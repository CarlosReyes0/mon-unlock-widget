/**
 * Optional Article NFTs on Monad. Unlock remains access; the connected wallet
 * pays gas. No server private key is required to mint.
 */
import {
  createPublicClient,
  custom,
  encodeFunctionData,
  keccak256,
  toBytes,
  type Address,
  type Hash,
} from "viem";
import { monadMainnet } from "./chains.js";
import { getCheckoutBaseUrl } from "./checkout-protocol.js";
import { mapWalletSendToEthSend, type Eip1193Provider } from "./wallet.js";

export const ARTICLE_NFT_CHAIN_ID = 143;
export const MAX_EDITION_SUPPLY = 25;

export type ArticleNftRole = "edition" | "receipt";

export type ArticleNftConfig = {
  ok: boolean;
  configured: boolean;
  contract: string;
  chainId: number;
  chain?: string;
  explorer?: string;
  mintAuth?: string;
  note?: string;
};

export const ARTICLE_NFT_ABI = [
  {
    name: "mintEdition",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "slug", type: "string" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [{ name: "tokenId", type: "uint256" }],
  },
  {
    name: "mintReceipt",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [{ name: "slug", type: "string" }],
    outputs: [{ name: "tokenId", type: "uint256" }],
  },
  {
    name: "editionOf",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "articleId", type: "bytes32" }],
    outputs: [{ type: "uint256" }],
  },
  {
    name: "receiptOf",
    type: "function",
    stateMutability: "view",
    inputs: [
      { name: "articleId", type: "bytes32" },
      { name: "reader", type: "address" },
    ],
    outputs: [{ type: "uint256" }],
  },
] as const;

const ENV_CONTRACT = (
  typeof import.meta !== "undefined" &&
  import.meta.env &&
  typeof import.meta.env.VITE_ARTICLE_NFT_CONTRACT === "string"
    ? import.meta.env.VITE_ARTICLE_NFT_CONTRACT.trim()
    : ""
);

export function isNftContractAddress(value: string | null | undefined): boolean {
  return typeof value === "string" && /^0x[a-fA-F0-9]{40}$/.test(value.trim());
}

export function clampEditionAmount(raw: unknown): number {
  const n = Math.round(Number(raw));
  if (!Number.isFinite(n) || n < 1) return 1;
  if (n > MAX_EDITION_SUPPLY) return MAX_EDITION_SUPPLY;
  return n;
}

export function articleNftApiBase(explicit?: string | null): string {
  if (explicit) return explicit.replace(/\/$/, "");
  if (typeof window !== "undefined" && window.location?.origin) {
    const path = window.location.pathname || "";
    if (
      path.includes("/write") ||
      path.includes("/dashboard") ||
      path.includes("/unlock") ||
      path.includes("/articles") ||
      path === "/"
    ) {
      return window.location.origin;
    }
  }
  return getCheckoutBaseUrl();
}

export async function fetchArticleNftConfig(
  apiBase = articleNftApiBase()
): Promise<ArticleNftConfig> {
  try {
    const res = await fetch(`${apiBase.replace(/\/$/, "")}/api/article-nfts/config`);
    const data = (await res.json().catch(() => ({}))) as ArticleNftConfig;
    if (data && typeof data === "object") {
      const fromApi = isNftContractAddress(data.contract) ? data.contract.trim() : "";
      const contract = fromApi || ENV_CONTRACT;
      return {
        ok: true,
        configured: Boolean(data.configured && isNftContractAddress(contract)) || isNftContractAddress(contract),
        contract: isNftContractAddress(contract) ? contract : "",
        chainId: Number(data.chainId) || ARTICLE_NFT_CHAIN_ID,
        chain: data.chain,
        explorer: data.explorer,
        mintAuth: data.mintAuth,
        note: data.note,
      };
    }
  } catch {
    /* fall through */
  }
  const configured = isNftContractAddress(ENV_CONTRACT);
  return {
    ok: true,
    configured,
    contract: configured ? ENV_CONTRACT : "",
    chainId: ARTICLE_NFT_CHAIN_ID,
  };
}

export function explorerTxUrl(txHash: string, explorer = "https://monadvision.com"): string {
  return `${explorer.replace(/\/$/, "")}/tx/${txHash}`;
}

export async function ensureMonadChain(provider: Eip1193Provider): Promise<void> {
  const current = (await provider.request({ method: "eth_chainId" })) as string;
  if (parseInt(current, 16) === monadMainnet.id) return;
  try {
    await provider.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: "0x" + monadMainnet.id.toString(16) }],
    });
  } catch (switchErr: unknown) {
    const code = (switchErr as { code?: number })?.code;
    if (code === 4902) {
      await provider.request({
        method: "wallet_addEthereumChain",
        params: [
          {
            chainId: "0x" + monadMainnet.id.toString(16),
            chainName: monadMainnet.name,
            nativeCurrency: monadMainnet.nativeCurrency,
            rpcUrls: monadMainnet.rpcUrls.default.http,
            blockExplorerUrls: monadMainnet.blockExplorers
              ? [monadMainnet.blockExplorers.default.url]
              : undefined,
          },
        ],
      });
      return;
    }
    throw switchErr;
  }
}

export function encodeMintCall(params: {
  role: ArticleNftRole;
  slug: string;
  amount?: number;
}): `0x${string}` {
  const slug = params.slug.trim();
  if (params.role === "receipt") {
    return encodeFunctionData({
      abi: ARTICLE_NFT_ABI,
      functionName: "mintReceipt",
      args: [slug],
    });
  }
  return encodeFunctionData({
    abi: ARTICLE_NFT_ABI,
    functionName: "mintEdition",
    args: [slug, BigInt(clampEditionAmount(params.amount))],
  });
}

export async function recordArticleNftMint(params: {
  apiBase?: string;
  tokenId: string;
  slug: string;
  role: ArticleNftRole;
  minter: string;
  txHash: string;
  amount?: number;
}): Promise<void> {
  const base = articleNftApiBase(params.apiBase);
  try {
    await fetch(`${base}/api/article-nfts/record`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        tokenId: params.tokenId,
        slug: params.slug,
        role: params.role,
        minter: params.minter,
        txHash: params.txHash,
        amount: params.amount ?? 1,
      }),
    });
  } catch {
    /* chain is source of truth; DB record is best-effort */
  }
}

export async function mintArticleNft(params: {
  provider: Eip1193Provider;
  account: Address;
  contract: Address;
  slug: string;
  role: ArticleNftRole;
  amount?: number;
  apiBase?: string;
}): Promise<{ txHash: Hash; tokenId: string }> {
  const slug = params.slug.trim();
  if (!slug) throw new Error("missing_slug");
  if (!isNftContractAddress(params.contract)) {
    throw new Error("nft_not_configured");
  }
  const eth = mapWalletSendToEthSend(params.provider);
  await ensureMonadChain(eth);
  const data = encodeMintCall({
    role: params.role,
    slug,
    amount: params.amount,
  });
  const txHash = (await eth.request({
    method: "eth_sendTransaction",
    params: [
      {
        from: params.account,
        to: params.contract,
        data,
        gas: "0x30d40",
      },
    ],
  })) as Hash;

  const publicClient = createPublicClient({
    chain: monadMainnet,
    transport: custom(eth),
  });
  await publicClient.waitForTransactionReceipt({ hash: txHash });

  let tokenId = "0";
  try {
    const articleId = keccak256(toBytes(slug));
    const id =
      params.role === "edition"
        ? await publicClient.readContract({
            address: params.contract,
            abi: ARTICLE_NFT_ABI,
            functionName: "editionOf",
            args: [articleId],
          })
        : await publicClient.readContract({
            address: params.contract,
            abi: ARTICLE_NFT_ABI,
            functionName: "receiptOf",
            args: [articleId, params.account],
          });
    tokenId = (id as bigint).toString();
  } catch {
    /* record without token id if the view fails */
  }

  await recordArticleNftMint({
    apiBase: params.apiBase,
    tokenId,
    slug,
    role: params.role,
    minter: params.account,
    txHash,
    amount: params.role === "edition" ? clampEditionAmount(params.amount) : 1,
  });

  return { txHash, tokenId };
}

export function cardUnlockNftCopy(): string {
  return "Receipt NFTs are for crypto unlocks with a wallet. Apple Pay and card still unlock the article — no NFT needed to read.";
}
