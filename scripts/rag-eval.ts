// scripts/rag-eval.ts — RAG retrieval eval harness. Ingests a small known corpus, runs a
// fixture of questions, and measures recall@1 / recall@3 / MRR WITH vs WITHOUT the reranker
// (so you can see whether reranking helps + catch retrieval regressions). Self-cleaning.
//   npx tsx scripts/rag-eval.ts
// Needs real Supabase (pgvector + rag_hybrid_search RPC) + OPENAI_API_KEY.
import { readFileSync } from "fs";
import { createClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";

const env = readFileSync(".env.local", "utf8");
const get = (k: string) => (env.match(new RegExp(`^${k}=(.+)$`, "m"))?.[1] || "").trim().replace(/^["']|["']$/g, "");
process.env.SUPABASE_URL = get("SUPABASE_URL") || get("VITE_SUPABASE_URL");
process.env.SUPABASE_SERVICE_KEY = get("SUPABASE_SERVICE_KEY");
process.env.OPENAI_API_KEY = get("OPENAI_API_KEY");
const service = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_KEY!, { auth: { persistSession: false } });

const corpus = [
  { title: "Cell Biology",  text: "Mitochondria are the powerhouse of the cell. They produce ATP through cellular respiration, releasing energy stored in glucose." },
  { title: "Plant Biology", text: "Photosynthesis lets plants convert sunlight into chemical energy. Chloroplasts capture light to make glucose and release oxygen." },
  { title: "Economics",     text: "In a market the price of a good settles where supply meets demand. Elasticity measures how quantity responds to a price change." },
  { title: "Physics",       text: "Newton's second law states that force equals mass times acceleration, F = ma. Every action has an equal and opposite reaction." },
  { title: "History",       text: "The French Revolution began in 1789 with the storming of the Bastille, overturning the monarchy and feudal privileges." },
  { title: "Chemistry",     text: "Covalent bonds hold atoms together by sharing electrons, while ionic bonds form when electrons transfer between atoms." },
];
const queries = [
  { q: "what organelle produces ATP in the cell?",   title: "Cell Biology" },
  { q: "how do plants turn sunlight into energy?",     title: "Plant Biology" },
  { q: "what sets the price of a good in a market?",   title: "Economics" },
  { q: "state Newton's second law of motion",          title: "Physics" },
  { q: "what year did the French Revolution start?",   title: "History" },
  { q: "what holds atoms together in a molecule?",     title: "Chemistry" },
];

const uid = "rag-eval-" + Date.now();
const email = `e2e-rageval-${Date.now()}@fschool-e2e.dev`;

async function runQuery(rag: any, body: any) {
  let out: any; const res: any = { statusCode: 200, setHeader() {}, status(c: number) { this.statusCode = c; return this; }, json(o: any) { out = o; return this; }, end(o: any) { if (o !== undefined) out = o; return this; } };
  await rag.default({ method: "POST", query: { action: "query" }, body }, res);
  return out;
}

async function evalMode(rag: any, rerank: boolean) {
  let r1 = 0, r3 = 0, mrr = 0;
  for (const { q, title } of queries) {
    const out = await runQuery(rag, { userId: uid, query: q, rerank, maxSections: 4 });
    const titles = (out?.passages || []).map((p: any) => p.title);
    const idx = titles.indexOf(title);
    if (idx === 0) r1++;
    if (idx >= 0 && idx < 3) r3++;
    if (idx >= 0) mrr += 1 / (idx + 1);
  }
  const n = queries.length;
  return { recall1: r1 / n, recall3: r3 / n, mrr: mrr / n };
}

async function run() {
  const rag = await import("../api/rag.ts");
  console.log("\n📊 RAG retrieval eval — ingesting corpus…");
  await service.from("users").insert({ id: uid, name: "RAG Eval", email });
  for (const doc of corpus) {
    const ing = await rag.ingest({ userId: uid, title: doc.title, kind: "text", text: doc.text });
    const documentId = ing.json?.documentId;
    if (!documentId) { console.log("  ingest failed for", doc.title, ing.json); continue; }
    for (let i = 0; i < 50; i++) { const e = await rag.embedBatch({ userId: uid, documentId }); if (e.json?.done) break; }
  }

  console.log(`  ${corpus.length} docs ingested, ${queries.length} queries.\n`);
  const base = await evalMode(rag, false);
  const rer  = await evalMode(rag, true);
  const pct = (x: number) => (x * 100).toFixed(0) + "%";
  const num = (x: number) => x.toFixed(3);
  console.log("                 recall@1   recall@3    MRR");
  console.log(`  baseline (RRF)   ${pct(base.recall1).padStart(6)}     ${pct(base.recall3).padStart(6)}    ${num(base.mrr)}`);
  console.log(`  + reranker       ${pct(rer.recall1).padStart(6)}     ${pct(rer.recall3).padStart(6)}    ${num(rer.mrr)}`);
  const delta = rer.mrr - base.mrr;
  console.log(`\n  MRR change with rerank: ${delta >= 0 ? "+" : ""}${num(delta)} ${delta > 0 ? "✅ better" : delta < 0 ? "⚠️ worse" : "no change"}`);
}

async function cleanup() {
  try { await service.from("users").delete().eq("id", uid); console.log("\n🧹 removed eval user + cascaded rag data"); }
  catch (e: any) { console.log("cleanup error:", e?.message); }
}

run().catch(e => console.error("RUN ERROR:", e?.message || e)).finally(() => cleanup());
