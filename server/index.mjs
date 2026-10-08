/**
 * Production server: static CDN assets + Coinbase Onramp + Stripe fiat unlock.
 *
 * Coinbase requires a server-side session token (JWT from CDP Secret API Key)
 * for every onramp open. Secrets stay here — never in the checkout bundle.
 *
 * Runtime env (Railway):
 *   CDP_API_KEY_ID / CDP_API_KEY       — Secret API Key ID (UUID)
 *   CDP_API_KEY_SECRET / CDP_API_SECRET — Secret (Ed25519 or EC PEM)
 *   STRIPE_SECRET_KEY / STRIPE_WEBHOOK_SECRET
 *   SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY
 *   RELAYER_PRIVATE_KEY                — contract owner; pays registerArticleFor gas
 *                                        and optional reader USDC-unlock gas drips
 *   ARTICLE_NFT_CONTRACT               — optional ERC-1155; writers/readers mint (they pay gas)
 *   MONAD_RPC_URL                      — optional, defaults to https://rpc.monad.xyz
 *   PORT                               — listen port (Railway sets this)
 */
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { generateJwt } from "@coinbase/cdp-sdk/auth";
import {
  stripeConfigured,
  supabaseConfigured,
  createArticleCheckoutSession,
  confirmFiatPayment,
  handleStripeWebhook,
  createConnectOnboardingLink,
  processPendingPayouts,
  getUnlockBySession,
} from "./stripe.mjs";
import {
  connectSampleConfigured,
  createConnectedAccount,
  createOnboardingLink,
  getAccountOnboardingStatus,
  handleConnectThinWebhook,
  createPlatformProduct,
  listPlatformProducts,
  createDestinationCheckout,
  getCheckoutSession,
  listLocalSellers,
} from "./connect-sample.mjs";
import {
  publishArticleForAgent,
  validatePublishInput,
  quoteFingerprint,
  parsePublishPaste,
} from "./publish.mjs";
import { withMppCharge, mppStatus, publishAmount } from "./mpp.mjs";
import { x402Status } from "./x402.mjs";
import { handleX402Publish, handleX402Unlock } from "./x402-handlers.mjs";
import { mirosharkPublicStatus, tryHandleMirosharkRequest } from "./miroshark.mjs";
import { tryHandleVoiceDraftRequest, voiceDraftPublicStatus } from "./voice-drafts.mjs";
import { tryHandleMediaRequest, mediaStatus } from "./media-host.mjs";
import { buildOpenApiDocument } from "./openapi.mjs";
import {
  listPublicArticles,
  getPublicArticle,
  adminSetListingStatus,
  listingsSupabaseConfigured,
  listingAdminConfigured,
} from "./listings-api.mjs";
import {
  cancelWriterSubscription,
  confirmCryptoSubscription,
  createStripeSubscriptionCheckout,
  getWriterPlan,
  lapseExpiredCryptoSubscriptions,
  listReaderSubscriptions,
  resolveArticleAccess,
  setArticleALaCarte,
  subscriptionContractAddress,
  upsertWriterPlan,
} from "./subscriptions.mjs";
import { relayerConfigured, relayerHealth, relayRegisterArticle } from "./relay-register.mjs";
import { articleHtmlForSlug, feedHtmlForReq, isDefaultOgPath, ogJpegForSlug, parseArticleSlug, writerHtmlForWallet } from "./og-http.mjs";
import {
  canonicalWriterPath,
  tryHandleFollowRequest,
  writerNotFoundHtml,
  writerWalletFromPath,
} from "./follows.mjs";
import { defaultOgJpegBuffer, parseOgImagePath } from "./og-card.mjs";
import { publicOrigin } from "./article-og.mjs";
import { createArticleDownload, parseDownloadPath } from "./article-download.mjs";
import {
  gateWalletReader,
  issueReaderSession,
  readerSessionCookie,
  requestDomain,
  resolveRequestReaderSession,
} from "./reader-session.mjs";
import { relayGasDrip } from "./relay-gas.mjs";
import {
  getNftConfig,
  getTokenMetadata,
  listNftsForArticle,
  parseMetadataPath,
  recordMint,
} from "./article-nft.mjs";
import {
  MONAD_BLOCKCHAIN,
  buildPayUrl,
  normalizeOnrampAsset,
} from "./coinbase-onramp.mjs";
import { createCspNonce, htmlSecurityHeaders, secureHtmlDocument } from "./security-headers.mjs";
import { ARTICLE_BODY_LIMIT, readLimitedBody as readBody } from "./body-limit.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const PORT = Number(process.env.PORT || 8080);

const CDP_API_KEY_ID = (
  process.env.CDP_API_KEY_ID ||
  process.env.CDP_API_KEY ||
  ""
).trim();
const CDP_API_KEY_SECRET = (
  process.env.CDP_API_KEY_SECRET ||
  process.env.CDP_API_SECRET ||
  ""
).trim();

const ONRAMP_HOST = "api.developer.coinbase.com";
const ONRAMP_PATH = "/onramp/v1/token";

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".map": "application/json",
  ".txt": "text/plain; charset=utf-8",
  ".md": "text/markdown; charset=utf-8",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".mov": "video/quicktime",
};

function parseByteRange(rangeHeader, size) {
  if (!rangeHeader || !rangeHeader.startsWith("bytes=")) return null;
  const [startStr, endStr] = rangeHeader.slice(6).split("-", 2);
  let start = startStr ? Number.parseInt(startStr, 10) : 0;
  let end = endStr ? Number.parseInt(endStr, 10) : size - 1;
  if (!Number.isFinite(start) || start < 0) start = 0;
  if (!Number.isFinite(end) || end >= size) end = size - 1;
  if (start > end) return null;
  return { start, end };
}

function cors(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,HEAD,POST,DELETE,OPTIONS");
  res.setHeader(
    "Access-Control-Allow-Headers",
    "Content-Type, Stripe-Signature, Authorization, Payment-Signature, Accept, X-PAYMENT, PAYMENT-SIGNATURE, X-Media-Name, X-Reader-Session"
  );
  res.setHeader(
    "Access-Control-Expose-Headers",
    "WWW-Authenticate, Payment-Receipt, PAYMENT-REQUIRED, X-PAYMENT-REQUIRED, PAYMENT-RESPONSE, X-PAYMENT-RESPONSE, Content-Disposition"
  );
}

/** HTML documents only. API and widget script responses keep their existing headers. */
function sendSecuredHtml(req, res, status, html, extraHeaders = {}) {
  const secured = secureHtmlDocument(html);
  const payload = Buffer.from(secured.body, "utf8");
  cors(res);
  res.writeHead(status, {
    "Content-Type": "text/html; charset=utf-8",
    ...extraHeaders,
    ...secured.headers,
    "Content-Length": payload.length,
  });
  if ((req.method || "GET") === "HEAD") return res.end();
  return res.end(payload);
}

function sendJson(res, status, body, extraHeaders = {}) {
  cors(res);
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    ...extraHeaders,
  });
  res.end(payload);
}

function sendText(res, status, text, extraHeaders = {}, method = "GET") {
  cors(res);
  const payload = Buffer.from(String(text ?? ""), "utf8");
  res.writeHead(status, {
    "Content-Type": "text/plain; charset=utf-8",
    "Cache-Control": "no-store",
    "Content-Length": payload.length,
    ...extraHeaders,
  });
  if (method === "HEAD") return res.end();
  return res.end(payload);
}

function fiatSessionFromUrl(url) {
  return String(url.searchParams.get("fiat_session") || url.searchParams.get("fiatSession") || "").trim();
}

/**
 * Wallet reads require a reader session. A Stripe fiat_session still stands
 * on its own, and a bare reader= address is not treated as that wallet.
 */
function requireReaderSession(req, claimedReader) {
  const session = resolveRequestReaderSession(req);
  if (!session) {
    const err = new Error("reader_session_required");
    err.status = 401;
    throw err;
  }
  if (claimedReader) {
    gateWalletReader({ queryReader: claimedReader, session, fiatSession: "" });
  }
  return session;
}

function authenticatedReaderForRead(req, url) {
  const fiatSession = fiatSessionFromUrl(url);
  const session = resolveRequestReaderSession(req);
  const reader = gateWalletReader({
    queryReader: url.searchParams.get("reader"),
    session,
    fiatSession,
  });
  return { reader, fiatSession };
}

function clientIp(req) {
  // Railway / reverse proxies append the real client as the first hop.
  const forwarded = req.headers["x-forwarded-for"];
  if (typeof forwarded === "string" && forwarded.trim()) {
    return forwarded.split(",")[0].trim();
  }
  const real = req.headers["x-real-ip"];
  if (typeof real === "string" && real.trim()) return real.trim();
  return req.socket?.remoteAddress || "127.0.0.1";
}

function isAddress(value) {
  return typeof value === "string" && /^0x[a-fA-F0-9]{40}$/.test(value);
}

async function createSessionToken({ address, asset, clientIp: ip }) {
  if (!CDP_API_KEY_ID || !CDP_API_KEY_SECRET) {
    const err = new Error("coinbase_not_configured");
    err.status = 503;
    throw err;
  }

  const jwt = await generateJwt({
    apiKeyId: CDP_API_KEY_ID,
    apiKeySecret: CDP_API_KEY_SECRET,
    requestMethod: "POST",
    requestHost: ONRAMP_HOST,
    requestPath: ONRAMP_PATH,
    expiresIn: 120,
  });

  const body = {
    addresses: [
      {
        address,
        blockchains: [MONAD_BLOCKCHAIN],
      },
    ],
    assets: [asset],
    clientIp: ip,
  };

  const res = await fetch(`https://${ONRAMP_HOST}${ONRAMP_PATH}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${jwt}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  const text = await res.text();
  let data;
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { message: text };
  }

  if (!res.ok) {
    const err = new Error(data?.message || data?.error || `cdp_${res.status}`);
    err.status = res.status >= 400 && res.status < 600 ? res.status : 502;
    err.details = data;
    throw err;
  }

  const token = data?.token;
  if (!token || typeof token !== "string") {
    const err = new Error("missing_session_token");
    err.status = 502;
    throw err;
  }
  return token;
}

async function handleSessionToken(req, res) {
  let raw;
  try {
    raw = await readBody(req);
  } catch {
    return sendJson(res, 413, { error: "body_too_large" });
  }

  let parsed;
  try {
    parsed = raw ? JSON.parse(raw) : {};
  } catch {
    return sendJson(res, 400, { error: "invalid_json" });
  }

  const address = typeof parsed.address === "string" ? parsed.address.trim() : "";
  const asset = normalizeOnrampAsset(parsed.asset);
  const amount =
    parsed.amount != null && String(parsed.amount).trim() !== ""
      ? String(parsed.amount).trim()
      : undefined;
  const amountKind =
    typeof parsed.amountKind === "string" ? parsed.amountKind.trim().toLowerCase() : undefined;
  const redirectUrl =
    typeof parsed.redirectUrl === "string" && parsed.redirectUrl.startsWith("https://")
      ? parsed.redirectUrl
      : undefined;

  if (!isAddress(address)) {
    return sendJson(res, 400, { error: "invalid_address" });
  }

  try {
    const token = await createSessionToken({
      address,
      asset,
      clientIp: clientIp(req),
    });
    const url = buildPayUrl(token, { asset, amount, amountKind, redirectUrl });
    return sendJson(res, 200, { url, token, asset });
  } catch (e) {
    const status = e?.status || 500;
    const message = e?.message || "session_token_failed";
    if (message === "coinbase_not_configured") {
      return sendJson(res, 503, {
        error: "coinbase_not_configured",
        message:
          "Set CDP_API_KEY_ID and CDP_API_KEY_SECRET on the Railway service to enable Coinbase Onramp.",
      });
    }
    console.error("[coinbase] session token failed:", message, e?.details || "");
    return sendJson(res, status, { error: message });
  }
}

function safeJoin(root, urlPath) {
  const decoded = decodeURIComponent(urlPath.split("?")[0]);
  const cleaned = path.normalize(decoded).replace(/^(\.\.[/\\])+/, "");
  const full = path.join(root, cleaned);
  if (!full.startsWith(root)) return null;
  return full;
}

async function serveArticleHtml(req, res, slug) {
  try {
    const buf = await articleHtmlForSlug(req, slug);
    return sendSecuredHtml(req, res, 200, buf.toString("utf8"), {
      "Cache-Control": "public, max-age=60",
    });
  } catch (e) {
    console.error("[article-og] inject failed:", e?.message || e);
    return serveStatic(req, res, "/article.html");
  }
}

function serveFeedHtml(req, res) {
  try {
    const buf = feedHtmlForReq(req);
    return sendSecuredHtml(req, res, 200, buf.toString("utf8"), {
      "Cache-Control": "public, max-age=60",
    });
  } catch (e) {
    console.error("[article-og] feed inject failed:", e?.message || e);
    return serveStatic(req, res, "/articles.html");
  }
}

function serveOgJpeg(res, buf, method) {
  const body = Buffer.isBuffer(buf) ? buf : Buffer.from(buf);
  cors(res);
  res.writeHead(200, {
    "Content-Type": "image/jpeg",
    "Cache-Control": "public, max-age=86400",
    "Content-Length": body.length,
  });
  if (method === "HEAD") return res.end();
  return res.end(body);
}

function isPrivateRuntimePath(urlPath) {
  let decoded = String(urlPath || "").split("?")[0];
  try {
    decoded = decodeURIComponent(decoded);
  } catch {
    return true;
  }
  const cleaned = path.posix.normalize(decoded.startsWith("/") ? decoded : `/${decoded}`);
  return cleaned === "/server" || cleaned.startsWith("/server/");
}

function serveStatic(req, res, urlPath) {
  if (isPrivateRuntimePath(urlPath)) {
    cors(res);
    res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    return res.end("Not found");
  }
  let filePath = safeJoin(ROOT, urlPath === "/" ? "/index.html" : urlPath);
  if (!filePath) {
    cors(res);
    res.writeHead(403);
    return res.end("Forbidden");
  }

  const method = req.method || "GET";

  function sendFile(targetPath) {
    fs.stat(targetPath, (statErr, fileStat) => {
      if (statErr || !fileStat.isFile()) {
        cors(res);
        res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
        return res.end("Not found");
      }

      const ext = path.extname(targetPath).toLowerCase();
      const contentType = MIME[ext] || "application/octet-stream";
      if (ext === ".html") {
        fs.readFile(targetPath, (readErr, fileBuf) => {
          if (readErr) {
            cors(res);
            res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
            return res.end("Not found");
          }
          // Full document so the CSP nonce matches the body. Ranges would split that.
          return sendSecuredHtml(req, res, 200, fileBuf.toString("utf8"), {
            "Cache-Control": "no-cache",
          });
        });
        return;
      }
      const size = fileStat.size;
      const range = parseByteRange(req.headers.range, size);
      const headers = {
        "Content-Type": contentType,
        "Cache-Control": "no-cache",
        "Accept-Ranges": "bytes",
      };

      if (range) {
        const { start, end } = range;
        const chunkSize = end - start + 1;
        cors(res);
        res.writeHead(206, {
          ...headers,
          "Content-Range": `bytes ${start}-${end}/${size}`,
          "Content-Length": chunkSize,
        });
        if (method === "HEAD") return res.end();
        fs.createReadStream(targetPath, { start, end }).pipe(res);
        return;
      }

      cors(res);
      res.writeHead(200, {
        ...headers,
        "Content-Length": size,
      });
      if (method === "HEAD") return res.end();
      fs.createReadStream(targetPath).pipe(res);
    });
  }

  fs.stat(filePath, (err, stat) => {
    if (err) {
      cors(res);
      res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      return res.end("Not found");
    }
    if (stat.isDirectory()) {
      return sendFile(path.join(filePath, "index.html"));
    }
    if (!stat.isFile()) {
      cors(res);
      res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      return res.end("Not found");
    }
    sendFile(filePath);
  });
}

const server = http.createServer(async (req, res) => {
  const method = req.method || "GET";
  const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);

  if (method === "OPTIONS") {
    cors(res);
    res.writeHead(204);
    return res.end();
  }

  if (await tryHandleMirosharkRequest(req, res)) return;
  if (await tryHandleVoiceDraftRequest(req, res)) return;
  if (await tryHandleMediaRequest(req, res)) return;

  if (method === "POST" && url.pathname === "/api/coinbase/session-token") {
    return handleSessionToken(req, res);
  }

  if (method === "GET" && url.pathname === "/api/coinbase/health") {
    return sendJson(res, 200, {
      ok: true,
      coinbaseConfigured: Boolean(CDP_API_KEY_ID && CDP_API_KEY_SECRET),
    });
  }

  // --- Stripe fiat unlock ---
  if (method === "GET" && url.pathname === "/api/stripe/health") {
    return sendJson(res, 200, {
      ok: true,
      stripeConfigured: stripeConfigured(),
      supabaseConfigured: supabaseConfigured(),
    });
  }

  if (method === "POST" && url.pathname === "/api/stripe/create-intent") {
    try {
      const raw = await readBody(req);
      const parsed = raw ? JSON.parse(raw) : {};
      const result = await createArticleCheckoutSession({
        articleId: parsed.articleId,
        amountUsdCents: parsed.amountUsdCents,
        buyerEmail: parsed.buyerEmail,
        title: parsed.title,
        embedSig: parsed.embedSig,
        contract: parsed.contract,
        reader: parsed.reader,
        returnUrl: parsed.returnUrl,
      });
      return sendJson(res, 200, result);
    } catch (e) {
      const status = e?.status || 500;
      if (e?.message === "stripe_not_configured" || e?.message === "supabase_not_configured") {
        return sendJson(res, 503, { error: e.message });
      }
      console.error("[stripe] create-intent:", e?.message || e, e?.details || "");
      return sendJson(res, status, { error: e?.message || "create_intent_failed" });
    }
  }

  if (method === "POST" && url.pathname === "/api/stripe/confirm") {
    try {
      const raw = await readBody(req);
      const parsed = raw ? JSON.parse(raw) : {};
      const result = await confirmFiatPayment({
        paymentIntentId: parsed.paymentIntentId,
        sessionId: parsed.sessionId,
      });
      return sendJson(res, 200, result);
    } catch (e) {
      const status = e?.status || 500;
      console.error("[stripe] confirm:", e?.message || e);
      return sendJson(res, status, { error: e?.message || "confirm_failed" });
    }
  }

  if (method === "POST" && url.pathname === "/api/stripe/webhook") {
    try {
      const raw = await readBody(req, 256_000);
      const result = await handleStripeWebhook(raw, req.headers["stripe-signature"]);
      return sendJson(res, 200, result);
    } catch (e) {
      const status = e?.status || 400;
      console.error("[stripe] webhook:", e?.message || e);
      return sendJson(res, status, { error: e?.message || "webhook_failed" });
    }
  }

  if (method === "GET" && url.pathname === "/api/stripe/unlock-status") {
    try {
      const session = url.searchParams.get("session") || "";
      const unlock = await getUnlockBySession(session);
      if (!unlock || unlock.status !== "succeeded") {
        return sendJson(res, 404, { unlocked: false });
      }
      return sendJson(res, 200, {
        unlocked: true,
        articleId: unlock.article_id,
        articleIdHash: unlock.article_id_hash,
        sessionToken: unlock.session_token,
      });
    } catch (e) {
      const status = e?.status || 500;
      return sendJson(res, status, { error: e?.message || "status_failed" });
    }
  }

  if (method === "POST" && url.pathname === "/api/stripe/connect/onboard") {
    try {
      const raw = await readBody(req);
      const parsed = raw ? JSON.parse(raw) : {};
      const proto = String(req.headers["x-forwarded-proto"] || "https").split(",")[0].trim();
      const origin = `${proto}://${req.headers.host || "localhost"}`;
      const safeUrl = (value, fallback) => {
        if (typeof value !== "string") return fallback;
        try {
          const u = new URL(value);
          if (u.protocol !== "https:" && u.protocol !== "http:") return fallback;
          // Only same-host return/refresh URLs (prevent open redirects).
          if (u.host !== (req.headers.host || "")) return fallback;
          return u.toString();
        } catch {
          return fallback;
        }
      };
      const result = await createConnectOnboardingLink({
        publisher: parsed.publisher,
        refreshUrl: safeUrl(parsed.refreshUrl, `${origin}/dashboard.html`),
        returnUrl: safeUrl(parsed.returnUrl, `${origin}/dashboard.html`),
      });
      return sendJson(res, 200, result);
    } catch (e) {
      const status = e?.status || 500;
      console.error("[stripe] connect onboard:", e?.message || e);
      return sendJson(res, status, { error: e?.message || "onboard_failed" });
    }
  }

  if (method === "POST" && url.pathname === "/api/stripe/payouts/process") {
    try {
      const cronSecret = (process.env.STRIPE_PAYOUT_CRON_SECRET || "").trim();
      if (!cronSecret) {
        return sendJson(res, 503, { error: "payout_cron_not_configured" });
      }
      const auth = String(req.headers.authorization || "");
      const headerSecret = String(req.headers["x-cron-secret"] || "");
      const bearer = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
      if (bearer !== cronSecret && headerSecret !== cronSecret) {
        return sendJson(res, 401, { error: "unauthorized" });
      }
      const raw = await readBody(req);
      const parsed = raw ? JSON.parse(raw) : {};
      const result = await processPendingPayouts({ limit: parsed.limit });
      return sendJson(res, 200, result);
    } catch (e) {
      const status = e?.status || 500;
      console.error("[stripe] payouts:", e?.message || e);
      return sendJson(res, status, { error: e?.message || "payouts_failed" });
    }
  }

  // --- Agent discovery + MPP publish ---
  // Dynamic OpenAPI so MPPscan sees protocols: [{ mpp: {...} }] with live recipient.
  if ((method === "GET" || method === "HEAD") && url.pathname === "/openapi.json") {
    const doc = buildOpenApiDocument();
    const payload = JSON.stringify(doc, null, 2);
    cors(res);
    res.writeHead(200, {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-cache",
    });
    if (method === "HEAD") return res.end();
    return res.end(payload);
  }

  if (method === "GET" && url.pathname === "/api/agents/health") {
    return sendJson(res, 200, {
      ok: true,
      service: "mon-unlock",
      product: "Open Paywall",
      mpp: mppStatus(),
      x402: x402Status(),
      miroshark: mirosharkPublicStatus(),
      voiceDrafts: voiceDraftPublicStatus(),
      docs: {
        llms: "/llms.txt",
        agents: "/agents.md",
        skill: "/skill.md",
        cursorSkill: "/.well-known/skills/mon-unlock/SKILL.md",
        x402Skill: "/.well-known/skills/open-paywall-x402/SKILL.md",
        openapi: "/openapi.json",
      },
    });
  }

  if (method === "POST" && url.pathname === "/api/agents/publish/parse") {
    try {
      const raw = await readBody(req, ARTICLE_BODY_LIMIT);
      const parsed = raw ? JSON.parse(raw) : {};
      const result = parsePublishPaste(parsed.paste, { publisher: parsed.publisher });
      if (!result.ok) {
        return sendJson(res, 400, { ok: false, errors: result.errors });
      }
      return sendJson(res, 200, {
        ok: true,
        input: result.input,
        formattedPaste: result.formattedPaste,
        parsedFrom: "paste",
        next: "POST /api/agents/publish/validate then /api/agents/publish with this input object.",
      });
    } catch (e) {
      if (e?.message === "body_too_large") {
        return sendJson(res, 413, { error: "body_too_large" });
      }
      return sendJson(res, 400, { error: "invalid_json" });
    }
  }

  if (method === "POST" && url.pathname === "/api/agents/publish/validate") {
    try {
      const raw = await readBody(req, ARTICLE_BODY_LIMIT);
      const parsed = raw ? JSON.parse(raw) : {};
      const validated = validatePublishInput(parsed);
      if (!validated.ok) {
        return sendJson(res, 400, { ok: false, errors: validated.errors });
      }
      const status = mppStatus();
      return sendJson(res, 200, {
        ok: true,
        valid: true,
        fingerprint: quoteFingerprint(validated.input),
        quote: {
          amount: publishAmount(),
          currency: status.currency,
          description: "Create one embeddable paywall (embed HTML + body sync)",
        },
        mpp: status,
        next: "POST /api/agents/publish (MPP PathUSD) or POST /api/x402/publish (Bankr / x402 USDC on Base), then pay the 402 challenge.",
      });
    } catch (e) {
      if (e?.message === "body_too_large") {
        return sendJson(res, 413, { error: "body_too_large" });
      }
      return sendJson(res, 400, { error: "invalid_json" });
    }
  }

  if (method === "POST" && url.pathname === "/api/agents/publish") {
    // Important: unpaid probes (empty/invalid body) must still return HTTP 402 +
    // WWW-Authenticate so mpp.dev / registries detect MPP. Do not 400 before the gate.
    let parsed = {};
    let parseError = null;
    try {
      const raw = await readBody(req, ARTICLE_BODY_LIMIT);
      parsed = raw ? JSON.parse(raw) : {};
    } catch (e) {
      if (e?.message === "body_too_large") {
        return sendJson(res, 413, { error: "body_too_large" });
      }
      parseError = "invalid_json";
    }

    const validated = parseError
      ? { ok: false, errors: [parseError] }
      : validatePublishInput(parsed);
    const hasPaymentCredential = String(req.headers.authorization || "")
      .trim()
      .toLowerCase()
      .startsWith("payment ");

    // After paying, invalid payloads should not be accepted as success.
    if (!validated.ok && hasPaymentCredential) {
      return sendJson(res, 400, { ok: false, errors: validated.errors });
    }

    cors(res);
    return withMppCharge(req, res, {
      amount: publishAmount(),
      scope: `publish:${validated.ok ? validated.input.articleId : "probe"}`,
      onPaid: async () => {
        if (!validated.ok) {
          const err = new Error("invalid_input");
          err.status = 400;
          err.payload = { ok: false, errors: validated.errors };
          throw err;
        }
        return publishArticleForAgent(validated.input);
      },
    });
  }

  const isX402Publish =
    url.pathname === "/api/x402/publish" || url.pathname === "/api/agents/x402/publish";
  if (method === "POST" && isX402Publish) {
    return handleX402Publish(req, res, { readBody, sendJson });
  }

  const isX402Unlock =
    url.pathname === "/api/x402/unlock" ||
    url.pathname === "/api/agents/x402/unlock" ||
    url.pathname.startsWith("/api/x402/articles/") ||
    url.pathname.startsWith("/api/agents/x402/articles/");
  if ((method === "GET" || method === "POST") && isX402Unlock) {
    return handleX402Unlock(req, res, { url, readBody, sendJson });
  }

  // Friendly aliases for agent discovery URLs without extensions.
  if (method === "GET" || method === "HEAD") {
    if (url.pathname === "/agents") {
      return serveStatic(req, res, "/agents.html");
    }
    if (url.pathname === "/skill") {
      return serveStatic(req, res, "/skill.md");
    }
  }

  // --- Stripe Connect sample (Accounts v2 + destination charges) ---
  const requestOrigin = () => {
    const proto = String(req.headers["x-forwarded-proto"] || "http").split(",")[0].trim();
    return `${proto}://${req.headers.host || "localhost"}`;
  };

  if (method === "GET" && url.pathname === "/api/connect-sample/health") {
    return sendJson(res, 200, {
      ok: true,
      stripeConfigured: connectSampleConfigured(),
    });
  }

  if (method === "GET" && url.pathname === "/api/connect-sample/sellers") {
    try {
      return sendJson(res, 200, { sellers: listLocalSellers() });
    } catch (e) {
      return sendJson(res, e?.status || 500, {
        error: e?.code || "sellers_failed",
        message: e?.message || "sellers_failed",
      });
    }
  }

  if (method === "POST" && url.pathname === "/api/connect-sample/accounts") {
    try {
      const raw = await readBody(req);
      const parsed = raw ? JSON.parse(raw) : {};
      const result = await createConnectedAccount(parsed);
      return sendJson(res, 200, result);
    } catch (e) {
      const status = e?.status || 500;
      console.error("[connect-sample] accounts:", e?.message || e);
      return sendJson(res, status, {
        error: e?.code || "account_create_failed",
        message: e?.message || "account_create_failed",
      });
    }
  }

  if (method === "POST" && url.pathname === "/api/connect-sample/account-link") {
    try {
      const raw = await readBody(req);
      const parsed = raw ? JSON.parse(raw) : {};
      const origin = requestOrigin();
      const accountId = String(parsed.accountId || "").trim();
      const result = await createOnboardingLink({
        accountId,
        returnUrl: `${origin}/connect-demo.html?accountId=${encodeURIComponent(accountId)}`,
        refreshUrl: `${origin}/connect-demo.html?accountId=${encodeURIComponent(accountId)}&refresh=1`,
      });
      return sendJson(res, 200, result);
    } catch (e) {
      const status = e?.status || 500;
      console.error("[connect-sample] account-link:", e?.message || e);
      return sendJson(res, status, {
        error: e?.code || "account_link_failed",
        message: e?.message || "account_link_failed",
      });
    }
  }

  if (method === "GET" && url.pathname === "/api/connect-sample/account-status") {
    try {
      const accountId = url.searchParams.get("accountId") || "";
      const result = await getAccountOnboardingStatus(accountId);
      return sendJson(res, 200, result);
    } catch (e) {
      const status = e?.status || 500;
      return sendJson(res, status, {
        error: e?.code || "account_status_failed",
        message: e?.message || "account_status_failed",
      });
    }
  }

  if (method === "POST" && url.pathname === "/api/connect-sample/products") {
    try {
      const raw = await readBody(req);
      const parsed = raw ? JSON.parse(raw) : {};
      const result = await createPlatformProduct(parsed);
      return sendJson(res, 200, result);
    } catch (e) {
      const status = e?.status || 500;
      console.error("[connect-sample] products:", e?.message || e);
      return sendJson(res, status, {
        error: e?.code || "product_create_failed",
        message: e?.message || "product_create_failed",
      });
    }
  }

  if (method === "GET" && url.pathname === "/api/connect-sample/products") {
    try {
      const result = await listPlatformProducts();
      return sendJson(res, 200, result);
    } catch (e) {
      const status = e?.status || 500;
      return sendJson(res, status, {
        error: e?.code || "product_list_failed",
        message: e?.message || "product_list_failed",
      });
    }
  }

  if (method === "POST" && url.pathname === "/api/connect-sample/checkout") {
    try {
      const raw = await readBody(req);
      const parsed = raw ? JSON.parse(raw) : {};
      const origin = requestOrigin();
      const result = await createDestinationCheckout({
        productId: parsed.productId,
        quantity: parsed.quantity,
        successUrl: `${origin}/connect-success.html?session_id={CHECKOUT_SESSION_ID}`,
        cancelUrl: `${origin}/connect-store.html?canceled=1`,
      });
      return sendJson(res, 200, result);
    } catch (e) {
      const status = e?.status || 500;
      console.error("[connect-sample] checkout:", e?.message || e);
      return sendJson(res, status, {
        error: e?.code || "checkout_failed",
        message: e?.message || "checkout_failed",
      });
    }
  }

  if (method === "GET" && url.pathname === "/api/connect-sample/checkout-session") {
    try {
      const sessionId = url.searchParams.get("session_id") || "";
      const result = await getCheckoutSession(sessionId);
      return sendJson(res, 200, result);
    } catch (e) {
      const status = e?.status || 500;
      return sendJson(res, status, {
        error: e?.code || "session_failed",
        message: e?.message || "session_failed",
      });
    }
  }

  if (method === "POST" && url.pathname === "/api/connect-sample/webhook") {
    try {
      // Raw body required for thin-event signature verification.
      const raw = await readBody(req, 256_000);
      const result = await handleConnectThinWebhook(raw, req.headers["stripe-signature"]);
      return sendJson(res, 200, result);
    } catch (e) {
      const status = e?.status || 400;
      console.error("[connect-sample] webhook:", e?.message || e);
      return sendJson(res, status, {
        error: e?.code || "webhook_failed",
        message: e?.message || "webhook_failed",
      });
    }
  }

  // --- Reader session (one wallet signature, then a short-lived token) ---
  if (method === "POST" && url.pathname === "/api/reader/session") {
    try {
      const raw = await readBody(req);
      const parsed = raw ? JSON.parse(raw) : {};
      const issued = await issueReaderSession({
        domain: requestDomain(req),
        address: parsed.address,
        issuedAt: parsed.issuedAt,
        expiresAt: parsed.expiresAt,
        signature: parsed.signature,
      });
      const secure = publicOrigin(req).startsWith("https:");
      return sendJson(
        res,
        200,
        { token: issued.token, address: issued.address, expiresAt: issued.expiresAt },
        { "Set-Cookie": readerSessionCookie(issued.token, issued.expiresAt, { secure }) }
      );
    } catch (e) {
      if (e instanceof SyntaxError) return sendJson(res, 400, { error: "invalid_json" });
      const status = e?.status || 500;
      return sendJson(res, status, { error: e?.message || "reader_session_failed" });
    }
  }

  if (await tryHandleFollowRequest(req, res, url, {
    readBody,
    clientIp,
    sendJson,
    sendText,
    sendHtml: sendSecuredHtml,
  })) {
    return;
  }

  // --- Writer subscriptions (fiat + Monad USDC) ---
  if (method === "GET" && url.pathname === "/api/access") {
    try {
      const auth = authenticatedReaderForRead(req, url);
      const body = await resolveArticleAccess({
        articleId: url.searchParams.get("article_id") || url.searchParams.get("articleId"),
        reader: auth.reader,
        fiatSession: auth.fiatSession,
      });
      return sendJson(res, 200, body);
    } catch (e) {
      const status = e?.status || 500;
      return sendJson(res, status, { error: e?.message || "access_failed", ...(e?.access || {}) });
    }
  }

  if (method === "GET" && url.pathname === "/api/article-body") {
    try {
      const auth = authenticatedReaderForRead(req, url);
      const body = await resolveArticleAccess({
        articleId: url.searchParams.get("article_id") || url.searchParams.get("articleId"),
        reader: auth.reader,
        fiatSession: auth.fiatSession,
        includeBody: true,
      });
      return sendJson(res, 200, { body: body.body, reason: body.reason });
    } catch (e) {
      const status = e?.status || 500;
      return sendJson(res, status, { error: e?.message || "body_failed" });
    }
  }

  // Entitled HTML download — same gate as /api/article-body. No body bytes if locked.
  const downloadSlug = parseDownloadPath(url.pathname);
  if ((method === "GET" || method === "HEAD") && downloadSlug) {
    try {
      const auth = authenticatedReaderForRead(req, url);
      const file = await createArticleDownload({
        articleId: downloadSlug,
        reader: auth.reader,
        fiatSession: auth.fiatSession,
        origin: publicOrigin(req),
      });
      cors(res);
      const payload = Buffer.from(file.html, "utf8");
      // Headers only — do not nonce scripts inside the entitled article body.
      res.writeHead(200, {
        "Content-Type": file.contentType,
        "Content-Disposition": file.contentDisposition,
        "Cache-Control": "private, no-store",
        "X-Robots-Tag": "noindex, nofollow",
        "Content-Length": payload.length,
        ...htmlSecurityHeaders(createCspNonce()),
      });
      if (method === "HEAD") return res.end();
      return res.end(payload);
    } catch (e) {
      const status = e?.status || 500;
      return sendJson(res, status, { error: e?.message || "download_failed" });
    }
  }

  if (method === "GET" && url.pathname.startsWith("/api/writers/") && url.pathname.endsWith("/plan")) {
    try {
      const publisher = decodeURIComponent(url.pathname.slice("/api/writers/".length, -"/plan".length));
      const plan = await getWriterPlan(publisher);
      return sendJson(res, 200, { plan, subscriptionContract: subscriptionContractAddress() || null });
    } catch (e) {
      const status = e?.status || 500;
      return sendJson(res, status, { error: e?.message || "plan_failed" });
    }
  }

  if (method === "POST" && url.pathname === "/api/writers/plan") {
    try {
      const raw = await readBody(req);
      const parsed = raw ? JSON.parse(raw) : {};
      const plan = await upsertWriterPlan({
        publisher: parsed.publisher,
        monthlyPriceCents: parsed.monthlyPriceCents,
        allowALaCarte: parsed.allowALaCarte,
        planSig: parsed.planSig,
      });
      return sendJson(res, 200, { plan });
    } catch (e) {
      const status = e?.status || 500;
      return sendJson(res, status, { error: e?.message || "plan_save_failed" });
    }
  }

  if (method === "POST" && url.pathname === "/api/articles/a-la-carte") {
    try {
      const raw = await readBody(req);
      const parsed = raw ? JSON.parse(raw) : {};
      const result = await setArticleALaCarte({
        articleId: parsed.articleId,
        publisher: parsed.publisher,
        allowALaCarte: parsed.allowALaCarte,
        aLaCarteSig: parsed.aLaCarteSig,
      });
      return sendJson(res, 200, result);
    } catch (e) {
      const status = e?.status || 500;
      return sendJson(res, status, { error: e?.message || "a_la_carte_failed" });
    }
  }

  if (method === "GET" && url.pathname === "/api/subscriptions") {
    try {
      const session = requireReaderSession(req, url.searchParams.get("reader"));
      const rows = await listReaderSubscriptions(session.address);
      return sendJson(res, 200, { subscriptions: rows });
    } catch (e) {
      const status = e?.status || 500;
      return sendJson(res, status, { error: e?.message || "list_failed" });
    }
  }

  if (method === "POST" && url.pathname === "/api/subscriptions/stripe/checkout") {
    try {
      const raw = await readBody(req);
      const parsed = raw ? JSON.parse(raw) : {};
      const proto = String(req.headers["x-forwarded-proto"] || "https").split(",")[0].trim();
      const origin = `${proto}://${req.headers.host || "localhost"}`;
      const safeUrl = (value, fallback) => {
        if (typeof value !== "string") return fallback;
        try {
          const u = new URL(value);
          if (u.protocol !== "https:" && u.protocol !== "http:") return fallback;
          return u.toString();
        } catch {
          return fallback;
        }
      };
      const result = await createStripeSubscriptionCheckout({
        reader: parsed.reader,
        writer: parsed.writer,
        successUrl: safeUrl(parsed.successUrl, `${origin}/account.html?sub=ok`),
        cancelUrl: safeUrl(parsed.cancelUrl, `${origin}/account.html?sub=cancel`),
      });
      return sendJson(res, 200, result);
    } catch (e) {
      const status = e?.status || 500;
      if (e?.message === "stripe_not_configured" || e?.message === "supabase_not_configured") {
        return sendJson(res, 503, { error: e.message });
      }
      return sendJson(res, status, { error: e?.message || "checkout_failed" });
    }
  }

  if (method === "POST" && url.pathname === "/api/subscriptions/crypto/confirm") {
    try {
      const raw = await readBody(req);
      const parsed = raw ? JSON.parse(raw) : {};
      const session = requireReaderSession(req, parsed.reader);
      const result = await confirmCryptoSubscription({
        reader: session.address,
        writer: parsed.writer,
        txHash: parsed.txHash,
      });
      return sendJson(res, 200, result);
    } catch (e) {
      if (e instanceof SyntaxError) return sendJson(res, 400, { error: "invalid_json" });
      const status = e?.status || 500;
      return sendJson(res, status, { error: e?.message || "confirm_failed" });
    }
  }

  if (method === "POST" && url.pathname === "/api/subscriptions/cancel") {
    try {
      const raw = await readBody(req);
      const parsed = raw ? JSON.parse(raw) : {};
      const session = requireReaderSession(req, parsed.reader);
      const result = await cancelWriterSubscription({
        reader: session.address,
        writer: parsed.writer,
      });
      return sendJson(res, 200, result);
    } catch (e) {
      if (e instanceof SyntaxError) return sendJson(res, 400, { error: "invalid_json" });
      const status = e?.status || 500;
      return sendJson(res, status, { error: e?.message || "cancel_failed" });
    }
  }

  if (method === "POST" && url.pathname === "/api/subscriptions/crypto/lapse") {
    try {
      const cronSecret = (process.env.STRIPE_PAYOUT_CRON_SECRET || "").trim();
      if (cronSecret) {
        const auth = String(req.headers.authorization || "");
        const headerSecret = String(req.headers["x-cron-secret"] || "");
        const bearer = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
        if (bearer !== cronSecret && headerSecret !== cronSecret) {
          return sendJson(res, 401, { error: "unauthorized" });
        }
      }
      const result = await lapseExpiredCryptoSubscriptions();
      return sendJson(res, 200, result);
    } catch (e) {
      const status = e?.status || 500;
      return sendJson(res, status, { error: e?.message || "lapse_failed" });
    }
  }

  // --- Publisher gas relayer (registerArticleFor; writer still signs) ---
  if (method === "GET" && url.pathname === "/api/relay/health") {
    return sendJson(res, 200, relayerHealth());
  }

  if (method === "POST" && url.pathname === "/api/relay/register") {
    try {
      const raw = await readBody(req);
      const parsed = raw ? JSON.parse(raw) : {};
      const result = await relayRegisterArticle(parsed, { ip: clientIp(req) });
      return sendJson(res, 200, result);
    } catch (e) {
      if (e?.message === "body_too_large") {
        return sendJson(res, 413, { error: "body_too_large" });
      }
      if (e instanceof SyntaxError) {
        return sendJson(res, 400, { error: "invalid_json" });
      }
      const status = e?.status || 500;
      const payload = { error: e?.message || "relay_failed" };
      if (e?.fallback) payload.fallback = true;
      return sendJson(res, status, payload);
    }
  }

  if (method === "POST" && url.pathname === "/api/relay/gas") {
    try {
      const raw = await readBody(req);
      const parsed = raw ? JSON.parse(raw) : {};
      const result = await relayGasDrip(parsed, { ip: clientIp(req) });
      return sendJson(res, 200, result);
    } catch (e) {
      if (e?.message === "body_too_large") {
        return sendJson(res, 413, { error: "body_too_large" });
      }
      if (e instanceof SyntaxError) {
        return sendJson(res, 400, { error: "invalid_json" });
      }
      const status = e?.status || 500;
      const payload = { error: e?.message || "gas_drip_failed" };
      if (e?.fallback) payload.fallback = true;
      return sendJson(res, status, payload);
    }
  }

  // --- Optional Article NFTs (Monad). Unlock remains access; minter pays gas. ---
  if (method === "GET" && url.pathname === "/api/article-nfts/config") {
    return sendJson(res, 200, getNftConfig());
  }

  const nftMetaId = parseMetadataPath(url.pathname);
  if ((method === "GET" || method === "HEAD") && nftMetaId) {
    try {
      const metadata = await getTokenMetadata(nftMetaId, { origin: publicOrigin(req) });
      cors(res);
      const payload = JSON.stringify(metadata);
      res.writeHead(200, {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "public, max-age=60",
      });
      if (method === "HEAD") return res.end();
      return res.end(payload);
    } catch (e) {
      const status = e?.status || 500;
      return sendJson(res, status, { error: e?.message || "metadata_failed" });
    }
  }

  if (method === "GET" && url.pathname === "/api/article-nfts") {
    try {
      const body = await listNftsForArticle({
        slug: url.searchParams.get("slug") || url.searchParams.get("articleSlug"),
        wallet: url.searchParams.get("wallet") || url.searchParams.get("minter"),
      });
      return sendJson(res, 200, body);
    } catch (e) {
      const status = e?.status || 500;
      return sendJson(res, status, { error: e?.message || "list_nfts_failed" });
    }
  }

  if (method === "POST" && url.pathname === "/api/article-nfts/record") {
    try {
      const raw = await readBody(req);
      const parsed = raw ? JSON.parse(raw) : {};
      const result = await recordMint(parsed);
      return sendJson(res, 200, result);
    } catch (e) {
      if (e?.message === "body_too_large") {
        return sendJson(res, 413, { error: "body_too_large" });
      }
      if (e instanceof SyntaxError) {
        return sendJson(res, 400, { error: "invalid_json" });
      }
      const status = e?.status || 500;
      return sendJson(res, status, { error: e?.message || "record_failed" });
    }
  }

  // --- Article aggregator (public feed + hosted pages) ---
  if (method === "GET" && url.pathname === "/api/articles") {
    try {
      if (!listingsSupabaseConfigured()) {
        return sendJson(res, 503, { error: "supabase_not_configured" });
      }
      const limit = url.searchParams.get("limit");
      const body = await listPublicArticles({ limit });
      return sendJson(res, 200, body);
    } catch (e) {
      const status = e?.status || 500;
      return sendJson(res, status, { error: e?.message || "list_failed" });
    }
  }

  if (method === "GET" && url.pathname.startsWith("/api/articles/")) {
    try {
      if (!listingsSupabaseConfigured()) {
        return sendJson(res, 503, { error: "supabase_not_configured" });
      }
      const slug = decodeURIComponent(url.pathname.slice("/api/articles/".length));
      const body = await getPublicArticle(slug);
      return sendJson(res, 200, body);
    } catch (e) {
      const status = e?.status || 500;
      return sendJson(res, status, { error: e?.message || "get_failed" });
    }
  }

  if (method === "GET" && url.pathname === "/api/listings/health") {
    return sendJson(res, 200, {
      ok: true,
      supabaseConfigured: listingsSupabaseConfigured(),
      adminConfigured: listingAdminConfigured(),
    });
  }

  if (method === "POST" && url.pathname === "/api/listings/hide") {
    try {
      const raw = await readBody(req);
      const parsed = raw ? JSON.parse(raw) : {};
      const result = await adminSetListingStatus({
        slug: parsed.slug,
        status: parsed.status || "hidden",
        authorization: req.headers.authorization,
      });
      return sendJson(res, 200, result);
    } catch (e) {
      const status = e?.status || 400;
      return sendJson(res, status, { error: e?.message || "hide_failed" });
    }
  }

  // Site root is the articles feed. Old homepage lives at /demo.
  if ((method === "GET" || method === "HEAD") && url.pathname === "/") {
    return serveFeedHtml(req, res);
  }
  if (
    (method === "GET" || method === "HEAD") &&
    (url.pathname === "/demo" || url.pathname === "/demo.html")
  ) {
    return serveStatic(req, res, "/index.html");
  }

  // Per-article OG cards (Twitterbot / Slackbot fetch this URL from og:image).
  // Path is stable; article HTML may append ?v= on og:image. twitter:image is bare.
  if ((method === "GET" || method === "HEAD") && isDefaultOgPath(url.pathname)) {
    return serveOgJpeg(res, defaultOgJpegBuffer(), method);
  }
  const ogSlug = parseOgImagePath(url.pathname);
  if ((method === "GET" || method === "HEAD") && ogSlug) {
    try {
      const buf = await ogJpegForSlug(ogSlug);
      return serveOgJpeg(res, buf, method);
    } catch (e) {
      console.error("[og-card] serve failed:", e?.message || e);
      return serveOgJpeg(res, defaultOgJpegBuffer(), method);
    }
  }

  // Pretty URLs: /articles → feed, /articles/:slug → hosted article
  if ((method === "GET" || method === "HEAD") && url.pathname === "/articles") {
    return serveFeedHtml(req, res);
  }
  if ((method === "GET" || method === "HEAD") && (url.pathname === "/write" || url.pathname === "/write.html")) {
    return serveStatic(req, res, "/write.html");
  }
  if ((method === "GET" || method === "HEAD") && (url.pathname === "/account" || url.pathname === "/account.html")) {
    return serveStatic(req, res, "/account.html");
  }
  if ((method === "GET" || method === "HEAD") && (url.pathname === "/dashboard" || url.pathname === "/dashboard.html")) {
    return serveStatic(req, res, "/dashboard.html");
  }
  if ((method === "GET" || method === "HEAD") && (url.pathname === "/publisher-auth" || url.pathname === "/publisher-auth.html")) {
    return serveStatic(req, res, "/publisher-auth.html");
  }
  if ((method === "GET" || method === "HEAD") && url.pathname.startsWith("/articles/")) {
    const slug = parseArticleSlug(url.pathname);
    if (slug) {
      return serveArticleHtml(req, res, slug);
    }
  }

  if ((method === "GET" || method === "HEAD") && (url.pathname === "/privacy" || url.pathname === "/privacy.html")) {
    return serveStatic(req, res, "/privacy.html");
  }
  if ((method === "GET" || method === "HEAD") && (url.pathname === "/follow/confirm" || url.pathname === "/follow-confirm.html")) {
    return serveStatic(req, res, "/follow-confirm.html");
  }
  const writerRedirect = canonicalWriterPath(url.pathname);
  if ((method === "GET" || method === "HEAD") && writerRedirect) {
    cors(res);
    res.writeHead(301, { Location: writerRedirect, "Cache-Control": "public, max-age=86400" });
    return res.end();
  }
  const writerWallet = (method === "GET" || method === "HEAD") ? writerWalletFromPath(url.pathname) : "";
  if (writerWallet) {
    try {
      const html = await writerHtmlForWallet(req, writerWallet);
      if (!html) return sendSecuredHtml(req, res, 404, writerNotFoundHtml());
      return sendSecuredHtml(req, res, 200, html.toString(), { "Cache-Control": "public, max-age=60" });
    } catch (e) {
      if (e?.status === 503 || e?.message === "supabase_not_configured") {
        return sendJson(res, 503, { error: "supabase_not_configured" });
      }
      console.error("[writer]", e?.message || e);
      return sendSecuredHtml(req, res, 404, writerNotFoundHtml());
    }
  }

  if (method === "GET" || method === "HEAD") {
    return serveStatic(req, res, url.pathname);
  }

  cors(res);
  res.writeHead(405);
  res.end("Method not allowed");
});

server.listen(PORT, () => {
  console.log(
    `[server] listening on :${PORT} (coinbase=${Boolean(CDP_API_KEY_ID && CDP_API_KEY_SECRET)} stripe=${stripeConfigured()} mpp=${mppStatus().configured} x402=${x402Status().configured} miroshark=${mirosharkPublicStatus().enabled} voiceDrafts=${voiceDraftPublicStatus().enabled} relayer=${relayerConfigured()} media=${mediaStatus().persistent ? "supabase" : "disk"})`
  );
});
