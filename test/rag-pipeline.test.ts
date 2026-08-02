import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { makeSupabaseMock, makeRes } from "./helpers";

// Mock the Supabase client so api/rag.ts (which builds one at module load) uses ours.
vi.mock("@supabase/supabase-js", () => ({ createClient: vi.fn() }));
import { createClient } from "@supabase/supabase-js";

// Re-import api/rag with a fresh module body bound to a per-test Supabase mock.
async function loadRag(router: (ctx: any) => any) {
  const { client, calls } = makeSupabaseMock(router);
  vi.resetModules();
  (createClient as any).mockReturnValue(client);
  const rag = await import("../api/rag.ts");
  return { rag, client, calls };
}

beforeEach(() => {
  process.env.SUPABASE_URL = "http://localhost";
  process.env.SUPABASE_SERVICE_KEY = "test";
  process.env.OPENAI_API_KEY = "test-openai";
});
afterEach(() => vi.unstubAllGlobals());

describe("ingest", () => {
  it("rejects missing userId / missing content", async () => {
    const { rag } = await loadRag(() => ({ error: null }));
    expect((await rag.ingest({})).status).toBe(400);
    expect((await rag.ingest({ userId: "u" })).status).toBe(400); // no text/pages
  });

  it("builds document → sections → chunks with consistent linkage", async () => {
    const { rag, calls } = await loadRag(() => ({ error: null }));
    const res = await rag.ingest({
      userId: "u1", title: "Bio", kind: "pdf",
      text: "# Cells\n\nThe cell is the unit of life.\n\n# Mitosis\n\nMitosis divides a cell.",
    });
    expect(res.status).toBe(200);
    expect(res.json.sections).toBe(2);
    expect(res.json.chunks).toBeGreaterThanOrEqual(2);

    const docInsert     = calls.find(c => c.table === "rag_documents" && c.op === "insert");
    const sectionInsert = calls.find(c => c.table === "rag_sections" && c.op === "insert");
    const chunkInsert   = calls.find(c => c.table === "rag_chunks" && c.op === "insert");
    expect(docInsert.payload.id).toBe(res.json.documentId);
    expect(docInsert.payload.user_id).toBe("u1");
    // every section belongs to the document; every chunk links to a real section
    const sectionIds = new Set(sectionInsert.payload.map((s: any) => s.id));
    for (const s of sectionInsert.payload) expect(s.document_id).toBe(res.json.documentId);
    for (const c of chunkInsert.payload) expect(sectionIds.has(c.section_id)).toBe(true);
  });

  it("propagates a DB error from the document insert", async () => {
    const { rag } = await loadRag((ctx) =>
      ctx.table === "rag_documents" ? { error: { message: "boom" } } : { error: null });
    const res = await rag.ingest({ userId: "u1", text: "hello world" });
    expect(res.status).toBe(500);
    expect(res.json.error).toContain("boom");
  });
});

describe("embedBatch", () => {
  it("requires userId + documentId", async () => {
    const { rag } = await loadRag(() => ({ data: [], error: null }));
    expect((await rag.embedBatch({ userId: "u" })).status).toBe(400);
  });

  it("embeds pending chunks via OpenAI and reports done", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({ data: [{ index: 0, embedding: Array(1536).fill(0.01) }] }),
    }));
    vi.stubGlobal("fetch", fetchMock);

    const { rag, calls } = await loadRag((ctx) =>
      ctx.table === "rag_chunks" && ctx.op === "select"
        ? { data: [{ id: "c1", section_id: "s1", document_id: "d1", user_id: "u1", course_id: null, content: "the cell" }], error: null }
        : { error: null });

    const res = await rag.embedBatch({ userId: "u1", documentId: "d1" });
    expect(res.status).toBe(200);
    expect(res.json.embedded).toBe(1);
    expect(res.json.done).toBe(true); // fewer than a full batch → queue drained
    expect(fetchMock).toHaveBeenCalledWith("https://api.openai.com/v1/embeddings", expect.anything());
    expect(calls.some(c => c.table === "rag_chunks" && c.op === "upsert")).toBe(true);
  });
});

describe("query (via handler)", () => {
  it("maps ranked chunks to parent sections with citations", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({
      ok: true, json: async () => ({ data: [{ index: 0, embedding: Array(1536).fill(0.01) }] }),
    })));

    const { rag } = await loadRag((ctx) => {
      if (ctx.op === "rpc") return { data: [{ section_id: "s1" }, { section_id: "s2" }], error: null };
      if (ctx.table === "rag_sections") return { data: [{ id: "s1", document_id: "d1", heading: "Cells", ordinal: 0, loc_start: 3, loc_end: 3, full_text: "The cell is the unit of life." }], error: null };
      if (ctx.table === "rag_documents") return { data: [{ id: "d1", title: "Bio Notes" }], error: null };
      return { data: null, error: null };
    });

    const res = makeRes();
    await rag.default({ method: "POST", query: { action: "query" }, body: { userId: "u1", query: "what is a cell" } }, res);
    expect(res.statusCode).toBe(200);
    expect(res.body.passages).toHaveLength(1);
    expect(res.body.passages[0].title).toBe("Bio Notes");
    expect(res.body.passages[0].loc).toBe("p.3");
  });

  it("returns 400 for a query with no text", async () => {
    const { rag } = await loadRag(() => ({ data: [], error: null }));
    const res = makeRes();
    await rag.default({ method: "POST", query: { action: "query" }, body: { userId: "u1" } }, res);
    expect(res.statusCode).toBe(400);
  });
});
