import { describe, it, expect } from "vitest";
import { sanitizeApiMessages } from "../src/lib/chatMessages";

// Regression coverage for the empty-reply bug: empty assistant rows from failed
// turns were being sent to Anthropic, which then returned nothing.
describe("sanitizeApiMessages", () => {
  it("drops empty / whitespace-only messages", () => {
    const out = sanitizeApiMessages([
      { role: "user", content: "hi" },
      { role: "assistant", content: "" },
      { role: "user", content: "   " },
      { role: "assistant", content: "hello" },
    ]);
    expect(out).toEqual([
      { role: "user", content: "hi" },
      { role: "assistant", content: "hello" },
    ]);
  });

  it("merges consecutive same-role turns", () => {
    const out = sanitizeApiMessages([
      { role: "user", content: "a" },
      { role: "user", content: "b" },
    ]);
    expect(out).toEqual([{ role: "user", content: "a\n\nb" }]);
  });

  it("coerces non-string content and drops it when empty", () => {
    const out = sanitizeApiMessages([
      { role: "user", content: "real" },
      { role: "assistant", content: { weird: true } as any },
    ]);
    expect(out).toEqual([{ role: "user", content: "real" }]);
  });

  it("handles a single user message and empty/missing input", () => {
    expect(sanitizeApiMessages([{ role: "user", content: "hi" }])).toEqual([{ role: "user", content: "hi" }]);
    expect(sanitizeApiMessages([])).toEqual([]);
    expect(sanitizeApiMessages(null)).toEqual([]);
  });
});
