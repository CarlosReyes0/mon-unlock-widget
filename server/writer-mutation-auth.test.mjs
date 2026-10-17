/**
 * POST /api/writers/plan and POST /api/articles/a-la-carte require the
 * owning publisher's EIP-191 signature over the payload plus issuedAt.
 * Rejected requests must not reach Supabase. A signature outside the
 * 10-minute window is 401 stale_signature. Replay protection is a
 * used_signatures row in the mock database: the same signature a second
 * time, including from a new server process, is 401 replayed_signature.
 * A signature-store error is 503 and does not write the plan. A new
 * issuedAt is a new signature and saves.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { test, after } from "node:test";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { privateKeyToAccount } from "viem/accounts";
import { sha256Hex } from "./follow-core.mjs";
import {
  buildALaCarteAuthMessage as serverALaCarteMessage,
  buildConnectAuthMessage as serverConnectMessage,
  buildGasAuthMessage as serverGasMessage,
  buildMediaAuthMessage as serverMediaMessage,
  buildPlanAuthMessage as serverPlanMessage,
  buildVoiceAuthMessage as serverVoiceMessage,
} from "./writer-mutation-auth.mjs";
import {
  buildALaCarteAuthMessage as clientALaCarteMessage,
  buildConnectAuthMessage as clientConnectMessage,
  buildGasAuthMessage as clientGasMessage,
  buildMediaAuthMessage as clientMediaMessage,
  buildPlanAuthMessage as clientPlanMessage,
  buildVoiceAuthMessage as clientVoiceMessage,
} from "../dist/core/publish-auth.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const APP_PORT = 18786;
const SB_PORT = 18787;
const RESTART_PORT = 18788;
const SLUG = "july-rain";

const OWNER_KEY = "0xac0974bec39a17e36ba4a6b4d4aad435cce0e4c9335790421507b8a191e28881";
const OTHER_KEY = "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d";
const owner = privateKeyToAccount(OWNER_KEY);
const other = privateKeyToAccount(OTHER_KEY);

const hits = [];
const usedSigs = new Set();
let articlePublisher = owner.address.toLowerCase();
let signatureStoreDown = false;

function readReqBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

const supabase = http.createServer(async (req, res) => {
  const url = new URL(req.url || "/", `http://127.0.0.1:${SB_PORT}`);
  const raw = req.method === "GET" || req.method === "HEAD" ? "" : await readReqBody(req);
  let parsed = null;
  if (raw) {
    try {
      parsed = JSON.parse(raw);
    } catch {
      parsed = raw;
    }
  }
  hits.push({ method: req.method, path: url.pathname, body: parsed });
  res.setHeader("Content-Type", "application/json");

  if (url.pathname === "/rest/v1/used_signatures" && req.method === "POST") {
    if (signatureStoreDown) {
      res.writeHead(500);
      res.end(JSON.stringify({ message: "connection refused", code: "08006" }));
      return;
    }
    const row = Array.isArray(parsed) ? parsed[0] : parsed;
    const hash = row && typeof row.sig_hash === "string" ? row.sig_hash : "";
    if (!hash || usedSigs.has(hash)) {
      res.writeHead(409);
      res.end(
        JSON.stringify({
          code: "23505",
          message: 'duplicate key value violates unique constraint "used_signatures_pkey"',
        })
      );
      return;
    }
    usedSigs.add(hash);
    res.writeHead(201);
    res.end("");
    return;
  }

  if (url.pathname === "/rest/v1/writer_plans" && req.method === "POST") {
    res.writeHead(200);
    res.end(JSON.stringify(parsed));
    return;
  }

  if (url.pathname === "/rest/v1/articles" && req.method === "GET") {
    const articleId = String(url.searchParams.get("article_id") || "").replace(/^eq\./, "");
    if (articleId !== SLUG) {
      res.writeHead(200);
      res.end("[]");
      return;
    }
    res.writeHead(200);
    res.end(
      JSON.stringify([
        {
          article_id: SLUG,
          publisher: articlePublisher,
          allow_a_la_carte: true,
        },
      ])
    );
    return;
  }

  if (url.pathname === "/rest/v1/articles" && req.method === "PATCH") {
    const patch = parsed && typeof parsed === "object" ? parsed : {};
    res.writeHead(200);
    res.end(
      JSON.stringify([
        {
          article_id: SLUG,
          publisher: articlePublisher,
          allow_a_la_carte: patch.allow_a_la_carte !== false,
        },
      ])
    );
    return;
  }

  res.writeHead(200);
  res.end("[]");
});

await new Promise((resolve) => supabase.listen(SB_PORT, "127.0.0.1", resolve));

const child = spawn(process.execPath, ["server/index.mjs"], {
  cwd: ROOT,
  env: appEnv(APP_PORT),
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
});

const origin = `http://127.0.0.1:${APP_PORT}`;

function resetDb() {
  hits.length = 0;
  usedSigs.clear();
  articlePublisher = owner.address.toLowerCase();
  signatureStoreDown = false;
}

function appEnv(port) {
  return {
    ...process.env,
    PORT: String(port),
    CDP_API_KEY_ID: "",
    CDP_API_KEY_SECRET: "",
    CDP_API_KEY: "",
    CDP_API_SECRET: "",
    STRIPE_SECRET_KEY: "",
    STRIPE_WEBHOOK_SECRET: "",
    MPP_SECRET_KEY: "",
    MPP_TEMPO_RECIPIENT: "",
    MPP_DEV_BYPASS: "",
    X402_PAY_TO: "",
    RELAYER_PRIVATE_KEY: "",
    SUPABASE_URL: `http://127.0.0.1:${SB_PORT}`,
    SUPABASE_SERVICE_ROLE_KEY: "test-role-key",
  };
}

async function spawnApp(port) {
  const proc = spawn(process.execPath, ["server/index.mjs"], {
    cwd: ROOT,
    env: appEnv(port),
    stdio: ["ignore", "pipe", "pipe"],
  });
  let log = "";
  proc.stdout.on("data", (chunk) => {
    log += chunk.toString();
  });
  proc.stderr.on("data", (chunk) => {
    log += chunk.toString();
  });
  await once(proc.stdout, "data");
  return { proc, log: () => log };
}

async function post(path, body) {
  const res = await fetch(`${origin}${path}`, {
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
  return { status: res.status, body: json };
}

function writes() {
  return hits.filter((hit) => hit.method === "POST" || hit.method === "PATCH");
}

function freshIssuedAt(offsetMs = 0) {
  return new Date(Date.now() + offsetMs).toISOString();
}

async function signedPlan(fields, signer = owner) {
  const body = { issuedAt: freshIssuedAt(), ...fields };
  const planSig = await signer.signMessage({ message: serverPlanMessage(body) });
  return { ...body, planSig };
}

async function signedALaCarte(fields, signer = owner) {
  const body = { issuedAt: freshIssuedAt(), ...fields };
  const aLaCarteSig = await signer.signMessage({ message: serverALaCarteMessage(body) });
  return { ...body, aLaCarteSig };
}

test("client and server sign the same plan and a-la-carte messages", () => {
  const plan = {
    publisher: owner.address.toUpperCase(),
    monthlyPriceCents: 500,
    allowALaCarte: false,
    issuedAt: "2026-10-17T03:10:00.000Z",
  };
  const article = {
    articleId: SLUG,
    publisher: owner.address,
    allowALaCarte: true,
    issuedAt: "2026-10-17T03:10:00.000Z",
  };
  const connect = {
    publisher: owner.address.toUpperCase(),
    issuedAt: "2026-10-17T02:16:00.000Z",
  };
  const recent = {
    address: owner.address.toUpperCase(),
    issuedAt: "2026-10-17T03:10:00.000Z",
  };
  assert.equal(serverPlanMessage(plan), clientPlanMessage(plan));
  assert.equal(serverALaCarteMessage(article), clientALaCarteMessage(article));
  assert.match(serverPlanMessage(plan), /issuedAt:2026-10-17T03:10:00\.000Z/);
  assert.match(serverALaCarteMessage(article), /issuedAt:2026-10-17T03:10:00\.000Z/);
  assert.equal(serverConnectMessage(connect), clientConnectMessage(connect));
  assert.equal(serverGasMessage(recent), clientGasMessage(recent));
  assert.equal(serverMediaMessage(recent), clientMediaMessage(recent));
  assert.equal(serverVoiceMessage(recent), clientVoiceMessage(recent));
  assert.equal(
    serverGasMessage(recent),
    [
      "Open Paywall gas v1",
      `address:${owner.address.toLowerCase()}`,
      "issuedAt:2026-10-17T03:10:00.000Z",
    ].join("\n")
  );
  assert.equal(
    serverConnectMessage(connect),
    [
      "Open Paywall connect v1",
      `publisher:${owner.address.toLowerCase()}`,
      "issuedAt:2026-10-17T02:16:00.000Z",
    ].join("\n")
  );
});

test("dashboard and account UI sign plan and a-la-carte updates", () => {
  const dashboard = fs.readFileSync(path.join(ROOT, "dashboard.html"), "utf8");
  const account = fs.readFileSync(path.join(ROOT, "src/publisher/PublisherApp.tsx"), "utf8");
  const articles = fs.readFileSync(path.join(ROOT, "src/publisher/AccountArticles.tsx"), "utf8");
  assert.match(dashboard, /buildPlanAuthMessage/);
  assert.match(dashboard, /planSig/);
  assert.match(dashboard, /buildALaCarteAuthMessage/);
  assert.match(dashboard, /aLaCarteSig/);
  assert.match(dashboard, /buildConnectAuthMessage/);
  assert.match(dashboard, /connectSig/);
  assert.match(dashboard, /issuedAt/);
  assert.match(account, /buildPlanAuthMessage/);
  assert.match(account, /planSig/);
  assert.match(account, /buildConnectAuthMessage/);
  assert.match(account, /connectSig/);
  assert.match(account, /issuedAt/);
  assert.match(articles, /buildALaCarteAuthMessage/);
  assert.match(articles, /aLaCarteSig/);
  assert.match(articles, /issuedAt/);
  const planSave = dashboard.split("async function saveWriterPlan")[1]?.split("async function ")[0] || "";
  const listingSave = dashboard.split("async function saveListingFromDashboard")[1]?.split("async function ")[0] || "";
  assert.match(planSave, /issuedAt/);
  assert.match(planSave, /planSig/);
  assert.match(listingSave, /aLaCarteIssuedAt/);
  assert.match(listingSave, /aLaCarteSig/);
});

test("POST /api/writers/plan rejects an unauthenticated request without touching the DB", async () => {
  resetDb();
  const res = await post("/api/writers/plan", {
    publisher: owner.address,
    monthlyPriceCents: 500,
    allowALaCarte: false,
  });
  assert.equal(res.status, 401);
  assert.equal(res.body.error, "unauthorized");
  assert.equal(hits.length, 0);
});

test("POST /api/writers/plan rejects a bad signature without touching the DB", async () => {
  resetDb();
  const res = await post("/api/writers/plan", {
    publisher: owner.address,
    monthlyPriceCents: 500,
    allowALaCarte: false,
    issuedAt: freshIssuedAt(),
    planSig: "not-a-signature",
  });
  assert.equal(res.status, 401);
  assert.equal(res.body.error, "unauthorized");
  assert.equal(hits.length, 0);
});

test("POST /api/writers/plan rejects a signature from a different wallet", async () => {
  resetDb();
  const body = await signedPlan(
    {
      publisher: owner.address,
      monthlyPriceCents: 900,
      allowALaCarte: false,
    },
    other
  );
  const res = await post("/api/writers/plan", body);
  assert.equal(res.status, 403);
  assert.equal(res.body.error, "forbidden");
  assert.equal(hits.length, 0);
});

test("POST /api/writers/plan rejects a signature replayed for a different price or flag", async () => {
  resetDb();
  const signed = await signedPlan({
    publisher: owner.address,
    monthlyPriceCents: 500,
    allowALaCarte: true,
  });
  const otherPrice = await post("/api/writers/plan", { ...signed, monthlyPriceCents: 900 });
  const otherFlag = await post("/api/writers/plan", { ...signed, allowALaCarte: false });
  assert.equal(otherPrice.status, 403);
  assert.equal(otherFlag.status, 403);
  assert.equal(hits.length, 0);
});

test("POST /api/writers/plan rejects a stale or future signature without touching the DB", async () => {
  resetDb();
  const stale = await signedPlan({
    publisher: owner.address,
    monthlyPriceCents: 900,
    allowALaCarte: false,
    issuedAt: freshIssuedAt(-11 * 60 * 1000),
  });
  const future = await signedPlan({
    publisher: owner.address,
    monthlyPriceCents: 900,
    allowALaCarte: false,
    issuedAt: freshIssuedAt(11 * 60 * 1000),
  });
  const staleRes = await post("/api/writers/plan", stale);
  const futureRes = await post("/api/writers/plan", future);
  assert.equal(staleRes.status, 401);
  assert.equal(staleRes.body.error, "stale_signature");
  assert.equal(futureRes.status, 401);
  assert.equal(futureRes.body.error, "stale_signature");
  assert.equal(hits.length, 0);
});

test("POST /api/writers/plan accepts a fresh signature and rejects a replay", async () => {
  resetDb();
  const body = await signedPlan({
    publisher: owner.address,
    monthlyPriceCents: 900,
    allowALaCarte: false,
  });
  const first = await post("/api/writers/plan", body);
  assert.equal(first.status, 200, JSON.stringify(first.body));
  assert.equal(first.body.plan.allowALaCarte, false);
  assert.equal(first.body.plan.monthlyPriceCents, 900);
  assert.equal(first.body.plan.publisher, owner.address.toLowerCase());
  const replay = await post("/api/writers/plan", body);
  assert.equal(replay.status, 401);
  assert.equal(replay.body.error, "replayed_signature");
  const again = await signedPlan({
    publisher: owner.address,
    monthlyPriceCents: 900,
    allowALaCarte: false,
  });
  const second = await post("/api/writers/plan", again);
  assert.equal(second.status, 200, JSON.stringify(second.body));
  const planWrites = writes().filter((hit) => hit.path === "/rest/v1/writer_plans");
  const sigWrites = writes().filter((hit) => hit.path === "/rest/v1/used_signatures");
  assert.equal(planWrites.length, 2);
  assert.equal(sigWrites.length, 3);
  assert.equal(writes()[0].path, "/rest/v1/used_signatures");
  assert.equal(writes()[0].body[0].sig_hash, sha256Hex(body.planSig.trim()));
  assert.equal(writes()[0].body[0].purpose, "plan");
  assert.equal(writes()[0].body[0].wallet, owner.address.toLowerCase());
  assert.equal(writes()[1].path, "/rest/v1/writer_plans");
  assert.equal(writes()[1].body[0].allow_a_la_carte, false);
  assert.equal(writes()[1].body[0].monthly_price_cents, 900);
  assert.equal(writes()[1].body[0].publisher, owner.address.toLowerCase());
});

test("POST /api/writers/plan rejects a replay from a new process against the same database", async () => {
  resetDb();
  const body = await signedPlan({
    publisher: owner.address,
    monthlyPriceCents: 700,
    allowALaCarte: true,
  });
  const first = await post("/api/writers/plan", body);
  assert.equal(first.status, 200, JSON.stringify(first.body));
  const restarted = await spawnApp(RESTART_PORT);
  try {
    const res = await fetch(`http://127.0.0.1:${RESTART_PORT}/api/writers/plan`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const json = await res.json();
    assert.equal(res.status, 401, JSON.stringify(json));
    assert.equal(json.error, "replayed_signature");
  } finally {
    restarted.proc.kill("SIGTERM");
  }
  const planWrites = writes().filter((hit) => hit.path === "/rest/v1/writer_plans");
  assert.equal(planWrites.length, 1);
  assert.equal(usedSigs.size, 1);
});

test("POST /api/writers/plan fails closed when the signature store is unavailable", async () => {
  resetDb();
  signatureStoreDown = true;
  const body = await signedPlan({
    publisher: owner.address,
    monthlyPriceCents: 700,
    allowALaCarte: true,
  });
  const res = await post("/api/writers/plan", body);
  assert.equal(res.status, 503, JSON.stringify(res.body));
  assert.equal(res.body.error, "signature_store_unavailable");
  assert.equal(writes().filter((hit) => hit.path === "/rest/v1/writer_plans").length, 0);
  assert.equal(writes().filter((hit) => hit.path === "/rest/v1/used_signatures").length, 1);
  assert.equal(usedSigs.size, 0);
});

test("POST /api/articles/a-la-carte rejects an unauthenticated request without touching the DB", async () => {
  resetDb();
  const res = await post("/api/articles/a-la-carte", {
    articleId: SLUG,
    publisher: owner.address,
    allowALaCarte: false,
  });
  assert.equal(res.status, 401);
  assert.equal(res.body.error, "unauthorized");
  assert.equal(hits.length, 0);
});

test("POST /api/articles/a-la-carte rejects a bad signature without touching the DB", async () => {
  resetDb();
  const res = await post("/api/articles/a-la-carte", {
    articleId: SLUG,
    publisher: owner.address,
    allowALaCarte: false,
    issuedAt: freshIssuedAt(),
    aLaCarteSig: "not-a-signature",
  });
  assert.equal(res.status, 401);
  assert.equal(hits.length, 0);
});

test("POST /api/articles/a-la-carte rejects a signature from a different wallet", async () => {
  resetDb();
  const body = await signedALaCarte(
    {
      articleId: SLUG,
      publisher: owner.address,
      allowALaCarte: false,
    },
    other
  );
  const res = await post("/api/articles/a-la-carte", body);
  assert.equal(res.status, 403);
  assert.equal(res.body.error, "forbidden");
  assert.equal(hits.length, 0);
});

test("POST /api/articles/a-la-carte rejects a signature replayed for another article or flag", async () => {
  resetDb();
  const signed = await signedALaCarte({
    articleId: SLUG,
    publisher: owner.address,
    allowALaCarte: true,
  });
  const otherArticle = await post("/api/articles/a-la-carte", { ...signed, articleId: "other-piece" });
  const otherFlag = await post("/api/articles/a-la-carte", { ...signed, allowALaCarte: false });
  assert.equal(otherArticle.status, 403);
  assert.equal(otherFlag.status, 403);
  assert.equal(writes().length, 0);
  assert.equal(hits.length, 0);
});

test("POST /api/articles/a-la-carte rejects a stale signature without touching the DB", async () => {
  resetDb();
  const body = await signedALaCarte({
    articleId: SLUG,
    publisher: owner.address,
    allowALaCarte: false,
    issuedAt: freshIssuedAt(-11 * 60 * 1000),
  });
  const res = await post("/api/articles/a-la-carte", body);
  assert.equal(res.status, 401);
  assert.equal(res.body.error, "stale_signature");
  assert.equal(hits.length, 0);
});

test("POST /api/articles/a-la-carte rejects the signer when they do not own the article", async () => {
  resetDb();
  articlePublisher = other.address.toLowerCase();
  const body = await signedALaCarte({
    articleId: SLUG,
    publisher: owner.address,
    allowALaCarte: false,
  });
  const res = await post("/api/articles/a-la-carte", body);
  assert.equal(res.status, 403);
  assert.equal(res.body.error, "forbidden");
  assert.equal(writes().length, 0);
  assert.equal(hits.length, 1);
  assert.equal(hits[0].method, "GET");
});

test("POST /api/articles/a-la-carte accepts a fresh signature and rejects a replay", async () => {
  resetDb();
  const body = await signedALaCarte({
    articleId: SLUG,
    publisher: owner.address,
    allowALaCarte: false,
  });
  const res = await post("/api/articles/a-la-carte", body);
  assert.equal(res.status, 200, `${JSON.stringify(res.body)}\n${serverLog}`);
  assert.equal(res.body.articleId, SLUG);
  assert.equal(res.body.allowALaCarte, false);
  const replay = await post("/api/articles/a-la-carte", body);
  assert.equal(replay.status, 401);
  assert.equal(replay.body.error, "replayed_signature");
  const patches = writes().filter((hit) => hit.method === "PATCH");
  const sigWrites = writes().filter((hit) => hit.path === "/rest/v1/used_signatures");
  assert.equal(patches.length, 1);
  assert.equal(patches[0].body.allow_a_la_carte, false);
  assert.equal(sigWrites.length, 2);
  assert.equal(sigWrites[0].body[0].sig_hash, sha256Hex(body.aLaCarteSig.trim()));
  assert.equal(sigWrites[0].body[0].purpose, "a-la-carte");
  assert.equal(writes()[0].path, "/rest/v1/used_signatures");
  assert.equal(writes()[1].method, "PATCH");
});
