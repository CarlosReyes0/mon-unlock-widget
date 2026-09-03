import {
  createPublicClient,
  custom,
  keccak256,
  toBytes,
  verifyMessage,
  type Address,
  type PublicClient,
} from "viem";
import { monadMainnet } from "./chains.js";
import type { Eip1193Provider } from "./wallet.js";

/**
 * Signing prefix for newly created embeds.
 * Keep stable — changing this without dual-verify would invalidate all existing embeds.
 */
export const EMBED_SIG_PREFIX = "MON Unlock v1";

/** Forward-compatible prefix; accepted on verify, not used for signing yet. */
export const EMBED_SIG_PREFIX_OPENPAYWALL = "Open Paywall v1";

/** All prefixes accepted when verifying a publisher embed signature. */
export const EMBED_SIG_PREFIXES = [EMBED_SIG_PREFIX, EMBED_SIG_PREFIX_OPENPAYWALL] as const;

export const MAINNET_UNLOCK_CONTRACT =
  "0x27cA0c23835328e2Ab1424b66330be86fe177FA6" as const;

/** USDC paywall contract — set after deploy (or via VITE_USDC_UNLOCK_CONTRACT). */
export { MAINNET_USDC_UNLOCK_CONTRACT } from "./payment-asset.js";

export class EmbedSignatureError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EmbedSignatureError";
  }
}

export function buildEmbedSignMessage(
  params: {
    chainId: number;
    contract: string;
    articleId: string;
    priceWei: bigint;
  },
  prefix: string = EMBED_SIG_PREFIX
): string {
  const contract = params.contract.trim().toLowerCase();
  const article = params.articleId.trim();
  return `${prefix}\nchain:${params.chainId}\ncontract:${contract}\narticle:${article}\npriceWei:${params.priceWei.toString()}`;
}

export async function verifyEmbedSignature(params: {
  signature: `0x${string}`;
  chainId: number;
  contract: string;
  articleId: string;
  priceWei: bigint;
  publisher: Address;
}): Promise<boolean> {
  for (const prefix of EMBED_SIG_PREFIXES) {
    try {
      const valid = await verifyMessage({
        address: params.publisher,
        message: buildEmbedSignMessage(params, prefix),
        signature: params.signature,
      });
      if (valid) return true;
    } catch {
      /* try next prefix */
    }
  }
  return false;
}

const GET_ARTICLE_ABI = [
  {
    name: "getArticle",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "articleId", type: "bytes32" }],
    outputs: [
      { name: "priceWei", type: "uint256" },
      { name: "publisher", type: "address" },
      { name: "active", type: "bool" },
    ],
  },
] as const;

function toArticleId(articleId: string): `0x${string}` {
  return keccak256(toBytes(articleId.trim()));
}

/** Block unlock when the embed is missing or has a bad publisher signature.
 *  Missing signature is allowed when the article is registered on-chain and the
 *  embed price matches (hosted /articles pages often have no stored embed-sig).
 */
export async function assertEmbedAuthorized(params: {
  embedSig: string | null | undefined;
  articleId: string;
  priceWei: bigint;
  contractAddress: Address;
  chainId?: number;
  publicClient: PublicClient;
}): Promise<void> {
  const sig = params.embedSig?.trim();

  const chainId = params.chainId ?? monadMainnet.id;
  const articleIdBytes = toArticleId(params.articleId);

  let article: readonly [bigint, Address, boolean];
  try {
    article = (await params.publicClient.readContract({
      address: params.contractAddress,
      abi: GET_ARTICLE_ABI,
      functionName: "getArticle",
      args: [articleIdBytes],
    })) as readonly [bigint, Address, boolean];
  } catch {
    throw new EmbedSignatureError(
      "On-chain article lookup failed. Confirm the unlock-contract address and network."
    );
  }

  const [onChainPrice, publisher, active] = article;

  if (publisher === "0x0000000000000000000000000000000000000000") {
    throw new EmbedSignatureError(
      "This article has not been registered for on-chain payments yet."
    );
  }
  if (!active) {
    throw new EmbedSignatureError("This article is currently inactive for purchases.");
  }
  if (params.priceWei !== onChainPrice) {
    throw new EmbedSignatureError(
      "This embed was modified. Payments are blocked for your safety."
    );
  }

  if (!sig) {
    // Hosted catalog / thin embeds: on-chain registration + price match is enough.
    return;
  }

  const valid = await verifyEmbedSignature({
    signature: sig as `0x${string}`,
    chainId,
    contract: params.contractAddress,
    articleId: params.articleId,
    priceWei: onChainPrice,
    publisher,
  });

  if (!valid) {
    throw new EmbedSignatureError(
      "This embed was modified. Payments are blocked for your safety."
    );
  }
}

export function createMonadPublicClient(provider: Eip1193Provider): PublicClient {
  return createPublicClient({ chain: monadMainnet, transport: custom(provider) });
}
