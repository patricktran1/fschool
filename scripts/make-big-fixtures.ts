// Generates ~5MB versions of each document format (well over Vercel's 4.5MB body limit)
// and runs each through the real extract handler to prove extraction works at size.
// Files land in ./test-fixtures/big (gitignored — regenerate with this script).
//
//   npx tsx scripts/make-big-fixtures.ts
//
// Verifies via the local base64 path (no body limit in a script) to prove the PARSERS
// handle big files. The Storage *transport* at size is proven separately (6MB round-trip).
import { writeFileSync, mkdirSync } from "fs";
import { resolve } from "path";
import JSZip from "jszip";
import * as CFBmod from "cfb";
const CFB: any = (CFBmod as any).default ?? CFBmod;

const DIR = resolve(process.cwd(), "test-fixtures/big");
mkdirSync(DIR, { recursive: true });
const S = "SENTINEL_BIG_4F2A";
const TARGET = 5 * 1024 * 1024; // ~5MB, clears the 4.5MB body limit with margin
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const BASE = "The cell is the basic unit of life; mitochondria produce ATP through cellular respiration. ";

// ── .txt ──────────────────────────────────────────────────────────────────
const bigTxt = Buffer.from(`${S}\n` + BASE.repeat(Math.ceil(TARGET / BASE.length)), "utf8");

// ── .pdf — real page-1 text (the sentinel) + a big UNREFERENCED filler stream so the
// file is >4.5MB without making pdfjs chew through millions of glyphs. ──────────
function makeBigPdf(): Buffer {
  const content = `BT /F1 18 Tf 72 720 Td (${S} - big PDF) Tj 0 -26 Td (Photosynthesis converts light to energy.) Tj ET`;
  const filler = "0".repeat(TARGET); // ~5MB, not referenced by any page
  const objs: string[] = [];
  objs[1] = "<</Type/Catalog/Pages 2 0 R>>";
  objs[2] = "<</Type/Pages/Kids[3 0 R]/Count 1>>";
  objs[3] = "<</Type/Page/Parent 2 0 R/MediaBox[0 0 612 792]/Contents 4 0 R/Resources<</Font<</F1 5 0 R>>>>>>";
  objs[4] = `<</Length ${Buffer.byteLength(content, "latin1")}>>\nstream\n${content}\nendstream`;
  objs[5] = "<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>";
  objs[6] = `<</Length ${filler.length}>>\nstream\n${filler}\nendstream`;
  let pdf = "%PDF-1.4\n"; const off: number[] = [];
  for (let i = 1; i <= 6; i++) { off[i] = Buffer.byteLength(pdf, "latin1"); pdf += `${i} 0 obj\n${objs[i]}\nendobj\n`; }
  const xref = Buffer.byteLength(pdf, "latin1");
  pdf += "xref\n0 7\n0000000000 65535 f \n";
  for (let i = 1; i <= 6; i++) pdf += `${String(off[i]).padStart(10, "0")} 00000 n \n`;
  pdf += `trailer\n<</Size 7/Root 1 0 R>>\nstartxref\n${xref}\n%%EOF`;
  return Buffer.from(pdf, "latin1");
}

// ── .docx — many paragraphs (zip is stored uncompressed → file ≈ text size) ──
async function makeBigDocx(): Promise<Buffer> {
  const zip = new JSZip();
  zip.file("[Content_Types].xml", `<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`);
  zip.file("_rels/.rels", `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`);
  const para = `<w:p><w:r><w:t xml:space="preserve">${esc(BASE)}</w:t></w:r></w:p>`;
  let body = `<w:p><w:r><w:t>${esc(`${S} - big DOCX`)}</w:t></w:r></w:p>`;
  while (body.length < TARGET) body += para;
  zip.file("word/document.xml", `<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}</w:body></w:document>`);
  return zip.generateAsync({ type: "nodebuffer" });
}

// ── .pptx — many slides, each with many paragraphs ──────────────────────────
async function makeBigPptx(): Promise<Buffer> {
  const zip = new JSZip();
  const para = `<a:p><a:r><a:t>${esc(BASE)}</a:t></a:r></a:p>`;
  const slides: string[] = []; let total = 0;
  while (total < TARGET) {
    const head = slides.length === 0 ? `<a:p><a:r><a:t>${esc(`${S} - big PPTX`)}</a:t></a:r></a:p>` : `<a:p><a:r><a:t>Slide ${slides.length + 1}</a:t></a:r></a:p>`;
    const body = head + para.repeat(1500);
    slides.push(body); total += body.length;
  }
  zip.file("[Content_Types].xml", `<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/>${slides.map((_, k) => `<Override PartName="/ppt/slides/slide${k + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>`).join("")}</Types>`);
  zip.file("_rels/.rels", `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="ppt/presentation.xml"/></Relationships>`);
  zip.file("ppt/presentation.xml", `<?xml version="1.0"?><p:presentation xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"/>`);
  slides.forEach((body, k) => zip.file(`ppt/slides/slide${k + 1}.xml`, `<?xml version="1.0"?><p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><p:cSld><p:spTree><p:sp><p:txBody>${body}</p:txBody></p:sp></p:spTree></p:cSld></p:sld>`));
  return zip.generateAsync({ type: "nodebuffer" });
}

// ── .ppt — legacy OLE2; each slide a unique TextBytesAtom (unique → not de-duped) ──
function rec(verInstance: number, recType: number, body: Buffer): Buffer {
  const h = Buffer.alloc(8); h.writeUInt16LE(verInstance, 0); h.writeUInt16LE(recType, 2); h.writeUInt32LE(body.length, 4);
  return Buffer.concat([h, body]);
}
function makeBigPpt(): Buffer {
  const slides: string[] = []; let total = 0;
  while (total < TARGET) {
    const head = slides.length === 0 ? `${S} - big PPT slide one. ` : `Slide ${slides.length + 1} unique. `;
    const s = head + BASE.repeat(12000);
    slides.push(s); total += s.length;
  }
  const stream = Buffer.concat(slides.map(s => rec(0x000f, 0x03ee, rec(0x0000, 0x0fa8, Buffer.from(s, "latin1")))));
  const cfb = CFB.utils.cfb_new();
  CFB.utils.cfb_add(cfb, "PowerPoint Document", stream);
  return CFB.write(cfb, { type: "buffer" });
}

async function run() {
  const files: { name: string; buf: Buffer; type: string }[] = [
    { name: "big.txt",  buf: bigTxt,              type: "text/plain" },
    { name: "big.pdf",  buf: makeBigPdf(),        type: "application/pdf" },
    { name: "big.docx", buf: await makeBigDocx(), type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" },
    { name: "big.pptx", buf: await makeBigPptx(), type: "application/vnd.openxmlformats-officedocument.presentationml.presentation" },
    { name: "big.ppt",  buf: makeBigPpt(),        type: "application/vnd.ms-powerpoint" },
  ];

  const { default: handler } = await import("../api/extract.ts");
  console.log(`\nWrote big fixtures to ${DIR}\n`);
  for (const f of files) {
    writeFileSync(resolve(DIR, f.name), f.buf);
    const mb = (f.buf.length / 1024 / 1024).toFixed(2);
    const over = f.buf.length > 4.5 * 1024 * 1024 ? "over 4.5MB ✓" : "UNDER 4.5MB ✗";
    let out: any; const res: any = { statusCode: 200, setHeader() {}, status(c: number) { this.statusCode = c; return this; }, json(o: any) { out = o; return this; }, end(o: any) { if (o !== undefined) out = o; return this; } };
    const t0 = Date.now();
    try {
      await handler({ method: "POST", body: { base64: f.buf.toString("base64"), file_type: f.type, name: f.name } }, res);
      const ok = res.statusCode === 200 && String(out?.text || "").includes(S);
      console.log(`  ${ok ? "✅" : "❌"} ${f.name.padEnd(9)} ${mb.padStart(5)} MB (${over})  → extracted ${String(out?.chars ?? 0).padStart(7)} chars in ${Date.now() - t0}ms, sentinel ${ok ? "found" : "MISSING " + JSON.stringify(out?.error || "")}`);
    } catch (e: any) {
      console.log(`  ❌ ${f.name.padEnd(9)} ${mb} MB  → threw: ${e.message}`);
    }
  }
  console.log("");
}
run().catch(e => { console.error(e); process.exit(1); });
