/**
 * POST /api/stripe/connect/onboard requires the writer's EIP-191 signature.
 * Unsigned, bad, wrong-wallet, and stale requests are 401 and must not
 * return a link or an existing Stripe account id. Stripe is a localhost mock.
 */
import assert from "node:assert/strict";
import http from "node:http";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { test, after } from "node:test";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { privateKeyToAccount } from "viem/accounts";
import { buildConnectAuthMessage } from "./writer-mutation-auth.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const APP_PORT = 18792;
const SB_PORT = 18793;
const STRIPE_PORT = 18794;
const EXISTING_ACCOUNT = "acct_existing_writer";
const NEW_ACCOUNT = "acct_mock_writer";

const OWNER_KEY = "0xac0974bec39a17e36ba4a6b4d4aad435cce0e4c9335790421507b8a191e28881";
const OTHER_KEY = "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d";
const owner = privateKeyToAccount(OWNER_KEY);
const other = privateKeyToAccount(OTHER_KEY);

const sbHits = [];
const stripeCalls = [];
let existingAccount = false;

function readReqBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

function sendJson(res, status, body) {
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Request-Id": "req_mock",
  });
  res.end(JSON.stringify(body));
}

const supabase = http.createServer(async (req, res) => {
  const url = new URL(req.url || "/", `http://127.0.0.1:${SB_PORT}`);
  const raw = req.method === "GET" || req.method === "HEAD" ? "" : await readReqBody(req);
  sbHits.push({ method: req.method, path: url.pathname, raw });
  if (req.method === "GET" && url.pathname === "/rest/v1/publisher_accounts") {
    sendJson(res, 200, existingAccount ? [{ stripe_account_id: EXISTING_ACCOUNT }] : []);
    return;
  }
  sendJson(res, 200, []);
});

const stripe = http.createServer(async (req, res) => {
  const url = new URL(req.url || "/", `http://127.0.0.1:${STRIPE_PORT}`);
  if (req.method !== "GET" && req.method !== "HEAD") await readReqBody(req);
  stripeCalls.push({ method: req.method, path: url.pathname });

  if (req.method === "GET" && url.pathname === "/mock-onboarding") {
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end("<!doctype html><title>Mock onboarding</title><p>Local mock. No Stripe account was created.</p>");
    return;
  }
  if (req.method === "POST" && url.pathname === "/v1/accounts") {
    sendJson(res, 200, {
      id: NEW_ACCOUNT,
      object: "account",
      charges_enabled: false,
      payouts_enabled: false,
    });
    return;
  }
  if (req.method === "GET" && url.pathname.startsWith("/v1/accounts/")) {
    const id = decodeURIComponent(url.pathname.split("/").pop() || "");
    sendJson(res, 200, {
      id,
      object: "account",
      charges_enabled: false,
      payouts_enabled: false,
    });
    return;
  }
  if (req.method === "POST" && url.pathname === "/v1/account_links") {
    sendJson(res, 200, {
      object: "account_link",
      url: `http://127.0.0.1:${STRIPE_PORT}/mock-onboarding`,
      created: 1_700_000_000,
      expires_at: 1_900_000_000,
    });
    return;
  }
  sendJson(res, 404, {
    error: { message: `unmocked ${req.method} ${url.pathname}`, type: "invalid_request_error" },
  });
});

await new Promise((resolve) => supabase.listen(SB_PORT, "127.0.0.1", resolve));
await new Promise((resolve) => stripe.listen(STRIPE_PORT, "127.0.0.1", resolve));

const child = spawn(process.execPath, ["server/index.mjs"], {
  cwd: ROOT,
  env: {
    ...process.env,
    PORT: String(APP_PORT),
    CDP_API_KEY_ID: "",
    CDP_API_KEY_SECRET: "",
    CDP_API_KEY: "",
    CDP_API_SECRET: "",
    STRIPE_SECRET_KEY: "sk_test_mock_openpaywall_local_only",
    STRIPE_WEBHOOK_SECRET: "",
    STRIPE_CONNECT_WEBHOOK_SECRET: "",
    STRIPE_MOCK_BASE_URL: `http://127.0.0.1:${STRIPE_PORT}`,
    MPP_SECRET_KEY: "",
    MPP_TEMPO_RECIPIENT: "",
    MPP_DEV_BYPASS: "",
    X402_PAY_TO: "",
    RELAYER_PRIVATE_KEY: "",
    SUPABASE_URL: `http://127.0.0.1:${SB_PORT}`,
    SUPABASE_SERVICE_ROLE_KEY: "test-role-key",
  },
  stdio: ["ignore", "pipe", "pipe"],
});

let serverLog = "";
child.stdout.on("data", (chunk) => {
  serverLog += chunk.toString();
});
child.stderr.on("data", (chunk) => {
  serverLog += chunk.toString();
});
await once(child.stdout, "data");

after(() => {
  child.kill("SIGTERM");
  supabase.close();
  stripe.close();
});

function reset() {
  sbHits.length = 0;
  stripeCalls.length = 0;
  existingAccount = true;
}

async function post(body) {
  const res = await fetch(`http://127.0.0.1:${APP_PORT}/api/stripe/connect/onboard`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let json = {};
  try {
    json = JSON.parse(text);
  } catch {
    json = { raw: text };
  }
  return { status: res.status, body: json, text };
}

function assertNoLink(res) {
  assert.equal(res.body.url, undefined);
  assert.equal(res.body.stripeAccountId, undefined);
  assert.equal(res.text.includes(EXISTING_ACCOUNT), false);
  assert.equal(res.text.includes(NEW_ACCOUNT), false);
  assert.equal(res.text.includes("mock-onboarding"), false);
  assert.equal(sbHits.length, 0);
  assert.equal(stripeCalls.length, 0);
}

async function signedBody(account, overrides = {}) {
  const issuedAt = overrides.issuedAt || new Date().toISOString();
  const publisher = overrides.publisher || owner.address;
  const message = buildConnectAuthMessage({
    publisher: overrides.signedPublisher || publisher,
    issuedAt: overrides.signedIssuedAt || issuedAt,
  });
  const connectSig = await account.signMessage({ message });
  return {
    publisher,
    issuedAt,
    connectSig,
    returnUrl: `http://127.0.0.1:${APP_PORT}/account.html`,
    refreshUrl: `http://127.0.0.1:${APP_PORT}/account.html`,
  };
}

test("unsigned onboard is 401 and does not touch Stripe or the account row", async () => {
  reset();
  const res = await post({
    publisher: owner.address,
    returnUrl: `http://127.0.0.1:${APP_PORT}/account.html`,
    refreshUrl: `http://127.0.0.1:${APP_PORT}/account.html`,
  });
  assert.equal(res.status, 401);
  assert.equal(res.body.error, "unauthorized");
  assertNoLink(res);
});

test("bad signature onboard is 401 with no link", async () => {
  reset();
  const res = await post({
    publisher: owner.address,
    issuedAt: new Date().toISOString(),
    connectSig: "not-a-signature",
  });
  assert.equal(res.status, 401);
  assert.equal(res.body.error, "unauthorized");
  assertNoLink(res);
});

test("wrong-wallet onboard is 401 with no link", async () => {
  reset();
  const body = await signedBody(other);
  const res = await post(body);
  assert.equal(res.status, 401);
  assert.equal(res.body.error, "unauthorized");
  assertNoLink(res);
});

test("stale onboard signature is 401 with no link", async () => {
  reset();
  const issuedAt = new Date(Date.now() - 11 * 60 * 1000).toISOString();
  const body = await signedBody(owner, { issuedAt });
  const res = await post(body);
  assert.equal(res.status, 401);
  assert.equal(res.body.error, "unauthorized");
  assertNoLink(res);
});

test("a signature replayed onto a fresh timestamp is 401 with no link", async () => {
  reset();
  const staleAt = new Date(Date.now() - 2 * 60 * 1000).toISOString();
  const body = await signedBody(owner, { signedIssuedAt: staleAt, issuedAt: new Date().toISOString() });
  const res = await post(body);
  assert.equal(res.status, 401);
  assert.equal(res.body.error, "unauthorized");
  assertNoLink(res);
});

test("a valid signature creates an onboarding link against the mock", async () => {
  reset();
  existingAccount = false;
  const body = await signedBody(owner);
  const res = await post(body);
  assert.equal(res.status, 200, `${JSON.stringify(res.body)}\n${serverLog}`);
  assert.equal(res.body.url, `http://127.0.0.1:${STRIPE_PORT}/mock-onboarding`);
  assert.equal(res.body.stripeAccountId, NEW_ACCOUNT);
  assert.equal(stripeCalls.some((call) => call.method === "POST" && call.path === "/v1/accounts"), true);
  assert.equal(stripeCalls.some((call) => call.method === "POST" && call.path === "/v1/account_links"), true);
});

test("a valid signature returns the existing account link and not a new account", async () => {
  reset();
  const body = await signedBody(owner);
  const res = await post(body);
  assert.equal(res.status, 200, `${JSON.stringify(res.body)}\n${serverLog}`);
  assert.equal(res.body.url, `http://127.0.0.1:${STRIPE_PORT}/mock-onboarding`);
  assert.equal(res.body.stripeAccountId, EXISTING_ACCOUNT);
  assert.equal(stripeCalls.some((call) => call.method === "POST" && call.path === "/v1/accounts"), false);
  assert.equal(stripeCalls.some((call) => call.path === `/v1/accounts/${EXISTING_ACCOUNT}`), true);
});
