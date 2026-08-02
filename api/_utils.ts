// api/utils.js — Merged utility endpoints (iTunes + Twilio) to stay under Vercel's 12-function limit.
// Routes by path suffix: /api/utils?fn=itunes  or  /api/utils?fn=twilio

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(204).end();

  const fn = req.query.fn;

  // ── iTunes search proxy ────────────────────────────────────────────────────
  if (fn === "itunes") {
    if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });
    const { term, media = "music", entity = "song", limit = "8", lang = "en_us" } = req.query;
    if (!term) return res.status(400).json({ error: "term is required" });
    const url = `https://itunes.apple.com/search?term=${encodeURIComponent(term)}&media=${media}&entity=${entity}&limit=${limit}&lang=${lang}`;
    try {
      const upstream = await fetch(url);
      if (!upstream.ok) return res.status(upstream.status).json({ error: `iTunes returned ${upstream.status}` });
      const data = await upstream.json();
      res.setHeader("Cache-Control", "public, s-maxage=300");
      return res.status(200).json(data);
    } catch (err) {
      return res.status(502).json({ error: err.message ?? "iTunes fetch failed" });
    }
  }

  // ── Twilio SMS proxy ───────────────────────────────────────────────────────
  if (fn === "twilio") {
    if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
    const sid   = process.env.TWILIO_SID;
    const token = process.env.TWILIO_TOKEN;
    const from  = process.env.TWILIO_FROM;
    if (!sid || !token || !from) return res.status(500).json({ error: "Twilio env vars not configured" });
    const { to, body } = req.body;
    if (!to || !body) return res.status(400).json({ error: "to and body are required" });
    const credentials = Buffer.from(`${sid}:${token}`).toString("base64");
    try {
      const twilioRes = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
        method: "POST",
        headers: { "Authorization": `Basic ${credentials}`, "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ To: to, From: from, Body: body }).toString(),
      });
      const data = await twilioRes.json();
      if (!twilioRes.ok) return res.status(twilioRes.status).json({ error: data.message ?? "Twilio error" });
      return res.status(200).json({ sid: data.sid, status: data.status });
    } catch (err) {
      return res.status(502).json({ error: err.message });
    }
  }

  return res.status(400).json({ error: "Unknown fn. Use ?fn=itunes or ?fn=twilio" });
}
