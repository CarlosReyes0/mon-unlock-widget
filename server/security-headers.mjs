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
 *
 * Do not put a nonce on style-src. A nonce or hash there makes browsers
 * ignore 'unsafe-inline', which React style attributes and page <style>
 * blocks need.
 */
import { randomBytes } from "node:crypto";

export const X_FRAME_OPTIONS = "DENY";

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
      // dashboard.html loads @supabase/supabase-js from jsDelivr.
      "https://cdn.jsdelivr.net",
      // generator / dashboard / register dynamic-import viem from esm.sh.
      "https://esm.sh",
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
    "font-src 'self' data: https://fonts.gstatic.com",
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
