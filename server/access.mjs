/**
 * One access door: buy (forever) OR live subscribe-to-writer (until cancel / lapse).
 * Pure helpers — unit-tested. Server and widget share the same rules.
 */

export const DEFAULT_MONTHLY_CENTS = 500;
export const DEFAULT_MONTHLY_USDC = 5_000_000; // $5.00, 6 decimals
export const CRYPTO_PERIOD_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * @param {unknown} addr
 * @returns {string} lowercase 0x… or ""
 */
export function normalizeAddress(addr) {
  if (typeof addr !== "string") return "";
  const a = addr.trim().toLowerCase();
  return /^0x[a-f0-9]{40}$/.test(a) ? a : "";
}

/**
 * Article-level false wins. Otherwise writer default. Missing = allow buy.
 * @param {{ articleAllow?: boolean | null, writerAllow?: boolean | null }} input
 */
export function resolveAllowALaCarte(input = {}) {
  if (input.articleAllow === false) return false;
  if (input.writerAllow === false) return false;
  return true;
}

/**
 * Live sub: status active, not canceled, period still open.
 * Cancel is immediate — canceled_at drops access even if the month was paid.
 * @param {{ status?: string, canceled_at?: string | null, current_period_end?: string | null } | null} sub
 * @param {Date} [now]
 */
export function subscriptionIsLive(sub, now = new Date()) {
  if (!sub) return false;
  if (sub.status !== "active") return false;
  if (sub.canceled_at) return false;
  if (sub.current_period_end) {
    const end = new Date(sub.current_period_end);
    if (Number.isNaN(end.getTime()) || end <= now) return false;
  }
  return true;
}

/**
 * @param {{
 *   purchased?: boolean,
 *   subscriptionLive?: boolean,
 *   allowALaCarte?: boolean,
 * }} input
 */
export function evaluateAccess(input = {}) {
  const purchased = Boolean(input.purchased);
  const subscriptionLive = Boolean(input.subscriptionLive);
  const allowALaCarte = input.allowALaCarte !== false;
  const canPurchase = allowALaCarte;

  if (purchased) {
    return { allowed: true, reason: "purchase", canPurchase };
  }
  if (subscriptionLive) {
    return { allowed: true, reason: "subscription", canPurchase };
  }
  return {
    allowed: false,
    reason: canPurchase ? "locked" : "subscribe_only",
    canPurchase,
  };
}

/**
 * @param {unknown} cents
 */
export function normalizeMonthlyCents(cents) {
  const n = Math.round(Number(cents));
  if (!Number.isFinite(n) || n < 50) return DEFAULT_MONTHLY_CENTS;
  if (n > 100_000) return 100_000;
  return n;
}

/**
 * Cents → USDC base units (6 decimals). $5.00 → 5_000_000
 * @param {number} cents
 */
export function centsToUsdcUnits(cents) {
  const n = normalizeMonthlyCents(cents);
  return n * 10_000;
}
