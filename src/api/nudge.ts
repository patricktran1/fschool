// src/api/nudge.ts — client helper for the rate-limited "come study" nudge.
// The server (api/nudge.ts) owns rate-limiting, the nudge row insert, and the
// email fallback. Returns { sent, reason?, emailSent } or null on network error.

export async function sendNudge({ fromUserId, toUserId, roomId, fromName, roomName, recipientOnline }) {
  try {
    const res = await fetch("/api/nudge", {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify({ fromUserId, toUserId, roomId, fromName, roomName, recipientOnline }),
    });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}
