// DocUpload.tsx — Upload a document (PDF / text) or paste text to index it for RAG.
// PDFs/text are extracted server-side via /api/extract, then /api/rag?action=ingest
// sections + chunks + stores them; embeddings are filled in via repeated
// /api/rag?action=embed calls (bounded batches → large docs don't time out). Once
// indexed, the tutor (NeuralRing) answers grounded in the content with [n] citations.

import { useRef, useState, useEffect } from "react";
import { useApp } from "../context/AppContext";
import { supabase } from "../api/supabase";

const ACCEPT = ".pdf,.txt,.md,.markdown,.html,.docx,.pptx,.ppt,.png,.jpg,.jpeg,.webp,.gif,.mp3,.wav,.m4a,.mp4,.mov,.webm";

// Base64 inflates bytes ~33%, so a file over ~3MB risks Vercel's ~4.5MB request-body
// limit when sent inline. Anything larger uploads straight to Storage instead.
const STORAGE_THRESHOLD = 3 * 1024 * 1024;

// Map a file's MIME/name to the RAG `kind` tag.
function kindForFile(file) {
  const s = `${file.type} ${file.name}`.toLowerCase();
  if (/pdf/.test(s)) return "pdf";
  if (/wordprocessingml|\.docx\b/.test(s)) return "docx";
  if (/presentationml|\.pptx\b/.test(s)) return "pptx";
  if (/ms-powerpoint|\.ppt\b/.test(s)) return "ppt"; // legacy binary PowerPoint
  if (/image\/|\.(png|jpe?g|webp|gif|bmp|tiff?)\b/.test(s)) return "image";
  if (/audio\/|\.(mp3|wav|m4a|aac|ogg|flac)\b/.test(s)) return "audio";
  if (/video\/|\.(mp4|mov|webm|mpeg)\b/.test(s)) return "video";
  return "text";
}

function readAsBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload  = () => resolve(String(reader.result).split(",")[1] ?? "");
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

export default function DocUpload() {
  const { userId, courses } = useApp();
  const fileRef = useRef(null);
  const [status,   setStatus]   = useState("idle"); // idle|reading|extracting|indexing|done|error
  const [message,  setMessage]  = useState("");
  const [courseId, setCourseId] = useState("");
  const [showPaste, setShowPaste] = useState(false);
  const [pasteText, setPasteText] = useState("");
  const [pasteTitle, setPasteTitle] = useState("");
  const [youtubeUrl, setYoutubeUrl] = useState("");
  const [docs, setDocs] = useState([]); // already-indexed documents for this user

  const busy = status === "reading" || status === "extracting" || status === "indexing";

  // Load the user's indexed documents; re-runs when an upload finishes (status → done).
  useEffect(() => {
    if (!userId) return;
    let cancelled = false;
    (async () => {
      try {
        const { data } = await supabase
          .from("rag_documents")
          .select("id, title, kind, created_at")
          .eq("user_id", userId)
          .order("created_at", { ascending: false })
          .limit(50);
        if (!cancelled) setDocs(data ?? []);
      } catch { /* table may not exist yet */ }
    })();
    return () => { cancelled = true; };
  }, [userId, status]);

  async function deleteDoc(id) {
    setDocs(prev => prev.filter(d => d.id !== id)); // optimistic
    try { await supabase.from("rag_documents").delete().eq("id", id); } catch { /* non-fatal */ }
  }

  async function ingest({ text = null, pages = null, title, kind }: any) {
    if (!userId) { setStatus("error"); setMessage("Not signed in."); return; }
    const hasContent = (pages && pages.some(p => p?.text?.trim())) || (text && text.trim());
    if (!hasContent) { setStatus("error"); setMessage("Nothing to index — no text found."); return; }
    setStatus("indexing"); setMessage("Preparing…");
    try {
      // 1. Parse + store chunks WITHOUT embeddings — fast, never times out.
      const res = await fetch("/api/rag?action=ingest", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        // Prefer structured pages (page-number citations); fall back to flat text.
        body:    JSON.stringify({ userId, courseId: courseId || null, title, kind, pages, text }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data.error || !data.documentId) throw new Error(data.error || `ingest ${res.status}`);
      const total = data.chunks ?? 0;

      // 2. Embed in bounded batches so a large doc can't blow the serverless time
      //    limit — loop until the server reports it's drained the queue.
      let embedded = 0;
      for (let guard = 0; guard < 100000; guard++) {
        const er = await fetch("/api/rag?action=embed", {
          method:  "POST",
          headers: { "Content-Type": "application/json" },
          body:    JSON.stringify({ userId, documentId: data.documentId }),
        });
        const ed = await er.json().catch(() => ({}));
        if (!er.ok || ed.error) throw new Error(ed.error || `embed ${er.status}`);
        embedded += ed.embedded ?? 0;
        if (total) setMessage(`Indexing… ${Math.min(embedded, total)}/${total} chunks`);
        if (ed.done) break;
      }

      setStatus("done");
      setMessage(`Indexed “${title}” — ${data.sections} section${data.sections !== 1 ? "s" : ""}, ${total} chunk${total !== 1 ? "s" : ""}. Ask the tutor about it.`);
    } catch (err) {
      setStatus("error");
      setMessage(err?.message || "Indexing failed.");
    }
  }

  async function handleFile(file) {
    if (!file) return;
    const kind = kindForFile(file);
    // Files over the body limit upload straight to Storage and are read server-side —
    // so size is never a limit, for any type (audio/video → transcribe, else → extract).
    if (file.size > STORAGE_THRESHOLD) {
      return (kind === "audio" || kind === "video")
        ? handleLargeMedia(file, kind)
        : handleLargeDoc(file, kind);
    }
    setStatus("reading"); setMessage(`Reading ${file.name}…`);
    try {
      const base64 = await readAsBase64(file);
      setStatus("extracting");
      setMessage(kind === "image" ? "Reading image (OCR)…"
               : kind === "audio" || kind === "video" ? "Transcribing… (this can take a moment)"
               : "Extracting text…");
      const res = await fetch("/api/extract", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ base64, file_type: file.type, name: file.name }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.text) throw new Error(data.error || "Couldn't extract text from that file.");
      if (data.truncated) setMessage("Large file — indexing the first portion…");
      await ingest({ text: data.text, pages: data.pages, title: file.name, kind });
    } catch (err) {
      setStatus("error");
      setMessage(err?.message || "Couldn't read that file.");
    }
  }

  // Get a signed upload URL and push the file straight to Storage, retrying on transient
  // upload failures (network blips — likelier on large files). Re-signs each attempt (the
  // upload token is single-use) with a short backoff, and returns the storage path.
  async function signAndUpload(file, attempts = 3) {
    let lastErr = "Couldn't start the upload.";
    for (let i = 1; i <= attempts; i++) {
      try {
        const sres = await fetch("/api/transcribe?action=sign", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ userId, filename: file.name }),
        });
        const sdata = await sres.json().catch(() => ({}));
        if (!sres.ok || !sdata.path || !sdata.token) {
          lastErr = sdata.error || "Couldn't start the upload.";
        } else {
          const up = await supabase.storage.from("media-uploads").uploadToSignedUrl(sdata.path, sdata.token, file);
          if (!up.error) return sdata.path;
          lastErr = up.error.message;
        }
      } catch (e) {
        lastErr = e?.message || String(e);
      }
      if (i < attempts) {
        setMessage(`Upload interrupted — retrying (${i}/${attempts - 1})…`);
        await new Promise(r => setTimeout(r, 800 * i)); // brief backoff before re-signing
      }
    }
    throw new Error(`Upload failed after ${attempts} tries: ${lastErr}`);
  }

  // Large media: direct-to-Storage upload, then provider transcription (polled),
  // then RAG ingest — all server-side after the upload, so no body-size limit.
  async function handleLargeMedia(file, kind) {
    if (!userId) { setStatus("error"); setMessage("Not signed in."); return; }
    try {
      setStatus("reading"); setMessage("Uploading…");
      const storagePath = await signAndUpload(file);

      setStatus("extracting"); setMessage("Transcribing… (this can take a few minutes for long recordings)");
      const stres = await fetch("/api/transcribe?action=start", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId, storagePath, title: file.name, courseId: courseId || null, kind }),
      });
      const stdata = await stres.json().catch(() => ({}));
      if (!stres.ok || !stdata.jobId) throw new Error(stdata.error || "Couldn't start transcription.");

      // ElevenLabs Scribe is synchronous — `start` returns the final state directly.
      if (stdata.status === "done")  { setStatus("done"); setMessage(`Indexed “${file.name}” from its transcript. Ask the tutor about it.`); return; }
      if (stdata.status === "error") throw new Error(stdata.error || "Transcription failed.");

      // Fallback poll (only reached if a future async provider leaves it pending).
      for (let guard = 0; guard < 100000; guard++) {
        await new Promise(r => setTimeout(r, 4000));
        const pres = await fetch("/api/transcribe?action=status", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ jobId: stdata.jobId }),
        });
        const pdata = await pres.json().catch(() => ({}));
        const st = pdata?.job?.status;
        if (st === "indexing") setMessage("Transcribed — indexing…");
        if (st === "done")  { setStatus("done"); setMessage(`Indexed “${file.name}” from its transcript. Ask the tutor about it.`); return; }
        if (st === "error") throw new Error(pdata?.job?.error || "Transcription failed.");
      }
    } catch (err) {
      setStatus("error");
      setMessage(err?.message || "Couldn't transcribe that file.");
    }
  }

  // Large documents (PDF/PPT/PPTX/DOCX/etc. over the body limit): upload straight to
  // Storage, then /api/extract reads the bytes server-side (no body-size limit), then ingest.
  async function handleLargeDoc(file, kind) {
    if (!userId) { setStatus("error"); setMessage("Not signed in."); return; }
    try {
      setStatus("reading"); setMessage(`Uploading ${file.name}…`);
      const storagePath = await signAndUpload(file);

      setStatus("extracting"); setMessage("Extracting text…");
      const res = await fetch("/api/extract", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ storagePath, file_type: file.type, name: file.name }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.text) throw new Error(data.error || "Couldn't extract text from that file.");
      if (data.truncated) setMessage("Large file — indexing the first portion…");
      await ingest({ text: data.text, pages: data.pages, title: file.name, kind });
    } catch (err) {
      setStatus("error");
      setMessage(err?.message || "Couldn't read that file.");
    }
  }

  async function handleYoutube(rawUrl) {
    const url = (rawUrl || "").trim();
    if (!url) return;
    setStatus("extracting"); setMessage("Fetching YouTube transcript…");
    try {
      const res = await fetch("/api/extract", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ youtubeUrl: url }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.text) throw new Error(data.error || "Couldn't fetch a transcript for that video.");
      await ingest({ text: data.text, pages: data.pages, title: `YouTube — ${url}`, kind: "youtube" });
      setYoutubeUrl("");
    } catch (err) {
      setStatus("error");
      setMessage(err?.message || "Couldn't fetch that transcript.");
    }
  }

  const statusColor =
    status === "done"  ? "rgba(100,220,155,0.95)" :
    status === "error" ? "rgba(255,120,110,0.95)" :
    "var(--text-dim)";

  return (
    <div style={{
      background: "var(--color-surface)", border: "1px solid var(--color-border)",
      borderRadius: "var(--radius-card)", boxShadow: "var(--depth-line)",
      padding: "16px 18px", marginBottom: "24px",
    }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "10px", marginBottom: "12px" }}>
        <div style={{ minWidth: 0 }}>
          <p style={{ color: "var(--text-primary)", fontSize: "14px", fontWeight: 600 }}>Add study material</p>
          <p style={{ color: "var(--text-dim)", fontSize: "12px", marginTop: "2px" }}>
            PDF, Word, slides, image, audio/video — or a YouTube link. The tutor answers grounded in it.
          </p>
        </div>
      </div>

      {/* Optional course tag */}
      {courses?.length > 0 && (
        <select
          value={courseId}
          onChange={e => setCourseId(e.target.value)}
          disabled={busy}
          style={{
            width: "100%", boxSizing: "border-box", marginBottom: "10px",
            background: "rgba(255,255,255,0.04)", border: "1px solid var(--color-border)",
            borderRadius: "10px", padding: "9px 11px", color: "var(--text-primary)",
            fontSize: "13px", fontFamily: "inherit", outline: "none",
          }}
        >
          <option value="" style={{ background: "#15171c", color: "#F5F5F5" }}>No specific course</option>
          {courses.map((c, i) => (
            <option key={c.dbId ?? c.id ?? i} value={c.dbId ?? c.id ?? ""} style={{ background: "#15171c", color: "#F5F5F5" }}>
              {c.courseCode || c.name || `Course ${i + 1}`}
            </option>
          ))}
        </select>
      )}

      <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
        <input
          ref={fileRef} type="file" accept={ACCEPT} style={{ display: "none" }}
          onChange={e => { const f = e.target.files?.[0]; e.target.value = ""; handleFile(f); }}
        />
        <button
          onClick={() => fileRef.current?.click()}
          disabled={busy}
          style={{
            flex: "1 1 auto", background: "var(--color-accent)", color: "#111", border: "none",
            borderRadius: "var(--radius-btn)", padding: "11px 16px", fontSize: "14px", fontWeight: 600,
            cursor: busy ? "default" : "pointer", fontFamily: "inherit", opacity: busy ? 0.6 : 1,
          }}
        >
          {busy ? "Working…" : "Upload file"}
        </button>
        <button
          onClick={() => setShowPaste(v => !v)}
          disabled={busy}
          style={{
            background: "transparent", color: "var(--text-secondary)", border: "1px solid var(--color-border)",
            borderRadius: "var(--radius-btn)", padding: "11px 16px", fontSize: "14px", fontWeight: 500,
            cursor: "pointer", fontFamily: "inherit",
          }}
        >
          Paste text
        </button>
      </div>

      {/* YouTube link → transcript */}
      <div style={{ display: "flex", gap: "8px", marginTop: "8px" }}>
        <input
          value={youtubeUrl}
          onChange={e => setYoutubeUrl(e.target.value)}
          onKeyDown={e => { if (e.key === "Enter") handleYoutube(youtubeUrl); }}
          disabled={busy}
          placeholder="Paste a YouTube link…"
          style={{
            flex: "1 1 auto", minWidth: 0, boxSizing: "border-box",
            background: "rgba(255,255,255,0.04)", border: "1px solid var(--color-border)",
            borderRadius: "10px", padding: "10px 12px", color: "var(--text-primary)",
            fontSize: "13px", fontFamily: "inherit", outline: "none",
          }}
        />
        <button
          onClick={() => handleYoutube(youtubeUrl)}
          disabled={busy || !youtubeUrl.trim()}
          style={{
            background: "transparent", color: "var(--text-secondary)", border: "1px solid var(--color-border)",
            borderRadius: "var(--radius-btn)", padding: "10px 16px", fontSize: "14px", fontWeight: 500,
            cursor: (busy || !youtubeUrl.trim()) ? "default" : "pointer", fontFamily: "inherit",
            opacity: (busy || !youtubeUrl.trim()) ? 0.6 : 1, flexShrink: 0,
          }}
        >
          Add
        </button>
      </div>

      {showPaste && (
        <div style={{ marginTop: "10px" }}>
          <input
            value={pasteTitle}
            onChange={e => setPasteTitle(e.target.value)}
            placeholder="Title (e.g. Chapter 4 notes)"
            style={{
              width: "100%", boxSizing: "border-box", marginBottom: "8px",
              background: "rgba(255,255,255,0.04)", border: "1px solid var(--color-border)",
              borderRadius: "10px", padding: "9px 11px", color: "var(--text-primary)",
              fontSize: "13px", fontFamily: "inherit", outline: "none",
            }}
          />
          <textarea
            value={pasteText}
            onChange={e => setPasteText(e.target.value)}
            placeholder="Paste textbook passages, notes, or any text to make it searchable…"
            rows={5}
            style={{
              width: "100%", boxSizing: "border-box", resize: "vertical",
              background: "rgba(255,255,255,0.04)", border: "1px solid var(--color-border)",
              borderRadius: "10px", padding: "10px 12px", color: "var(--text-primary)",
              fontSize: "13px", lineHeight: 1.6, fontFamily: "inherit", outline: "none",
            }}
          />
          <button
            onClick={() => ingest({ text: pasteText, title: pasteTitle.trim() || "Pasted notes", kind: "text" }).then(() => { setPasteText(""); setPasteTitle(""); })}
            disabled={busy || !pasteText.trim()}
            style={{
              marginTop: "8px", background: "var(--color-accent)", color: "#111", border: "none",
              borderRadius: "var(--radius-btn)", padding: "9px 16px", fontSize: "13px", fontWeight: 600,
              cursor: (busy || !pasteText.trim()) ? "default" : "pointer", fontFamily: "inherit",
              opacity: (busy || !pasteText.trim()) ? 0.6 : 1,
            }}
          >
            Index text
          </button>
        </div>
      )}

      {message && (
        <p style={{ color: statusColor, fontSize: "12px", marginTop: "12px", lineHeight: 1.5 }}>
          {message}
        </p>
      )}

      {/* Indexed documents — these are searchable by the tutor (separate from
          portal-synced files below). */}
      {docs.length > 0 && (
        <div style={{ marginTop: "14px", borderTop: "1px solid var(--color-border)", paddingTop: "12px" }}>
          <p style={{ color: "var(--text-dim)", fontSize: "11px", letterSpacing: "0.5px", textTransform: "uppercase", marginBottom: "8px" }}>
            Indexed materials ({docs.length})
          </p>
          <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
            {docs.map(d => (
              <div key={d.id} style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                <span style={{ flex: 1, minWidth: 0, color: "var(--text-secondary)", fontSize: "13px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {d.title}
                </span>
                <span style={{ fontSize: "10px", fontWeight: 700, letterSpacing: "0.5px", textTransform: "uppercase", color: "var(--text-dim)", flexShrink: 0 }}>
                  {d.kind}
                </span>
                <button
                  onClick={() => deleteDoc(d.id)}
                  title="Remove from index"
                  style={{ background: "none", border: "none", color: "var(--text-dim)", cursor: "pointer", fontSize: "17px", lineHeight: 1, padding: "0 2px", flexShrink: 0 }}
                >
                  ×
                </button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
