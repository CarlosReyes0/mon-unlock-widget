/**
 * Wallet auth for writer plan, per-article à la carte, and Connect onboarding.
 *
 * Same EIP-191 pattern as update-listing ("Open Paywall listing v1") and
 * register-article ("Open Paywall publish v1"): a fixed prefix plus the fields
 * being changed. A signature authorizes only that exact payload, so it cannot
 * be replayed onto a different writer, article, price, or flag.
 *
 * Plan, à la carte, and Connect ("Open Paywall connect v1") include issuedAt
 * and reuse the follower signature window (follow-core issuedAtFresh, 10
 * minutes). A stale issuedAt is 401 stale_signature. Replay protection for
 * plan and à la carte is the used_signatures row inserted by subscriptions.mjs
 * before the write (unique conflict is 401 replayed_signature; a store
 * failure is 503). Connect maps every failed check, including a wrong wallet,
 * to 401. Plan and à la carte keep 403 for a readable signature from a
 * different wallet.
 *
 * Keep buildPlanAuthMessage / buildALaCarteAuthMessage / buildConnectAuthMessage
 * / buildGasAuthMessage / buildMediaAuthMessage / buildVoiceAuthMessage
 * identical to src/core/publish-auth.ts. The Railway image does not include
 * src/, and CI smoke starts the server before tsc, so this copy has to live
 * in server/.
 */
import { recoverMessageAddress } from "viem";
import { assertPublisherNotBlocked } from "./blocked-publishers.mjs";
import { issuedAtFresh } from "./follow-core.mjs";

export const PLAN_AUTH_PREFIX = "Open Paywall plan v1";
export const A_LA_CARTE_AUTH_PREFIX = "Open Paywall a-la-carte v1";
export const CONNECT_AUTH_PREFIX = "Open Paywall connect v1";
export const GAS_AUTH_PREFIX = "Open Paywall gas v1";
export const MEDIA_AUTH_PREFIX = "Open Paywall media v1";
export const VOICE_AUTH_PREFIX = "Open Paywall voice v1";

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
 * @param {{ publisher: unknown, monthlyPriceCents: unknown, allowALaCarte?: unknown, issuedAt: unknown }} input
 */
export function buildPlanAuthMessage(input) {
  return [
    PLAN_AUTH_PREFIX,
    `publisher:${asText(input.publisher).trim().toLowerCase()}`,
    `monthlyPriceCents:${asText(input.monthlyPriceCents).trim()}`,
    `allowALaCarte:${listFlag(input.allowALaCarte)}`,
    `issuedAt:${asText(input.issuedAt).trim()}`,
  ].join("\n");
}

/**
 * @param {{ articleId: unknown, publisher: unknown, allowALaCarte?: unknown, issuedAt: unknown }} input
 */
export function buildALaCarteAuthMessage(input) {
  return [
    A_LA_CARTE_AUTH_PREFIX,
    `article:${asText(input.articleId).trim()}`,
    `publisher:${asText(input.publisher).trim().toLowerCase()}`,
    `allowALaCarte:${listFlag(input.allowALaCarte)}`,
    `issuedAt:${asText(input.issuedAt).trim()}`,
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
 * Plan and à-la-carte proof. Missing signature is 401 unauthorized. A stale
 * or future issuedAt is 401 stale_signature. A bad signature is 401. A
 * different wallet is 403. Replay is not decided here: subscriptions.mjs
 * inserts sha256(signature) into used_signatures before the write.
 * @param {{ publisher: string, message: string, signature: unknown, issuedAt: unknown }} input
 * @param {number} [now]
 */
export async function assertWriterMutationSignature(input, now = Date.now()) {
  assertPublisherNotBlocked(input?.publisher);
  const signature = typeof input?.signature === "string" ? input.signature.trim() : "";
  if (!signature) throw httpError("unauthorized", 401);
  if (!issuedAtFresh(input?.issuedAt, now)) throw httpError("stale_signature", 401);
  await assertPublisherSignature(input.publisher, input.message, signature);
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
  assertPublisherNotBlocked(publisher);
  const issuedAt = asText(input?.issuedAt).trim();
  if (!connectIssuedAtFresh(issuedAt, now)) throw httpError("unauthorized", 401);
  const message = buildConnectAuthMessage({ publisher, issuedAt });
  try {
    await assertPublisherSignature(publisher, message, input?.connectSig);
  } catch {
    throw httpError("unauthorized", 401);
  }
}

/**
 * Unlock-attempt proof. Line order matches src/core/publish-auth.ts.
 * @param {{ articleId: unknown, address: unknown, issuedAt: unknown }} input
 */
export function buildGasAuthMessage(input) {
  return [
    GAS_AUTH_PREFIX,
    `article:${asText(input.articleId).trim()}`,
    `address:${asText(input.address).trim().toLowerCase()}`,
    `issuedAt:${asText(input.issuedAt).trim()}`,
  ].join("\n");
}

/**
 * @param {{ address: unknown, issuedAt: unknown }} input
 */
export function buildMediaAuthMessage(input) {
  return [
    MEDIA_AUTH_PREFIX,
    `address:${asText(input.address).trim().toLowerCase()}`,
    `issuedAt:${asText(input.issuedAt).trim()}`,
  ].join("\n");
}

/**
 * @param {{ address: unknown, issuedAt: unknown }} input
 */
export function buildVoiceAuthMessage(input) {
  return [
    VOICE_AUTH_PREFIX,
    `address:${asText(input.address).trim().toLowerCase()}`,
    `issuedAt:${asText(input.issuedAt).trim()}`,
  ].join("\n");
}

/**
 * EIP-191 proof with the same 10-minute issuedAt window as Connect onboarding.
 * Missing, stale, unreadable, and wrong-wallet signatures are all 401.
 * @param {{ address: unknown, issuedAt: unknown, signature: unknown, message: string }} input
 * @param {number} [now]
 */
export async function assertRecentWalletSignature(input, now = Date.now()) {
  const wallet = asText(input?.address).trim().toLowerCase();
  const issuedAt = asText(input?.issuedAt).trim();
  if (!/^0x[a-f0-9]{40}$/.test(wallet)) throw httpError("unauthorized", 401);
  if (!issuedAtFresh(issuedAt, now)) throw httpError("unauthorized", 401);
  try {
    await assertPublisherSignature(wallet, input.message, input?.signature);
  } catch {
    throw httpError("unauthorized", 401);
  }
}
