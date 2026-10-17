/**
 * Wallet auth for writer plan, per-article à la carte, and Connect onboarding.
 *
 * Same EIP-191 pattern as update-listing ("Open Paywall listing v1") and
 * register-article ("Open Paywall publish v1"): a fixed prefix plus the fields
 * being changed. Plan and à la carte do not use a timestamp. A signature
 * authorizes only that exact payload, so it cannot be replayed onto a
 * different writer, article, price, or flag. Submitting the same payload
 * again is idempotent.
 *
 * Connect onboarding ("Open Paywall connect v1") adds issuedAt and reuses the
 * follower signature replay window (follow-core issuedAtFresh, 10 minutes).
 * Every failed check is 401. The shared helper's 403 for a wrong wallet is
 * mapped to 401 so a bad proof never continues into Stripe.
 *
 * Keep buildPlanAuthMessage / buildALaCarteAuthMessage / buildConnectAuthMessage
 * identical to src/core/publish-auth.ts. The Railway image does not include
 * src/, and CI smoke starts the server before tsc, so this copy has to live
 * in server/.
 */
import { recoverMessageAddress } from "viem";
import { issuedAtFresh } from "./follow-core.mjs";

export const PLAN_AUTH_PREFIX = "Open Paywall plan v1";
export const A_LA_CARTE_AUTH_PREFIX = "Open Paywall a-la-carte v1";
export const CONNECT_AUTH_PREFIX = "Open Paywall connect v1";

function asText(value) {
  if (value == null) return "";
  return String(value);
}

function listFlag(value) {
  if (value === true) return "true";
  if (value === false) return "false";
  return "";
}

/**
 * @param {{ publisher: unknown, monthlyPriceCents: unknown, allowALaCarte?: unknown }} input
 */
export function buildPlanAuthMessage(input) {
  return [
    PLAN_AUTH_PREFIX,
    `publisher:${asText(input.publisher).trim().toLowerCase()}`,
    `monthlyPriceCents:${asText(input.monthlyPriceCents).trim()}`,
    `allowALaCarte:${listFlag(input.allowALaCarte)}`,
  ].join("\n");
}

/**
 * @param {{ articleId: unknown, publisher: unknown, allowALaCarte?: unknown }} input
 */
export function buildALaCarteAuthMessage(input) {
  return [
    A_LA_CARTE_AUTH_PREFIX,
    `article:${asText(input.articleId).trim()}`,
    `publisher:${asText(input.publisher).trim().toLowerCase()}`,
    `allowALaCarte:${listFlag(input.allowALaCarte)}`,
  ].join("\n");
}

/**
 * Binds the writer wallet and the time the onboarding request was signed.
 * @param {{ publisher: unknown, issuedAt: unknown }} input
 */
export function buildConnectAuthMessage(input) {
  return [
    CONNECT_AUTH_PREFIX,
    `publisher:${asText(input.publisher).trim().toLowerCase()}`,
    `issuedAt:${asText(input.issuedAt).trim()}`,
  ].join("\n");
}

/** Same 10-minute window as follower signatures. */
export function connectIssuedAtFresh(value, now = Date.now()) {
  return issuedAtFresh(value, now);
}

function httpError(message, status) {
  const err = new Error(message);
  err.status = status;
  return err;
}

/**
 * Recover the signer of an EIP-191 message. Missing or unreadable signatures
 * are 401. A readable signature from a different wallet is 403.
 * @param {string} publisher lowercase 0x address that must have signed
 * @param {string} message
 * @param {unknown} signature
 */
export async function assertPublisherSignature(publisher, message, signature) {
  const sig = typeof signature === "string" ? signature.trim() : "";
  if (!sig) throw httpError("unauthorized", 401);
  let recovered = "";
  try {
    recovered = await recoverMessageAddress({
      message,
      signature: sig,
    });
  } catch {
    throw httpError("unauthorized", 401);
  }
  if (String(recovered || "").toLowerCase() !== String(publisher || "").toLowerCase()) {
    throw httpError("forbidden", 403);
  }
}

/**
 * EIP-191 proof that `publisher` just asked to open Stripe Connect onboarding.
 * Missing, bad, wrong-wallet, and stale signatures are all 401. Call this
 * before any Stripe or publisher_accounts lookup.
 * @param {{ publisher: unknown, issuedAt: unknown, connectSig: unknown }} input
 * @param {number} [now]
 */
export async function assertConnectOnboardingAuth(input, now = Date.now()) {
  const publisher = asText(input?.publisher).trim().toLowerCase();
  const issuedAt = asText(input?.issuedAt).trim();
  if (!connectIssuedAtFresh(issuedAt, now)) throw httpError("unauthorized", 401);
  const message = buildConnectAuthMessage({ publisher, issuedAt });
  try {
    await assertPublisherSignature(publisher, message, input?.connectSig);
  } catch {
    throw httpError("unauthorized", 401);
  }
}
