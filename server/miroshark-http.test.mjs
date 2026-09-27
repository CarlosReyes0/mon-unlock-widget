/**
 * HTTP tests for optional MiroShark preview. A local mock stands in for
 * x402.miroshark.xyz — no mainnet spend, no live facilitator.
 */
import assert from "node:assert/strict";
import http from "node:http";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { test, after } from "node:test";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { decodeJsonB64OrJson } from "./x402.mjs";
import { privateKeyToAccount } from "viem/accounts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const APP_PORT = 18810;
const PAY_PORT = 18814;
const MOCK_PORT = 18811;
const BUILDER = "bc_testcode";
const PAYER_KEY = "0xcccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc";

const seen = [];
let mockMode = "402"; // 402 | error

const mock = http.createServer(async (req, res) => {
  const url = new URL(req.url || "/", `http://127.0.0.1:${MOCK_PORT}`);
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const rawBody = Buffer.concat(chunks).toString("utf8");
  seen.push({
    method: req.method,
    path: url.pathname,
    builder: req.headers["x-builder-code"] || "",
    payment: req.headers["payment-signature"] || "",
    body: rawBody,
  });

  if (req.method === "POST" && url.pathname === "/run") {
    if (mockMode === "error") {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "boom" }));
      return;
    }
    const payment = req.headers["payment-signature"] || "";
    if (!payment) {
      res.writeHead(402, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          x402Version: 2,
          error: "Payment required",
          accepts: [
            {
              scheme: "exact",
              network: "eip155:143",
              asset: "0x754704Bc059F8C67012fEd69BC8A327a5aafb603",
              amount: "1000000",
              payTo: "0x0000CE08fa224696A819877070BF378e8B131ACF",
            },
            {
              scheme: "exact",
              network: "eip155:8453",
              asset: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
              amount: "1000000",
              payTo: "0x4444444444444444444444444444444444444444",
              extra: { name: "USD Coin", version: "2" },
            },
          ],
          extensions: { "builder-code": { info: { a: "bc_r3g1wwdh" } } },
        })
      );
      return;
    }
    res.writeHead(202, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify({
        success: true,
        data: {
          run_id: "run_bbbbbbbbbbbb",
          status: "queued",
          wait_url: `http://127.0.0.1:${MOCK_PORT}/wait/run_bbbbbbbbbbbb`,
          status_url: `http://127.0.0.1:${MOCK_PORT}/status/run_bbbbbbbbbbbb`,
        },
      })
    );
    return;
  }

  if (req.method === "GET" && url.pathname === "/status/run_bbbbbbbbbbbb") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify({
        success: true,
        data: {
          run_id: "run_bbbbbbbbbbbb",
          status: "completed",
          progress: 100,
          message: "Done",
          share_url: `http://127.0.0.1:${MOCK_PORT}/share/sim1`,
        },
      })
    );
    return;
  }

  if (req.method === "GET" && url.pathname === "/report/run_bbbbbbbbbbbb") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify({
        success: true,
        data: {
          run_id: "run_bbbbbbbbbbbb",
          status: "completed",
          report_markdown: "# Simulated landing\n\nReaders were curious, then split on whether to pay.",
        },
      })
    );
    return;
  }

  res.writeHead(404);
  res.end("nope");
});

await new Promise((resolve) => mock.listen(MOCK_PORT, "127.0.0.1", resolve));

function spawnApp(port, extraEnv = {}) {
  return spawn(process.execPath, ["server/index.mjs"], {
    cwd: ROOT,
    env: {
      ...process.env,
      PORT: String(port),
      BASE_BUILDER_CODE: BUILDER,
      MIROSHARK_BASE_URL: `http://127.0.0.1:${MOCK_PORT}`,
      MIROSHARK_X402_PRIVATE_KEY: "",
      CDP_API_KEY_ID: "",
      CDP_API_KEY_SECRET: "",
      STRIPE_SECRET_KEY: "",
      MPP_SECRET_KEY: "",
      MPP_TEMPO_RECIPIENT: "",
      RELAYER_PRIVATE_KEY: "",
      ...extraEnv,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
}

const app = spawnApp(APP_PORT);
const paying = spawnApp(PAY_PORT, { MIROSHARK_X402_PRIVATE_KEY: PAYER_KEY });
await once(app.stdout, "data");
await once(paying.stdout, "data");

after(() => {
  app.kill("SIGTERM");
  paying.kill("SIGTERM");
  mock.close();
});

const origin = `http://127.0.0.1:${APP_PORT}`;
const payOrigin = `http://127.0.0.1:${PAY_PORT}`;

test("GET /api/miroshark/status reports enabled builder code without leaking a payer key", async () => {
  const res = await fetch(`${origin}/api/miroshark/status`);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.enabled, true);
  assert.equal(body.builderCode, BUILDER);
  assert.equal(body.serverPayer, false);
  assert.equal(body.affiliate.header, "X-Builder-Code");
  assert.equal(JSON.stringify(body).includes(PAYER_KEY), false);
});

test("GET /api/agents/health includes miroshark status", async () => {
  const res = await fetch(`${origin}/api/agents/health`);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.miroshark.enabled, true);
  assert.equal(body.miroshark.serverPayer, false);
});

test("POST /api/miroshark/preview returns 402 challenge and sends X-Builder-Code", async () => {
  seen.length = 0;
  mockMode = "402";
  const res = await fetch(`${origin}/api/miroshark/preview`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      title: "July rain walk",
      body: "Walking home in the rain.\n\nThe paid rest of the piece.",
    }),
  });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.ok, false);
  assert.equal(body.code, "payment_required");
  assert.equal(body.builderCodeAttached, true);
  assert.ok(seen.some((r) => r.path === "/run" && r.builder === BUILDER && !r.payment));
  assert.match(JSON.stringify(body.paymentRequired.accepts), /eip155:8453/);
});

test("POST /api/miroshark/preview with a writer signature opens the sim", async () => {
  seen.length = 0;
  mockMode = "402";
  const account = privateKeyToAccount(PAYER_KEY);
  const first = await fetch(`${origin}/api/miroshark/preview`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      title: "July rain walk",
      body: "Walking home in the rain.\n\nThe paid rest of the piece.",
    }),
  });
  const challenge = await first.json();
  assert.equal(challenge.code, "payment_required");
  const pay = challenge.clientPayment;
  const signature = await account.signTypedData({
    domain: pay.domain,
    types: pay.types,
    primaryType: pay.primaryType,
    message: {
      from: account.address,
      to: pay.message.to,
      value: BigInt(pay.message.value),
      validAfter: BigInt(pay.message.validAfter),
      validBefore: BigInt(pay.message.validBefore),
      nonce: pay.message.nonce,
    },
  });
  const res = await fetch(`${origin}/api/miroshark/preview`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      title: "July rain walk",
      body: "Walking home in the rain.\n\nThe paid rest of the piece.",
      payment: {
        signature,
        authorization: { from: account.address, ...pay.message },
      },
    }),
  });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.ok, true);
  assert.equal(body.paid, true);
  assert.match(body.run.waitUrl, /\/wait\/run_bbbbbbbbbbbb$/);
  const paid = seen.find((r) => r.path === "/run" && r.payment);
  assert.ok(paid);
  assert.equal(paid.builder, BUILDER);
  const decoded = decodeJsonB64OrJson(paid.payment);
  assert.equal(decoded.payload.authorization.from.toLowerCase(), account.address.toLowerCase());
  assert.deepEqual(decoded.extensions["builder-code"].info.s, [BUILDER, "x402aff"]);
});

test("POST /api/miroshark/preview with server payer pays Base and stamps x402aff s", async () => {
  seen.length = 0;
  mockMode = "402";
  const res = await fetch(`${payOrigin}/api/miroshark/preview`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      title: "July rain walk",
      body: "Walking home in the rain.\n\nThe paid rest of the piece.",
    }),
  });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.ok, true);
  assert.equal(body.paid, true);
  assert.equal(body.run.runId, "run_bbbbbbbbbbbb");
  const paid = seen.find((r) => r.path === "/run" && r.payment);
  assert.ok(paid);
  assert.equal(paid.builder, BUILDER);
  const decoded = decodeJsonB64OrJson(paid.payment);
  assert.equal(decoded.accepted.network, "eip155:8453");
  assert.equal(decoded.accepted.payTo, "0x4444444444444444444444444444444444444444");
  assert.deepEqual(decoded.extensions["builder-code"].info.s, [BUILDER, "x402aff"]);
});

test("GET /api/miroshark/runs/:id proxies a short summary", async () => {
  const res = await fetch(`${origin}/api/miroshark/runs/run_bbbbbbbbbbbb`);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.ok, true);
  assert.equal(body.run.status, "completed");
  assert.match(body.summary, /Readers were curious/);
});

test("MiroShark 500 fails soft with HTTP 200", async () => {
  mockMode = "error";
  try {
    const res = await fetch(`${origin}/api/miroshark/preview`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: "Hi", body: "A long enough draft to preview." }),
    });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.ok, false);
    assert.equal(body.code, "miroshark_error");
  } finally {
    mockMode = "402";
  }
});
