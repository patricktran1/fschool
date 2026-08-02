// @vitest-environment node
// extract reads the upload via Blob.arrayBuffer() + Node Buffer — use the node env so
// these behave like the real Vercel runtime (jsdom's Blob.arrayBuffer is unreliable).
import { describe, it, expect, vi, beforeEach } from "vitest";
import { makeSupabaseMock, makeRes } from "./helpers";

// extract.ts builds its Supabase client lazily from process.env; mock createClient so
// the storagePath branch reads from our fake Storage instead of a real bucket.
vi.mock("@supabase/supabase-js", () => ({ createClient: vi.fn() }));
import { createClient } from "@supabase/supabase-js";

async function loadExtract(router: (ctx: any) => any) {
  const { client, calls } = makeSupabaseMock(router);
  vi.resetModules();
  (createClient as any).mockReturnValue(client);
  const mod = await import("../api/extract.ts");
  return { handler: mod.default, calls };
}

const post = (body: any) => ({ method: "POST", body });

beforeEach(() => {
  process.env.SUPABASE_URL = "http://localhost";
  process.env.SUPABASE_SERVICE_KEY = "test";
});

describe("extract from Storage (large-file path, bypasses the 4.5MB body limit)", () => {
  it("downloads the file from Storage, extracts text, and cleans up the temp upload", async () => {
    const { handler, calls } = await loadExtract((ctx) =>
      ctx.op === "download"
        ? { data: new Blob(["Lecture one. Cells are the unit of life."]), error: null }
        : { data: null, error: null });
    const res = makeRes();
    await handler(post({ storagePath: "u1/notes.txt", file_type: "text/plain", name: "notes.txt" }), res);

    expect(res.statusCode).toBe(200);
    expect(res.body.text).toContain("Cells are the unit of life");
    expect(calls.some(c => c.op === "remove")).toBe(true); // temp upload removed
  });

  it("400s with a clear message when the Storage download fails", async () => {
    const { handler } = await loadExtract((ctx) =>
      ctx.op === "download" ? { data: null, error: { message: "Object not found" } } : { data: null, error: null });
    const res = makeRes();
    await handler(post({ storagePath: "u1/missing.pdf", file_type: "application/pdf", name: "missing.pdf" }), res);

    expect(res.statusCode).toBe(400);
    expect(res.body.error).toContain("storage download");
  });

  it("still 400s a request with neither base64, storagePath, nor youtubeUrl", async () => {
    const { handler } = await loadExtract(() => ({ data: null, error: null }));
    const res = makeRes();
    await handler(post({ file_type: "text/plain", name: "x.txt" }), res);
    expect(res.statusCode).toBe(400);
  });
});
