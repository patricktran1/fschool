// src/api/tokens.js — Client-side token helper.
// Uses a simple event emitter so toasts fire without prop drilling.
// Amounts are NEVER sent to the server — only action + meta.

const _listeners = new Set<(data: any) => void>();

/** Subscribe to token awards (returns unsubscribe fn) */
export function onTokenAwarded(fn) {
  _listeners.add(fn);
  return () => _listeners.delete(fn);
}

function emit(data) {
  _listeners.forEach(fn => { try { fn(data); } catch {} });
}

/** Fire a token award — server validates and sets the amount */
export async function awardTokens(action, meta = {}) {
  const userId = localStorage.getItem("fschool_uid");
  if (!userId) return null;
  try {
    const res = await fetch("/api/token-engine?action=award", {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify({ userId, action, meta }),
    });
    if (!res.ok) return null;
    const result = await res.json();
    if (result?.awarded) emit({ action, ...result });
    return result;
  } catch {
    return null;
  }
}

/** Fetch token summary for the current user */
export async function getTokenSummary() {
  const userId = localStorage.getItem("fschool_uid");
  if (!userId) return null;
  try {
    const res = await fetch(`/api/token-engine?action=summary&userId=${encodeURIComponent(userId)}`);
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}
