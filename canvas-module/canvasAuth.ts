/**
 * canvasAuth.js
 * Token-based auth helpers for the Canvas LMS module.
 *
 * This module handles two separate concerns:
 *   1. App-level session tokens — short-lived HMAC tokens issued by the
 *      /init serverless function so the client can call the proxy without
 *      exposing FS_APP_SECRET.
 *   2. Canvas access tokens — the long-lived personal access token that the
 *      user generates in Canvas (Account → Settings → New Access Token).
 *
 * Required token scopes (Canvas):
 *   - url:GET|/api/v1/courses
 *   - url:GET|/api/v1/courses/:course_id/assignments
 *   - url:GET|/api/v1/courses/:course_id/assignments/:assignment_id/submissions/:user_id
 *   - url:GET|/api/v1/announcements
 *   - url:GET|/api/v1/conversations
 *   - url:GET|/api/v1/courses/:course_id/modules
 *   - url:GET|/api/v1/courses/:course_id/pages/:url_or_id
 *   - url:GET|/api/v1/courses/:course_id/discussion_topics
 *   - url:GET|/api/v1/courses/:course_id/assignment_groups
 *   - url:GET|/api/v1/users/self
 *   - url:GET|/api/v1/users/self/groups
 *
 * If no scopes are set the token has full account access. Restricting scopes
 * is recommended for production.
 */

import crypto from 'crypto';

/**
 * Verifies a short-lived HMAC-SHA256 app session token.
 *
 * Token format: "<unix_expiry>.<hex_signature>"
 *
 * @param {string} token  - The token string to verify.
 * @param {string} secret - The server-side FS_APP_SECRET.
 * @returns {boolean} true if the token is valid and not expired.
 */
function verifySessionToken(token, secret) {
  if (!token || !secret) return false;
  const parts = token.split('.');
  if (parts.length !== 2) return false;
  const [expires, sig] = parts;
  if (Math.floor(Date.now() / 1000) > parseInt(expires, 10)) return false;
  const expected = crypto
    .createHmac('sha256', secret)
    .update(expires)
    .digest('hex');
  try {
    return crypto.timingSafeEqual(
      Buffer.from(sig, 'hex'),
      Buffer.from(expected, 'hex')
    );
  } catch (_) {
    return false;
  }
}

/**
 * Issues a short-lived HMAC-SHA256 app session token.
 * Call this on the server side (e.g. in a Netlify Function) to give the
 * client a time-bounded credential for proxy calls.
 *
 * @param {string} secret     - The server-side FS_APP_SECRET.
 * @param {number} [ttl=900]  - Token lifetime in seconds (default 15 min).
 * @returns {{ token: string, expires: number }}
 *   token   — "<unix_expiry>.<hex_signature>"
 *   expires — Unix timestamp (seconds) when the token expires.
 */
function issueSessionToken(secret, ttl = 900) {
  const expires = Math.floor(Date.now() / 1000) + ttl;
  const sig = crypto
    .createHmac('sha256', secret)
    .update(String(expires))
    .digest('hex');
  return { token: `${expires}.${sig}`, expires };
}

/**
 * Fetches a fresh short-lived session token from the /init endpoint.
 * Used client-side; keeps the token in memory only — never in localStorage.
 *
 * Caches the token in the returned state object to avoid unnecessary round-trips.
 *
 * @param {string} initEndpoint - URL of the token-issuing endpoint (e.g. "/.netlify/functions/init").
 * @param {{ token: string, expires: number }} [cache]
 *   Optional in-memory cache object from a previous call. Pass the same
 *   object reference on each invocation so the cache persists across calls.
 * @returns {Promise<string>} The session token string, or '' on failure.
 */
async function fetchSessionToken(initEndpoint, cache: any = {}) {
  const BUFFER_SECS = 30;
  if (cache.token && Math.floor(Date.now() / 1000) < (cache.expires || 0) - BUFFER_SECS) {
    return cache.token;
  }
  try {
    const r = await fetch(initEndpoint, {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' },
    });
    if (r.ok) {
      const d = await r.json();
      cache.token = d.token || '';
      cache.expires = d.expires || 0;
      return cache.token;
    }
  } catch (_) {}
  return '';
}

/**
 * Builds the Authorization header value for a Canvas API request.
 *
 * @param {string} canvasToken - The user's Canvas personal access token.
 * @returns {{ Authorization: string }}
 */
function buildCanvasAuthHeader(canvasToken) {
  return { Authorization: `Bearer ${canvasToken}` };
}

/**
 * Validates that a Canvas personal access token looks plausible (non-empty,
 * minimum length). Does NOT make a network call — use fetchCurrentUser() to
 * confirm validity against the API.
 *
 * @param {string} canvasToken - The token to validate.
 * @returns {boolean}
 */
function isValidCanvasToken(canvasToken) {
  return typeof canvasToken === 'string' && canvasToken.trim().length >= 10;
}

export {
  verifySessionToken,
  issueSessionToken,
  fetchSessionToken,
  buildCanvasAuthHeader,
  isValidCanvasToken,
};
