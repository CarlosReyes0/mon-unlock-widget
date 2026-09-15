/**
 * Publisher gas relayer.
 *
 * Articles stay registered on-chain — crypto unlock, hasUnlocked, and embed-sig
 * checks all read the contract. Writers should not pay that gas.
 *
 * Flow: writer signs the embed message (free) → this server calls
 * `registerArticleFor` as the contract owner → payments still go to the writer.
 *
 * Runtime env:
 *   RELAYER_PRIVATE_KEY  — must be the ArticleUnlock / ArticleUnlockUsdc owner
 *   MONAD_RPC_URL        — optional, defaults to https://rpc.monad.xyz
 *   RELAYER_DAILY_LIMIT  — per-publisher cap (default 20)
 *   RELAYER_IP_DAILY_LIMIT — per-IP cap (default 40)
 */
import {
  createPublicClient,
  createWalletClient,
  http,
  keccak256,
  toBytes,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import {
  ALLOWED_FIAT_UNLOCK_CONTRACTS,
  MAINNET_USDC_UNLOCK_CONTRACT,
  MONAD_CHAIN_ID,
  assertFiatEmbedAuthorized,
} from "./embed-signature.mjs";
import {
  fetchArticleRow,
  listingsSupabaseConfigured,
  markArticleRegistered,
} from "./listings-api.mjs";

const ZERO = "0x0000000000000000000000000000000000000000";
const DAY_MS = 24 * 60 * 60 * 1000;
const DEFAULT_PUBLISHER_LIMIT = 20;
const DEFAULT_IP_LIMIT = 40;

export const GET_ARTICLE_ABI = [
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
];

export const REGISTER_FOR_ABI = [
  {
    name: "registerArticleFor",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "articleId", type: "bytes32" },
      { name: "priceWei", type: "uint256" },
      { name: "publisher", type: "address" },
    ],
    outputs: [],
  },
];

const OWNER_ABI = [
  {
    name: "owner",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "address" }],
  },
];

/** @type {Map<string, { count: number, resetAt: number }>} */
const rateBuckets = new Map();

export function resetRelayRateLimits() {
  rateBuckets.clear();
}

export function relayerPrivateKey() {
  const raw = (process.env.RELAYER_PRIVATE_KEY || "").trim();
  if (!raw) return "";
  return raw.startsWith("0x") ? raw : `0x${raw}`;
}

export function relayerConfigured() {
  const key = relayerPrivateKey();
  return /^0x[a-fA-F0-9]{64}$/.test(key);
}

export function relayerAccount() {
  if (!relayerConfigured()) return null;
  return privateKeyToAccount(relayerPrivateKey());
}

export function monadRpcUrl() {
  return (process.env.MONAD_RPC_URL || "https://rpc.monad.xyz").trim() || "https://rpc.monad.xyz";
}

function publisherDailyLimit() {
  const n = Number(process.env.RELAYER_DAILY_LIMIT);
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_PUBLISHER_LIMIT;
}

function ipDailyLimit() {
  const n = Number(process.env.RELAYER_IP_DAILY_LIMIT);
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_IP_LIMIT;
}

export function takeRateLimitToken(key, limit, windowMs = DAY_MS, now = Date.now()) {
  const bucket = rateBuckets.get(key);
  if (!bucket || now >= bucket.resetAt) {
    rateBuckets.set(key, { count: 1, resetAt: now + windowMs });
    return true;
  }
  if (bucket.count >= limit) return false;
  bucket.count += 1;
  return true;
}

export function articleIdFromSlug(slug) {
  return keccak256(toBytes(String(slug || "").trim()));
}

export function isAllowedUnlockContract(contract) {
  const c = String(contract || "").trim().toLowerCase();
  return ALLOWED_FIAT_UNLOCK_CONTRACTS.some((allowed) => allowed.toLowerCase() === c);
}

function httpError(message, status = 400) {
  const err = new Error(message);
  err.status = status;
  return err;
}

/**
 * @param {unknown} body
 * @returns {{
 *   slug: string,
 *   articleIdHash: `0x${string}`,
 *   priceWei: bigint,
 *   publisher: string,
 *   embedSig: string,
 *   paymentAsset: "usdc" | "mon",
 *   contract: string,
 * }}
 */
export function parseRelayRequest(body) {
  const parsed = body && typeof body === "object" ? body : {};
  const slug = String(parsed.slug || parsed.articleId || "").trim();
  if (!slug) throw httpError("missing_slug");

  const publisher = String(parsed.publisher || "").trim().toLowerCase();
  if (!/^0x[a-f0-9]{40}$/.test(publisher)) throw httpError("invalid_publisher");

  const embedSig = String(parsed.embedSig || parsed.signature || "").trim();
  if (!embedSig) throw httpError("missing_embed_sig");

  let priceWei;
  try {
    priceWei = BigInt(parsed.priceWei);
  } catch {
    throw httpError("invalid_price");
  }
  if (priceWei <= 0n) throw httpError("invalid_price");

  const paymentAssetRaw = String(parsed.paymentAsset || "").trim().toLowerCase();
  const paymentAsset = paymentAssetRaw === "mon" ? "mon" : "usdc";

  const contract = String(parsed.contract || "").trim().toLowerCase() ||
    (paymentAsset === "usdc" ? MAINNET_USDC_UNLOCK_CONTRACT.toLowerCase() : "");
  if (!/^0x[a-f0-9]{40}$/.test(contract)) throw httpError("invalid_contract");
  if (!isAllowedUnlockContract(contract)) throw httpError("unsupported_contract", 400);

  const expectedHash = articleIdFromSlug(slug);
  const providedHash = String(parsed.articleIdHash || parsed.articleIdBytes || expectedHash)
    .trim()
    .toLowerCase();
  if (providedHash !== expectedHash.toLowerCase()) throw httpError("hash_mismatch");

  return {
    slug,
    articleIdHash: expectedHash,
    priceWei,
    publisher,
    embedSig,
    paymentAsset,
    contract,
  };
}

export function relayerHealth() {
  const account = relayerAccount();
  return {
    ok: true,
    relayerConfigured: Boolean(account),
    relayerAddress: account ? account.address : null,
    contracts: ALLOWED_FIAT_UNLOCK_CONTRACTS,
  };
}

function monadChain(rpcUrl) {
  return {
    id: MONAD_CHAIN_ID,
    name: "Monad",
    nativeCurrency: { name: "MON", symbol: "MON", decimals: 18 },
    rpcUrls: { default: { http: [rpcUrl] } },
  };
}

async function defaultGetOnchainArticle({ contract, articleIdHash, rpcUrl }) {
  const publicClient = createPublicClient({
    chain: monadChain(rpcUrl),
    transport: http(rpcUrl),
  });
  const article = await publicClient.readContract({
    address: contract,
    abi: GET_ARTICLE_ABI,
    functionName: "getArticle",
    args: [articleIdHash],
  });
  return {
    priceWei: article[0],
    publisher: String(article[1] || "").toLowerCase(),
    active: Boolean(article[2]),
  };
}

async function defaultSubmitRegisterArticleFor({
  contract,
  articleIdHash,
  priceWei,
  publisher,
  rpcUrl,
}) {
  const account = relayerAccount();
  if (!account) throw httpError("relayer_not_configured", 503);

  const chain = monadChain(rpcUrl);
  const publicClient = createPublicClient({ chain, transport: http(rpcUrl) });
  const owner = await publicClient.readContract({
    address: contract,
    abi: OWNER_ABI,
    functionName: "owner",
  });
  if (String(owner).toLowerCase() !== account.address.toLowerCase()) {
    throw httpError("relayer_not_owner", 503);
  }

  const walletClient = createWalletClient({
    account,
    chain,
    transport: http(rpcUrl),
  });
  const hash = await walletClient.writeContract({
    address: contract,
    abi: REGISTER_FOR_ABI,
    functionName: "registerArticleFor",
    args: [articleIdHash, priceWei, publisher],
  });
  await publicClient.waitForTransactionReceipt({ hash });
  return hash;
}

/**
 * Register an article on-chain for a publisher who signed the embed message.
 * @param {object} body — JSON from POST /api/relay/register
 * @param {{ ip?: string }} [ctx]
 * @param {object} [deps] — test doubles
 */
export async function relayRegisterArticle(body, ctx = {}, deps = {}) {
  if (!(deps.configured ?? relayerConfigured)()) {
    const err = httpError("relayer_not_configured", 503);
    err.fallback = true;
    throw err;
  }

  const req = parseRelayRequest(body);
  const ip = String(ctx.ip || "unknown");

  const takeToken = deps.takeRateLimit ?? takeRateLimitToken;
  if (!takeToken(`pub:${req.publisher}`, publisherDailyLimit())) {
    throw httpError("rate_limited", 429);
  }
  if (!takeToken(`ip:${ip}`, ipDailyLimit())) {
    throw httpError("rate_limited", 429);
  }

  const verify = deps.verifyEmbed ?? assertFiatEmbedAuthorized;
  const signed = await verify({
    embedSig: req.embedSig,
    contract: req.contract,
    articleId: req.slug,
    priceWei: req.priceWei,
    publisher: req.publisher,
    chainId: MONAD_CHAIN_ID,
  });
  if (!signed.ok) {
    throw httpError(signed.error || "invalid_embed_sig", signed.status || 403);
  }

  const lookup = deps.lookupReservation ?? (async (slug) => {
    if (!listingsSupabaseConfigured()) return null;
    return fetchArticleRow(slug);
  });
  const reserved = await lookup(req.slug);
  if (!reserved) {
    throw httpError("reservation_required", 403);
  }
  const reservedPublisher = String(reserved.publisher || "").trim().toLowerCase();
  if (reservedPublisher !== req.publisher) {
    throw httpError("slug_taken", 409);
  }

  const rpcUrl = deps.rpcUrl ?? monadRpcUrl();
  const getArticle = deps.getOnchainArticle ?? defaultGetOnchainArticle;
  let existing;
  try {
    existing = await getArticle({
      contract: req.contract,
      articleIdHash: req.articleIdHash,
      rpcUrl,
    });
  } catch {
    existing = { publisher: ZERO, priceWei: 0n, active: false };
  }

  const existingPublisher = String(existing?.publisher || "").toLowerCase();
  const alreadyOurs =
    existingPublisher &&
    existingPublisher !== ZERO &&
    existingPublisher === req.publisher;
  const takenByOther =
    existingPublisher &&
    existingPublisher !== ZERO &&
    existingPublisher !== req.publisher;

  if (takenByOther) {
    throw httpError("slug_taken", 409);
  }

  let txHash = null;
  if (!alreadyOurs) {
    const submit = deps.submitRegisterArticleFor ?? defaultSubmitRegisterArticleFor;
    txHash = await submit({
      contract: req.contract,
      articleIdHash: req.articleIdHash,
      priceWei: req.priceWei,
      publisher: req.publisher,
      rpcUrl,
    });
  }

  const confirm = deps.confirmRegistered ?? markArticleRegistered;
  try {
    await confirm({
      slug: req.slug,
      publisher: req.publisher,
      embedSig: req.embedSig,
      priceWei: req.priceWei.toString(),
    });
  } catch {
    /* chain write is source of truth; client may retry confirm */
  }

  return {
    ok: true,
    slug: req.slug,
    txHash,
    alreadyRegistered: alreadyOurs,
    relayer: true,
  };
}
