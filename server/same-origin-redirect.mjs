/**
 * Stripe success / cancel / return URLs must land on the host that received
 * the request. A foreign host is an open redirect after checkout.
 */

/**
 * Compare hosts with default ports removed (https://host:443 vs host).
 * @param {string} host
 * @param {string} protocol "http:" or "https:"
 */
function canonicalHost(host, protocol) {
  const proto = protocol === "http:" ? "http:" : "https:";
  try {
    return new URL(`${proto}//${host}`).host.toLowerCase();
  } catch {
    return "";
  }
}

/**
 * @param {unknown} value
 * @param {string} host request Host header (may include a port)
 * @returns {string | null} the URL when it is http(s) on that host, otherwise null
 */
export function sameOriginRedirectUrl(value, host) {
  if (typeof value !== "string") return null;
  const raw = value.trim();
  if (!raw || /[\s\\]/.test(raw)) return null;
  const expected = String(host || "").trim().toLowerCase();
  if (!expected || /[\s/@\\]/.test(expected)) return null;
  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    return null;
  }
  if (parsed.username || parsed.password) return null;
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
  const want = canonicalHost(expected, parsed.protocol);
  if (!want || parsed.host.toLowerCase() !== want) return null;
  // Stripe substitutes this token. Re-serializing the URL would encode the braces.
  if (raw.includes("{CHECKOUT_SESSION_ID}")) return raw;
  return parsed.toString();
}
