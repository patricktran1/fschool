// scripts/rls-verify.ts — proves Tier A RLS isolation with two REAL users: each can read
// only their OWN rows in a per-user table. Reports ENFORCED (migration applied) vs NOT
// ENFORCED (run supabase-rls-client-tables.sql first). Creates + DELETES test data.
//   npx tsx scripts/rls-verify.ts
import { readFileSync } from "fs";
import { createClient } from "@supabase/supabase-js";

const env = readFileSync(".env.local", "utf8");
const get = (k: string) => (env.match(new RegExp(`^${k}=(.+)$`, "m"))?.[1] || "").trim().replace(/^["']|["']$/g, "");
const URL = get("SUPABASE_URL") || get("VITE_SUPABASE_URL");
const SERVICE = get("SUPABASE_SERVICE_KEY");
const ANON = get("VITE_SUPABASE_ANON_KEY") || get("SUPABASE_ANON_KEY");
process.env.SUPABASE_URL = URL; process.env.SUPABASE_SERVICE_KEY = SERVICE;

const service = createClient(URL, SERVICE, { auth: { persistSession: false } });
const freshAnon = () => createClient(URL, ANON, { auth: { persistSession: false, autoRefreshToken: false } });
const ts = Date.now();
const TABLE = "srs_reviews"; // a Tier A per-user table (user_id + card_key)
const emails: string[] = [];

async function callMigrate(action: string, body: any) {
  const { default: handler } = await import("../api/auth-migrate.ts");
  let out: any; const res: any = { statusCode: 200, setHeader() {}, status(c: number) { this.statusCode = c; return this; }, json(o: any) { out = o; return this; }, end(o: any) { if (o !== undefined) out = o; return this; } };
  await handler({ method: "POST", query: { action }, body }, res);
  return out;
}
async function mkUser(kind: string) {
  const email = `e2e-${kind}-${ts}@fschool-e2e.dev`.toLowerCase(); emails.push(email); // endpoint lowercases — match it
  const password = "Passw0rd!" + kind;
  const out = await callMigrate("signup", { name: `RLS ${kind}`, email, password });
  const anon = freshAnon();
  await anon.auth.signInWithPassword({ email, password });
  return { id: out?.userId as string, anon };
}

async function run() {
  console.log("\n🔒 RLS isolation check (Tier A) — two real users\n");
  const A = await mkUser("rlsA");
  const B = await mkUser("rlsB");

  const insA = await A.anon.from(TABLE).insert({ user_id: A.id, card_key: `rls-${ts}-A` });
  const insB = await B.anon.from(TABLE).insert({ user_id: B.id, card_key: `rls-${ts}-B` });
  if (insA.error || insB.error) console.log("  (insert note:", insA.error?.message || insB.error?.message, ")");

  const aOwn  = await A.anon.from(TABLE).select("card_key").eq("user_id", A.id);
  const aSeesB = await A.anon.from(TABLE).select("card_key").eq("user_id", B.id);
  const bSeesA = await B.anon.from(TABLE).select("card_key").eq("user_id", A.id);

  const ownOk  = (aOwn.data?.length ?? 0) >= 1;
  const aBlocked = (aSeesB.data?.length ?? 0) === 0;
  const bBlocked = (bSeesA.data?.length ?? 0) === 0;
  console.log(`  A reads own row:        ${ownOk ? "yes ✅" : "NO ❌"}`);
  console.log(`  A blocked from B's row: ${aBlocked ? "yes ✅" : `NO ❌ (saw ${aSeesB.data?.length})`}`);
  console.log(`  B blocked from A's row: ${bBlocked ? "yes ✅" : `NO ❌ (saw ${bSeesA.data?.length})`}`);
  console.log(`\n  RLS isolation: ${ownOk && aBlocked && bBlocked
    ? "✅ ENFORCED"
    : "⚠️  NOT ENFORCED — run supabase-rls-client-tables.sql (Tier A) in the SQL editor, then re-run this."}`);
}

async function cleanup() {
  console.log("\n🧹 Cleanup");
  try { await service.from(TABLE).delete().like("card_key", `rls-${ts}-%`); } catch (e: any) { console.log("  row cleanup:", e?.message); }
  for (const email of emails) {
    try {
      const { data: row } = await service.from("users").select("id, auth_id").eq("email", email).maybeSingle();
      if (!row) { console.log("  (not found)", email); continue; }
      if (row.auth_id) { try { await service.auth.admin.deleteUser(row.auth_id); } catch { /* gone */ } }
      await service.from("users").delete().eq("id", row.id); // cascades srs_reviews
      console.log("  removed", email);
    } catch (e: any) { console.log("  FAILED", email, e?.message); }
  }
}

run().catch(e => console.error("RUN ERROR:", e?.message || e)).finally(() => cleanup().catch(e => console.error("CLEANUP ERROR:", e?.message || e)));
