/**
 * How the indexer applies an ArticleRegistered event.
 * A blocked publisher is ignored. An existing row keeps its publisher when
 * the event names a different wallet.
 *
 * ArticleUpdated (updatePrice) uses the same USDC cent cap. There is no
 * MON/USD price for listings, so a MON amount is not turned into cents.
 */
import { isBlockedPublisher } from "./blocked-publishers.ts";
import { MAX_ARTICLE_PRICE_CENTS, MIN_ARTICLE_PRICE_CENTS } from "./article-price.ts";

export const REGISTRATION_IGNORED_WARNING = "indexer: registration event ignored";
export const PUBLISHER_LEFT_UNCHANGED_WARNING =
  "indexer: registration event ignored; stored publisher left unchanged";
export const PRICE_ABOVE_CAP_WARNING = "indexer: price above cap";

const USDC_ATOMIC_PER_CENT = 10_000n;

export function chainCardCents(
  paymentAsset: "mon" | "usdc",
  priceWei: string
): { cents: number } | { overCap: true } | { skip: true } {
  if (paymentAsset !== "usdc") return { skip: true };
  let atomic: bigint;
  try {
    atomic = BigInt(String(priceWei).trim());
  } catch {
    return { skip: true };
  }
  if (atomic < 0n) return { skip: true };
  const maxAtomic = BigInt(MAX_ARTICLE_PRICE_CENTS) * USDC_ATOMIC_PER_CENT;
  if (atomic > maxAtomic) return { overCap: true };
  if (atomic % USDC_ATOMIC_PER_CENT !== 0n) return { skip: true };
  const cents = Number(atomic / USDC_ATOMIC_PER_CENT);
  if (!Number.isSafeInteger(cents) || cents < MIN_ARTICLE_PRICE_CENTS) return { skip: true };
  return { cents };
}

/**
 * Card cents to write from an on-chain price.
 * Over the cap: price_cents is cleared and a warning is returned.
 * In range: price_cents is the USDC dollar amount.
 * MON, or a USDC amount that is not a whole cent at or above $0.50: no card write,
 * unless a stored card price is already over the cap (cleared so a later update can save).
 */
export function chainPriceFields(
  paymentAsset: "mon" | "usdc",
  priceWei: string,
  storedPriceCents?: unknown
): { price_cents?: number | null; warn?: string } {
  const decided = chainCardCents(paymentAsset, priceWei);
  if ("cents" in decided) return { price_cents: decided.cents };
  if ("overCap" in decided) return { price_cents: null, warn: PRICE_ABOVE_CAP_WARNING };
  if (storedPriceCents != null && storedPriceCents !== "") {
    const stored = typeof storedPriceCents === "number" ? storedPriceCents : Number(storedPriceCents);
    if (Number.isInteger(stored) && stored > MAX_ARTICLE_PRICE_CENTS) {
      return { price_cents: null, warn: PRICE_ABOVE_CAP_WARNING };
    }
  }
  return {};
}

export type RegistrationDecision = {
  action: "insert" | "update" | "skip";
  warn?: string;
};

export function decideArticleRegistration(input: {
  rowExists: boolean;
  existingPublisher?: string | null;
  eventPublisher: string;
  blockedList?: string | null;
}): RegistrationDecision {
  const eventPublisher = String(input.eventPublisher || "").trim().toLowerCase();
  if (isBlockedPublisher(eventPublisher, input.blockedList)) {
    return { action: "skip", warn: REGISTRATION_IGNORED_WARNING };
  }
  if (!input.rowExists) return { action: "insert" };
  const current = String(input.existingPublisher || "").trim().toLowerCase();
  if (current && current !== eventPublisher) {
    return { action: "skip", warn: PUBLISHER_LEFT_UNCHANGED_WARNING };
  }
  return { action: "update" };
}

/**
 * Fields written when a registration event updates a row that already
 * belongs to this publisher. A stored publisher is never included.
 */
export function registrationUpdatePatch(input: {
  existingPublisher?: string | null;
  eventPublisher: string;
  priceWei: string;
  paymentAsset: "mon" | "usdc";
  now: string;
  storedPriceCents?: unknown;
}): Record<string, unknown> {
  const current = String(input.existingPublisher || "").trim().toLowerCase();
  const next = String(input.eventPublisher || "").trim().toLowerCase();
  const patch: Record<string, unknown> = {
    price_wei: input.priceWei,
    payment_asset: input.paymentAsset,
    active: true,
    registration_status: "registered",
    updated_at: input.now,
  };
  const priced = chainPriceFields(input.paymentAsset, input.priceWei, input.storedPriceCents);
  if ("price_cents" in priced) patch.price_cents = priced.price_cents;
  if (!current && next) patch.publisher = next;
  return patch;
}

/** Fields for an ArticleUpdated event. Does not change the publisher. */
export function priceUpdatePatch(input: {
  paymentAsset: "mon" | "usdc";
  priceWei: string;
  storedPriceCents?: unknown;
  now: string;
}): { patch: Record<string, unknown>; warn?: string } {
  const priced = chainPriceFields(input.paymentAsset, input.priceWei, input.storedPriceCents);
  const patch: Record<string, unknown> = {
    price_wei: input.priceWei,
    updated_at: input.now,
  };
  if ("price_cents" in priced) patch.price_cents = priced.price_cents;
  return { patch, warn: priced.warn };
}
