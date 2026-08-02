// Generates a valid sample file for every format the extract pipeline supports — with
// the correct extension and a known SENTINEL string — into ./test-fixtures, then runs
// each through the real api/extract handler to confirm the text comes back.
//
//   npx tsx scripts/make-fixtures.ts
//
// Document formats are generated with real, extractable content and verified offline.
// Images/audio need OCR/transcription (an API key + real content), so we emit valid
// placeholder files but skip extraction for them.
import { writeFileSync, mkdirSync } from "fs";
import { resolve } from "path";
import zlib from "zlib";
import JSZip from "jszip";
import * as CFBmod from "cfb";
const CFB: any = (CFBmod as any).default ?? CFBmod;

const DIR = resolve(process.cwd(), "test-fixtures");
mkdirSync(DIR, { recursive: true });
const S = "SENTINEL_FSCHOOL_4F2A"; // the marker we look for after extraction
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

// ── .txt / .md / .html ──────────────────────────────────────────────────────
const txt  = `${S}\nPlain-text fixture. The cell is the basic unit of life.`;
const md   = `# ${S}\n\nMarkdown fixture.\n\n- Mitosis divides a cell\n- Meiosis makes gametes`;
const html = `<!doctype html><html><body><h1>${S}</h1><p>HTML fixture about photosynthesis.</p></body></html>`;

// ── .pdf (minimal valid PDF with a text layer + correct xref offsets) ─────────
function makePdf(lines: string[]): Buffer {
  const objs: string[] = [];
  objs[1] = "<</Type/Catalog/Pages 2 0 R>>";
  objs[2] = "<</Type/Pages/Kids[3 0 R]/Count 1>>";
  objs[3] = "<</Type/Page/Parent 2 0 R/MediaBox[0 0 612 792]/Contents 4 0 R/Resources<</Font<</F1 5 0 R>>>>>>";
  const draw = lines.map((l, i) => `${i === 0 ? "72 720 Td" : "0 -26 Td"} (${l.replace(/([()\\])/g, "\\$1")}) Tj`).join(" ");
  const stream = `BT /F1 18 Tf ${draw} ET`;
  objs[4] = `<</Length ${Buffer.byteLength(stream, "latin1")}>>\nstream\n${stream}\nendstream`;
  objs[5] = "<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>";
  let pdf = "%PDF-1.4\n";
  const off: number[] = [];
  for (let i = 1; i <= 5; i++) { off[i] = Buffer.byteLength(pdf, "latin1"); pdf += `${i} 0 obj\n${objs[i]}\nendobj\n`; }
  const xref = Buffer.byteLength(pdf, "latin1");
  pdf += "xref\n0 6\n0000000000 65535 f \n";
  for (let i = 1; i <= 5; i++) pdf += `${String(off[i]).padStart(10, "0")} 00000 n \n`;
  pdf += `trailer\n<</Size 6/Root 1 0 R>>\nstartxref\n${xref}\n%%EOF`;
  return Buffer.from(pdf, "latin1");
}

// ── .docx (Office Open XML, read by mammoth) ──────────────────────────────────
async function makeDocx(lines: string[]): Promise<Buffer> {
  const zip = new JSZip();
  zip.file("[Content_Types].xml", `<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`);
  zip.file("_rels/.rels", `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`);
  const ps = lines.map(t => `<w:p><w:r><w:t xml:space="preserve">${esc(t)}</w:t></w:r></w:p>`).join("");
  zip.file("word/document.xml", `<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${ps}</w:body></w:document>`);
  return zip.generateAsync({ type: "nodebuffer" });
}

// ── .pptx (Office Open XML, slides read by pptxToPages) ───────────────────────
async function makePptx(slides: string[][]): Promise<Buffer> {
  const zip = new JSZip();
  zip.file("[Content_Types].xml", `<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/>${slides.map((_, i) => `<Override PartName="/ppt/slides/slide${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>`).join("")}</Types>`);
  zip.file("_rels/.rels", `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="ppt/presentation.xml"/></Relationships>`);
  zip.file("ppt/presentation.xml", `<?xml version="1.0"?><p:presentation xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"/>`);
  slides.forEach((paras, i) => {
    const body = paras.map(t => `<a:p><a:r><a:t>${esc(t)}</a:t></a:r></a:p>`).join("");
    zip.file(`ppt/slides/slide${i + 1}.xml`, `<?xml version="1.0"?><p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><p:cSld><p:spTree><p:sp><p:txBody>${body}</p:txBody></p:sp></p:spTree></p:cSld></p:sld>`);
  });
  return zip.generateAsync({ type: "nodebuffer" });
}

// ── .ppt (legacy OLE2 binary, read by pptToPages → extractPptText) ────────────
function rec(verInstance: number, recType: number, body: Buffer): Buffer {
  const h = Buffer.alloc(8);
  h.writeUInt16LE(verInstance, 0); h.writeUInt16LE(recType, 2); h.writeUInt32LE(body.length, 4);
  return Buffer.concat([h, body]);
}
function makePpt(slides: string[]): Buffer {
  // Each slide = a Slide container (0x03EE) wrapping a TextBytesAtom (0x0FA8).
  const stream = Buffer.concat(slides.map(s => rec(0x000f, 0x03ee, rec(0x0000, 0x0fa8, Buffer.from(s, "latin1")))));
  const cfb = CFB.utils.cfb_new();
  CFB.utils.cfb_add(cfb, "PowerPoint Document", stream);
  return CFB.write(cfb, { type: "buffer" });
}

// ── .png (valid RGB image; no text → OCR placeholder) ─────────────────────────
const CRC_T = (() => { const t: number[] = []; for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
const crc32 = (b: Buffer) => { let c = 0xffffffff; for (const x of b) c = CRC_T[(c ^ x) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
function pngChunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length, 0);
  const td = Buffer.concat([Buffer.from(type, "latin1"), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td), 0);
  return Buffer.concat([len, td, crc]);
}
function makePng(w = 96, h = 32): Buffer {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2; // 8-bit RGB
  const raw = Buffer.alloc(h * (1 + w * 3));
  for (let y = 0; y < h; y++) { const o = y * (1 + w * 3); for (let x = 0; x < w; x++) { const p = o + 1 + x * 3; raw[p] = 30; raw[p + 1] = 120; raw[p + 2] = 200; } }
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), pngChunk("IHDR", ihdr), pngChunk("IDAT", zlib.deflateSync(raw)), pngChunk("IEND", Buffer.alloc(0))]);
}

// ── .wav (valid 16-bit PCM tone; no speech → transcription placeholder) ───────
function makeWav(seconds = 0.6, freq = 440, rate = 8000): Buffer {
  const n = Math.floor(seconds * rate), dataLen = n * 2, buf = Buffer.alloc(44 + dataLen);
  buf.write("RIFF", 0); buf.writeUInt32LE(36 + dataLen, 4); buf.write("WAVE", 8);
  buf.write("fmt ", 12); buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(rate, 24); buf.writeUInt32LE(rate * 2, 28); buf.writeUInt16LE(2, 32); buf.writeUInt16LE(16, 34);
  buf.write("data", 36); buf.writeUInt32LE(dataLen, 40);
  for (let i = 0; i < n; i++) buf.writeInt16LE(Math.sin((2 * Math.PI * freq * i) / rate) * 0.3 * 32767, 44 + i * 2);
  return buf;
}

async function run() {
  // Build every fixture.
  const files: { name: string; buf: Buffer; type: string; verify: boolean }[] = [
    { name: "sample.txt",  buf: Buffer.from(txt, "utf8"),  type: "text/plain",     verify: true },
    { name: "sample.md",   buf: Buffer.from(md, "utf8"),   type: "text/markdown",  verify: true },
    { name: "sample.html", buf: Buffer.from(html, "utf8"), type: "text/html",      verify: true },
    { name: "sample.pdf",  buf: makePdf([`${S} — PDF fixture`, "Photosynthesis converts light to energy."]), type: "application/pdf", verify: true },
    { name: "sample.docx", buf: await makeDocx([`${S} — DOCX fixture`, "Newton's second law: F = m·a."]), type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", verify: true },
    { name: "sample.pptx", buf: await makePptx([[`${S} — PPTX slide one`, "Supply and demand"], ["Slide two: elasticity"]]), type: "application/vnd.openxmlformats-officedocument.presentationml.presentation", verify: true },
    { name: "sample.ppt",  buf: makePpt([`${S} — PPT slide one. The mitochondria is the powerhouse.`, "Slide two: ATP synthesis."]), type: "application/vnd.ms-powerpoint", verify: true },
    { name: "sample.png",  buf: makePng(), type: "image/png", verify: false }, // OCR needs real text + API key
    { name: "sample.wav",  buf: makeWav(), type: "audio/wav", verify: false }, // transcription needs speech + API key
  ];

  const { default: handler } = await import("../api/extract.ts");
  const extract = async (buf: Buffer, type: string, name: string) => {
    let out: any; const res: any = { statusCode: 200, setHeader() {}, status(c: number) { this.statusCode = c; return this; }, json(o: any) { out = o; return this; }, end(o: any) { if (o !== undefined) out = o; return this; } };
    await handler({ method: "POST", body: { base64: buf.toString("base64"), file_type: type, name } }, res);
    return out;
  };

  console.log(`\nWrote fixtures to ${DIR}\n`);
  const rows: string[] = [];
  for (const f of files) {
    writeFileSync(resolve(DIR, f.name), f.buf);
    if (!f.verify) { rows.push(`  ${f.name.padEnd(13)} ${String(f.buf.length).padStart(8)} B   (valid file; OCR/transcription needs an API key + real content)`); continue; }
    try {
      const out = await extract(f.buf, f.type, f.name);
      const ok = String(out?.text || "").includes(S);
      rows.push(`  ${ok ? "✅" : "❌"} ${f.name.padEnd(11)} ${String(f.buf.length).padStart(8)} B   extracted ${String(out?.chars ?? 0).padStart(5)} chars, sentinel ${ok ? "found" : "MISSING — " + JSON.stringify(out?.error || out?.text?.slice(0, 60))}`);
    } catch (e: any) {
      rows.push(`  ❌ ${f.name.padEnd(11)} extract threw: ${e.message}`);
    }
  }
  console.log(rows.join("\n"));
  console.log("");
}
run().catch(e => { console.error(e); process.exit(1); });
