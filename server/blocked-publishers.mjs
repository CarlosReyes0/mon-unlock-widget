/**
 * Publisher denylist for the Node server.
 * BLOCKED_PUBLISHERS is a comma-separated env var. Case-insensitive,
 * whitespace around entries is ignored. Empty or unset blocks nobody.
 * The edge-function copy is src/core/blocked-publishers.ts. Keep parse rules identical.
 */

const ADDRESS = /^0x[a-f0-9]{40}$/;

export const BLOCKED_PUBLISHER_MESSAGE = "forbidden";

/** @param {string | null | undefined} raw */
export function parseBlockedPublishers(raw) {
  const seen = new Set();
  const out = [];
  for (const part of String(raw ?? "").split(",")) {
    const addr = part.trim().toLowerCase();
    if (!ADDRESS.test(addr) || seen.has(addr)) continue;
    seen.add(addr);
    out.push(addr);
  }
  return out;
}

/**
 * @param {unknown} address
 * @param {string | null | undefined} [raw]
 */
export function isBlockedPublisher(address, raw = process.env.BLOCKED_PUBLISHERS) {
  const norm = String(address ?? "").trim().toLowerCase();
  if (!ADDRESS.test(norm)) return false;
  return parseBlockedPublishers(raw).includes(norm);
}

/**
 * @param {unknown} address
 * @param {string | null | undefined} [raw]
 */
export function assertPublisherNotBlocked(address, raw = process.env.BLOCKED_PUBLISHERS) {
  if (!isBlockedPublisher(address, raw)) return;
  const err = new Error(BLOCKED_PUBLISHER_MESSAGE);
  err.status = 403;
  throw err;
}
