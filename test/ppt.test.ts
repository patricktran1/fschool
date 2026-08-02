import { describe, it, expect } from "vitest";
import { extractPptText } from "../api/extract";

// Build a PowerPoint binary record: [verInstance LE][recType LE][recLen LE][body].
// verInstance low nibble 0xF marks a container; otherwise it's a leaf atom.
function rec(verInstance: number, recType: number, body: Buffer): Buffer {
  const h = Buffer.alloc(8);
  h.writeUInt16LE(verInstance, 0);
  h.writeUInt16LE(recType, 2);
  h.writeUInt32LE(body.length, 4);
  return Buffer.concat([h, body]);
}
const textBytes = (s: string) => rec(0x0000, 0x0fa8, Buffer.from(s, "latin1"));   // TextBytesAtom
const textChars = (s: string) => rec(0x0000, 0x0fa0, Buffer.from(s, "utf16le"));  // TextCharsAtom
const slide     = (children: Buffer) => rec(0x000f, 0x03ee, children);            // Slide container
const persist   = () => rec(0x0000, 0x03f3, Buffer.alloc(20));                     // SlidePersistAtom

describe("extractPptText", () => {
  it("extracts both UTF-16 and byte text, bucketed by slide", () => {
    const stream = Buffer.concat([
      textBytes("Title One"),
      textChars("Body in unicode"),
      slide(textBytes("Second Slide")),
    ]);
    const pages = extractPptText(stream);
    expect(pages).toHaveLength(2);
    expect(pages[0].text).toContain("Title One");
    expect(pages[0].text).toContain("Body in unicode");
    expect(pages[1].text).toContain("Second Slide");
    expect(pages[1].text).toMatch(/# Slide 2/);
  });

  it("splits slides on SlidePersistAtom (the outline delimiter)", () => {
    const stream = Buffer.concat([
      textBytes("Intro"),
      persist(), textBytes("Slide A"),
      persist(), textBytes("Slide B"),
    ]);
    const pages = extractPptText(stream);
    expect(pages).toHaveLength(3);
    expect(pages[2].text).toContain("Slide B");
  });

  it("de-duplicates runs that appear in both the outline and the slide", () => {
    const stream = Buffer.concat([
      textBytes("Repeated Heading"),
      slide(textBytes("Repeated Heading")), // dup → deduped → empty slide bucket dropped
    ]);
    const pages = extractPptText(stream);
    expect(pages).toHaveLength(1);
    expect(pages[0].text).toContain("Repeated Heading");
  });

  it("converts vertical-tab / CR control chars to line breaks and strips nulls", () => {
    const pages = extractPptText(textBytes("Line A\x0bLine B\x0d"));
    expect(pages[0].text).toContain("Line A\nLine B");
  });

  it("returns [] for an empty or too-short stream (no crash)", () => {
    expect(extractPptText(Buffer.from([0, 0, 0, 0]))).toEqual([]);
    expect(extractPptText(new Uint8Array(0))).toEqual([]);
  });
});
