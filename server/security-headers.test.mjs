import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import {
  baselineSecurityHeaders,
  contentSecurityPolicy,
  httpsRedirectFor,
  isHttpsRedirectHost,
  isRailwayHealthCheck,
  PERMISSIONS_POLICY,
  REFERRER_POLICY,
  secureHtmlDocument,
  stampInlineScriptNonces,
  STRICT_TRANSPORT_SECURITY,
  X_CONTENT_TYPE_OPTIONS,
  X_FRAME_OPTIONS,
} from "./security-headers.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("CSP matches Privy's embedded-wallet hosts and this app's dependencies", () => {
  const csp = contentSecurityPolicy("abc123");
  assert.match(csp, /default-src 'self'/);
  assert.match(csp, /script-src[^;]*'nonce-abc123'/);
  assert.match(csp, /script-src[^;]*'wasm-unsafe-eval'/);
  assert.match(csp, /script-src[^;]*https:\/\/challenges\.cloudflare\.com/);
  assert.match(csp, /script-src[^;]*https:\/\/js\.stripe\.com/);
  assert.doesNotMatch(csp, /script-src[^;]*https:\/\/cdn\.jsdelivr\.net/);
  assert.doesNotMatch(csp, /script-src[^;]*https:\/\/esm\.sh/);
  const scriptSrc = csp.split("; ").find((part) => part.startsWith("script-src "));
  assert.ok(scriptSrc);
  assert.equal(scriptSrc.includes("'unsafe-eval'"), false);
  assert.match(scriptSrc, /'wasm-unsafe-eval'/);
  assert.doesNotMatch(csp, /script-src[^;]*'unsafe-inline'/);
  assert.match(csp, /style-src[^;]*'unsafe-inline'/);
  assert.match(csp, /style-src[^;]*https:\/\/fonts\.googleapis\.com/);
  assert.match(csp, /font-src[^;]*https:\/\/fonts\.gstatic\.com/);
  assert.match(csp, /frame-ancestors 'none'/);
  assert.match(csp, /object-src 'none'/);
  assert.match(csp, /base-uri 'self'/);
  for (const host of [
    "https://auth.privy.io",
    "https://verify.walletconnect.com",
    "https://verify.walletconnect.org",
    "https://challenges.cloudflare.com",
  ]) {
    assert.match(csp, new RegExp(`frame-src[^;]*${host.replace(/[.]/g, "\\.")}`));
    assert.match(csp, new RegExp(`child-src[^;]*${host.replace(/[.]/g, "\\.")}`));
  }
  assert.match(csp, /connect-src[^;]*'self'/);
  assert.match(csp, /connect-src[^;]*https:\/\/auth\.privy\.io/);
  assert.match(csp, /connect-src[^;]*wss:\/\/relay\.walletconnect\.com/);
  assert.match(csp, /connect-src[^;]*wss:\/\/relay\.walletconnect\.org/);
  assert.match(csp, /connect-src[^;]*wss:\/\/www\.walletlink\.org/);
  assert.match(csp, /connect-src[^;]*https:\/\/\*\.rpc\.privy\.systems/);
  assert.match(csp, /connect-src[^;]*https:\/\/explorer-api\.walletconnect\.com/);
  assert.match(csp, /connect-src[^;]*https:\/\/api\.stripe\.com/);
  assert.match(csp, /connect-src[^;]*https:\/\/\*\.supabase\.co/);
  assert.match(csp, /connect-src[^;]*https:\/\/rpc\.monad\.xyz/);
  assert.match(csp, /connect-src[^;]*https:\/\/mainnet\.base\.org/);
  assert.match(csp, /frame-src[^;]*https:\/\/www\.youtube\.com/);
  assert.match(csp, /frame-src[^;]*https:\/\/\*\.moonpay\.com/);
  assert.match(csp, /worker-src 'self' blob:/);
  assert.match(csp, /manifest-src 'self'/);
  assert.equal(X_FRAME_OPTIONS, "DENY");
});

test("inline scripts get a nonce; external scripts and embed snippets do not", () => {
  const html = [
    "<!doctype html>",
    "<script src=\"/site-nav.js\"></script>",
    "<script type=\"module\">",
    "const embed = `<script type=\"module\" src=\"${CDN}/dist/openpaywall.js\"><\\/script>`;",
    "</script>",
    "<script>window.__ok = true;</script>",
  ].join("\n");
  const secured = secureHtmlDocument(html);
  assert.match(secured.headers["Content-Security-Policy"], new RegExp(`'nonce-${secured.nonce}'`));
  assert.equal(secured.headers["X-Frame-Options"], "DENY");
  assert.match(secured.body, new RegExp(`<script nonce="${secured.nonce}" type="module">`));
  assert.match(secured.body, new RegExp(`<script nonce="${secured.nonce}">window.__ok`));
  assert.match(secured.body, /<script src="\/site-nav.js"><\/script>/);
  assert.match(
    secured.body,
    /<script type="module" src="\$\{CDN\}\/dist\/openpaywall\.js"><\\\/script>/
  );
  assert.equal(secured.body.match(/nonce="/g).length, 2);
});

test("publisher embed templates in real pages are not stamped", () => {
  for (const name of ["dashboard.html", "generator.html", "register.html"]) {
    const raw = fs.readFileSync(path.join(ROOT, name), "utf8");
    const stamped = stampInlineScriptNonces(raw, "fixednonce");
    assert.match(
      stamped,
      /<script type="module" src="\$\{CDN_BASE\}\/dist\/openpaywall\.js\?v=\$\{WIDGET_VERSION\}"/
    );
    assert.doesNotMatch(stamped, /nonce="fixednonce"[^>]*src="\$\{CDN_BASE\}/);
    const inlineOpens = stamped.match(/<script nonce="fixednonce"/g) || [];
    assert.ok(inlineOpens.length >= 1, `${name} should nonce its inline script`);
  }
  for (const name of ["dashboard.html", "generator.html"]) {
    const stamped = stampInlineScriptNonces(
      fs.readFileSync(path.join(ROOT, name), "utf8"),
      "fixednonce"
    );
    assert.match(
      stamped,
      /<script type="module" src="\$\{CDN_BASE\}\/dist\/openpaywall\.js\?v=\$\{WIDGET_VERSION\}"><\\\/script>/
    );
  }
});

test("baseline headers set HSTS, nosniff, referrer policy, and a deny-by-default permissions policy", () => {
  assert.equal(STRICT_TRANSPORT_SECURITY, "max-age=31536000; includeSubDomains");
  assert.equal(/preload/i.test(STRICT_TRANSPORT_SECURITY), false);
  assert.ok(Number(STRICT_TRANSPORT_SECURITY.match(/max-age=(\d+)/)?.[1]) >= 31536000);
  assert.equal(X_CONTENT_TYPE_OPTIONS, "nosniff");
  assert.equal(REFERRER_POLICY, "strict-origin-when-cross-origin");
  assert.match(PERMISSIONS_POLICY, /clipboard-write=\(self "https:\/\/auth\.privy\.io"/);
  assert.match(PERMISSIONS_POLICY, /camera=\(\)/);
  assert.match(PERMISSIONS_POLICY, /microphone=\(\)/);
  assert.match(PERMISSIONS_POLICY, /geolocation=\(\)/);
  assert.match(PERMISSIONS_POLICY, /payment=\(self "https:\/\/js\.stripe\.com"/);
  const headers = baselineSecurityHeaders();
  assert.equal(headers["Strict-Transport-Security"], STRICT_TRANSPORT_SECURITY);
  assert.equal(headers["X-Content-Type-Options"], "nosniff");
  assert.equal(headers["Referrer-Policy"], REFERRER_POLICY);
  assert.equal(headers["Permissions-Policy"], PERMISSIONS_POLICY);
  assert.equal("Content-Security-Policy" in headers, false);
});

test("static pages self-host viem and do not load esm.sh or jsDelivr", () => {
  for (const name of ["dashboard.html", "generator.html", "register.html", "index.html", "article.html"]) {
    const raw = fs.readFileSync(path.join(ROOT, name), "utf8");
    assert.equal(/esm\.sh|cdn\.jsdelivr\.net/.test(raw), false, name);
  }
  for (const name of ["dashboard.html", "generator.html", "register.html"]) {
    const raw = fs.readFileSync(path.join(ROOT, name), "utf8");
    assert.match(raw, /\/vendor\/viem\.js/, name);
  }
});

function req(headers, method = "GET") {
  return { method, headers };
}

test("HTTP redirects to HTTPS only for an allowlisted host, and health checks stay put", () => {
  const health = new URL("http://healthcheck.railway.app/");
  assert.equal(
    isRailwayHealthCheck(req({ host: "healthcheck.railway.app" }, "GET"), health),
    true
  );
  assert.equal(
    httpsRedirectFor(
      req({ host: "healthcheck.railway.app", "x-forwarded-proto": "http", "user-agent": "RailwayHealthCheck/1.0" }),
      health
    ),
    null
  );
  assert.equal(
    httpsRedirectFor(
      req({ host: "openpaywall.app", "x-forwarded-proto": "http", "user-agent": "RailwayHealthCheck/1.0" }),
      new URL("http://openpaywall.app/")
    ),
    null
  );
  assert.equal(
    httpsRedirectFor(req({ host: "openpaywall.app" }), new URL("http://openpaywall.app/write")),
    null
  );
  assert.equal(
    httpsRedirectFor(
      req({ host: "openpaywall.app", "x-forwarded-proto": "https" }),
      new URL("https://openpaywall.app/write")
    ),
    null
  );
  assert.deepEqual(
    httpsRedirectFor(
      req({ host: "openpaywall.app", "x-forwarded-proto": "http" }),
      new URL("http://openpaywall.app/write?x=1")
    ),
    { status: 301, location: "https://openpaywall.app/write?x=1" }
  );
  assert.equal(
    httpsRedirectFor(
      req({ host: "openpaywall.app", "x-forwarded-proto": "https, http" }),
      new URL("https://openpaywall.app/")
    ),
    null
  );
  assert.deepEqual(
    httpsRedirectFor(
      req({ host: "evil.example", "x-forwarded-proto": "http" }, "POST"),
      new URL("http://evil.example/api/subscriptions/stripe/checkout")
    ),
    null
  );
  assert.equal(isHttpsRedirectHost("evil.example"), false);
  assert.equal(isHttpsRedirectHost("preview.up.railway.app"), true);
  assert.equal(isHttpsRedirectHost("healthcheck.railway.app"), false);
  const post = httpsRedirectFor(
    req({ host: "127.0.0.1:8080", "x-forwarded-proto": "http" }, "POST"),
    new URL("http://127.0.0.1:8080/api/stripe/create-intent")
  );
  assert.equal(post?.status, 308);
  assert.equal(post?.location, "https://127.0.0.1:8080/api/stripe/create-intent");
});
