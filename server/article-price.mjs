/**
 * Checkout charge from a stored article price.
 * Keep the minimum, maximum, and USDC conversion in sync with src/core/article-price.ts.
 * Card checkout refuses a stored price or a USDC on-chain amount over $1,000.00.
 * A client-supplied amount, used only when the row has no price_cents, uses the same cap.
 */

export const MIN_ARTICLE_PRICE_CENTS = 50;
export const MAX_ARTICLE_PRICE_CENTS = 100_000;
export const MAX_USDC_ATOMIC = 1_000_000_000n;
export const PRICE_ABOVE_MAXIMUM_MESSAGE = "Maximum is $1,000.00.";

/** @param {unknown} value */
export function usdcAtomicAboveCap(value) {
  try {
    const atomic = typeof value === "bigint" ? value : BigInt(String(value ?? "").trim());
    return atomic > MAX_USDC_ATOMIC;
  } catch {
    return false;
  }
}

/** @param {unknown} value */
export function storedPriceCents(value) {
  if (value == null || value === "") return null;
  const n = typeof value === "number" ? value : Number(String(value).trim());
  if (!Number.isSafeInteger(n) || n < MIN_ARTICLE_PRICE_CENTS || n > MAX_ARTICLE_PRICE_CENTS) return null;
  return n;
}

/** @param {unknown} raw */
export function parseUsdToCents(raw) {
  const trimmed = String(raw ?? "")
    .trim()
    .replace(/^\$/, "");
  if (!/^\d+(\.\d{1,2})?$/.test(trimmed)) return null;
  const [whole, frac = ""] = trimmed.split(".");
  const cents = Number(whole) * 100 + Number(frac.padEnd(2, "0"));
  if (!Number.isSafeInteger(cents)) return null;
  return cents;
}

/**
 * True when a USD string is above $1,000.00.
 * Extra digits past cents count as over the cap ($1,000.001 is over).
 * @param {unknown} raw
 */
export function usdPriceAboveCap(raw) {
  const cents = parseUsdToCents(raw);
  if (cents != null) return cents > MAX_ARTICLE_PRICE_CENTS;
  const trimmed = String(raw ?? "")
    .trim()
    .replace(/^\$/, "");
  if (!/^\d+(\.\d+)?$/.test(trimmed)) return false;
  const [whole, frac = ""] = trimmed.split(".");
  const head = Number(whole) * 100 + Number((frac + "00").slice(0, 2));
  const extra = frac.length > 2 && /[1-9]/.test(frac.slice(2));
  const loose = head + (extra ? 1 : 0);
  return Number.isSafeInteger(loose) && loose > MAX_ARTICLE_PRICE_CENTS;
}

function paymentAssetOf(article) {
  return String(article?.payment_asset || article?.paymentAsset || "")
    .trim()
    .toLowerCase();
}

/** USDC listings only. MON amounts are not converted to dollars here. */
export function listingUsdcAboveCap(article) {
  const asset = paymentAssetOf(article);
  if (asset !== "usdc" && asset !== "usd" && asset !== "stable") return false;
  return usdcAtomicAboveCap(article?.price_wei ?? article?.priceWei ?? "0");
}

/**
 * Stored cents, or a USDC on-chain amount, over the cap.
 * @param {unknown} row
 */
export function articleAbovePriceCap(row) {
  if (!row || typeof row !== "object") return false;
  const raw = row.price_cents ?? row.priceCents;
  if (raw != null && raw !== "") {
    const n = typeof raw === "number" ? raw : Number(String(raw).trim());
    if (Number.isSafeInteger(n) && n > MAX_ARTICLE_PRICE_CENTS) return true;
  }
  return listingUsdcAboveCap(row);
}

/**
 * @param {{ price_cents?: unknown, price_wei?: unknown, payment_asset?: unknown, paymentAsset?: unknown } | null | undefined} article
 * @param {unknown} requestedCents
 * @returns {{ ok: true, cents: number, source: "price_cents" | "request" } | { ok: false, error: "invalid_amount" | "amount_too_large" }}
 */
export function resolveUnlockChargeCents(article, requestedCents) {
  if (listingUsdcAboveCap(article)) return { ok: false, error: "amount_too_large" };
  const raw = article?.price_cents;
  if (raw != null && raw !== "") {
    const n = typeof raw === "number" ? raw : Number(String(raw).trim());
    if (!Number.isSafeInteger(n) || n < MIN_ARTICLE_PRICE_CENTS) {
      return { ok: false, error: "invalid_amount" };
    }
    if (n > MAX_ARTICLE_PRICE_CENTS) return { ok: false, error: "amount_too_large" };
    return { ok: true, cents: n, source: "price_cents" };
  }
  const amount = Math.round(Number(requestedCents));
  if (!Number.isFinite(amount) || amount < MIN_ARTICLE_PRICE_CENTS) {
    return { ok: false, error: "invalid_amount" };
  }
  if (amount > MAX_ARTICLE_PRICE_CENTS) return { ok: false, error: "amount_too_large" };
  return { ok: true, cents: amount, source: "request" };
}
