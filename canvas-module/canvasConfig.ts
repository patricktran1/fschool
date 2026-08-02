/**
 * canvasConfig.js
 * Shared constants for the Canvas LMS API module.
 */

export const CANVAS_API_VERSION = '/api/v1';

export const CANVAS_DEFAULT_BASE = 'https://canvas.instructure.com';

export const CANVAS_PER_PAGE = 50;

export const CANVAS_REQUEST_TIMEOUT_MS = 12000;

/** @type {string[]} */
export const CANVAS_ALLOWED_DOMAINS = [
  '.instructure.com',
  '.canvas.net',
  'canvas.ubc.ca',
  'q.utoronto.ca',
  'utsc.utoronto.ca',
];
