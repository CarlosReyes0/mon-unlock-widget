/**
 * Production security headers for HTML documents.
 *
 * Privy production setup asks for a Content-Security-Policy that allows the
 * embedded-wallet iframe (auth.privy.io) and for X-Frame-Options. This module
 * builds an enforcing policy: Privy's template, plus the third parties this
 * app actually loads.
 *
 * Framing: hosted pages are not embedded. Checkout opens with window.open
 * (or same-tab navigation on mobile). The publisher widget is a script /
 * custom element on the publisher's origin, so these headers do not apply to
 * it. frame-ancestors 'none' matches X-Frame-Options: DENY.
 *
 * Inline scripts (generator, dashboard, homepage, Vite's modulepreload
 * polyfill) get a per-response nonce so script-src can stay free of
 * 'unsafe-inline'. Script tags inside those scripts (embed snippets use
 * <\/script>) are not rewritten — the walker follows HTML script parsing.
 * Do not add 'unsafe-eval'. Follow sign-in loads a same-origin module
 * instead; eval is what broke that sheet on the production policy.
 *
 * Do not put a nonce on style-src. A nonce or hash there makes browsers
 * ignore 'unsafe-inline', which React style attributes and page <style>
 * blocks need.
 *
 * viem for generator / register / dashboard is self-hosted at /vendor/viem.js.
 * script-src does not allow esm.sh or jsDelivr (those hosts can serve any
 * package). Supabase edge functions are not this document policy.
 */
import { randomBytes } from "node:crypto";

export const X_FRAME_OPTIONS = "DENY";

/** One year. includeSubDomains, no preload. */
export const STRICT_TRANSPORT_SECURITY = "max-age=31536000; includeSubDomains";

export const X_CONTENT_TYPE_OPTIONS = "nosniff";

export const REFERRER_POLICY = "strict-origin-when-cross-origin";

/**
 * Deny powerful features this app does not use. clipboard-write stays on for
 * our pages and the Privy / WalletConnect frames that copy addresses.
 * payment stays on for Stripe's Payment Request / express checkout.
 * publickey-credentials-get stays on for Privy passkeys.
 * Video embeds keep the features their iframes already request.
 */
export const PERMISSIONS_POLICY = [
  "accelerometer=()",
  "camera=()",
  "clipboard-read=()",
  `clipboard-write=(self "https://auth.privy.io" "https://verify.walletconnect.com" "https://verify.walletconnect.org" "https://secure.walletconnect.com" "https://secure.walletconnect.org")`,
  "display-capture=()",
  `encrypted-media=(self "https://www.youtube.com" "https://www.youtube-nocookie.com" "https://player.vimeo.com" "https://www.loom.com")`,
  `fullscreen=(self "https://www.youtube.com" "https://www.youtube-nocookie.com" "https://player.vimeo.com" "https://www.loom.com" "https://js.stripe.com" "https://checkout.stripe.com")`,
  "geolocation=()",
  "gyroscope=()",
  "hid=()",
  "magnetometer=()",
  "microphone=()",
  "midi=()",
  `payment=(self "https://js.stripe.com" "https://checkout.stripe.com" "https://hooks.stripe.com")`,
  `picture-in-picture=(self "https://www.youtube.com" "https://www.youtube-nocookie.com" "https://player.vimeo.com" "https://www.loom.com")`,
  `publickey-credentials-get=(self "https://auth.privy.io")`,
  "screen-wake-lock=()",
  "serial=()",
  "usb=()",
  "web-share=()",
  "xr-spatial-tracking=()",
  `autoplay=(self "https://www.youtube.com" "https://www.youtube-nocookie.com" "https://player.vimeo.com" "https://www.loom.com")`,
].join(", ");

/** railway.toml healthcheckPath. Railway sends Host healthcheck.railway.app and this user agent. */
export const RAILWAY_HEALTHCHECK_HOST = "healthcheck.railway.app";
export const RAILWAY_HEALTHCHECK_UA = /^RailwayHealthCheck\//i;

/** Headers for every response, including API and static files. CSP stays on documents. */
export function baselineSecurityHeaders() {
  return {
    "Strict-Transport-Security": STRICT_TRANSPORT_SECURITY,
    "X-Content-Type-Options": X_CONTENT_TYPE_OPTIONS,
    "Referrer-Policy": REFERRER_POLICY,
    "Permissions-Policy": PERMISSIONS_POLICY,
  };
}

/** @returns {string} CSP nonce token (base64url, safe in a header and an attribute) */
export function createCspNonce() {
  return randomBytes(16).toString("base64url");
}

/**
 * @param {string} nonce
 * @returns {Record<string, string>}
 */
export function htmlSecurityHeaders(nonce) {
  return {
    "Content-Security-Policy": contentSecurityPolicy(nonce),
    "X-Frame-Options": X_FRAME_OPTIONS,
  };
}

/**
 * Nonce inline scripts and return the matching response headers.
 * External scripts are left alone; script-src allowlists them.
 * @param {string} html
 */
export function secureHtmlDocument(html) {
  const nonce = createCspNonce();
  return {
    nonce,
    body: stampInlineScriptNonces(String(html), nonce),
    headers: htmlSecurityHeaders(nonce),
  };
}

/**
 * Add nonce="…" to HTML-level inline <script> tags (no src).
 * Does not touch markup that appears inside a script element.
 * @param {string} html
 * @param {string} nonce
 */
export function stampInlineScriptNonces(html, nonce) {
  const source = String(html);
  let out = "";
  let i = 0;
  while (i < source.length) {
    const start = findScriptOpen(source, i);
    if (start < 0) {
      out += source.slice(i);
      break;
    }
    out += source.slice(i, start);
    const openEnd = source.indexOf(">", start);
    if (openEnd < 0) {
      out += source.slice(start);
      break;
    }
    let openTag = source.slice(start, openEnd + 1);
    const inline = !/\bsrc\s*=/i.test(openTag);
    if (inline && !/\bnonce\s*=/i.test(openTag)) {
      openTag = openTag.replace(/^<script\b/i, `<script nonce="${nonce}"`);
    }
    out += openTag;
    const rest = source.slice(openEnd + 1);
    const close = /<\/script\s*>/i.exec(rest);
    if (!close) {
      out += rest;
      break;
    }
    out += rest.slice(0, close.index + close[0].length);
    i = openEnd + 1 + close.index + close[0].length;
  }
  return out;
}

function findScriptOpen(html, from) {
  const re = /<script\b/gi;
  re.lastIndex = from;
  const match = re.exec(html);
  return match ? match.index : -1;
}

/**
 * Enforcing CSP. `nonce` must match the attribute stamped onto inline scripts.
 * @param {string} nonce
 */
export function contentSecurityPolicy(nonce) {
  const safeNonce = String(nonce || "").replace(/[^A-Za-z0-9_-]/g, "");
  const directives = [
    "default-src 'self'",
    [
      "script-src",
      "'self'",
      `'nonce-${safeNonce}'`,
      // Embedded wallets / WalletConnect compile WASM. This does not allow JS eval().
      "'wasm-unsafe-eval'",
      "https://challenges.cloudflare.com",
      "https://hcaptcha.com",
      "https://*.hcaptcha.com",
      "https://js.stripe.com",
      "https://*.js.stripe.com",
      "https://maps.googleapis.com",
      "https://accounts.google.com",
    ].join(" "),
    [
      "style-src",
      "'self'",
      "'unsafe-inline'",
      "https://fonts.googleapis.com",
      "https://hcaptcha.com",
      "https://*.hcaptcha.com",
    ].join(" "),
    // Article bodies and write previews load publisher images from arbitrary https URLs.
    "img-src 'self' data: blob: https:",
    // WalletConnect's Reown QR modal (@reown/appkit-ui ThemeUtil, bundled by
    // @walletconnect/ethereum-provider) preloads and @font-face-loads KHTeka
    // only from https://fonts.reown.com. No other font origin.
    "font-src 'self' data: https://fonts.gstatic.com https://fonts.reown.com",
    "media-src 'self' blob: https:",
    "object-src 'none'",
    "base-uri 'self'",
    [
      "form-action",
      "'self'",
      "https://auth.privy.io",
      "https://accounts.google.com",
      "https://hooks.stripe.com",
      "https://checkout.stripe.com",
    ].join(" "),
    "frame-ancestors 'none'",
    childOrFrame("child-src"),
    childOrFrame("frame-src"),
    [
      "connect-src",
      "'self'",
      "https://auth.privy.io",
      "wss://relay.walletconnect.com",
      "wss://relay.walletconnect.org",
      "https://relay.walletconnect.com",
      "https://relay.walletconnect.org",
      "wss://www.walletlink.org",
      "https://www.walletlink.org",
      "https://*.rpc.privy.systems",
      "https://explorer-api.walletconnect.com",
      "https://pulse.walletconnect.org",
      "https://api.web3modal.org",
      "https://rpc.walletconnect.com",
      "https://rpc.walletconnect.org",
      "https://verify.walletconnect.com",
      "https://verify.walletconnect.org",
      "https://challenges.cloudflare.com",
      "https://hcaptcha.com",
      "https://*.hcaptcha.com",
      "https://api.stripe.com",
      "https://maps.googleapis.com",
      "https://checkout.stripe.com",
      "https://link.com",
      "https://*.link.com",
      "https://accounts.google.com",
      "https://*.supabase.co",
      "wss://*.supabase.co",
      "https://rpc.monad.xyz",
      "wss://rpc.monad.xyz",
      "https://rpc1.monad.xyz",
      "wss://rpc1.monad.xyz",
      "https://testnet-rpc.monad.xyz",
      "https://mainnet.base.org",
      "https://api.relay.link",
      "https://api.testnets.relay.link",
      "https://*.moonpay.com",
      "https://fonts.googleapis.com",
      "https://fonts.gstatic.com",
      "blob:",
    ].join(" "),
    // WalletConnect spins up a blob: worker. 'self' alone blocks that.
    "worker-src 'self' blob:",
    "manifest-src 'self'",
  ];
  return directives.join("; ");
}

function headerFirst(value) {
  const raw = Array.isArray(value) ? value[0] : String(value || "");
  return raw.split(",")[0].trim();
}

function requestHost(req) {
  return headerFirst(req?.headers?.host);
}

function hostnameOf(host) {
  const h = String(host || "").trim().toLowerCase();
  if (!h) return "";
  if (h.startsWith("[")) {
    const end = h.indexOf("]");
    return end === -1 ? h : h.slice(0, end + 1);
  }
  return h.replace(/:\d+$/, "");
}

/**
 * Hosts we will send a browser to over HTTPS. Loopback is for local runs.
 * Anything else is refused so a spoofed Host cannot turn the redirect into
 * an open redirect. healthcheck.railway.app is intentionally not listed.
 * @param {string} host
 */
export function isHttpsRedirectHost(host) {
  const raw = String(host || "").trim().toLowerCase();
  if (!raw || /[\s/@\\]/.test(raw) || raw.includes("..")) return false;
  const name = hostnameOf(raw);
  if (name === "openpaywall.app" || name === "www.openpaywall.app") return true;
  if (name.endsWith(".up.railway.app") && name !== ".up.railway.app") return true;
  if (name === "localhost" || name === "127.0.0.1" || name === "[::1]") return true;
  return false;
}

/**
 * Railway's probe is GET/HEAD / from inside the network. It does not come
 * through the public edge (which always sets x-forwarded-proto to https).
 * Exempt it even if a probe is forwarded with proto=http.
 * @param {import("node:http").IncomingMessage} req
 * @param {URL} url
 */
export function isRailwayHealthCheck(req, url) {
  const method = String(req?.method || "GET").toUpperCase();
  if (method !== "GET" && method !== "HEAD") return false;
  if ((url?.pathname || "/") !== "/") return false;
  if (hostnameOf(requestHost(req)) === RAILWAY_HEALTHCHECK_HOST) return true;
  return RAILWAY_HEALTHCHECK_UA.test(headerFirst(req?.headers?.["user-agent"]));
}

/**
 * Redirect only when the first x-forwarded-proto hop is exactly "http".
 * A missing header means the process was reached directly (local dev, or
 * Railway's health check) and must not redirect. https must not redirect,
 * or the proxy and the app loop. The Location host is an allowlist, not
 * the raw Host header.
 * @param {import("node:http").IncomingMessage} req
 * @param {URL} url
 * @returns {{ status: number, location: string } | null}
 */
export function httpsRedirectFor(req, url) {
  if (!url || isRailwayHealthCheck(req, url)) return null;
  const proto = headerFirst(req?.headers?.["x-forwarded-proto"]).toLowerCase();
  if (proto !== "http") return null;
  const host = requestHost(req);
  if (!isHttpsRedirectHost(host)) return null;
  const path = url.pathname || "/";
  const search = url.search || "";
  if (!path.startsWith("/") || /[\s\\]/.test(path) || /[\s\\]/.test(search)) return null;
  const location = `https://${host}${path}${search}`;
  let parsed;
  try {
    parsed = new URL(location);
  } catch {
    return null;
  }
  if (parsed.protocol !== "https:") return null;
  if (parsed.host.toLowerCase() !== host.toLowerCase()) return null;
  const method = String(req?.method || "GET").toUpperCase();
  const status = method === "GET" || method === "HEAD" ? 301 : 308;
  return { status, location };
}

function childOrFrame(name) {
  return [
    name,
    "https://auth.privy.io",
    "https://verify.walletconnect.com",
    "https://verify.walletconnect.org",
    "https://secure.walletconnect.com",
    "https://secure.walletconnect.org",
    "https://challenges.cloudflare.com",
    "https://hcaptcha.com",
    "https://*.hcaptcha.com",
    "https://js.stripe.com",
    "https://*.js.stripe.com",
    "https://hooks.stripe.com",
    "https://checkout.stripe.com",
    "https://connect-js.stripe.com",
    "https://link.com",
    "https://*.link.com",
    "https://*.moonpay.com",
    "https://accounts.google.com",
    "https://www.youtube.com",
    "https://www.youtube-nocookie.com",
    "https://player.vimeo.com",
    "https://www.loom.com",
    "blob:",
  ].join(" ");
}
