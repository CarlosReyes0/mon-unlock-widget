import assert from "node:assert/strict";
import { test } from "node:test";
import { sameOriginRedirectUrl } from "./same-origin-redirect.mjs";

const HOST = "127.0.0.1:18765";

test("same-origin http and https checkout URLs are kept", () => {
  assert.equal(
    sameOriginRedirectUrl("https://127.0.0.1:18765/account.html?sub=ok", HOST),
    "https://127.0.0.1:18765/account.html?sub=ok"
  );
  assert.equal(
    sameOriginRedirectUrl("http://127.0.0.1:18765/account.html?sub=cancel", HOST),
    "http://127.0.0.1:18765/account.html?sub=cancel"
  );
});

test("Stripe's checkout session placeholder is not percent-encoded", () => {
  const raw = "https://127.0.0.1:18765/unlock.html?session_id={CHECKOUT_SESSION_ID}";
  assert.equal(sameOriginRedirectUrl(raw, HOST), raw);
});

test("foreign, credentialed, and non-http checkout URLs are rejected", () => {
  const rejected = [
    "https://evil.example/phish",
    "https://127.0.0.1:18765.evil.example/account.html",
    "https://evil.example/?next=https://127.0.0.1:18765/",
    "http://127.0.0.1:18766/account.html",
    "https://user:pass@127.0.0.1:18765/account.html",
    "javascript:alert(1)",
    "//evil.example/phish",
    "https://evil.example\\@127.0.0.1:18765/",
    "",
    null,
    1,
  ];
  for (const value of rejected) {
    assert.equal(sameOriginRedirectUrl(value, HOST), null, `expected reject: ${value}`);
  }
});

test("default https port still matches a host header without a port", () => {
  assert.equal(
    sameOriginRedirectUrl("https://openpaywall.app:443/account.html", "openpaywall.app"),
    "https://openpaywall.app/account.html"
  );
});
