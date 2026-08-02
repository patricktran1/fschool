// groq.js — calls /api/groq (Vite dev proxy or Vercel function).
// The actual Groq key lives server-side only — never bundled into the browser.

export async function groq(messages, system = "", maxTokens = 1024) {
  const r = await fetch("/api/groq", {
    method:  "POST",
    headers: { "Content-Type": "application/json" },
    body:    JSON.stringify({ messages, system, max_tokens: maxTokens }),
  });

  const d = await r.json();
  if (!r.ok) throw new Error(d.error ?? `Groq proxy error ${r.status}`);
  return d.content ?? "";
}
