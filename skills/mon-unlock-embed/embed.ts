/**
 * Shared embed generation — mirrors generator.html output exactly.
 * Body is stored in Supabase (not in the embed) so readers fetch it after unlock.
 */

import {
  createPublicClient,
  createWalletClient,
  http,
  keccak256,
  parseEther,
  toBytes,
  type Hash,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";

export const CDN_BASE = "https://mon-unlock-widget-production.up.railway.app";
export const MAINNET_CONTRACT = "0x038446b1F736e254cC0E256B20D74823c41EeADB";
export const WIDGET_VERSION = "20240713";
export const WC_PROJECT_ID = "c2a289e11ad2998f8ea4633db536334c";
export const REGISTER_ARTICLE_URL =
  "https://flczjqljgntmkanipugo.supabase.co/functions/v1/register-article";
export const MONAD_RPC = "https://rpc.monad.xyz";

export const MONAD_CHAIN = {
  id: 143,
  name: "Monad",
  nativeCurrency: { name: "MON", symbol: "MON", decimals: 18 },
  rpcUrls: { default: { http: [MONAD_RPC] } },
} as const;

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

const REGISTER_ABI = [
  {
    name: "registerArticle",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "articleId", type: "bytes32" },
      { name: "priceWei", type: "uint256" },
    ],
    outputs: [],
  },
] as const;

export interface ArticleInput {
  title: string;
  articleId: string;
  teaser: string;
  body: string;
  author?: string;
  price?: string;
  publisher: string;
}

export interface PluginSecrets {
  /** Publisher wallet — required for Supabase sync */
  publisher?: string;
  /** If set, the agent registers the article on Monad automatically (costs gas) */
  privateKey?: `0x${string}`;
}

export interface GenerateResult {
  embed: string;
  articleIdHash: `0x${string}`;
  priceWei: string;
  slug: string;
}

export interface OnChainResult {
  ok: boolean;
  alreadyRegistered?: boolean;
  txHash?: Hash;
  error?: string;
  publisher?: string;
}

export function escapeTeaser(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export function toArticleIdHash(slug: string): `0x${string}` {
  return keccak256(toBytes(slug));
}

export function toPriceWei(priceMon: string): string {
  return parseEther(priceMon || "1").toString();
}

export function publisherFromPrivateKey(privateKey: `0x${string}`): string {
  return privateKeyToAccount(privateKey).address;
}

export function buildEmbedSignMessage(params: {
  chainId: number;
  contract: string;
  articleId: string;
  priceWei: bigint;
}): string {
  const contract = params.contract.trim().toLowerCase();
  const article = params.articleId.trim();
  return `MON Unlock v1\nchain:${params.chainId}\ncontract:${contract}\narticle:${article}\npriceWei:${params.priceWei.toString()}`;
}

export async function signEmbedWithPrivateKey(input: {
  articleId: string;
  priceWei: string;
  privateKey: `0x${string}`;
}): Promise<`0x${string}`> {
  const account = privateKeyToAccount(input.privateKey);
  const message = buildEmbedSignMessage({
    chainId: 143,
    contract: MAINNET_CONTRACT,
    articleId: input.articleId,
    priceWei: BigInt(input.priceWei),
  });
  return account.signMessage({ message });
}

/** Same embed block as generator.html — teaser slot only, body fetched post-unlock. */
export function generateEmbed(
  input: {
    title: string;
    articleId: string;
    teaser: string;
    author?: string;
    price?: string;
  },
  embedSig?: string
): string {
  const author = input.author?.trim() || "Author";
  const price = input.price?.trim() || "1";
  const teaserEsc = escapeTeaser(input.teaser.trim());
  const sigAttr = embedSig ? `\n  embed-sig="${embedSig}"` : "";

  return `<link rel="stylesheet" href="${CDN_BASE}/dist/mon-unlock.css" />
<script type="module" src="${CDN_BASE}/dist/mon-unlock.js?v=${WIDGET_VERSION}"></script>

<mon-unlock
  article-id="${input.articleId.trim()}"
  title="${input.title.trim()}"
  author="${author}"
  price="${price}"
  unlock-contract="${MAINNET_CONTRACT}"${sigAttr}
  walletconnect-project-id="${WC_PROJECT_ID}"
>
  <div slot="teaser">
${teaserEsc}
  </div>
</mon-unlock>`;
}

export function buildFinishRegistrationUrl(slug: string, price = "1"): string {
  const params = new URLSearchParams({ slug: slug.trim(), price: (price || "1").trim() });
  return `${CDN_BASE}/register.html?${params.toString()}`;
}

export function buildGenerateResult(input: ArticleInput): GenerateResult {
  const slug = input.articleId.trim();
  const articleIdHash = toArticleIdHash(slug);
  const priceWei = toPriceWei(input.price || "1");

  return {
    embed: generateEmbed(input),
    articleIdHash,
    priceWei,
    slug,
  };
}

export async function getOnChainStatus(articleIdHash: `0x${string}`): Promise<{
  registered: boolean;
  publisher?: string;
  active?: boolean;
}> {
  const publicClient = createPublicClient({
    chain: MONAD_CHAIN,
    transport: http(MONAD_RPC),
  });

  try {
    const article = await publicClient.readContract({
      address: MAINNET_CONTRACT,
      abi: GET_ARTICLE_ABI,
      functionName: "getArticle",
      args: [articleIdHash],
    });

    const publisher = article[1];
    if (publisher === "0x0000000000000000000000000000000000000000") {
      return { registered: false };
    }

    return { registered: true, publisher, active: article[2] };
  } catch {
    return { registered: false };
  }
}

/** Register article on Monad — same tx as generator.html "Copy embed" with wallet. */
export async function registerOnChain(input: {
  articleIdHash: `0x${string}`;
  priceWei: string;
  privateKey: `0x${string}`;
}): Promise<OnChainResult> {
  const account = privateKeyToAccount(input.privateKey);
  const priceWei = BigInt(input.priceWei);

  const existing = await getOnChainStatus(input.articleIdHash);
  if (existing.registered) {
    if (existing.publisher?.toLowerCase() === account.address.toLowerCase()) {
      return { ok: true, alreadyRegistered: true, publisher: account.address };
    }
    return {
      ok: false,
      error: `Already registered on-chain by ${existing.publisher}`,
      publisher: existing.publisher,
    };
  }

  const publicClient = createPublicClient({
    chain: MONAD_CHAIN,
    transport: http(MONAD_RPC),
  });
  const walletClient = createWalletClient({
    account,
    chain: MONAD_CHAIN,
    transport: http(MONAD_RPC),
  });

  try {
    const txHash = await walletClient.writeContract({
      address: MAINNET_CONTRACT,
      abi: REGISTER_ABI,
      functionName: "registerArticle",
      args: [input.articleIdHash, priceWei],
    });
    await publicClient.waitForTransactionReceipt({ hash: txHash });
    return { ok: true, txHash, publisher: account.address };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : "On-chain registration failed",
      publisher: account.address,
    };
  }
}

export async function syncMetadataToSupabase(input: ArticleInput): Promise<{
  ok: boolean;
  error?: string;
}> {
  const { articleIdHash, priceWei, slug } = buildGenerateResult(input);

  try {
    const res = await fetch(REGISTER_ARTICLE_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        slug,
        articleIdHash,
        priceWei,
        publisher: input.publisher.toLowerCase(),
        teaser: input.teaser.trim(),
        body: input.body.trim(),
      }),
    });

    if (res.ok) return { ok: true };

    const err = (await res.json().catch(() => ({}))) as { error?: string };
    return { ok: false, error: err.error || `HTTP ${res.status}` };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Network error" };
  }
}

export async function publishArticle(
  input: ArticleInput,
  secrets: PluginSecrets = {},
): Promise<{
  embed: string;
  slug: string;
  articleIdHash: `0x${string}`;
  metadataSynced: boolean;
  metadataError?: string;
  onChainRegistered: boolean;
  onChainAlreadyRegistered?: boolean;
  onChainTxHash?: Hash;
  onChainError?: string;
  needsManualOnChainRegistration: boolean;
  finishRegistrationUrl: string;
}> {
  const privateKey = secrets.privateKey;
  const publisher =
    (input.publisher || secrets.publisher || (privateKey ? publisherFromPrivateKey(privateKey) : "")).trim();

  if (!publisher) {
    throw new Error("Publisher wallet required. Set publisher or privateKey in plugin config.");
  }

  const fullInput = { ...input, publisher };
  const result = buildGenerateResult(fullInput);
  const sync = await syncMetadataToSupabase(fullInput);

  let onChain: OnChainResult | null = null;
  if (privateKey) {
    onChain = await registerOnChain({
      articleIdHash: result.articleIdHash,
      priceWei: result.priceWei,
      privateKey,
    });
  } else {
    const status = await getOnChainStatus(result.articleIdHash);
    onChain = status.registered
      ? { ok: true, alreadyRegistered: true, publisher: status.publisher }
      : { ok: false, error: "Not registered on-chain" };
  }

  const onChainRegistered = Boolean(onChain?.ok);
  const needsManualOnChainRegistration = !onChainRegistered;

  let embedSig: string | undefined;
  if (onChainRegistered && privateKey) {
    embedSig = await signEmbedWithPrivateKey({
      articleId: result.slug,
      priceWei: result.priceWei,
      privateKey,
    });
  }

  return {
    embed: generateEmbed(fullInput, embedSig),
    slug: result.slug,
    articleIdHash: result.articleIdHash,
    metadataSynced: sync.ok,
    metadataError: sync.error,
    onChainRegistered,
    onChainAlreadyRegistered: onChain?.alreadyRegistered,
    onChainTxHash: onChain?.txHash,
    onChainError: onChain?.error,
    needsManualOnChainRegistration,
    finishRegistrationUrl: buildFinishRegistrationUrl(result.slug, input.price || "1"),
  };
}

/** @deprecated use publishArticle */
export async function generateAndSync(input: ArticleInput) {
  const result = buildGenerateResult(input);
  const sync = await syncMetadataToSupabase(input);
  return {
    embed: result.embed,
    slug: result.slug,
    articleIdHash: result.articleIdHash,
    metadataSynced: sync.ok,
    metadataError: sync.error,
  };
}
