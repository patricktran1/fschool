import { describe, it, expect } from "vitest";
import { reconstructPage } from "../api/extract";

// Mimic a pdfjs text item: transform = [a, b, c, d, x, y]; height ~ font size.
function item(str: string, x: number, y: number, h: number) {
  return { str, transform: [h, 0, 0, h, x, y], height: h, hasEOL: false };
}

describe("reconstructPage", () => {
  it("marks larger-font lines as headings and keeps body text", () => {
    const out = reconstructPage([
      item("Chapter 1: Cells", 72, 700, 22),
      item("The cell is the basic unit of life.", 72, 670, 11),
      item("It was discovered by Robert Hooke.", 72, 654, 11),
    ]);
    expect(out).toContain("# Chapter 1: Cells");
    expect(out).toContain("basic unit of life");
    expect(out).toContain("Robert Hooke");
  });

  it("inserts a paragraph break on a large vertical gap", () => {
    const out = reconstructPage([
      item("First paragraph line one.", 72, 700, 11),
      item("First paragraph line two.", 72, 684, 11),   // normal gap (16)
      item("Second paragraph after a gap.", 72, 650, 11), // big gap (34)
      item("Second paragraph line two.", 72, 634, 11),
    ]);
    expect(out).toMatch(/line two\.\n\nSecond paragraph after a gap/);
  });

  it("groups items on the same line left-to-right", () => {
    const out = reconstructPage([
      item("Hello", 72, 700, 11),
      item("world", 120, 700, 11), // same y → same line
    ]);
    expect(out.replace(/\s+/g, " ")).toContain("Hello world");
  });

  it("returns empty string for no items", () => {
    expect(reconstructPage([])).toBe("");
  });
});
