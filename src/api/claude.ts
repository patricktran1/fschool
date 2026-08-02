// claude.js — calls /api/claude (Vite dev proxy or Vercel function).
// The Anthropic key lives server-side only — never bundled into the browser.

export async function claude(messages, system = "") {
  const r = await fetch("/api/claude", {
    method:  "POST",
    headers: { "Content-Type": "application/json" },
    body:    JSON.stringify({ messages, system }),
  });

  const d = await r.json();
  if (!r.ok) throw new Error(d.error ?? `Claude proxy error ${r.status}`);
  return d.content ?? "";
}
