/**
 * How the indexer applies an ArticleRegistered event.
 * A blocked publisher is ignored. An existing row keeps its publisher when
 * the event names a different wallet.
 */
import { isBlockedPublisher } from "./blocked-publishers.ts";

export const REGISTRATION_IGNORED_WARNING = "indexer: registration event ignored";
export const PUBLISHER_LEFT_UNCHANGED_WARNING =
  "indexer: registration event ignored; stored publisher left unchanged";

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
  if (!current && next) patch.publisher = next;
  return patch;
}
