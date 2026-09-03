/**
 * Article aggregator listing helpers (pure — unit-tested).
 * Open Paywall is source of truth; opt-in listing with optional external URL.
 */

const LISTING_STATUSES = new Set(["unlisted", "listed", "hidden"]);

/**
 * @param {unknown} raw
 * @returns {{ ok: true, url: string | null } | { ok: false, error: string }}
 */
export function normalizeExternalUrl(raw) {
  if (raw == null || raw === "") return { ok: true, url: null };
  if (typeof raw !== "string") return { ok: false, error: "invalid_external_url" };
  const trimmed = raw.trim();
  if (!trimmed) return { ok: true, url: null };
  let parsed;
  try {
    parsed = new URL(trimmed);
  } catch {
    return { ok: false, error: "invalid_external_url" };
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return { ok: false, error: "invalid_external_url" };
  }
  return { ok: true, url: parsed.toString() };
}

/**
 * @param {unknown} raw
 * @returns {raw is 'unlisted' | 'listed' | 'hidden'}
 */
export function isListingStatus(raw) {
  return typeof raw === "string" && LISTING_STATUSES.has(raw);
}

/**
 * Resolve next listing fields when a publisher opts in / out / edits URL.
 * Hidden stays hidden unless they explicitly re-list (listOn === true).
 *
 * @param {{
 *   currentStatus?: string | null,
 *   listOn?: boolean | null,
 *   externalUrl?: unknown,
 *   now?: Date,
 * }} input
 */
export function resolveListingUpdate(input) {
  const now = input.now || new Date();
  const current = isListingStatus(input.currentStatus)
    ? input.currentStatus
    : "unlisted";

  const urlResult = normalizeExternalUrl(input.externalUrl);
  if (!urlResult.ok) return urlResult;

  /** @type {'unlisted' | 'listed' | 'hidden'} */
  let listing_status = current;
  let listed_at = undefined;

  if (input.listOn === true) {
    listing_status = "listed";
    if (current !== "listed") {
      listed_at = now.toISOString();
    }
  } else if (input.listOn === false) {
    // Publisher unlist — leave moderator hidden alone only if they did not pass listOn false
    // intentionally; false means they want off the feed.
    listing_status = "unlisted";
  }

  return {
    ok: true,
    listing_status,
    external_url: urlResult.url,
    ...(listed_at ? { listed_at } : {}),
  };
}

/**
 * Public feed projection — never includes body.
 * @param {Record<string, unknown>} row
 */
export function toPublicListing(row) {
  if (!row || row.listing_status !== "listed") return null;
  const slug = typeof row.article_id === "string" ? row.article_id.trim() : "";
  if (!slug) return null;

  const priceWei = row.price_wei != null ? String(row.price_wei) : "0";
  const paymentAsset = row.payment_asset === "usdc" ? "usdc" : "mon";

  return {
    slug,
    title: typeof row.title === "string" && row.title.trim() ? row.title.trim() : slug,
    author:
      typeof row.author === "string" && row.author.trim()
        ? row.author.trim()
        : "Author",
    teaser: typeof row.teaser === "string" ? row.teaser : "",
    priceWei,
    paymentAsset,
    publisher: typeof row.publisher === "string" ? row.publisher : "",
    externalUrl:
      typeof row.external_url === "string" && row.external_url.trim()
        ? row.external_url.trim()
        : null,
    listedAt: row.listed_at || null,
    unlockContract:
      typeof row.unlock_contract === "string" && row.unlock_contract.trim()
        ? row.unlock_contract.trim()
        : paymentAsset === "usdc"
          ? "0xd66Df017335ae80BcE5d4Ec728421f3a3DAf6f9f"
          : "0x27cA0c23835328e2Ab1424b66330be86fe177FA6",
    embedSig:
      typeof row.embed_sig === "string" && row.embed_sig.trim()
        ? row.embed_sig.trim()
        : "",
  };
}

export function formatPriceLabel(priceWei, paymentAsset) {
  try {
    const n = BigInt(priceWei);
    if (paymentAsset === "usdc") {
      const whole = n / 1_000_000n;
      const frac = n % 1_000_000n;
      const fracStr = frac.toString().padStart(6, "0").replace(/0+$/, "");
      return fracStr ? `$${whole}.${fracStr} USDC` : `$${whole} USDC`;
    }
    const whole = n / 10n ** 18n;
    const frac = n % 10n ** 18n;
    const fracStr = frac.toString().padStart(18, "0").slice(0, 4).replace(/0+$/, "");
    return fracStr ? `${whole}.${fracStr} MON` : `${whole} MON`;
  } catch {
    return paymentAsset === "usdc" ? "USDC" : "MON";
  }
}
