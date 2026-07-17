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
  createPaymentIntent,
  confirmPaymentIntent,
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
} from "./publish.mjs";
import { withMppCharge, mppStatus, publishAmount } from "./mpp.mjs";
import { buildOpenApiDocument } from "./openapi.mjs";

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
const PAY_BASE = "https://pay.coinbase.com/buy/select-asset";

/** Monad network id for Coinbase Onramp session addresses. */
const MONAD_BLOCKCHAIN = "monad";

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".map": "application/json",
  ".txt": "text/plain; charset=utf-8",
  ".md": "text/markdown; charset=utf-8",
};

function cors(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,HEAD,POST,OPTIONS");
  res.setHeader(
    "Access-Control-Allow-Headers",
    "Content-Type, Stripe-Signature, Authorization, Payment-Signature, Accept"
  );
  res.setHeader("Access-Control-Expose-Headers", "WWW-Authenticate, Payment-Receipt");
}

function sendJson(res, status, body) {
  cors(res);
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  res.end(payload);
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

function readBody(req, limit = 64_000) {
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

function isAddress(value) {
  return typeof value === "string" && /^0x[a-fA-F0-9]{40}$/.test(value);
}

function buildPayUrl(token, { asset, amount, redirectUrl }) {
  const params = new URLSearchParams({
    sessionToken: token,
    defaultNetwork: MONAD_BLOCKCHAIN,
    defaultAsset: asset,
    defaultExperience: "buy",
    fiatCurrency: "USD",
  });
  if (amount && Number(amount) > 0) {
    params.set("presetCryptoAmount", String(amount));
  }
  if (redirectUrl) {
    params.set("redirectUrl", redirectUrl);
  }
  return `${PAY_BASE}?${params.toString()}`;
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
  const assetRaw = typeof parsed.asset === "string" ? parsed.asset.trim().toUpperCase() : "USDC";
  const asset = assetRaw === "MON" || assetRaw === "MONAD_MON" ? "MON" : "USDC";
  const amount =
    parsed.amount != null && String(parsed.amount).trim() !== ""
      ? String(parsed.amount).trim()
      : undefined;
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
    const url = buildPayUrl(token, { asset, amount, redirectUrl });
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

function serveStatic(req, res, urlPath) {
  let filePath = safeJoin(ROOT, urlPath === "/" ? "/index.html" : urlPath);
  if (!filePath) {
    cors(res);
    res.writeHead(403);
    return res.end("Forbidden");
  }

  fs.stat(filePath, (err, stat) => {
    if (err || !stat.isFile()) {
      // Directory index fallback
      if (!err && stat?.isDirectory()) {
        filePath = path.join(filePath, "index.html");
      } else {
        cors(res);
        res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
        return res.end("Not found");
      }
    }

    fs.readFile(filePath, (readErr, data) => {
      if (readErr) {
        cors(res);
        res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
        return res.end("Not found");
      }
      const ext = path.extname(filePath).toLowerCase();
      cors(res);
      // Match previous http-server -c-1: avoid stale checkout/widget bundles after deploy.
      res.writeHead(200, {
        "Content-Type": MIME[ext] || "application/octet-stream",
        "Cache-Control": "no-cache",
      });
      res.end(data);
    });
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
      const result = await createPaymentIntent({
        articleId: parsed.articleId,
        amountUsdCents: parsed.amountUsdCents,
        buyerEmail: parsed.buyerEmail,
        title: parsed.title,
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
      const result = await confirmPaymentIntent(parsed.paymentIntentId);
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
      mpp: mppStatus(),
      docs: {
        llms: "/llms.txt",
        agents: "/agents.md",
        skill: "/skill.md",
        cursorSkill: "/.well-known/skills/mon-unlock/SKILL.md",
        openapi: "/openapi.json",
      },
    });
  }

  if (method === "POST" && url.pathname === "/api/agents/publish/validate") {
    try {
      const raw = await readBody(req, 512_000);
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
        next: "POST /api/agents/publish with the same JSON body, then pay the 402 challenge.",
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
      const raw = await readBody(req, 512_000);
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

  if (method === "GET" || method === "HEAD") {
    return serveStatic(req, res, url.pathname);
  }

  cors(res);
  res.writeHead(405);
  res.end("Method not allowed");
});

server.listen(PORT, () => {
  console.log(
    `[server] listening on :${PORT} (coinbase=${Boolean(CDP_API_KEY_ID && CDP_API_KEY_SECRET)} stripe=${stripeConfigured()} mpp=${mppStatus().configured})`
  );
});
