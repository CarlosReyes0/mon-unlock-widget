/**
 * Per-article USD price for Write, publish, and listing edits.
 * Stripe's USD minimum is $0.50. There is no product maximum.
 * Card net is an estimate: price − (2.9% + $0.30). USDC net is the price.
 */

export const MIN_ARTICLE_PRICE_CENTS = 50;
export const DEFAULT_ARTICLE_PRICE_CENTS = 50;
/** Soft confirm when a typed price is above this. $25.00 itself does not confirm. */
export const HIGH_PRICE_CONFIRM_CENTS = 2500;
export const ARTICLE_PRICE_PRESETS_CENTS = [50, 100, 200, 500] as const;
export const LAST_PUBLISHED_PRICE_KEY = "openpaywall-last-article-price-cents";

const PRESET_LABELS: Record<(typeof ARTICLE_PRICE_PRESETS_CENTS)[number], string> = {
  50: "$0.50",
  100: "$1",
  200: "$2",
  500: "$5",
};

export function presetLabel(cents: number): string {
  return PRESET_LABELS[cents as (typeof ARTICLE_PRICE_PRESETS_CENTS)[number]] || formatUsdFromCents(cents);
}

export function formatUsdFromCents(cents: number): string {
  const negative = cents < 0;
  const abs = Math.abs(Math.trunc(cents));
  const whole = Math.floor(abs / 100);
  const frac = String(abs % 100).padStart(2, "0");
  return `${negative ? "-" : ""}$${whole}.${frac}`;
}

/** Whole dollars or up to two decimal places. "$1.50" and "0.5" are fine. */
export function parseUsdToCents(raw: string): number | null {
  const trimmed = String(raw ?? "")
    .trim()
    .replace(/^\$/, "");
  if (!/^\d+(\.\d{1,2})?$/.test(trimmed)) return null;
  const [whole, frac = ""] = trimmed.split(".");
  const cents = Number(whole) * 100 + Number(frac.padEnd(2, "0"));
  if (!Number.isSafeInteger(cents)) return null;
  return cents;
}

export function parseArticlePriceCents(
  value: unknown
): { ok: true; cents: number } | { ok: false; error: "invalid_price" | "price_below_minimum" } {
  let cents: number;
  if (typeof value === "number") {
    cents = value;
  } else if (typeof value === "string" && /^\d+$/.test(value.trim())) {
    cents = Number(value.trim());
  } else {
    return { ok: false, error: "invalid_price" };
  }
  if (!Number.isSafeInteger(cents)) return { ok: false, error: "invalid_price" };
  if (cents < MIN_ARTICLE_PRICE_CENTS) return { ok: false, error: "price_below_minimum" };
  return { ok: true, cents };
}

/** USDC base units (6 decimals). $0.50 → 500_000n. */
export function usdcAtomicForCents(cents: number): bigint {
  return BigInt(cents) * 10_000n;
}

export function cardNetCents(priceCents: number): number {
  return Math.round(priceCents - priceCents * 0.029 - 30);
}

export function priceNetLine(priceCents: number): string {
  return `Card: you get ~${formatUsdFromCents(cardNetCents(priceCents))} · USDC: ~${formatUsdFromCents(priceCents)}`;
}

export function needsHighPriceConfirm(cents: number): boolean {
  return cents > HIGH_PRICE_CONFIRM_CENTS;
}

export function readLastPublishedPriceCents(storage: Pick<Storage, "getItem"> | null | undefined): number {
  try {
    const parsed = parseArticlePriceCents(storage?.getItem(LAST_PUBLISHED_PRICE_KEY) ?? "");
    if (parsed.ok) return parsed.cents;
  } catch {
    /* private mode */
  }
  return DEFAULT_ARTICLE_PRICE_CENTS;
}

export function writeLastPublishedPriceCents(
  storage: Pick<Storage, "setItem"> | null | undefined,
  cents: number
): void {
  const parsed = parseArticlePriceCents(cents);
  if (!parsed.ok) return;
  try {
    storage?.setItem(LAST_PUBLISHED_PRICE_KEY, String(parsed.cents));
  } catch {
    /* ignore quota / private mode */
  }
}
