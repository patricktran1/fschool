// api/canvas.js — Vercel serverless function (ESM).
// Forwards Canvas LMS API requests server-side, bypassing browser CORS.
// Receives: ?base=<canvas-api-base>&path=<api-path>&token=<access-token>

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Authorization, Accept");
  if (req.method === "OPTIONS") { res.status(200).end(); return; }

  const { base, path, token } = req.query;
  if (!base || !path || !token) {
    return res.status(400).json({ error: "Missing base, path, or token query params" });
  }

  const clean     = base.replace(/\/+$/, "") + "/" + path.replace(/^\/+/, "");
  const separator = clean.includes("?") ? "&" : "?";
  const target    = `${clean}${separator}per_page=50`;

  try {
    const upstream = await fetch(target, {
      headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
    });

    const body       = await upstream.text();
    const linkHeader = upstream.headers.get("Link");

    if (linkHeader) res.setHeader("Link", linkHeader);
    res.setHeader("Content-Type", "application/json");
    res.status(upstream.status).send(body);
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
};
