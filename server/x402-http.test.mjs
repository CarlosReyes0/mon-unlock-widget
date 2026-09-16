/**
 * HTTP tests for x402 publish + unlock. Facilitator + Supabase are local mocks
 * (no mainnet funds, no live DB writes required for the payment path).
 */
import assert from "node:assert/strict";
import http from "node:http";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { test, after } from "node:test";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { encodeJsonB64 } from "./x402.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const APP_PORT = 18774;
const FAC_PORT = 18775;
const SB_PORT = 18776;
const PAY_TO = "0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb0";
const SLUG = "x402-demo-article";
const PAID_BODY = "SECRET_PAID_ARTICLE_TEXT_DO_NOT_LEAK";

let facilitatorMode = "ok"; // ok | invalid | down

const facilitator = http.createServer((req, res) => {
  if (facilitatorMode === "down") {
    res.writeHead(500, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "down" }));
    return;
  }
  const url = new URL(req.url || "/", `http://127.0.0.1:${FAC_PORT}`);
  if (req.method === "POST" && url.pathname === "/verify") {
    if (facilitatorMode === "invalid") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ isValid: false, invalidReason: "facilitator_rejected" }));
      return;
    }
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ isValid: true }));
    return;
  }
  if (req.method === "POST" && url.pathname === "/settle") {
    if (facilitatorMode === "invalid") {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ success: false, errorReason: "not_settled" }));
      return;
    }
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify({
        success: true,
        transaction: "0xabc123def456",
        network: "base",
      })
    );
    return;
  }
  res.writeHead(404);
  res.end();
});

const supabase = http.createServer((req, res) => {
  const url = new URL(req.url || "/", `http://127.0.0.1:${SB_PORT}`);
  res.setHeader("Content-Type", "application/json");
  if (!url.pathname.startsWith("/rest/v1/")) {
    res.writeHead(404);
    res.end("[]");
    return;
  }
  if (url.pathname === "/rest/v1/writer_plans") {
    res.writeHead(200);
    res.end("[]");
    return;
  }
  if (url.pathname === "/rest/v1/articles") {
    const select = url.searchParams.get("select") || "";
    const articleEq = (url.searchParams.get("article_id") || "").replace(/^eq\./, "");
    const hashEq = url.searchParams.get("article_id_hash");
    const wantsBody = /\bbody\b/.test(select);
    if (hashEq && !articleEq) {
      res.writeHead(200);
      res.end("[]");
      return;
    }
    if (articleEq && articleEq !== SLUG) {
      res.writeHead(200);
      res.end("[]");
      return;
    }
    if (!articleEq) {
      res.writeHead(200);
      res.end("[]");
      return;
    }
    const row = {
      article_id: SLUG,
      article_id_hash: "0x" + "ab".repeat(32),
      publisher: "0x1111111111111111111111111111111111111111",
      price_wei: "500000",
      listing_status: "listed",
      payment_asset: "usdc",
      allow_a_la_carte: true,
      title: "Demo paid piece",
      teaser: "Free preview only",
    };
    if (wantsBody) row.body = PAID_BODY;
    res.writeHead(200);
    res.end(JSON.stringify([row]));
    return;
  }
  if (url.pathname === "/rest/v1/unlocks" || url.pathname === "/rest/v1/fiat_unlocks" || url.pathname === "/rest/v1/subscriptions") {
    res.writeHead(200);
    res.end("[]");
    return;
  }
  res.writeHead(200);
  res.end("[]");
});

await new Promise((resolve) => facilitator.listen(FAC_PORT, "127.0.0.1", resolve));
await new Promise((resolve) => supabase.listen(SB_PORT, "127.0.0.1", resolve));

const child = spawn(process.execPath, ["server/index.mjs"], {
  cwd: ROOT,
  env: {
    ...process.env,
    PORT: String(APP_PORT),
    CDP_API_KEY_ID: "",
    CDP_API_KEY_SECRET: "",
    STRIPE_SECRET_KEY: "",
    MPP_SECRET_KEY: "",
    MPP_TEMPO_RECIPIENT: "",
    MPP_DEV_BYPASS: "",
    X402_DEV_BYPASS: "",
    X402_PAY_TO: PAY_TO,
    X402_FACILITATOR_URL: `http://127.0.0.1:${FAC_PORT}`,
    X402_PUBLISH_AMOUNT: "0.05",
    SUPABASE_URL: `http://127.0.0.1:${SB_PORT}`,
    SUPABASE_SERVICE_ROLE_KEY: "test-role-key",
  },
  stdio: ["ignore", "pipe", "pipe"],
});

await once(child.stdout, "data");

after(() => {
  child.kill("SIGTERM");
  facilitator.close();
  supabase.close();
});

const origin = `http://127.0.0.1:${APP_PORT}`;

const publishPayload = {
  title: "X402 demo",
  articleId: "x402-demo-1",
  teaser: "Preview text",
  body: "Full article body for x402 publish.",
  publisher: "0x1111111111111111111111111111111111111111",
  paymentAsset: "usdc",
  price: "0.50",
};

function xPayment({ to = PAY_TO, value = "50000", nonce, network = "base" } = {}) {
  return encodeJsonB64({
    x402Version: 1,
    scheme: "exact",
    network,
    payload: {
      signature: "0x" + "ab".repeat(65),
      authorization: {
        from: "0x2222222222222222222222222222222222222222",
        to,
        value,
        validAfter: "0",
        validBefore: "9999999999",
        nonce: nonce || `0x${Date.now().toString(16).padStart(64, "0")}`,
      },
    },
  });
}

test("unpaid POST /api/x402/publish returns 402 with machine-readable accepts", async () => {
  const res = await fetch(`${origin}/api/x402/publish`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(publishPayload),
  });
  assert.equal(res.status, 402);
  assert.ok(res.headers.get("payment-required") || res.headers.get("x-payment-required"));
  const body = await res.json();
  assert.equal(body.x402Version, 1);
  assert.ok(Array.isArray(body.accepts) && body.accepts[0]);
  const acc = body.accepts[0];
  assert.equal(acc.scheme, "exact");
  assert.equal(acc.network, "base");
  assert.equal(acc.asset.toLowerCase(), "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913");
  assert.equal(acc.payTo.toLowerCase(), PAY_TO.toLowerCase());
  assert.equal(acc.maxAmountRequired, "50000");
  assert.equal("body" in acc, false);
});

test("empty probe POST /api/x402/publish still 402 (not 400)", async () => {
  const res = await fetch(`${origin}/api/x402/publish`, { method: "POST" });
  assert.equal(res.status, 402);
  const body = await res.json();
  assert.equal(body.x402Version, 1);
});

test("malformed X-PAYMENT fail-closes (402, no publish)", async () => {
  const res = await fetch(`${origin}/api/x402/publish`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-PAYMENT": "not-valid-payment" },
    body: JSON.stringify(publishPayload),
  });
  assert.equal(res.status, 402);
  const body = await res.json();
  assert.match(body.error || "", /Invalid|rejected|required/i);
  assert.equal(body.ok, undefined);
});

test("wrong-network payment fail-closes before facilitator", async () => {
  const res = await fetch(`${origin}/api/x402/publish`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-PAYMENT": xPayment({ network: "monad", nonce: "0x" + "aa".repeat(32) }),
    },
    body: JSON.stringify(publishPayload),
  });
  assert.equal(res.status, 402);
  const body = await res.json();
  assert.match(body.error || "", /unsupported_network/);
});

test("facilitator reject fail-closes", async () => {
  facilitatorMode = "invalid";
  try {
    const res = await fetch(`${origin}/api/x402/publish`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-PAYMENT": xPayment({ nonce: "0x" + "bb".repeat(32) }),
      },
      body: JSON.stringify(publishPayload),
    });
    assert.equal(res.status, 402);
    const body = await res.json();
    assert.match(body.error || "", /rejected|invalid/i);
    assert.notEqual(body.ok, true);
  } finally {
    facilitatorMode = "ok";
  }
});

test("successful mocked payment publishes embed", async () => {
  const res = await fetch(`${origin}/api/x402/publish`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-PAYMENT": xPayment({ nonce: "0x" + "cc".repeat(32) }),
    },
    body: JSON.stringify(publishPayload),
  });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.ok, true);
  assert.match(body.embed, /<open-paywall/);
  assert.equal(body.needsManualOnChainRegistration, true);
  assert.match(body.finishRegistrationUrl, /register\.html/);
  assert.equal(body.payment.protocol, "x402");
  assert.equal(body.payment.network, "base");
});

test("GET /api/x402/articles/{slug} unpaid is 402 and never returns paid body", async () => {
  const res = await fetch(`${origin}/api/x402/articles/${SLUG}`);
  assert.equal(res.status, 402);
  const text = await res.text();
  assert.equal(text.includes(PAID_BODY), false);
  const body = JSON.parse(text);
  assert.equal(body.x402Version, 1);
  assert.equal(body.accepts[0].maxAmountRequired, "500000");
  assert.equal(body.body, undefined);
});

test("GET /api/x402/unlock without slug is 400", async () => {
  const res = await fetch(`${origin}/api/x402/unlock`);
  assert.equal(res.status, 400);
  const body = await res.json();
  assert.equal(body.error, "invalid_article_id");
});

test("GET unknown slug is 404 not 402", async () => {
  const res = await fetch(`${origin}/api/x402/articles/does-not-exist-slug`);
  assert.equal(res.status, 404);
});

test("successful mocked payment returns paid body", async () => {
  const res = await fetch(`${origin}/api/x402/articles/${SLUG}`, {
    headers: {
      "X-PAYMENT": xPayment({ value: "500000", nonce: "0x" + "dd".repeat(32) }),
    },
  });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.ok, true);
  assert.equal(body.body, PAID_BODY);
  assert.equal(body.payment.protocol, "x402");
});

test("alias POST /api/agents/x402/publish unpaid is 402", async () => {
  const res = await fetch(`${origin}/api/agents/x402/publish`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "{}",
  });
  assert.equal(res.status, 402);
});

test("GET /api/agents/health includes x402 status", async () => {
  const res = await fetch(`${origin}/api/agents/health`);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.x402.configured, true);
  assert.equal(body.x402.network, "base");
  assert.equal(body.docs.x402Skill, "/.well-known/skills/open-paywall-x402/SKILL.md");
});
