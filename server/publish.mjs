/**
 * Agent / API publish helpers — generate embed HTML and sync article body to Supabase.
 * Mirrors skills/mon-unlock-embed/embed.ts so OpenClaw and the HTTP API stay aligned.
 */
import { createHash } from "node:crypto";
import { keccak256, toBytes, parseEther } from "viem";

export const CDN_BASE =
  process.env.CDN_BASE || "https://mon-unlock-widget-production.up.railway.app";
export const MAINNET_CONTRACT =
  process.env.UNLOCK_CONTRACT || "0x038446b1F736e254cC0E256B20D74823c41EeADB";
export const WIDGET_VERSION = process.env.WIDGET_VERSION || "20240714";
export const WC_PROJECT_ID =
  process.env.WALLETCONNECT_PROJECT_ID || "c2a289e11ad2998f8ea4633db536334c";
export const REGISTER_ARTICLE_URL =
  process.env.REGISTER_ARTICLE_URL ||
  "https://flczjqljgntmkanipugo.supabase.co/functions/v1/register-article";

export function escapeTeaser(text) {
  return String(text)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

export function toArticleIdHash(slug) {
  return keccak256(toBytes(String(slug).trim()));
}

export function toPriceWei(priceMon) {
  return parseEther(String(priceMon || "1").trim() || "1").toString();
}

export function isAddress(value) {
  return typeof value === "string" && /^0x[a-fA-F0-9]{40}$/.test(value);
}

/**
 * Finish-registration page URL. Optional meta (title/author/teaser) lets the page
 * rebuild a fully signed embed for one-click copy after the wallet signs.
 */
export function buildFinishRegistrationUrl(slug, price = "1", meta = {}) {
  const params = new URLSearchParams({
    slug: String(slug).trim(),
    price: String(price || "1").trim(),
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
  const price = (input.price || "1").trim() || "1";
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
  unlock-contract="${MAINNET_CONTRACT}"${sigAttr}
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
  const price = typeof raw?.price === "string" ? raw.price.trim() : "1";

  if (!title) errors.push("title is required");
  if (!articleId) errors.push("articleId (slug) is required");
  else if (!/^[a-z0-9][a-z0-9-]{1,62}[a-z0-9]$/i.test(articleId)) {
    errors.push("articleId must be a URL-safe slug (letters, numbers, hyphens)");
  }
  if (!teaser) errors.push("teaser is required");
  if (!body) errors.push("body is required");
  if (!isAddress(publisher)) errors.push("publisher must be a 0x wallet address");
  if (price && Number.isNaN(Number(price))) errors.push("price must be a number (MON)");

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
      price: price || "1",
    },
  };
}

export async function syncMetadataToSupabase(input, options = {}) {
  const slug = input.articleId.trim();
  const articleIdHash = toArticleIdHash(slug);
  const priceWei = toPriceWei(input.price || "1");

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
  });

  return {
    ok: true,
    slug: sync.slug || input.articleId,
    articleIdHash: sync.articleIdHash || toArticleIdHash(input.articleId),
    priceWei: sync.priceWei || toPriceWei(input.price),
    priceMon: input.price || "1",
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
      "Readers unlock with MON (wallet) or card / Apple Pay / Google Pay when Stripe is configured.",
    ],
  };
}

/** Stable request fingerprint for quotes (not a secret). */
export function quoteFingerprint(input) {
  const h = createHash("sha256");
  h.update(
    JSON.stringify({
      title: input.title,
      articleId: input.articleId,
      teaser: input.teaser,
      bodyLen: input.body.length,
      publisher: input.publisher.toLowerCase(),
      price: input.price || "1",
    })
  );
  return h.digest("hex").slice(0, 16);
}
