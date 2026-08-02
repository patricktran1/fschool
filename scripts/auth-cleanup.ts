// scripts/auth-cleanup.ts — removes any leftover e2e auth test accounts (GoTrue user +
// public.users row) matching the test email pattern. Safe to run repeatedly.
//   npx tsx scripts/auth-cleanup.ts
import { readFileSync } from "fs";
import { createClient } from "@supabase/supabase-js";

const env = readFileSync(".env.local", "utf8");
const get = (k: string) => (env.match(new RegExp(`^${k}=(.+)$`, "m"))?.[1] || "").trim().replace(/^["']|["']$/g, "");
const service = createClient(get("SUPABASE_URL") || get("VITE_SUPABASE_URL"), get("SUPABASE_SERVICE_KEY"), { auth: { persistSession: false } });

const { data: rows, error } = await service.from("users").select("id, auth_id, email").like("email", "e2e-%@fschool-e2e.dev");
if (error) { console.error("lookup failed:", error.message); process.exit(1); }
console.log(`found ${rows?.length || 0} leftover test accounts`);
for (const r of rows || []) {
  if (r.auth_id) { try { await service.auth.admin.deleteUser(r.auth_id); } catch (e: any) { /* may already be gone */ } }
  try { await service.from("users").delete().eq("id", r.id); console.log("  removed", r.email); }
  catch (e: any) { console.log("  FAILED to remove", r.email, e?.message); }
}
console.log("cleanup done");
