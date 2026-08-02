// Simulates a user pasting a big file into the app — the EXACT DocUpload.handleLargeDoc
// sequence against the running dev server:
//   1) POST /api/transcribe?action=sign      → signed upload URL
//   2) supabase.storage.uploadToSignedUrl    → file goes straight to Storage (browser path)
//   3) POST /api/extract { storagePath }      → server reads it from Storage and extracts
// The file's bytes NEVER go through the request body, so the 4.5MB limit can't apply.
//
//   node scripts/sim-upload.mjs        (dev server must be running on :5173)
import { readFileSync } from "fs";
import { createClient } from "@supabase/supabase-js";

const env = readFileSync(".env.local", "utf8");
const get = (k) => (env.match(new RegExp(`^${k}=(.+)$`, "m"))?.[1] || "").trim().replace(/^["']|["']$/g, "");
const SUPA_URL = get("VITE_SUPABASE_URL") || get("SUPABASE_URL");
const ANON = get("VITE_SUPABASE_ANON_KEY");
const DEV = process.env.DEV_URL || "http://localhost:5173";
const userId = "fixture-test-user";
const sb = createClient(SUPA_URL, ANON); // anon client, like the browser — the upload token authorizes

const files = [
  ["test-fixtures/big/big.ppt",  "application/vnd.ms-powerpoint", "lecture.ppt"],
  ["test-fixtures/big/big.pdf",  "application/pdf", "notes.pdf"],
  ["test-fixtures/big/big.pptx", "application/vnd.openxmlformats-officedocument.presentationml.presentation", "slides.pptx"],
  ["test-fixtures/big/big.docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document", "essay.docx"],
];

// Re-sign + re-upload, retrying on Node undici's intermittent "fetch failed" on large
// PUT bodies (a browser's fetch is reliable; this just makes the node sim deterministic).
async function signAndUpload(buf, type, name, attempts = 4) {
  for (let i = 1; i <= attempts; i++) {
    const sres = await fetch(`${DEV}/api/transcribe?action=sign`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ userId, filename: name }) });
    const sdata = await sres.json();
    if (!sres.ok || !sdata.path) return { error: "sign: " + JSON.stringify(sdata).slice(0, 140) };
    const up = await sb.storage.from("media-uploads").uploadToSignedUrl(sdata.path, sdata.token, buf, { contentType: type });
    if (!up.error) return { path: sdata.path };
    if (i === attempts) return { error: "upload: " + up.error.message };
    console.log(`  … upload attempt ${i} hit "${up.error.message}" — retrying`);
  }
}

let pass = 0;
for (const [path, type, name] of files) {
  const buf = readFileSync(path);
  console.log(`\n📎 Pasting ${name} — ${(buf.length / 1024 / 1024).toFixed(2)} MB`);
  try {
    const su = await signAndUpload(buf, type, name);
    if (su.error) { console.log("  ✗", su.error); continue; }
    console.log("  1) signed upload URL ✓");
    console.log("  2) uploaded straight to Storage ✓ (bytes bypassed the request body)");

    const eres = await fetch(`${DEV}/api/extract`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ storagePath: su.path, file_type: type, name }) });
    const edata = await eres.json();
    const ok = eres.ok && typeof edata.text === "string" && edata.text.includes("SENTINEL_BIG_4F2A");
    console.log(`  3) extract HTTP ${eres.status} → ${edata.chars ?? 0} chars, sentinel ${ok ? "found ✓" : "MISSING ✗ " + (edata.error || "")}`);
    if (ok) { pass++; console.log("  ✅ END-TO-END OK — exactly as if pasted in the app"); }
    else console.log("  ❌ FAILED");
  } catch (e) {
    console.log("  ✗ threw:", e.message);
  }
}
console.log(`\n${pass}/${files.length} big files made it through the real Storage path.\n`);
