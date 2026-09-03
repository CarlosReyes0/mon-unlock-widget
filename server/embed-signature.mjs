/**
 * Server-side embed signature helpers (mirrors src/core/embed-signature.ts).
 * Used by Stripe fiat create-intent so card unlocks can't bypass publisher auth.
 *
 * Dual-support: verify accepts legacy "MON Unlock v1" and "Open Paywall v1".
 * New signatures still sign with the legacy prefix so nothing in the wild breaks.
 */
import { verifyMessage } from "viem";

export const EMBED_SIG_PREFIX = "MON Unlock v1";
export const EMBED_SIG_PREFIX_OPENPAYWALL = "Open Paywall v1";
export const EMBED_SIG_PREFIXES = [EMBED_SIG_PREFIX, EMBED_SIG_PREFIX_OPENPAYWALL];
export const MAINNET_UNLOCK_CONTRACT =
  "0x27cA0c23835328e2Ab1424b66330be86fe177FA6";
/** USDC ArticleUnlockUsdc — same allowlist as widget payment-asset helpers. */
export const MAINNET_USDC_UNLOCK_CONTRACT =
  "0xd66Df017335ae80BcE5d4Ec728421f3a3DAf6f9f";
export const ALLOWED_FIAT_UNLOCK_CONTRACTS = [
  MAINNET_UNLOCK_CONTRACT,
  MAINNET_USDC_UNLOCK_CONTRACT,
];
export const MONAD_CHAIN_ID = 143;

export function buildEmbedSignMessage(
  { chainId, contract, articleId, priceWei },
  prefix = EMBED_SIG_PREFIX
) {
  const normalizedContract = String(contract || "").trim().toLowerCase();
  const article = String(articleId || "").trim();
  return `${prefix}\nchain:${chainId}\ncontract:${normalizedContract}\narticle:${article}\npriceWei:${priceWei.toString()}`;
}

/**
 * @param {{
 *   embedSig: string,
 *   contract: string,
 *   articleId: string,
 *   priceWei: string | bigint | number,
 *   publisher: string,
 *   chainId?: number,
 * }} input
 * @returns {Promise<{ ok: true } | { ok: false, error: string, status: number }>}
 */
export async function assertFiatEmbedAuthorized(input) {
  const embedSig = String(input.embedSig || "").trim();
  const contract = String(input.contract || "").trim();
  const articleId = String(input.articleId || "").trim();
  const publisher = String(input.publisher || "").trim();
  const chainId = input.chainId ?? MONAD_CHAIN_ID;

  if (!embedSig) {
    return {
      ok: false,
      status: 400,
      error: "missing_embed_sig",
    };
  }
  if (!contract.startsWith("0x") || contract.length !== 42) {
    return { ok: false, status: 400, error: "invalid_contract" };
  }
  const contractOk = ALLOWED_FIAT_UNLOCK_CONTRACTS.some(
    (c) => c.toLowerCase() === contract.toLowerCase()
  );
  if (!contractOk) {
    return { ok: false, status: 400, error: "unsupported_contract" };
  }
  if (!publisher.startsWith("0x") || publisher.length !== 42) {
    return { ok: false, status: 400, error: "invalid_publisher" };
  }

  let priceWei;
  try {
    priceWei = BigInt(input.priceWei);
  } catch {
    return { ok: false, status: 400, error: "invalid_price" };
  }
  if (priceWei <= 0n) {
    return { ok: false, status: 400, error: "invalid_price" };
  }

  let valid = false;
  for (const prefix of EMBED_SIG_PREFIXES) {
    const message = buildEmbedSignMessage(
      {
        chainId,
        contract,
        articleId,
        priceWei,
      },
      prefix
    );
    try {
      valid = await verifyMessage({
        address: publisher,
        message,
        signature: embedSig,
      });
    } catch {
      valid = false;
    }
    if (valid) break;
  }

  if (!valid) {
    return { ok: false, status: 403, error: "invalid_embed_sig" };
  }

  return { ok: true };
}

/**
 * Fiat unlock auth for create-intent.
 * - Valid publisher embed-sig → allow (third-party embeds)
 * - Open Paywall listed article → allow without sig (hosted /articles pages)
 */
export async function authorizeFiatUnlock(input) {
  const listingStatus = String(input.listingStatus || "").trim();
  if (listingStatus === "listed") {
    const publisher = String(input.publisher || "").trim();
    if (!publisher.startsWith("0x") || publisher.length !== 42) {
      return { ok: false, status: 400, error: "invalid_publisher" };
    }
    let priceWei;
    try {
      priceWei = BigInt(input.priceWei);
    } catch {
      return { ok: false, status: 400, error: "invalid_price" };
    }
    if (priceWei <= 0n) {
      return { ok: false, status: 400, error: "invalid_price" };
    }
    return { ok: true, via: "listed" };
  }
  const signed = await assertFiatEmbedAuthorized(input);
  if (signed.ok) return { ok: true, via: "embed_sig" };
  return signed;
}
