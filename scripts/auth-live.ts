// scripts/auth-live.ts — REAL end-to-end auth verification against Supabase/GoTrue.
// Exercises the endpoints the client depends on (signup / lazy-migrate / reset) plus a real
// signInWithPassword via the anon client. Creates real test accounts and DELETES them after
// (self-cleaning, even on error).
//
//   npx tsx scripts/auth-live.ts
import { readFileSync } from "fs";
import { createClient } from "@supabase/supabase-js";
import { createHash, randomUUID } from "node:crypto";

const env = readFileSync(".env.local", "utf8");
const get = (k: string) => (env.match(new RegExp(`^${k}=(.+)$`, "m"))?.[1] || "").trim().replace(/^["']|["']$/g, "");
const URL = get("SUPABASE_URL") || get("VITE_SUPABASE_URL");
const SERVICE = get("SUPABASE_SERVICE_KEY");
const ANON = get("VITE_SUPABASE_ANON_KEY") || get("SUPABASE_ANON_KEY");
process.env.SUPABASE_URL = URL;
process.env.SUPABASE_SERVICE_KEY = SERVICE;

const service = createClient(URL, SERVICE, { auth: { persistSession: false } });
const sha256 = (s: string) => createHash("sha256").update(s, "utf8").digest("hex");
const freshAnon = () => createClient(URL, ANON, { auth: { persistSession: false, autoRefreshToken: false } });
const ts = Date.now();
const emails: string[] = [];
const mkEmail = (kind: string) => { const e = `e2e-${kind}-${ts}@fschool-e2e.dev`; emails.push(e); return e; };

async function callMigrate(action: string, body: any) {
  const { default: handler } = await import("../api/auth-migrate.ts");
  let out: any; const res: any = { statusCode: 200, setHeader() {}, status(c: number) { this.statusCode = c; return this; }, json(o: any) { out = o; return this; }, end(o: any) { if (o !== undefined) out = o; return this; } };
  await handler({ method: "POST", query: { action }, body }, res);
  return { status: res.statusCode, body: out };
}

let pass = 0, total = 0;
const check = (name: string, cond: boolean, detail = "") => { total++; cond ? (pass++, console.log(`  ✅ ${name}`)) : console.log(`  ❌ ${name}  ${detail}`); };

async function run() {
  console.log("\n🔐 Live auth verification (creates + deletes real test accounts)\n");

  // A) New signup → real GoTrue session
  console.log("A) New signup");
  const aEmail = mkEmail("signup"), aPw = "Passw0rd!A";
  const aSignup = await callMigrate("signup", { name: "E2E Signup", email: aEmail, password: aPw });
  check("signup endpoint → 200 + userId", aSignup.status === 200 && !!aSignup.body?.userId, JSON.stringify(aSignup.body));
  const aLogin = await freshAnon().auth.signInWithPassword({ email: aEmail, password: aPw });
  check("signInWithPassword returns a session", !!aLogin.data?.session && !aLogin.error, aLogin.error?.message || "");

  // B) Legacy account (password_hash, no auth_id) → lazy migrate → session
  console.log("\nB) Legacy lazy-migration");
  const bEmail = mkEmail("legacy"), bPw = "Passw0rd!B", bId = randomUUID();
  await service.from("users").insert({ id: bId, name: "E2E Legacy", email: bEmail, password_hash: sha256(bPw) });
  const preLogin = await freshAnon().auth.signInWithPassword({ email: bEmail, password: bPw });
  check("pre-migration login FAILS (not in GoTrue yet)", !preLogin.data?.session && !!preLogin.error);
  const bMig = await callMigrate("migrate", { email: bEmail, password: bPw });
  check("migrate endpoint → 200 migrated", bMig.status === 200 && bMig.body?.migrated === true, JSON.stringify(bMig.body));
  const postLogin = await freshAnon().auth.signInWithPassword({ email: bEmail, password: bPw });
  check("post-migration login returns a session", !!postLogin.data?.session && !postLogin.error, postLogin.error?.message || "");
  const { data: bRow } = await service.from("users").select("auth_id").eq("id", bId).maybeSingle();
  check("users.auth_id is now linked", !!bRow?.auth_id);

  // C) Wrong password → migrate rejects (no enumeration, no GoTrue user created)
  console.log("\nC) Wrong password");
  const cEmail = mkEmail("wrongpw"), cPw = "Passw0rd!C", cId = randomUUID();
  await service.from("users").insert({ id: cId, name: "E2E Wrong", email: cEmail, password_hash: sha256(cPw) });
  const cMig = await callMigrate("migrate", { email: cEmail, password: "totally-wrong" });
  check("migrate with wrong password → 401", cMig.status === 401, JSON.stringify(cMig.body));

  // D) Password reset via ?action=reset (the flow just migrated in App.tsx)
  console.log("\nD) Password reset");
  const dEmail = mkEmail("reset"), dPw = "Passw0rd!D", dNew = "Passw0rd!D-new";
  const dSignup = await callMigrate("signup", { name: "E2E Reset", email: dEmail, password: dPw });
  const dId = dSignup.body?.userId, token = "e2e-reset-token-" + ts;
  await service.from("users").update({ email_verify_token: token }).eq("id", dId);
  const dReset = await callMigrate("reset", { userId: dId, token, password: dNew });
  check("reset endpoint → 200", dReset.status === 200, JSON.stringify(dReset.body));
  const dNewLogin = await freshAnon().auth.signInWithPassword({ email: dEmail, password: dNew });
  check("login with NEW password works", !!dNewLogin.data?.session && !dNewLogin.error, dNewLogin.error?.message || "");
  const dOldLogin = await freshAnon().auth.signInWithPassword({ email: dEmail, password: dPw });
  check("login with OLD password fails", !dOldLogin.data?.session && !!dOldLogin.error);
  const dReuse = await callMigrate("reset", { userId: dId, token, password: "x" });
  check("reset token is single-use (reuse → 401)", dReuse.status === 401, JSON.stringify(dReuse.body));

  console.log(`\n${pass}/${total} checks passed`);
}

async function cleanup() {
  console.log("\n🧹 Cleanup");
  for (const email of emails) {
    try {
      const { data: row } = await service.from("users").select("id, auth_id").eq("email", email).maybeSingle();
      if (row?.auth_id) { try { await service.auth.admin.deleteUser(row.auth_id); } catch { /* may already be gone */ } }
      if (row?.id) await service.from("users").delete().eq("id", row.id); // builder is thenable — await, don't .catch
      console.log(`  removed ${email}`);
    } catch (e: any) {
      console.log(`  FAILED ${email}: ${e?.message}`);
    }
  }
}

run().catch(e => console.error("RUN ERROR:", e?.message || e)).finally(() => cleanup().catch(e => console.error("CLEANUP ERROR:", e?.message || e)));
