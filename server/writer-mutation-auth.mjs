/**
 * Wallet auth for writer plan and per-article à la carte updates.
 *
 * Same EIP-191 pattern as update-listing ("Open Paywall listing v1") and
 * register-article ("Open Paywall publish v1"): a fixed prefix plus the fields
 * being changed. Those flows do not use a timestamp or a nonce store. A
 * signature authorizes only this exact payload, so it cannot be replayed onto
 * a different writer, article, price, or flag. Submitting the same payload
 * again is idempotent.
 *
 * Keep buildPlanAuthMessage / buildALaCarteAuthMessage identical to
 * src/core/publish-auth.ts. The Railway image does not include src/, and CI
 * smoke starts the server before tsc, so this copy has to live in server/.
 */
import { recoverMessageAddress } from "viem";

export const PLAN_AUTH_PREFIX = "Open Paywall plan v1";
export const A_LA_CARTE_AUTH_PREFIX = "Open Paywall a-la-carte v1";

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
