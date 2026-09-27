import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import {
  contentSecurityPolicy,
  secureHtmlDocument,
  stampInlineScriptNonces,
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
  assert.match(csp, /script-src[^;]*https:\/\/cdn\.jsdelivr\.net/);
  assert.match(csp, /script-src[^;]*https:\/\/esm\.sh/);
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
