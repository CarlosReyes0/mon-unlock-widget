/**
 * Payer extraction and fire-and-forget payment logging.
 * Facilitator + Supabase are local mocks. No mainnet calls.
 */
import assert from "node:assert/strict";
import http from "node:http";
import { test } from "node:test";
import { encodeJsonB64 } from "./x402.mjs";
import { extractX402Payer, extractX402Tx, pendingX402PaymentLogs } from "./x402-payment-log.mjs";

const PAYER = "0x2222222222222222222222222222222222222222";
const PAY_TO = "0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb0";
const SETTLE_PAYER = "0x9999999999999999999999999999999999999999";

function evmV1Payload(from = PAYER) {
  return {
    x402Version: 1,
    scheme: "exact",
    network: "base",
    payload: {
      signature: "0x" + "ab".repeat(65),
      authorization: {
        from,
        to: PAY_TO,
        value: "50000",
        validAfter: "0",
        validBefore: "9999999999",
        nonce: "0x" + "11".repeat(32),
      },
    },
  };
}

test("extractX402Payer reads EVM v1 X-PAYMENT authorization.from", () => {
  const payload = evmV1Payload();
  assert.equal(extractX402Payer(payload, { payer: SETTLE_PAYER }), PAYER);
  assert.equal(extractX402Payer(JSON.parse(JSON.stringify(payload)), null), PAYER);
});

test("extractX402Payer reads EVM v2 PAYMENT-SIGNATURE authorization.from", () => {
  const payload = {
    x402Version: 2,
    accepted: {
      scheme: "exact",
      network: "eip155:8453",
      amount: "500000",
      asset: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
    },
    payload: {
      signature: "0x" + "cd".repeat(65),
      authorization: {
        from: "0x3333333333333333333333333333333333333333",
        to: PAY_TO,
        value: "500000",
        validAfter: "0",
        validBefore: "9999999999",
        nonce: "0x" + "22".repeat(32),
      },
    },
  };
  assert.equal(
    extractX402Payer(payload, { settlement: { payer: SETTLE_PAYER } }),
    "0x3333333333333333333333333333333333333333"
  );
});

test("extractX402Payer uses an explicit Solana payer when authorization.from is absent", () => {
  const payload = {
    x402Version: 1,
    scheme: "exact",
    network: "solana",
    payload: {
      transaction: "not-a-real-transaction",
      payer: "7EcDhSYGxXyscszYEp35KHN8vvw3svAuLKTzXwCFLtV",
    },
  };
  assert.equal(extractX402Payer(payload, { payer: SETTLE_PAYER }), payload.payload.payer);
});

test("extractX402Payer falls back to the settle response payer", () => {
  assert.equal(extractX402Payer({ payload: { transaction: "abc" } }, { payer: SETTLE_PAYER }), SETTLE_PAYER);
  assert.equal(
    extractX402Payer(null, { settlement: { payer: PAYER, transaction: "0xabc" } }),
    PAYER
  );
  assert.equal(extractX402Payer(undefined, { payerAddress: PAYER }), PAYER);
  assert.equal(extractX402Tx({ transaction: "0xabc123" }), "0xabc123");
  assert.equal(extractX402Tx({ settlement: { txHash: "0xdef456" } }), "0xdef456");
});

test("extractX402Payer does not throw on garbage input", () => {
  const evil = {};
  Object.defineProperty(evil, "payload", {
    get() {
      throw new Error("boom");
    },
  });
  const evilSettle = {};
  Object.defineProperty(evilSettle, "payer", {
    get() {
      throw new Error("settle boom");
    },
  });
  assert.equal(extractX402Payer(evil, null), null);
  assert.equal(extractX402Payer(null, evilSettle), null);
  assert.equal(extractX402Payer("nope", 12), null);
  assert.equal(extractX402Payer([], { settlement: [] }), null);
  assert.equal(extractX402Payer({ payload: "x", authorization: null }, { payer: { address: "" } }), null);
  assert.equal(extractX402Tx(evilSettle), null);
  assert.equal(extractX402Tx("tx"), null);
});

function listen(server) {
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve(server.address().port));
  });
}

test("a failing payment log does not block or change the 200 paid unlock", async () => {
  let releaseInsert = () => {};
  const holdInsert = new Promise((resolve) => {
    releaseInsert = resolve;
  });
  let markInsertSeen = () => {};
  const insertSeen = new Promise((resolve) => {
    markInsertSeen = resolve;
  });
  let insertedRow = null;

  const facilitator = http.createServer((req, res) => {
    const url = new URL(req.url || "/", "http://127.0.0.1");
    res.setHeader("Content-Type", "application/json");
    if (req.method === "POST" && url.pathname === "/verify") {
      res.writeHead(200);
      res.end(JSON.stringify({ isValid: true }));
      return;
    }
    if (req.method === "POST" && url.pathname === "/settle") {
      res.writeHead(200);
      res.end(
        JSON.stringify({
          success: true,
          transaction: "0xabc123def456",
          network: "base",
          payer: SETTLE_PAYER,
        })
      );
      return;
    }
    res.writeHead(404);
    res.end("{}");
  });

  const supabase = http.createServer((req, res) => {
    const url = new URL(req.url || "/", "http://127.0.0.1");
    if (url.pathname === "/rest/v1/x402_payments" && req.method === "POST") {
      const chunks = [];
      req.on("data", (chunk) => chunks.push(chunk));
      req.on("end", () => {
        insertedRow = JSON.parse(Buffer.concat(chunks).toString("utf8"));
        markInsertSeen();
        void holdInsert.then(() => {
          res.writeHead(500, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ message: "insert down" }));
        });
      });
      return;
    }
    res.setHeader("Content-Type", "application/json");
    if (url.pathname === "/rest/v1/articles") {
      res.writeHead(200);
      res.end(
        JSON.stringify([
          {
            id: 42,
            article_id: "x402-demo-article",
            article_id_hash: "0x" + "ab".repeat(32),
            publisher: "0x1111111111111111111111111111111111111111",
            price_wei: "500000",
            price_cents: 50,
            listing_status: "listed",
            payment_asset: "usdc",
            allow_a_la_carte: true,
            title: "Demo paid piece",
            teaser: "Free preview only",
            body: "SECRET_PAID_ARTICLE_TEXT_DO_NOT_LEAK",
          },
        ])
      );
      return;
    }
    res.writeHead(200);
    res.end("[]");
  });

  const facPort = await listen(facilitator);
  const sbPort = await listen(supabase);
  const previous = {
    SUPABASE_URL: process.env.SUPABASE_URL,
    SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
    X402_PAY_TO: process.env.X402_PAY_TO,
    X402_FACILITATOR_URL: process.env.X402_FACILITATOR_URL,
    X402_DEV_BYPASS: process.env.X402_DEV_BYPASS,
    CDP_API_KEY_ID: process.env.CDP_API_KEY_ID,
    CDP_API_KEY_SECRET: process.env.CDP_API_KEY_SECRET,
  };
  process.env.SUPABASE_URL = `http://127.0.0.1:${sbPort}`;
  process.env.SUPABASE_SERVICE_ROLE_KEY = "test-role-key";
  process.env.X402_PAY_TO = PAY_TO;
  process.env.X402_FACILITATOR_URL = `http://127.0.0.1:${facPort}`;
  process.env.X402_DEV_BYPASS = "";
  process.env.CDP_API_KEY_ID = "";
  process.env.CDP_API_KEY_SECRET = "";

  const errors = [];
  const originalError = console.error;
  console.error = (...args) => {
    errors.push(args.map((part) => String(part)).join(" "));
  };

  const { handleX402Unlock } = await import(`./x402-handlers.mjs?logtest=${Date.now()}`);
  let statusCode = 0;
  let rawBody = "";
  const res = {
    setHeader() {},
    writeHead(status) {
      statusCode = status;
    },
    end(payload) {
      rawBody = String(payload || "");
    },
  };
  const payment = encodeJsonB64({
    ...evmV1Payload(),
    payload: {
      ...evmV1Payload().payload,
      authorization: {
        ...evmV1Payload().payload.authorization,
        value: "500000",
      },
    },
  });

  try {
    const pending = handleX402Unlock(
      {
        method: "GET",
        headers: { host: "127.0.0.1", "x-payment": payment },
      },
      res,
      {
        url: new URL("http://127.0.0.1/api/x402/articles/x402-demo-article"),
        readBody: async () => "",
        sendJson(response, status, body) {
          statusCode = status;
          response.end(JSON.stringify(body));
        },
      }
    );
    const raced = await Promise.race([
      pending.then(() => "handler"),
      new Promise((resolve) => setTimeout(() => resolve("blocked"), 800)),
    ]);
    assert.equal(raced, "handler");
    assert.equal(statusCode, 200);
    const body = JSON.parse(rawBody);
    assert.equal(body.paid, true);
    assert.equal(body.reason, "x402");
    assert.equal(body.body, "SECRET_PAID_ARTICLE_TEXT_DO_NOT_LEAK");
    assert.equal(body.payment.transaction, "0xabc123def456");

    const seen = await Promise.race([
      insertSeen.then(() => "seen"),
      new Promise((resolve) => setTimeout(() => resolve("missing"), 800)),
    ]);
    assert.equal(seen, "seen");
    assert.equal(insertedRow.kind, "unlock");
    assert.equal(insertedRow.article_id, 42);
    assert.equal(insertedRow.payer, PAYER);
    assert.equal(insertedRow.amount_atomic, "500000");
    assert.equal(insertedRow.tx, "0xabc123def456");
    assert.equal(insertedRow.network, "base");
  } finally {
    releaseInsert();
    await pendingX402PaymentLogs();
    console.error = originalError;
    facilitator.close();
    supabase.close();
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }

  assert.ok(errors.some((line) => line.includes("[x402-payment-log]") && line.includes("insert failed")));
});
