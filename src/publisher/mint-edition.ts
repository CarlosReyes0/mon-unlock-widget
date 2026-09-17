import {
  createPublicClient,
  encodeFunctionData,
  http,
  keccak256,
  toBytes,
  type Address,
  type Hash,
} from "viem";
import { base, baseSepolia } from "viem/chains";
import { mapWalletSendToEthSend, type Eip1193Provider } from "../core/wallet.js";

const MINT_ABI = [
  {
    name: "mint",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [{ name: "articleId", type: "bytes32" }],
    outputs: [{ name: "tokenId", type: "uint256" }],
  },
] as const;

const TOKEN_OF_ARTICLE_ABI = [
  {
    name: "tokenOfArticle",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "articleId", type: "bytes32" }],
    outputs: [{ type: "uint256" }],
  },
] as const;

export type NftConfig = {
  ok: boolean;
  configured: boolean;
  contract: string | null;
  chainId: number;
  chainName: string;
  explorer: string;
  rpcUrl: string;
  unlockSeparate?: boolean;
  message?: string;
};

export type MintEditionResult = {
  tokenId: string;
  txHash: string;
  contract: string;
  chainId: number;
  explorerUrl: string | null;
  openseaUrl: string | null;
};

function nftHealthUrl(): string {
  if (typeof window !== "undefined" && window.location?.origin) {
    return `${window.location.origin}/api/nft/health`;
  }
  return "/api/nft/health";
}

function recordUrl(slug: string): string {
  const path = `/api/articles/${encodeURIComponent(slug)}/nft`;
  if (typeof window !== "undefined" && window.location?.origin) {
    return `${window.location.origin}${path}`;
  }
  return path;
}

export async function fetchNftConfig(): Promise<NftConfig> {
  const res = await fetch(nftHealthUrl());
  const body = (await res.json().catch(() => ({}))) as NftConfig;
  if (!res.ok) {
    return {
      ok: false,
      configured: false,
      contract: null,
      chainId: 8453,
      chainName: "base",
      explorer: "https://basescan.org",
      rpcUrl: "https://mainnet.base.org",
      message: "nft_health_failed",
    };
  }
  return {
    ok: true,
    configured: Boolean(body.configured && body.contract),
    contract: body.contract || null,
    chainId: Number(body.chainId) === 84532 ? 84532 : 8453,
    chainName: body.chainName || "base",
    explorer: body.explorer || "https://basescan.org",
    rpcUrl: body.rpcUrl || "https://mainnet.base.org",
    unlockSeparate: body.unlockSeparate !== false,
    message: body.message,
  };
}

function chainFor(chainId: number) {
  return chainId === 84532 ? baseSepolia : base;
}

function hexChainId(chainId: number): `0x${string}` {
  return `0x${chainId.toString(16)}`;
}

async function ensureBase(eth: Eip1193Provider, chainId: number, onStatus?: (msg: string) => void) {
  const current = await eth.request({ method: "eth_chainId" });
  const id = parseInt(String(current), 16);
  if (id === chainId) return;
  onStatus?.(chainId === 84532 ? "Switching to Base Sepolia…" : "Switching to Base…");
  const chain = chainFor(chainId);
  try {
    await eth.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: hexChainId(chainId) }],
    });
  } catch (err: unknown) {
    const code = err && typeof err === "object" && "code" in err ? Number((err as { code: number }).code) : 0;
    if (code === 4902) {
      await eth.request({
        method: "wallet_addEthereumChain",
        params: [
          {
            chainId: hexChainId(chainId),
            chainName: chain.name,
            nativeCurrency: chain.nativeCurrency,
            rpcUrls: [chain.rpcUrls.default.http[0]],
            blockExplorerUrls: [chain.blockExplorers?.default.url].filter(Boolean),
          },
        ],
      });
      return;
    }
    throw err;
  }
}

export async function mintArticleEdition(input: {
  slug: string;
  publisher: Address | string;
  provider: Eip1193Provider;
  onStatus?: (msg: string) => void;
}): Promise<MintEditionResult> {
  const slug = String(input.slug || "").trim();
  if (!slug) throw new Error("Missing article.");
  const publisher = String(input.publisher || "").toLowerCase() as Address;
  if (!/^0x[a-f0-9]{40}$/.test(publisher)) throw new Error("Sign in to mint.");

  const cfg = await fetchNftConfig();
  if (!cfg.configured || !cfg.contract) {
    throw new Error("Edition NFT is not configured yet.");
  }

  const eth = mapWalletSendToEthSend(input.provider);
  await ensureBase(eth, cfg.chainId, input.onStatus);

  const articleHash = keccak256(toBytes(slug));
  const contract = cfg.contract as Address;
  const chain = chainFor(cfg.chainId);
  const publicClient = createPublicClient({
    chain,
    transport: http(cfg.rpcUrl),
  });

  const existing = (await publicClient.readContract({
    address: contract,
    abi: TOKEN_OF_ARTICLE_ABI,
    functionName: "tokenOfArticle",
    args: [articleHash],
  })) as bigint;

  let tokenId = existing;
  let txHash: Hash | "" = "";

  if (existing === 0n) {
    input.onStatus?.("Minting edition on Base…");
    const data = encodeFunctionData({
      abi: MINT_ABI,
      functionName: "mint",
      args: [articleHash],
    });
    txHash = (await eth.request({
      method: "eth_sendTransaction",
      params: [{ from: publisher, to: contract, data }],
    })) as Hash;
    await publicClient.waitForTransactionReceipt({ hash: txHash });
    tokenId = (await publicClient.readContract({
      address: contract,
      abi: TOKEN_OF_ARTICLE_ABI,
      functionName: "tokenOfArticle",
      args: [articleHash],
    })) as bigint;
  }

  if (tokenId === 0n) throw new Error("Mint did not return a token id.");

  input.onStatus?.("Saving collectible…");
  const res = await fetch(recordUrl(slug), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      publisher,
      tokenId: tokenId.toString(),
      txHash: txHash || undefined,
      contract,
      chainId: cfg.chainId,
    }),
  });
  const body = (await res.json().catch(() => ({}))) as {
    error?: string;
    nft?: { explorerUrl?: string | null; openseaUrl?: string | null };
  };
  if (!res.ok) {
    throw new Error(body.error || `Could not save the collectible (HTTP ${res.status}).`);
  }

  return {
    tokenId: tokenId.toString(),
    txHash: txHash || "",
    contract,
    chainId: cfg.chainId,
    explorerUrl: body.nft?.explorerUrl || `${cfg.explorer}/token/${contract}?a=${tokenId}`,
    openseaUrl: body.nft?.openseaUrl || null,
  };
}
