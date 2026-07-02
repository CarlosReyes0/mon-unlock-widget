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

export const EMBED_SIG_PREFIX = "MON Unlock v1";
export const MAINNET_UNLOCK_CONTRACT =
  "0x038446b1F736e254cC0E256B20D74823c41EeADB" as const;

export class EmbedSignatureError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EmbedSignatureError";
  }
}

export function buildEmbedSignMessage(params: {
  chainId: number;
  contract: string;
  articleId: string;
  priceWei: bigint;
}): string {
  const contract = params.contract.trim().toLowerCase();
  const article = params.articleId.trim();
  return `${EMBED_SIG_PREFIX}\nchain:${params.chainId}\ncontract:${contract}\narticle:${article}\npriceWei:${params.priceWei.toString()}`;
}

export async function verifyEmbedSignature(params: {
  signature: `0x${string}`;
  chainId: number;
  contract: string;
  articleId: string;
  priceWei: bigint;
  publisher: Address;
}): Promise<boolean> {
  return verifyMessage({
    address: params.publisher,
    message: buildEmbedSignMessage(params),
    signature: params.signature,
  });
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

/** Block unlock when the embed is missing or has a bad publisher signature. */
export async function assertEmbedAuthorized(params: {
  embedSig: string | null | undefined;
  articleId: string;
  priceWei: bigint;
  contractAddress: Address;
  chainId?: number;
  publicClient: PublicClient;
}): Promise<void> {
  const sig = params.embedSig?.trim();
  if (!sig) {
    throw new EmbedSignatureError(
      "This embed is missing a publisher signature. Get a new embed from the generator."
    );
  }

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
