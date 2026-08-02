import { describe, it, expect } from "vitest";
import { applyRerankOrder } from "../api/rag";

const hits = [{ id: "a" }, { id: "b" }, { id: "c" }, { id: "d" }];
const ids = (hs: any[]) => hs.map(h => h.id);

describe("applyRerankOrder", () => {
  it("reorders hits by the reranker's index order", () => {
    expect(ids(applyRerankOrder(hits, [2, 0, 1, 3]))).toEqual(["c", "a", "b", "d"]);
  });

  it("appends hits the reranker omitted, in original order (nothing is lost)", () => {
    expect(ids(applyRerankOrder(hits, [3, 1]))).toEqual(["d", "b", "a", "c"]);
  });

  it("dedups repeated indices", () => {
    expect(ids(applyRerankOrder(hits, [1, 1, 0]))).toEqual(["b", "a", "c", "d"]);
  });

  it("ignores out-of-range and non-integer indices", () => {
    expect(ids(applyRerankOrder(hits, [9, -1, 2.5, "x", 2]))).toEqual(["c", "a", "b", "d"]);
  });

  it("falls back to the original order for empty / invalid input", () => {
    expect(ids(applyRerankOrder(hits, []))).toEqual(["a", "b", "c", "d"]);
    expect(ids(applyRerankOrder(hits, null as any))).toEqual(["a", "b", "c", "d"]);
    expect(ids(applyRerankOrder(hits, undefined as any))).toEqual(["a", "b", "c", "d"]);
  });
});
