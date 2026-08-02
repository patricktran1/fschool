import { describe, it, expect } from "vitest";
import { isHeading, sectionize, chunkText, sectionizePages } from "../api/rag";

describe("isHeading", () => {
  it("detects markdown, numbered, and keyword headings", () => {
    expect(isHeading("# Introduction")).toBe(true);
    expect(isHeading("Chapter 3: Cells")).toBe(true);
    expect(isHeading("1.2 Mitosis")).toBe(true);
    expect(isHeading("OVERVIEW")).toBe(true); // short all-caps
  });
  it("rejects normal prose", () => {
    expect(isHeading("The cell is the basic unit of life, discovered long ago.")).toBe(false);
    expect(isHeading("This sentence ends with a period.")).toBe(false);
  });
});

describe("sectionize", () => {
  it("splits on headings and captures each heading", () => {
    const text = "# Cells\n\nThe cell is the unit of life.\n\n# Mitosis\n\nMitosis divides a cell.";
    const secs = sectionize(text);
    expect(secs.length).toBe(2);
    expect(secs[0].heading).toBe("Cells");
    expect(secs[1].heading).toBe("Mitosis");
    expect(secs[0].text).toContain("unit of life");
  });
  it("falls back to a single section for unstructured text", () => {
    expect(sectionize("just one paragraph, no headings at all").length).toBe(1);
  });
});

describe("chunkText", () => {
  it("keeps short text as one chunk", () => {
    expect(chunkText("short text").length).toBe(1);
  });
  it("splits long text into bounded chunks, preserving content", () => {
    const long = "This is a sentence about biology. ".repeat(80); // ~2700 chars, one paragraph
    const chunks = chunkText(long);
    expect(chunks.length).toBeGreaterThan(1);
    for (const c of chunks) expect(c.length).toBeLessThanOrEqual(950);
    expect(chunks.join(" ")).toContain("biology");
  });
});

describe("sectionizePages", () => {
  it("tags sections with the page they came from", () => {
    const pages = [
      { page: 1, text: "# Intro\n\nWelcome to the course." },
      { page: 2, text: "# Topic A\n\nContent about topic A." },
    ];
    const secs = sectionizePages(pages);
    expect(secs.find(s => s.heading === "Intro")?.locStart).toBe(1);
    expect(secs.find(s => s.heading === "Topic A")?.locStart).toBe(2);
  });
});
