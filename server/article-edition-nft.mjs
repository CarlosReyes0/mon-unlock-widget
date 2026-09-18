/**
 * Optional article edition NFT (Base). Unlock / USDC stays the access gate.
 *
 * tokenURI: GET /api/nft/{tokenId}  → metadata JSON
 * Record:   POST /api/articles/{slug}/nft
 * Config:   GET /api/nft/health
 *
 * Runtime env (Railway):
 *   ARTICLE_EDITION_NFT_CONTRACT     — deployed ArticleEditionNFT address (required to mint)
 *   ARTICLE_EDITION_NFT_CHAIN_ID     — 8453 Base (default) or 84532 Base Sepolia
 *   ARTICLE_EDITION_NFT_BASE_URI     — optional; documented for the deploy script
 *   ARTICLE_EDITION_NFT_RPC_URL      — public Base RPC (safe to expose to the Write UI)
 *   SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY — tokenId ↔ slug mapping
 */
import { publicOrigin, plainText, articleOgImagePath } from "./article-og.mjs";
import { formatPriceLabel } from "./listings.mjs";

async function listingsApi() {
  return import("./listings-api.mjs");
}

export const BASE_MAINNET_CHAIN_ID = 8453;
export const BASE_SEPOLIA_CHAIN_ID = 84532;

const NFT_TOKEN_PATH = /^\/api\/nft\/(\d+)\/?$/;
const NFT_ARTICLE_PATH = /^\/api\/articles\/([^/]+)\/nft\/?$/i;

function isAddress(value) {
  return typeof value === "string" && /^0x[a-fA-F0-9]{40}$/.test(value);
}

function isTxHash(value) {
  return typeof value === "string" && /^0x[a-fA-F0-9]{64}$/.test(value);
}

function isTokenId(value) {
  if (typeof value === "number" && Number.isInteger(value) && value > 0) return true;
  if (typeof value !== "string") return false;
  return /^\d+$/.test(value.trim()) && BigInt(value.trim()) > 0n;
}

export function nftContractAddress() {
  const raw = (process.env.ARTICLE_EDITION_NFT_CONTRACT || "").trim();
  return isAddress(raw) ? raw.toLowerCase() : "";
}

export function nftChainId() {
  const n = Number(process.env.ARTICLE_EDITION_NFT_CHAIN_ID);
  if (n === BASE_SEPOLIA_CHAIN_ID) return BASE_SEPOLIA_CHAIN_ID;
  if (n === BASE_MAINNET_CHAIN_ID) return BASE_MAINNET_CHAIN_ID;
  return BASE_MAINNET_CHAIN_ID;
}

export function nftConfigured() {
  return Boolean(nftContractAddress());
}

export function nftChainName(chainId = nftChainId()) {
  return Number(chainId) === BASE_SEPOLIA_CHAIN_ID ? "base-sepolia" : "base";
}

export function nftExplorerBase(chainId = nftChainId()) {
  return Number(chainId) === BASE_SEPOLIA_CHAIN_ID
    ? "https://sepolia.basescan.org"
    : "https://basescan.org";
}

export function nftPublicRpcUrl(chainId = nftChainId()) {
  const explicit = (process.env.ARTICLE_EDITION_NFT_RPC_URL || "").trim();
  if (explicit) return explicit;
  return Number(chainId) === BASE_SEPOLIA_CHAIN_ID
    ? "https://sepolia.base.org"
    : "https://mainnet.base.org";
}

export function explorerTokenUrl({ chainId, contract, tokenId }) {
  if (!isAddress(contract) || !isTokenId(tokenId)) return null;
  const id = String(tokenId).trim();
  return `${nftExplorerBase(chainId)}/token/${contract.toLowerCase()}?a=${id}`;
}

export function openseaTokenUrl({ chainId, contract, tokenId }) {
  if (!isAddress(contract) || !isTokenId(tokenId)) return null;
  const id = String(tokenId).trim();
  const addr = contract.toLowerCase();
  if (Number(chainId) === BASE_SEPOLIA_CHAIN_ID) {
    return `https://testnets.opensea.io/assets/base-sepolia/${addr}/${id}`;
  }
  return `https://opensea.io/assets/base/${addr}/${id}`;
}

export function nftPublicStatus() {
  const chainId = nftChainId();
  const configured = nftConfigured();
  return {
    ok: true,
    configured,
    contract: nftContractAddress() || null,
    chainId,
    chainName: nftChainName(chainId),
    explorer: nftExplorerBase(chainId),
    rpcUrl: nftPublicRpcUrl(chainId),
    unlockSeparate: true,
    message: configured
      ? "Optional 1/1 article edition on Base. Unlock/USDC is still the access gate."
      : "Set ARTICLE_EDITION_NFT_CONTRACT on Railway after deploying contracts/src/ArticleEditionNFT.sol.",
  };
}

/**
 * @param {unknown} pathname
 * @returns {string | null}
 */
export function parseNftTokenPath(pathname) {
  const m = String(pathname || "").match(NFT_TOKEN_PATH);
  return m ? m[1] : null;
}

/**
 * @param {unknown} pathname
 * @returns {string | null}
 */
export function parseNftArticlePath(pathname) {
  const m = String(pathname || "").match(NFT_ARTICLE_PATH);
  if (!m) return null;
  try {
    return decodeURIComponent(m[1] || "").trim() || null;
  } catch {
    return (m[1] || "").trim() || null;
  }
}

/**
 * Public collectible projection — never required to read.
 * @param {Record<string, unknown> | null | undefined} row
 */
export function nftFromRow(row) {
  if (!row) return null;
  const tokenId = row.nft_token_id != null ? String(row.nft_token_id).trim() : "";
  const contract = typeof row.nft_contract === "string" ? row.nft_contract.trim() : "";
  if (!tokenId || !isTokenId(tokenId) || !isAddress(contract)) return null;
  const chainId = Number(row.nft_chain_id) || nftChainId();
  return {
    tokenId,
    contract: contract.toLowerCase(),
    chainId,
    txHash: typeof row.nft_tx_hash === "string" ? row.nft_tx_hash : "",
    owner: typeof row.nft_owner === "string" ? row.nft_owner.toLowerCase() : "",
    mintedAt: row.nft_minted_at || null,
    explorerUrl: explorerTokenUrl({ chainId, contract, tokenId }),
    openseaUrl: openseaTokenUrl({ chainId, contract, tokenId }),
  };
}

/**
 * ERC-721 metadata (OpenSea / Basescan).
 * @param {{
 *   article: Record<string, unknown>,
 *   origin: string,
 *   tokenId?: string | number | null,
 * }} input
 */
export function tokenMetadata({ article, origin, tokenId = null }) {
  const slug = String(article?.slug || article?.article_id || "").trim();
  const title =
    typeof article?.title === "string" && article.title.trim()
      ? article.title.trim()
      : slug || "Open Paywall article";
  const teaser = plainText(article?.teaser || "", 500);
  const host = String(origin || "").replace(/\/$/, "");
  const articleUrl = slug ? `${host}/articles/${encodeURIComponent(slug)}` : host;
  const imagePath = slug ? articleOgImagePath(slug) : "/assets/og-default.jpg";
  const priceLabel = formatPriceLabel(
    article?.priceWei ?? article?.price_wei ?? "0",
    article?.paymentAsset || article?.payment_asset || "usdc"
  );

  const attributes = [
    { trait_type: "Price", value: priceLabel },
    { trait_type: "Edition", value: "1/1" },
    {
      trait_type: "Access",
      value: "Unlock/USDC is the paywall — this NFT is not required to read",
    },
  ];
  if (slug) attributes.push({ trait_type: "Slug", value: slug });
  if (tokenId != null && isTokenId(tokenId)) {
    attributes.push({ trait_type: "Token ID", value: String(tokenId) });
  }

  return {
    name: title,
    description: teaser || `${title} on Open Paywall.`,
    external_url: articleUrl,
    image: `${host}${imagePath.startsWith("/") ? imagePath : `/${imagePath}`}`,
    attributes,
  };
}

function httpError(message, status) {
  const err = new Error(message);
  err.status = status;
  return err;
}

export async function metadataForTokenId(tokenId, origin) {
  const { listingsSupabaseConfigured, fetchArticleByNftToken } = await listingsApi();
  if (!listingsSupabaseConfigured()) throw httpError("supabase_not_configured", 503);
  if (!isTokenId(tokenId)) throw httpError("invalid_token", 400);
  const row = await fetchArticleByNftToken({
    tokenId: String(tokenId).trim(),
    contract: nftContractAddress() || undefined,
  });
  if (!row) throw httpError("not_found", 404);
  const article = {
    slug: row.article_id,
    title: row.title,
    teaser: row.teaser,
    priceWei: row.price_wei,
    paymentAsset: row.payment_asset,
  };
  return tokenMetadata({ article, origin, tokenId: String(tokenId).trim() });
}

export async function metadataForSlug(slug, origin) {
  const { listingsSupabaseConfigured, fetchArticleNftRow } = await listingsApi();
  if (!listingsSupabaseConfigured()) throw httpError("supabase_not_configured", 503);
  const row = await fetchArticleNftRow(slug);
  if (!row) throw httpError("not_found", 404);
  const nft = nftFromRow(row);
  return {
    minted: Boolean(nft),
    nft,
    metadata: tokenMetadata({
      article: {
        slug: row.article_id,
        title: row.title,
        teaser: row.teaser,
        priceWei: row.price_wei,
        paymentAsset: row.payment_asset,
      },
      origin,
      tokenId: nft?.tokenId,
    }),
  };
}

/**
 * Persist tokenId ↔ slug after the author mints. Does not send a chain tx.
 * @param {{
 *   slug: string,
 *   publisher: string,
 *   tokenId: string | number,
 *   txHash: string,
 *   contract?: string,
 *   chainId?: number,
 * }} input
 */
export async function recordArticleMint(input) {
  const slug = String(input?.slug || "").trim();
  const publisher = String(input?.publisher || "").trim().toLowerCase();
  if (!slug) throw httpError("missing_slug", 400);
  if (!isAddress(publisher)) throw httpError("invalid_publisher", 400);
  if (!isTokenId(input?.tokenId)) throw httpError("invalid_token", 400);
  const txHash = String(input?.txHash || "").trim();
  if (txHash && !isTxHash(txHash)) throw httpError("invalid_tx", 400);

  const expected = nftContractAddress();
  const contract = String(input?.contract || expected || "")
    .trim()
    .toLowerCase();
  if (!isAddress(contract)) throw httpError("nft_not_configured", 503);
  if (expected && contract !== expected) throw httpError("contract_mismatch", 400);

  const chainId = Number(input?.chainId) || nftChainId();
  if (input?.chainId != null && Number(input.chainId) !== nftChainId()) {
    throw httpError("chain_mismatch", 400);
  }

  const { listingsSupabaseConfigured, fetchArticleNftRow, saveArticleNft } = await listingsApi();
  if (!listingsSupabaseConfigured()) throw httpError("supabase_not_configured", 503);

  const row = await fetchArticleNftRow(slug);
  if (!row) throw httpError("not_found", 404);
  const owner = String(row.publisher || "").trim().toLowerCase();
  if (owner !== publisher) throw httpError("not_publisher", 403);

  const existing = nftFromRow(row);
  const tokenId = String(input.tokenId).trim();
  if (existing && existing.tokenId !== tokenId) {
    throw httpError("already_minted", 409);
  }
  if (existing && existing.tokenId === tokenId) {
    return { ok: true, alreadyMinted: true, nft: existing };
  }

  const saved = await saveArticleNft({
    slug,
    publisher,
    tokenId,
    contract,
    chainId,
    txHash: txHash.toLowerCase(),
    owner: publisher,
  });
  const nft = nftFromRow(saved) || {
    tokenId,
    contract,
    chainId,
    txHash: txHash.toLowerCase(),
    owner: publisher,
    mintedAt: saved?.nft_minted_at || new Date().toISOString(),
    explorerUrl: explorerTokenUrl({ chainId, contract, tokenId }),
    openseaUrl: openseaTokenUrl({ chainId, contract, tokenId }),
  };
  return { ok: true, alreadyMinted: false, nft };
}

function sendJson(res, status, body) {
  const payload = JSON.stringify(body);
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,HEAD,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, Accept");
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  res.end(payload);
}

function readIncomingBody(req, limit = 32_000) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > limit) {
        reject(new Error("body_too_large"));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

/**
 * @returns {Promise<boolean>} true if the request was handled
 */
export async function tryHandleNftRequest(req, res) {
  const method = req.method || "GET";
  const pathOnly = String(req.url || "").split("?")[0];
  const isNftApi =
    pathOnly === "/api/nft/health" ||
    Boolean(parseNftTokenPath(pathOnly)) ||
    Boolean(parseNftArticlePath(pathOnly));
  if (!isNftApi) return false;

  if (method === "OPTIONS") {
    sendJson(res, 204, {});
    return true;
  }

  const origin = publicOrigin(req);

  if ((method === "GET" || method === "HEAD") && pathOnly === "/api/nft/health") {
    sendJson(res, 200, nftPublicStatus());
    return true;
  }

  const tokenId = parseNftTokenPath(pathOnly);
  if (tokenId && (method === "GET" || method === "HEAD")) {
    try {
      const metadata = await metadataForTokenId(tokenId, origin);
      sendJson(res, 200, metadata);
    } catch (e) {
      sendJson(res, e?.status || 500, { error: e?.message || "metadata_failed" });
    }
    return true;
  }

  const slug = parseNftArticlePath(pathOnly);
  if (slug && (method === "GET" || method === "HEAD")) {
    try {
      const body = await metadataForSlug(slug, origin);
      sendJson(res, 200, body);
    } catch (e) {
      sendJson(res, e?.status || 500, { error: e?.message || "metadata_failed" });
    }
    return true;
  }

  if (slug && method === "POST") {
    let parsed = {};
    try {
      const raw = await readIncomingBody(req);
      parsed = raw ? JSON.parse(raw) : {};
    } catch (e) {
      sendJson(res, e?.message === "body_too_large" ? 413 : 400, { error: "invalid_json" });
      return true;
    }
    try {
      const result = await recordArticleMint({
        slug,
        publisher: parsed.publisher,
        tokenId: parsed.tokenId,
        txHash: parsed.txHash,
        contract: parsed.contract,
        chainId: parsed.chainId,
      });
      sendJson(res, 200, result);
    } catch (e) {
      sendJson(res, e?.status || 500, { error: e?.message || "mint_record_failed" });
    }
    return true;
  }

  sendJson(res, 405, { error: "method_not_allowed" });
  return true;
}
