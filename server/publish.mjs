/**
 * Agent / API publish helpers — generate embed HTML and sync article body to Supabase.
 * Mirrors skills/mon-unlock-embed/embed.ts so OpenClaw and the HTTP API stay aligned.
 */
import { createHash } from "node:crypto";
import { keccak256, toBytes, parseEther, parseUnits } from "viem";

export const CDN_BASE =
  process.env.CDN_BASE || "https://mon-unlock-widget-production.up.railway.app";
/** Legacy native-MON unlock contract (kept live — path A). */
export const MAINNET_MON_CONTRACT =
  process.env.UNLOCK_CONTRACT || "0x27cA0c23835328e2Ab1424b66330be86fe177FA6";
/** @deprecated use MAINNET_MON_CONTRACT */
export const MAINNET_CONTRACT = MAINNET_MON_CONTRACT;
/** ArticleUnlockUsdc on Monad mainnet. */
export const MAINNET_USDC_CONTRACT =
  process.env.USDC_UNLOCK_CONTRACT || "0xd66Df017335ae80BcE5d4Ec728421f3a3DAf6f9f";
/** Circle USDC on Monad mainnet. */
export const MONAD_USDC_TOKEN = "0x754704Bc059F8C67012fEd69BC8A327a5aafb603";
export const WIDGET_VERSION = process.env.WIDGET_VERSION || "20240714";
export const WC_PROJECT_ID =
  process.env.WALLETCONNECT_PROJECT_ID || "c2a289e11ad2998f8ea4633db536334c";
export const REGISTER_ARTICLE_URL =
  process.env.REGISTER_ARTICLE_URL ||
  "https://flczjqljgntmkanipugo.supabase.co/functions/v1/register-article";

export function normalizePaymentAsset(value) {
  const v = String(value ?? "").trim().toLowerCase();
  if (v === "usdc" || v === "usd" || v === "stable") return "usdc";
  return "mon";
}

export function defaultPriceForAsset(paymentAsset) {
  return normalizePaymentAsset(paymentAsset) === "usdc" ? "0.50" : "1";
}

export function unlockContractForAsset(paymentAsset) {
  return normalizePaymentAsset(paymentAsset) === "usdc"
    ? MAINNET_USDC_CONTRACT
    : MAINNET_MON_CONTRACT;
}

export function escapeTeaser(text) {
  return String(text)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

export function toArticleIdHash(slug) {
  return keccak256(toBytes(String(slug).trim()));
}

export function toPriceWei(price, paymentAsset = "usdc") {
  const asset = normalizePaymentAsset(paymentAsset);
  const fallback = defaultPriceForAsset(asset);
  const p = String(price ?? fallback).trim() || fallback;
  if (asset === "usdc") {
    return parseUnits(p, 6).toString();
  }
  return parseEther(p).toString();
}

export function isAddress(value) {
  return typeof value === "string" && /^0x[a-fA-F0-9]{40}$/.test(value);
}

/** URL-safe slug from a title (e.g. "July rain walk" → "july-rain-walk"). */
export function slugFromTitle(title) {
  let slug = String(title || "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (!slug) return "";
  if (slug.length < 3) slug = `${slug}-post`.replace(/^-+/, "");
  if (slug.length > 64) slug = slug.slice(0, 64).replace(/-+$/, "");
  if (!/^[a-z0-9]/.test(slug)) slug = `a-${slug}`;
  if (!/[a-z0-9]$/.test(slug)) slug = `${slug.replace(/-+$/, "")}0`;
  return slug.slice(0, 64);
}

/** Short random suffix so auto-slugs stay unique (e.g. july-rain-walk-k3m9x2). */
export function uniqueSlugSuffix() {
  const time = Date.now().toString(36);
  const rand = Math.floor(Math.random() * 36 ** 2)
    .toString(36)
    .padStart(2, "0");
  return `${time.slice(-4)}${rand}`.toLowerCase().replace(/[^a-z0-9]/g, "0");
}

/** Title-based slug with a unique suffix — default for casual paste. */
export function uniqueSlugFromTitle(title) {
  const base = slugFromTitle(title);
  const suffix = uniqueSlugSuffix();
  if (!base) return `post-${suffix}`.slice(0, 64);
  const combined = `${base}-${suffix}`;
  if (combined.length <= 64) return combined;
  const trimBase = base.slice(0, 64 - suffix.length - 1).replace(/-+$/, "");
  return `${trimBase}-${suffix}`;
}

/**
 * Parse casual human paste into a publish payload.
 *
 * Strict shape checker for the /parse API. Chat agents should interpret messy
 * input with an LLM, confirm with the human, then call this (or build JSON directly).
 */
export function parsePublishPaste(raw, options = {}) {
  const text = String(raw ?? "").trim();
  if (!text) return { ok: false, errors: ["paste is empty"] };

  const sep = text.search(/^---\s*$/m);
  if (sep < 0) {
    return {
      ok: false,
      errors: ['paste must include a "---" line before the full article body'],
    };
  }

  const header = text.slice(0, sep).trim();
  const body = text.slice(sep).replace(/^---\s*\n?/, "").trim();
  if (!body) return { ok: false, errors: ["article body is required after ---"] };

  const fields = {};
  for (const line of header.split(/\n/)) {
    const m = line.match(/^([^:]+):\s*(.*)$/);
    if (!m) continue;
    fields[m[1].trim().toLowerCase()] = m[2].trim();
  }

  const errors = [];
  const title = fields.title || "";
  const teaser = fields.teaser || "";
  const price = fields.price || "";
  const author = fields.author || "";
  if (!title) errors.push("Title: is required");
  if (!teaser) errors.push("Teaser: is required");
  if (!price) errors.push("Price: is required");
  if (errors.length) return { ok: false, errors };

  const articleId = uniqueSlugFromTitle(title);
  const assetRaw =
    fields.asset || fields["payment asset"] || fields.paymentasset || fields.payment || "";

  let paymentAsset;
  if (assetRaw) {
    paymentAsset = /mon/i.test(assetRaw) && !/usdc|usd|stable/i.test(assetRaw) ? "mon" : "usdc";
  }

  const publisher = typeof options.publisher === "string" ? options.publisher.trim() : "";

  const payload = {
    title,
    articleId,
    teaser,
    body,
    publisher,
    price,
    ...(author ? { author } : {}),
    ...(paymentAsset ? { paymentAsset } : {}),
  };

  const validated = validatePublishInput(payload);
  if (!validated.ok) return validated;
  return {
    ok: true,
    input: validated.input,
    formattedPaste: formatPublishPaste(validated.input),
    parsedFrom: "paste",
  };
}

/** Canonical paste with all fields (Slug always present — for agent confirmation). */
export function formatPublishPaste(input) {
  const paymentAsset = normalizePaymentAsset(input.paymentAsset ?? "usdc");
  const price = input.price || defaultPriceForAsset(paymentAsset);
  const lines = [
    `Title: ${input.title}`,
    `Price: ${price}`,
    `Teaser: ${input.teaser}`,
    `Slug: ${input.articleId}`,
  ];
  if (input.author) lines.push(`Author: ${input.author}`);
  return `${lines.join("\n")}\n---\n${input.body}`;
}

/**
 * Finish-registration page URL. Optional meta (title/author/teaser) lets the page
 * rebuild a fully signed embed for one-click copy after the wallet signs.
 */
export function buildFinishRegistrationUrl(slug, price, meta = {}) {
  const paymentAsset = normalizePaymentAsset(meta.paymentAsset ?? "usdc");
  const resolvedPrice =
    String(price ?? "").trim() || defaultPriceForAsset(paymentAsset);
  const params = new URLSearchParams({
    slug: String(slug).trim(),
    price: resolvedPrice,
    paymentAsset,
  });
  const title = typeof meta.title === "string" ? meta.title.trim() : "";
  const author = typeof meta.author === "string" ? meta.author.trim() : "";
  const teaser = typeof meta.teaser === "string" ? meta.teaser.trim() : "";
  if (title) params.set("title", title);
  if (author) params.set("author", author);
  // Keep URL usable in browsers/chat; long teasers still work via unsigned agent embed + attribute copy.
  if (teaser && teaser.length <= 1500) params.set("teaser", teaser);
  return `${CDN_BASE}/register.html?${params.toString()}`;
}

export function generateEmbed(input, embedSig) {
  const author = (input.author || "Author").trim() || "Author";
  const paymentAsset = normalizePaymentAsset(input.paymentAsset ?? "usdc");
  const price =
    (input.price || defaultPriceForAsset(paymentAsset)).trim() ||
    defaultPriceForAsset(paymentAsset);
  const unlockContract = unlockContractForAsset(paymentAsset);
  const teaserEsc = escapeTeaser((input.teaser || "").trim());
  const sig = typeof embedSig === "string" ? embedSig.trim() : "";
  const sigAttr = sig ? `\n  embed-sig="${sig}"` : "";
  // Prefer Open Paywall tag/assets. Legacy <mon-unlock> + mon-unlock.js still work
  // (same bundle registers both tags; openpaywall.* is an alias of mon-unlock.*).
  // Without embed-sig, payments are blocked until /register.html signs the embed.
  return `<link rel="stylesheet" href="${CDN_BASE}/dist/openpaywall.css" />
<script type="module" src="${CDN_BASE}/dist/openpaywall.js?v=${WIDGET_VERSION}"></script>

<open-paywall
  article-id="${String(input.articleId).trim()}"
  title="${String(input.title).trim()}"
  author="${author}"
  price="${price}"
  payment-asset="${paymentAsset}"
  unlock-contract="${unlockContract}"${sigAttr}
  walletconnect-project-id="${WC_PROJECT_ID}"
>
  <div slot="teaser">
${teaserEsc}
  </div>
</open-paywall>`;
}

export function validatePublishInput(raw) {
  const errors = [];
  const title = typeof raw?.title === "string" ? raw.title.trim() : "";
  const articleId = typeof raw?.articleId === "string" ? raw.articleId.trim() : "";
  const teaser = typeof raw?.teaser === "string" ? raw.teaser.trim() : "";
  const body = typeof raw?.body === "string" ? raw.body.trim() : "";
  const publisher = typeof raw?.publisher === "string" ? raw.publisher.trim() : "";
  const author = typeof raw?.author === "string" ? raw.author.trim() : "";
  const paymentAsset = normalizePaymentAsset(raw?.paymentAsset ?? "usdc");
  const priceRaw = typeof raw?.price === "string" ? raw.price.trim() : "";
  const price = priceRaw || defaultPriceForAsset(paymentAsset);

  if (!title) errors.push("title is required");
  if (!articleId) errors.push("articleId (slug) is required");
  else if (!/^[a-z0-9][a-z0-9-]{1,62}[a-z0-9]$/i.test(articleId)) {
    errors.push("articleId must be a URL-safe slug (letters, numbers, hyphens)");
  }
  if (!teaser) errors.push("teaser is required");
  if (!body) errors.push("body is required");
  if (!isAddress(publisher)) errors.push("publisher must be a 0x wallet address");
  if (raw?.paymentAsset != null) {
    const rawAsset = String(raw.paymentAsset).trim().toLowerCase();
    if (!["usdc", "mon", "usd", "stable"].includes(rawAsset)) {
      errors.push('paymentAsset must be "usdc" or "mon"');
    }
  }
  if (price && Number.isNaN(Number(price))) {
    errors.push(
      paymentAsset === "usdc"
        ? "price must be a USD amount (USDC)"
        : "price must be a MON amount"
    );
  }

  if (errors.length) return { ok: false, errors };

  return {
    ok: true,
    input: {
      title,
      articleId,
      teaser,
      body,
      publisher,
      author: author || undefined,
      paymentAsset,
      price,
    },
  };
}

export async function syncMetadataToSupabase(input, options = {}) {
  const slug = input.articleId.trim();
  const paymentAsset = normalizePaymentAsset(input.paymentAsset ?? "usdc");
  const articleIdHash = toArticleIdHash(slug);
  const priceWei = toPriceWei(input.price, paymentAsset);

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
        confirmRegistered: Boolean(options.confirmRegistered),
      }),
    });

    if (res.ok) {
      const body = await res.json().catch(() => ({}));
      return {
        ok: true,
        articleIdHash,
        priceWei,
        slug,
        registration_status: body.registration_status,
        reserved: body.reserved,
      };
    }

    const err = await res.json().catch(() => ({}));
    return {
      ok: false,
      error: err.error || `HTTP ${res.status}`,
      message: err.message,
      status: res.status,
      takenBy: err.publisher,
      articleIdHash,
      priceWei,
      slug,
    };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : "Network error",
      articleIdHash,
      priceWei,
      slug,
    };
  }
}

/**
 * Create embed + sync body. On-chain registration stays a separate wallet step
 * (see finishRegistrationUrl) unless the publisher uses OpenClaw Option A.
 */
export async function publishArticleForAgent(raw) {
  const validated = validatePublishInput(raw);
  if (!validated.ok) {
    const err = new Error(validated.errors.join("; "));
    err.status = 400;
    err.code = "invalid_input";
    err.errors = validated.errors;
    throw err;
  }

  const { input } = validated;
  const paymentAsset = input.paymentAsset;
  // Reserve-on-create: claim the global slug in Supabase before on-chain register.
  const sync = await syncMetadataToSupabase(input);
  if (!sync.ok && sync.error === "slug_taken") {
    const message =
      sync.message ||
      `Article id "${input.articleId}" is already reserved` +
        (sync.takenBy ? ` by ${sync.takenBy}` : "");
    const err = new Error(message);
    err.status = 409;
    err.code = "slug_taken";
    err.takenBy = sync.takenBy;
    err.payload = {
      ok: false,
      error: "slug_taken",
      message,
      takenBy: sync.takenBy,
      articleId: input.articleId,
    };
    throw err;
  }

  // Unsigned until the publisher finishes /register.html (wallet signature).
  const embed = generateEmbed(input);
  const finishRegistrationUrl = buildFinishRegistrationUrl(input.articleId, input.price, {
    title: input.title,
    author: input.author,
    teaser: input.teaser,
    paymentAsset,
  });

  const assetLabel = paymentAsset === "usdc" ? "USDC" : "MON";

  return {
    ok: true,
    slug: sync.slug || input.articleId,
    articleIdHash: sync.articleIdHash || toArticleIdHash(input.articleId),
    priceWei: sync.priceWei || toPriceWei(input.price, paymentAsset),
    paymentAsset,
    price: input.price,
    priceMon: paymentAsset === "mon" ? input.price : undefined,
    publisher: input.publisher.toLowerCase(),
    metadataSynced: sync.ok,
    metadataError: sync.error,
    registrationStatus: sync.registration_status || (sync.ok ? "reserved" : undefined),
    needsManualOnChainRegistration: true,
    finishRegistrationUrl,
    embed,
    nextSteps: [
      `Open ${finishRegistrationUrl}, connect your wallet, and click Register on Monad.`,
      "Approve the transaction and the embed signature prompt, then click Copy signed embed.",
      "Paste that signed HTML on your site (payments require embed-sig).",
      paymentAsset === "usdc"
        ? "Readers unlock with USDC (wallet) or card / Apple Pay / Google Pay when Stripe is configured."
        : "Readers unlock with MON (wallet) or card / Apple Pay / Google Pay when Stripe is configured.",
    ],
  };
}

/** Stable request fingerprint for quotes (not a secret). */
export function quoteFingerprint(input) {
  const paymentAsset = normalizePaymentAsset(input.paymentAsset ?? "usdc");
  const h = createHash("sha256");
  h.update(
    JSON.stringify({
      title: input.title,
      articleId: input.articleId,
      teaser: input.teaser,
      bodyLen: input.body.length,
      publisher: input.publisher.toLowerCase(),
      paymentAsset,
      price: input.price || defaultPriceForAsset(paymentAsset),
    })
  );
  return h.digest("hex").slice(0, 16);
}
