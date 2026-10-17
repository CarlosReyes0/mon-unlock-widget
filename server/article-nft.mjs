/**
 * Optional Article NFTs on Monad (writer edition + reader receipt).
 *
 * Unlock remains access. This module serves token metadata (never paid body),
 * records tokenId ↔ slug ↔ role, and does not ship a minting private key.
 * Writers/readers mint from their own wallets and pay gas.
 */
import {
  createPublicClient,
  decodeFunctionResult,
  encodeFunctionData,
  http,
  keccak256,
  toBytes,
} from "viem";
import { articleOgImagePath } from "./article-og.mjs";
import { formatPriceLabel } from "./listings.mjs";
import { monadRpcUrl } from "./relay-register.mjs";
import {
  MAINNET_UNLOCK_CONTRACT,
  MAINNET_USDC_UNLOCK_CONTRACT,
  MONAD_CHAIN_ID,
} from "./embed-signature.mjs";

export const ARTICLE_NFT_CHAIN_ID = 143;
export const ARTICLE_NFT_TESTNET_CHAIN_ID = 10143;
export const NFT_ROLES = new Set(["edition", "receipt"]);

const ARTICLE_META_COLS =
  "article_id,title,author,teaser,price_wei,payment_asset,publisher,external_url,listing_status";

export const TOKEN_META_ABI = [
  {
    name: "tokenMeta",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "id", type: "uint256" }],
    outputs: [
      { name: "articleId", type: "bytes32" },
      { name: "role", type: "uint8" },
      { name: "slug", type: "string" },
      { name: "supply", type: "uint256" },
    ],
  },
];

/** ERC-1155 balanceOf(account, id). ArticleNFT uses this, not ownerOf. */
export const NFT_BALANCE_OF_ABI = [
  {
    name: "balanceOf",
    type: "function",
    stateMutability: "view",
    inputs: [
      { name: "account", type: "address" },
      { name: "id", type: "uint256" },
    ],
    outputs: [{ name: "", type: "uint256" }],
  },
];

/** ERC-721 ownerOf(tokenId). Used only when balanceOf(account, id) is not implemented. */
export const NFT_OWNER_OF_ABI = [
  {
    name: "ownerOf",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "tokenId", type: "uint256" }],
    outputs: [{ name: "", type: "address" }],
  },
];

export function articleNftContract() {
  return (process.env.ARTICLE_NFT_CONTRACT || process.env.VITE_ARTICLE_NFT_CONTRACT || "")
    .trim();
}

export function articleNftConfigured() {
  return /^0x[a-fA-F0-9]{40}$/.test(articleNftContract());
}

export function parseMetadataPath(pathname) {
  const m = String(pathname || "").match(/^\/api\/article-nfts\/metadata\/(\d+)\/?$/);
  if (!m) return null;
  try {
    const id = BigInt(m[1]);
    if (id < 0n) return null;
    return id.toString();
  } catch {
    return null;
  }
}

export function roleFromOnchain(role) {
  return Number(role) === 1 ? "receipt" : "edition";
}

export function articleIdFromSlug(slug) {
  return keccak256(toBytes(String(slug || "").trim()));
}

function httpError(message, status = 400) {
  const err = new Error(message);
  err.status = status;
  return err;
}

function isAddress(value) {
  return typeof value === "string" && /^0x[a-fA-F0-9]{40}$/.test(value.trim());
}

function supabaseConfigured() {
  const url = (process.env.SUPABASE_URL || "").trim();
  const key = (process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim();
  return Boolean(url && key);
}

async function supabase(path, opts = {}) {
  if (!supabaseConfigured()) {
    throw httpError("supabase_not_configured", 503);
  }
  const url = (process.env.SUPABASE_URL || "").trim().replace(/\/$/, "");
  const key = (process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim();
  const method = opts.method || "GET";
  const res = await fetch(`${url}/rest/v1/${path}`, {
    method,
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
      Prefer: opts.prefer || "return=representation",
    },
    body: opts.body != null ? JSON.stringify(opts.body) : undefined,
  });
  const text = await res.text();
  let data = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = text;
    }
  }
  if (!res.ok) {
    const err = httpError(
      (data && data.message) || (data && data.error) || `supabase_${res.status}`,
      res.status >= 400 && res.status < 600 ? res.status : 502
    );
    err.data = data;
    throw err;
  }
  return data;
}

/**
 * ERC-721/1155 metadata. Never includes paid body — teaser only.
 * @param {object} input
 */
export function buildTokenMetadata(input = {}) {
  const slug = String(input.slug || "").trim();
  const role = input.role === "receipt" ? "receipt" : "edition";
  const title = String(input.title || slug || "Article").trim() || "Article";
  const teaser = String(input.teaser || "").trim();
  const origin = String(input.origin || "").replace(/\/$/, "");
  const articlePath = slug ? `/articles/${encodeURIComponent(slug)}` : "/articles";
  const externalUrl =
    (typeof input.externalUrl === "string" && input.externalUrl.trim()) ||
    (origin ? `${origin}${articlePath}` : articlePath);
  const image =
    (typeof input.imageUrl === "string" && input.imageUrl.trim()) ||
    (origin && slug ? `${origin}${articleOgImagePath(slug, input.article || input)}` : "");

  const attributes = [
    { trait_type: "role", value: role },
    { trait_type: "articleSlug", value: slug },
  ];
  if (input.priceLabel) {
    attributes.push({ trait_type: "price", value: String(input.priceLabel) });
  }

  const description =
    teaser ||
    (role === "edition"
      ? "Writer edition on Monad. Not required to read the article."
      : "Reader receipt on Monad. Not required to read the article.");

  const metadata = {
    name:
      role === "edition" ? `${title} — Writer edition` : `${title} — Unlock receipt`,
    description,
    external_url: externalUrl,
    attributes,
  };
  if (image) metadata.image = image;

  // Guard: paid body must never leak into tokenURI even if a caller passes it.
  delete metadata.body;
  delete metadata.paid_body;
  delete metadata.articleBody;
  return metadata;
}

export function metadataHasPaidBody(metadata) {
  if (!metadata || typeof metadata !== "object") return false;
  return (
    Object.prototype.hasOwnProperty.call(metadata, "body") ||
    Object.prototype.hasOwnProperty.call(metadata, "paid_body") ||
    Object.prototype.hasOwnProperty.call(metadata, "articleBody")
  );
}

export function getNftConfig() {
  const contract = articleNftContract();
  const configured = articleNftConfigured();
  return {
    ok: true,
    configured,
    contract: configured ? contract : "",
    chainId: ARTICLE_NFT_CHAIN_ID,
    chain: "monad",
    rpcUrl: monadRpcUrl(),
    explorer: "https://monadvision.com",
    unlockMon: MAINNET_UNLOCK_CONTRACT,
    unlockUsdc: MAINNET_USDC_UNLOCK_CONTRACT,
    mintAuth: "user-wallet",
    note:
      "Optional souvenir NFT. Unlock remains access. The minter’s wallet pays gas. No server private key is used to mint.",
  };
}

async function fetchArticleRow(slug) {
  const slugNorm = String(slug || "").trim();
  if (!slugNorm) return null;
  const path =
    `articles?select=${ARTICLE_META_COLS}` +
    `&article_id=eq.${encodeURIComponent(slugNorm)}` +
    `&limit=1`;
  const rows = await supabase(path);
  return Array.isArray(rows) ? rows[0] || null : null;
}

function metadataFromArticleRow(row, role, origin) {
  const slug = String(row?.article_id || "").trim();
  const paymentAsset = row?.payment_asset === "usdc" ? "usdc" : "mon";
  const priceLabel = formatPriceLabel(row?.price_wei ?? "0", paymentAsset);
  return buildTokenMetadata({
    slug,
    role,
    title: row?.title,
    teaser: row?.teaser,
    priceLabel,
    origin,
    article: row,
    externalUrl: origin && slug ? `${origin}/articles/${encodeURIComponent(slug)}` : "",
  });
}

function monadChain(rpcUrl) {
  return {
    id: MONAD_CHAIN_ID,
    name: "Monad",
    nativeCurrency: { name: "MON", symbol: "MON", decimals: 18 },
    rpcUrls: { default: { http: [rpcUrl] } },
  };
}

export async function readOnchainTokenMeta(tokenId, deps = {}) {
  const contract = deps.contract || articleNftContract();
  if (!/^0x[a-fA-F0-9]{40}$/.test(contract)) {
    throw httpError("nft_not_configured", 503);
  }
  if (typeof deps.readContract === "function") {
    return deps.readContract({ tokenId, contract });
  }
  const rpcUrl = deps.rpcUrl || monadRpcUrl();
  const client = createPublicClient({
    chain: monadChain(rpcUrl),
    transport: http(rpcUrl),
  });
  const result = await client.readContract({
    address: contract,
    abi: TOKEN_META_ABI,
    functionName: "tokenMeta",
    args: [BigInt(tokenId)],
  });
  const [articleId, role, slug, supply] = result;
  return { articleId, role, slug, supply };
}

export async function getTokenMetadata(tokenId, { origin, deps } = {}) {
  if (tokenId == null || tokenId === "") {
    throw httpError("missing_token_id", 400);
  }
  const id = String(tokenId);

  if (supabaseConfigured()) {
    try {
      const contract = articleNftContract();
      let path = `article_nfts?select=token_id,article_slug,role,minter,amount,tx_hash,contract` +
        `&token_id=eq.${encodeURIComponent(id)}` +
        `&limit=1`;
      if (/^0x[a-fA-F0-9]{40}$/.test(contract)) {
        path += `&contract=eq.${encodeURIComponent(contract.toLowerCase())}`;
      }
      const rows = await supabase(path);
      const row = Array.isArray(rows) ? rows[0] : null;
      if (row?.article_slug) {
        const article = await fetchArticleRow(row.article_slug);
        if (article) return metadataFromArticleRow(article, row.role, origin);
        return buildTokenMetadata({
          slug: row.article_slug,
          role: row.role,
          origin,
        });
      }
    } catch (e) {
      if (e?.message === "supabase_not_configured") {
        /* fall through to chain */
      } else if (e?.status && e.status !== 502) {
        throw e;
      }
    }
  }

  const onchain = await readOnchainTokenMeta(id, deps || {});
  const slug = String(onchain.slug || "").trim();
  const role = roleFromOnchain(onchain.role);
  if (slug && supabaseConfigured()) {
    const article = await fetchArticleRow(slug);
    if (article) return metadataFromArticleRow(article, role, origin);
  }
  if (!slug) throw httpError("not_found", 404);
  return buildTokenMetadata({ slug, role, origin });
}

export async function listNftsForArticle({ slug, wallet } = {}) {
  const slugNorm = String(slug || "").trim();
  if (!slugNorm) throw httpError("missing_slug", 400);
  const configured = articleNftConfigured();
  const out = {
    configured,
    contract: configured ? articleNftContract() : "",
    chainId: ARTICLE_NFT_CHAIN_ID,
    slug: slugNorm,
    edition: null,
    receipts: [],
    walletReceipt: null,
  };
  if (!supabaseConfigured()) return out;
  const path =
    `article_nfts?select=token_id,article_slug,role,minter,amount,tx_hash,contract,minted_at` +
    `&article_slug=eq.${encodeURIComponent(slugNorm)}` +
    `&order=minted_at.desc`;
  const rows = await supabase(path);
  const list = Array.isArray(rows) ? rows : [];
  const walletNorm = isAddress(wallet) ? wallet.trim().toLowerCase() : "";
  for (const row of list) {
    if (row.role === "edition" && !out.edition) {
      out.edition = row;
    }
    if (row.role === "receipt") {
      out.receipts.push(row);
      if (walletNorm && String(row.minter || "").toLowerCase() === walletNorm) {
        out.walletReceipt = row;
      }
    }
  }
  return out;
}

export function parseRecordBody(body) {
  const parsed = body && typeof body === "object" ? body : {};
  const slug = String(parsed.slug || parsed.articleSlug || "").trim();
  const role = String(parsed.role || "").trim().toLowerCase();
  const minter = String(parsed.minter || parsed.wallet || "").trim().toLowerCase();
  const tokenId = parsed.tokenId != null ? String(parsed.tokenId) : "";
  const txHash = String(parsed.txHash || parsed.tx_hash || "").trim().toLowerCase();
  const amountRaw = parsed.amount != null ? String(parsed.amount).trim() : "1";
  if (!slug) throw httpError("missing_slug");
  if (!NFT_ROLES.has(role)) throw httpError("invalid_role");
  if (!isAddress(minter)) throw httpError("invalid_minter");
  if (!/^\d+$/.test(tokenId)) throw httpError("invalid_token_id");
  if (txHash && !/^0x[a-f0-9]{64}$/.test(txHash)) throw httpError("invalid_tx_hash");
  if (!/^\d+$/.test(amountRaw)) throw httpError("invalid_amount");
  const amountBig = BigInt(amountRaw);
  if (amountBig <= 0n) throw httpError("invalid_amount");
  return { slug, role, minter, tokenId, txHash, amount: amountBig.toString() };
}

function resolveRecordContract(deps) {
  const override = typeof deps.contract === "string" ? deps.contract.trim() : "";
  if (override) {
    if (!/^0x[a-fA-F0-9]{40}$/.test(override)) throw httpError("wrong_contract", 400);
    return override.toLowerCase();
  }
  if (!articleNftConfigured()) throw httpError("nft_not_configured", 503);
  return articleNftContract().toLowerCase();
}

function claimedContract(body) {
  if (!body || typeof body !== "object") return "";
  const raw = body.contract ?? body.nftContract;
  if (raw == null) return "";
  return String(raw).trim();
}

function claimedChainId(body) {
  if (!body || typeof body !== "object") return null;
  if (body.chainId == null || body.chainId === "") return null;
  const n = Number(body.chainId);
  return Number.isFinite(n) ? n : NaN;
}

function receiptSucceeded(status) {
  return status === "0x1" || status === "0x01" || status === 1 || status === "success";
}

function isExecutionRevert(error) {
  if (!error || typeof error !== "object") return false;
  if (Number(error.code) === 3) return true;
  const msg = String(error.message || "").toLowerCase();
  return msg.includes("revert") || msg.includes("execution");
}

async function rpcExchange(fetchImpl, rpcUrl, method, params) {
  let res;
  try {
    res = await fetchImpl(rpcUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    });
  } catch (e) {
    const err = httpError("rpc_failed", 502);
    err.cause = e;
    throw err;
  }
  if (!res || typeof res.json !== "function") throw httpError("rpc_failed", 502);
  let data;
  try {
    data = await res.json();
  } catch {
    throw httpError("rpc_failed", 502);
  }
  if (!res.ok || data == null) throw httpError("rpc_failed", 502);
  return data;
}

async function rpcCall(fetchImpl, rpcUrl, method, params) {
  const data = await rpcExchange(fetchImpl, rpcUrl, method, params);
  if (data.error) throw httpError("rpc_failed", 502);
  return data.result;
}

async function ethCall(fetchImpl, rpcUrl, to, data) {
  const body = await rpcExchange(fetchImpl, rpcUrl, "eth_call", [{ to, data }, "latest"]);
  if (body.error) {
    if (isExecutionRevert(body.error)) return { ok: false, reverted: true };
    throw httpError("rpc_failed", 502);
  }
  if (typeof body.result !== "string" || !/^0x[0-9a-fA-F]*$/.test(body.result)) {
    throw httpError("rpc_failed", 502);
  }
  return { ok: true, result: body.result };
}

function tupleAt(decoded, index, name) {
  if (Array.isArray(decoded)) return decoded[index];
  if (decoded && typeof decoded === "object" && name && name in decoded) return decoded[name];
  return undefined;
}

/**
 * Fail closed. Every check below must succeed before a row is written.
 * There is no skip flag: a thrown RPC error, a missing or failed receipt,
 * the wrong chain, or the wrong contract rejects the request.
 */
async function assertMintOnchain(parsed, contract, deps) {
  const fetchImpl = deps.fetchImpl || fetch;
  const rpcUrl = deps.rpcUrl || monadRpcUrl();

  const chainRaw = await rpcCall(fetchImpl, rpcUrl, "eth_chainId", []);
  if (chainRaw == null || chainRaw === "") throw httpError("rpc_failed", 502);
  const chainId = Number(chainRaw);
  if (!Number.isFinite(chainId) || chainId !== ARTICLE_NFT_CHAIN_ID) {
    throw httpError("wrong_chain", 400);
  }

  const receipt = await rpcCall(fetchImpl, rpcUrl, "eth_getTransactionReceipt", [parsed.txHash]);
  if (receipt == null) throw httpError("receipt_missing", 400);
  const receiptHash = String(receipt.transactionHash || "").toLowerCase();
  if (receiptHash && receiptHash !== parsed.txHash) throw httpError("receipt_missing", 400);
  if (!receiptSucceeded(receipt.status)) throw httpError("tx_failed", 400);
  const to = String(receipt.to || "").toLowerCase();
  if (!to || to !== contract) throw httpError("wrong_contract", 400);

  const tokenId = BigInt(parsed.tokenId);
  const metaData = encodeFunctionData({
    abi: TOKEN_META_ABI,
    functionName: "tokenMeta",
    args: [tokenId],
  });
  const metaCall = await ethCall(fetchImpl, rpcUrl, contract, metaData);
  if (!metaCall.ok) throw httpError("onchain_mismatch", 400);
  let decoded;
  try {
    decoded = decodeFunctionResult({
      abi: TOKEN_META_ABI,
      functionName: "tokenMeta",
      data: metaCall.result,
    });
  } catch {
    throw httpError("onchain_mismatch", 400);
  }
  const articleId = tupleAt(decoded, 0, "articleId");
  const role = tupleAt(decoded, 1, "role");
  const slug = String(tupleAt(decoded, 2, "slug") || "").trim();
  if (!slug || slug !== parsed.slug) throw httpError("onchain_mismatch", 400);
  if (roleFromOnchain(role) !== parsed.role) throw httpError("onchain_mismatch", 400);
  if (String(articleId || "").toLowerCase() !== articleIdFromSlug(parsed.slug).toLowerCase()) {
    throw httpError("onchain_mismatch", 400);
  }

  await assertClaimedOwner(parsed, contract, fetchImpl, rpcUrl);
}

/**
 * ArticleNFT is ERC-1155: the minter must balanceOf > 0 (and cover `amount`)
 * on the configured contract. If that call reverts, ownerOf must equal the minter.
 * A zero balance is final. An RPC error is final. Neither path writes.
 */
async function assertClaimedOwner(parsed, contract, fetchImpl, rpcUrl) {
  const tokenId = BigInt(parsed.tokenId);
  const amount = BigInt(parsed.amount);
  const balanceData = encodeFunctionData({
    abi: NFT_BALANCE_OF_ABI,
    functionName: "balanceOf",
    args: [parsed.minter, tokenId],
  });
  const balanceCall = await ethCall(fetchImpl, rpcUrl, contract, balanceData);
  if (balanceCall.ok) {
    let balance;
    try {
      balance = BigInt(
        decodeFunctionResult({
          abi: NFT_BALANCE_OF_ABI,
          functionName: "balanceOf",
          data: balanceCall.result,
        })
      );
    } catch {
      throw httpError("not_owner", 400);
    }
    if (balance > 0n && balance >= amount) return;
    throw httpError("not_owner", 400);
  }

  const ownerData = encodeFunctionData({
    abi: NFT_OWNER_OF_ABI,
    functionName: "ownerOf",
    args: [tokenId],
  });
  const ownerCall = await ethCall(fetchImpl, rpcUrl, contract, ownerData);
  if (!ownerCall.ok) throw httpError("not_owner", 400);
  let owner = "";
  try {
    owner = String(
      decodeFunctionResult({
        abi: NFT_OWNER_OF_ABI,
        functionName: "ownerOf",
        data: ownerCall.result,
      })
    ).toLowerCase();
  } catch {
    throw httpError("not_owner", 400);
  }
  if (owner === parsed.minter && amount === 1n) return;
  throw httpError("not_owner", 400);
}

function nftRecordsMatch(existing, parsed, contract) {
  if (!existing || typeof existing !== "object") return false;
  let sameAmount = false;
  try {
    sameAmount = BigInt(existing.amount) === BigInt(parsed.amount);
  } catch {
    sameAmount = false;
  }
  return (
    String(existing.token_id) === String(parsed.tokenId) &&
    String(existing.contract || "").toLowerCase() === contract.toLowerCase() &&
    String(existing.article_slug || "") === parsed.slug &&
    String(existing.role || "") === parsed.role &&
    String(existing.minter || "").toLowerCase() === parsed.minter.toLowerCase() &&
    String(existing.tx_hash || "").toLowerCase() === parsed.txHash.toLowerCase() &&
    sameAmount
  );
}

async function findNftRow(contract, tokenId, deps) {
  if (deps.db) return deps.db.find(contract, tokenId);
  if (!supabaseConfigured()) return null;
  const path =
    `article_nfts?select=token_id,article_slug,role,minter,amount,tx_hash,contract` +
    `&contract=eq.${encodeURIComponent(contract)}` +
    `&token_id=eq.${encodeURIComponent(tokenId)}` +
    `&limit=1`;
  const rows = await supabase(path);
  return Array.isArray(rows) ? rows[0] || null : null;
}

async function insertNftRow(row, deps) {
  if (deps.db) return deps.db.insert(row);
  const rows = await supabase("article_nfts", {
    method: "POST",
    prefer: "return=representation",
    body: row,
  });
  return Array.isArray(rows) ? rows[0] : rows;
}

function idempotentOrConflict(existing, parsed, contract) {
  if (existing && nftRecordsMatch(existing, parsed, contract)) {
    return { recorded: true, idempotent: true, nft: existing };
  }
  throw httpError("nft_record_exists", 409);
}

export async function recordMint(body, deps = {}) {
  const contract = resolveRecordContract(deps);
  const parsed = parseRecordBody(body);
  if (!parsed.txHash) throw httpError("receipt_missing", 400);

  const named = claimedContract(body);
  if (named) {
    if (!/^0x[a-fA-F0-9]{40}$/.test(named) || named.toLowerCase() !== contract) {
      throw httpError("wrong_contract", 400);
    }
  }
  const chainClaim = claimedChainId(body);
  if (chainClaim != null && chainClaim !== ARTICLE_NFT_CHAIN_ID) {
    throw httpError("wrong_chain", 400);
  }

  // Chain proof first. deps cannot skip it. Nothing is written if this throws.
  await assertMintOnchain(parsed, contract, deps);

  const existing = await findNftRow(contract, parsed.tokenId, deps);
  if (existing) return idempotentOrConflict(existing, parsed, contract);

  if (!deps.db && !supabaseConfigured()) {
    return { recorded: false, ...parsed, contract, reason: "supabase_not_configured" };
  }

  const row = {
    token_id: parsed.tokenId,
    article_slug: parsed.slug,
    role: parsed.role,
    minter: parsed.minter,
    amount: parsed.amount,
    tx_hash: parsed.txHash,
    contract,
  };

  try {
    const inserted = await insertNftRow(row, deps);
    return { recorded: true, idempotent: false, nft: inserted };
  } catch (e) {
    if (e?.status !== 409) throw e;
  }

  const again = await findNftRow(contract, parsed.tokenId, deps);
  return idempotentOrConflict(again, parsed, contract);
}
