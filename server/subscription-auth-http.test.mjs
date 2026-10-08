/**
 * Subscription list, cancel, and crypto confirm require the reader session.
 * Crypto confirm also checks the Monad USDC transfer and will not reuse a tx.
 */
import assert from "node:assert/strict";
import http from "node:http";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { readFileSync } from "node:fs";
import { test, after } from "node:test";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { keccak256, toBytes } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { CRYPTO_PERIOD_MS } from "./access.mjs";
import { MONAD_USDC } from "./crypto-subscription-payment.mjs";
import { buildReaderSessionMessage } from "./reader-session.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const APP_PORT = 18950;
const SB_PORT = 18951;
const RPC_PORT = 18952;
const READER_KEY = "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d";
const readerAccount = privateKeyToAccount(READER_KEY);
const READER = readerAccount.address.toLowerCase();
const WRITER = "0x1111111111111111111111111111111111111111";
const OTHER = "0x3333333333333333333333333333333333333333";
const PRICE = 5_000_000n;
const TX_OK = "0x" + "ab".repeat(32);
const TX_SHORT = "0x" + "cd".repeat(32);
const BLOCK_TIME = Math.floor(Date.now() / 1000) - 120;
const TRANSFER_TOPIC = keccak256(toBytes("Transfer(address,address,uint256)"));

function topicAddress(addr) {
  return `0x${addr.slice(2).toLowerCase().padStart(64, "0")}`;
}

function receipt(txHash, { from = READER, to = WRITER, value = PRICE, status = "0x1" } = {}) {
  return {
    transactionHash: txHash,
    status,
    blockNumber: "0x10",
    logs: [
      {
        address: MONAD_USDC,
        topics: [TRANSFER_TOPIC, topicAddress(from), topicAddress(to)],
        data: `0x${value.toString(16).padStart(64, "0")}`,
      },
    ],
  };
}

const receipts = new Map([
  [TX_OK, receipt(TX_OK)],
  [TX_SHORT, receipt(TX_SHORT, { value: 1n })],
]);

const rows = [
  {
    id: 1,
    reader: OTHER,
    writer: WRITER,
    status: "active",
    source: "crypto",
    tx_hash: "0x" + "11".repeat(32),
    current_period_end: new Date(Date.now() + 86_400_000).toISOString(),
    canceled_at: null,
    updated_at: new Date().toISOString(),
    stripe_subscription_id: null,
  },
];
let nextId = 2;

function param(url, key) {
  const raw = url.searchParams.get(key) || "";
  if (raw.startsWith("eq.")) return { op: "eq", value: raw.slice(3) };
  if (raw.startsWith("like.")) return { op: "like", value: raw.slice(5).replaceAll("*", "") };
  return null;
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

const supabase = http.createServer(async (req, res) => {
  const url = new URL(req.url || "/", `http://127.0.0.1:${SB_PORT}`);
  res.setHeader("Content-Type", "application/json");
  if (url.pathname === "/rest/v1/writer_plans") {
    const publisher = param(url, "publisher");
    if (publisher?.value === WRITER) {
      res.writeHead(200);
      res.end(
        JSON.stringify([
          {
            publisher: WRITER,
            monthly_price_cents: 500,
            monthly_price_usdc: "5000000",
            allow_a_la_carte: true,
          },
        ])
      );
      return;
    }
    res.writeHead(200);
    res.end("[]");
    return;
  }
  if (url.pathname === "/rest/v1/subscriptions" && req.method === "GET") {
    let list = rows.slice();
    const reader = param(url, "reader");
    const writer = param(url, "writer");
    const source = param(url, "source");
    const tx = param(url, "tx_hash");
    if (reader?.op === "eq") list = list.filter((row) => row.reader === reader.value);
    if (writer?.op === "eq") list = list.filter((row) => row.writer === writer.value);
    if (source?.op === "eq") list = list.filter((row) => row.source === source.value);
    if (tx?.op === "like") list = list.filter((row) => String(row.tx_hash || "").includes(tx.value));
    res.writeHead(200);
    res.end(JSON.stringify(list));
    return;
  }
  if (url.pathname === "/rest/v1/subscriptions" && req.method === "POST") {
    const parsed = JSON.parse(await readBody(req));
    const incoming = Array.isArray(parsed) ? parsed[0] : parsed;
    let row = rows.find(
      (item) =>
        item.reader === incoming.reader &&
        item.writer === incoming.writer &&
        item.source === incoming.source
    );
    if (!row) {
      row = { id: nextId++, created_at: new Date().toISOString() };
      rows.push(row);
    }
    Object.assign(row, incoming, { id: row.id });
    res.writeHead(200);
    res.end(JSON.stringify([row]));
    return;
  }
  if (url.pathname === "/rest/v1/subscriptions" && req.method === "PATCH") {
    const id = Number(String(param(url, "id")?.value || ""));
    const patch = JSON.parse(await readBody(req));
    const row = rows.find((item) => item.id === id);
    if (row) Object.assign(row, patch);
    res.writeHead(200);
    res.end(JSON.stringify(row ? [row] : []));
    return;
  }
  res.writeHead(200);
  res.end("[]");
});

const rpc = http.createServer(async (req, res) => {
  const body = JSON.parse(await readBody(req));
  let result = null;
  if (body.method === "eth_chainId") result = "0x8f";
  if (body.method === "eth_getTransactionReceipt") result = receipts.get(String(body.params[0]).toLowerCase()) || null;
  if (body.method === "eth_getBlockByNumber") {
    result = { timestamp: "0x" + BLOCK_TIME.toString(16) };
  }
  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ jsonrpc: "2.0", id: body.id, result }));
});

await new Promise((resolve) => supabase.listen(SB_PORT, "127.0.0.1", resolve));
await new Promise((resolve) => rpc.listen(RPC_PORT, "127.0.0.1", resolve));

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
    X402_PAY_TO: "",
    SUPABASE_URL: `http://127.0.0.1:${SB_PORT}`,
    SUPABASE_SERVICE_ROLE_KEY: "test-role-key",
    MONAD_RPC_URL: `http://127.0.0.1:${RPC_PORT}`,
  },
  stdio: ["ignore", "pipe", "pipe"],
});
await once(child.stdout, "data");

after(() => {
  child.kill("SIGTERM");
  supabase.close();
  rpc.close();
});

const origin = `http://127.0.0.1:${APP_PORT}`;
const expectedPeriodEnd = new Date(BLOCK_TIME * 1000 + CRYPTO_PERIOD_MS).toISOString();

async function sessionFor(account) {
  const domain = `127.0.0.1:${APP_PORT}`;
  const issuedAt = Math.floor(Date.now() / 1000);
  const expiresAt = issuedAt + 3600;
  const message = buildReaderSessionMessage({
    domain,
    address: account.address,
    issuedAt,
    expiresAt,
  });
  const signature = await account.signMessage({ message });
  const res = await fetch(`${origin}/api/reader/session`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ address: account.address, issuedAt, expiresAt, signature }),
  });
  const body = await res.json();
  assert.equal(res.status, 200, JSON.stringify(body));
  return body.token;
}

test("subscription endpoints require the reader and a real USDC payment", async () => {
  const res = await fetch(`${origin}/api/subscriptions/crypto/confirm`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      reader: READER,
      writer: WRITER,
      txHash: TX_OK,
      periodEnd: "2099-01-01T00:00:00.000Z",
    }),
  });
  const body = await res.json();
  assert.equal(res.status, 401);
  assert.equal(body.error, "reader_session_required");
  assert.equal(rows.some((row) => row.reader === READER), false);

  const token = await sessionFor(readerAccount);
  const mismatchRes = await fetch(`${origin}/api/subscriptions/crypto/confirm`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Reader-Session": token },
    body: JSON.stringify({
      reader: OTHER,
      writer: WRITER,
      txHash: TX_OK,
      periodEnd: "2099-01-01T00:00:00.000Z",
    }),
  });
  const mismatchBody = await mismatchRes.json();
  assert.equal(mismatchRes.status, 403, JSON.stringify(mismatchBody));
  assert.equal(mismatchBody.error, "reader_mismatch");

  const ok = await fetch(`${origin}/api/subscriptions/crypto/confirm`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Reader-Session": token },
    body: JSON.stringify({ writer: WRITER, txHash: TX_OK, periodEnd: "2099-01-01T00:00:00.000Z" }),
  });
  const confirmed = await ok.json();
  assert.equal(ok.status, 200, JSON.stringify(confirmed));
  assert.equal(confirmed.already, false);
  assert.equal(confirmed.subscription.reader, READER);
  assert.equal(confirmed.subscription.current_period_end, expectedPeriodEnd);
  assert.equal(confirmed.subscription.tx_hash, TX_OK);

  const open = await fetch(`${origin}/api/subscriptions?reader=${READER}`);
  assert.equal(open.status, 401);
  const openBody = await open.json();
  assert.equal(openBody.error, "reader_session_required");
  assert.equal(openBody.subscriptions, undefined);

  const mismatch = await fetch(`${origin}/api/subscriptions?reader=${OTHER}`, {
    headers: { "X-Reader-Session": token },
  });
  assert.equal(mismatch.status, 403);

  const list = await fetch(`${origin}/api/subscriptions?reader=${READER}`, {
    headers: { "X-Reader-Session": token },
  });
  const listed = await list.json();
  assert.equal(list.status, 200, JSON.stringify(listed));
  assert.equal(listed.subscriptions.length, 1);
  assert.equal(listed.subscriptions[0].reader, READER);
  assert.equal(listed.subscriptions[0].live, true);
  assert.equal(listed.subscriptions.some((row) => row.reader === OTHER), false);

  const bareCancel = await fetch(`${origin}/api/subscriptions/cancel`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ reader: READER, writer: WRITER }),
  });
  assert.equal(bareCancel.status, 401);
  assert.equal(rows.find((row) => row.reader === READER).status, "active");

  const cancel = await fetch(`${origin}/api/subscriptions/cancel`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Reader-Session": token },
    body: JSON.stringify({ writer: WRITER }),
  });
  const canceled = await cancel.json();
  assert.equal(cancel.status, 200, JSON.stringify(canceled));
  assert.equal(canceled.canceled, 1);
  assert.equal(rows.find((row) => row.reader === READER).status, "canceled");
  assert.equal(rows.find((row) => row.reader === OTHER).status, "active");

  const replay = await fetch(`${origin}/api/subscriptions/crypto/confirm`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Reader-Session": token },
    body: JSON.stringify({ writer: WRITER, txHash: TX_OK }),
  });
  const replayBody = await replay.json();
  assert.equal(replay.status, 409, JSON.stringify(replayBody));
  assert.equal(replayBody.error, "tx_already_used");

  const short = await fetch(`${origin}/api/subscriptions/crypto/confirm`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Reader-Session": token },
    body: JSON.stringify({ writer: WRITER, txHash: TX_SHORT }),
  });
  const shortBody = await short.json();
  assert.equal(short.status, 400, JSON.stringify(shortBody));
  assert.equal(shortBody.error, "insufficient_payment");
});

test("account and the widget send the reader session on subscription calls", () => {
  const account = readFileSync(path.join(ROOT, "src/publisher/PublisherApp.tsx"), "utf8");
  const widget = readFileSync(path.join(ROOT, "src/widget/mon-unlock.ts"), "utf8");
  assert.match(account, /establishReaderSession/);
  assert.match(account, /READER_SESSION_HEADER/);
  assert.match(widget, /subscriptions\/crypto\/confirm/);
  assert.match(widget, /READER_SESSION_HEADER/);
  assert.doesNotMatch(account, /body: JSON\.stringify\(\{ reader, writer \}\)/);
});
