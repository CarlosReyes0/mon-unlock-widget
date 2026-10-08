/**
 * POST /api/writers/plan and POST /api/articles/a-la-carte require the
 * owning publisher's EIP-191 signature. Rejected requests must not reach
 * Supabase. Publish and listing do not timestamp signatures, so a signature
 * is rejected when it is replayed onto a different change, and the same
 * signed payload can be submitted again.
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
import {
  buildALaCarteAuthMessage as serverALaCarteMessage,
  buildPlanAuthMessage as serverPlanMessage,
} from "./writer-mutation-auth.mjs";
import {
  buildALaCarteAuthMessage as clientALaCarteMessage,
  buildPlanAuthMessage as clientPlanMessage,
} from "../dist/core/publish-auth.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const APP_PORT = 18786;
const SB_PORT = 18787;
const SLUG = "july-rain";

const OWNER_KEY = "0xac0974bec39a17e36ba4a6b4d4aad435cce0e4c9335790421507b8a191e28881";
const OTHER_KEY = "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d";
const owner = privateKeyToAccount(OWNER_KEY);
const other = privateKeyToAccount(OTHER_KEY);

const hits = [];
let articlePublisher = owner.address.toLowerCase();

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
  env: {
    ...process.env,
    PORT: String(APP_PORT),
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
});

const origin = `http://127.0.0.1:${APP_PORT}`;

function resetDb() {
  hits.length = 0;
  articlePublisher = owner.address.toLowerCase();
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

test("client and server sign the same plan and a-la-carte messages", () => {
  const plan = {
    publisher: owner.address.toUpperCase(),
    monthlyPriceCents: 500,
    allowALaCarte: false,
  };
  const article = {
    articleId: SLUG,
    publisher: owner.address,
    allowALaCarte: true,
  };
  assert.equal(serverPlanMessage(plan), clientPlanMessage(plan));
  assert.equal(serverALaCarteMessage(article), clientALaCarteMessage(article));
});

test("dashboard and account UI sign plan and a-la-carte updates", () => {
  const dashboard = fs.readFileSync(path.join(ROOT, "dashboard.html"), "utf8");
  const account = fs.readFileSync(path.join(ROOT, "src/publisher/PublisherApp.tsx"), "utf8");
  const articles = fs.readFileSync(path.join(ROOT, "src/publisher/AccountArticles.tsx"), "utf8");
  assert.match(dashboard, /buildPlanAuthMessage/);
  assert.match(dashboard, /planSig/);
  assert.match(dashboard, /buildALaCarteAuthMessage/);
  assert.match(dashboard, /aLaCarteSig/);
  assert.match(account, /buildPlanAuthMessage/);
  assert.match(account, /planSig/);
  assert.match(articles, /buildALaCarteAuthMessage/);
  assert.match(articles, /aLaCarteSig/);
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
    planSig: "not-a-signature",
  });
  assert.equal(res.status, 401);
  assert.equal(res.body.error, "unauthorized");
  assert.equal(hits.length, 0);
});

test("POST /api/writers/plan rejects a signature from a different wallet", async () => {
  resetDb();
  const message = serverPlanMessage({
    publisher: owner.address,
    monthlyPriceCents: 900,
    allowALaCarte: false,
  });
  const planSig = await other.signMessage({ message });
  const res = await post("/api/writers/plan", {
    publisher: owner.address,
    monthlyPriceCents: 900,
    allowALaCarte: false,
    planSig,
  });
  assert.equal(res.status, 403);
  assert.equal(res.body.error, "forbidden");
  assert.equal(hits.length, 0);
});

test("POST /api/writers/plan rejects a signature replayed for a different price or flag", async () => {
  resetDb();
  const message = serverPlanMessage({
    publisher: owner.address,
    monthlyPriceCents: 500,
    allowALaCarte: true,
  });
  const planSig = await owner.signMessage({ message });
  const otherPrice = await post("/api/writers/plan", {
    publisher: owner.address,
    monthlyPriceCents: 900,
    allowALaCarte: true,
    planSig,
  });
  const otherFlag = await post("/api/writers/plan", {
    publisher: owner.address,
    monthlyPriceCents: 500,
    allowALaCarte: false,
    planSig,
  });
  assert.equal(otherPrice.status, 403);
  assert.equal(otherFlag.status, 403);
  assert.equal(hits.length, 0);
});

test("POST /api/writers/plan accepts the owning publisher signature and can be repeated", async () => {
  resetDb();
  const body = {
    publisher: owner.address,
    monthlyPriceCents: 900,
    allowALaCarte: false,
  };
  const planSig = await owner.signMessage({ message: serverPlanMessage(body) });
  const first = await post("/api/writers/plan", { ...body, planSig });
  assert.equal(first.status, 200, JSON.stringify(first.body));
  assert.equal(first.body.plan.allowALaCarte, false);
  assert.equal(first.body.plan.monthlyPriceCents, 900);
  assert.equal(first.body.plan.publisher, owner.address.toLowerCase());
  const second = await post("/api/writers/plan", { ...body, planSig });
  assert.equal(second.status, 200);
  assert.equal(writes().length, 2);
  assert.equal(writes()[0].path, "/rest/v1/writer_plans");
  assert.equal(writes()[0].body[0].allow_a_la_carte, false);
  assert.equal(writes()[0].body[0].monthly_price_cents, 900);
  assert.equal(writes()[0].body[0].publisher, owner.address.toLowerCase());
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
    aLaCarteSig: "not-a-signature",
  });
  assert.equal(res.status, 401);
  assert.equal(hits.length, 0);
});

test("POST /api/articles/a-la-carte rejects a signature from a different wallet", async () => {
  resetDb();
  const message = serverALaCarteMessage({
    articleId: SLUG,
    publisher: owner.address,
    allowALaCarte: false,
  });
  const aLaCarteSig = await other.signMessage({ message });
  const res = await post("/api/articles/a-la-carte", {
    articleId: SLUG,
    publisher: owner.address,
    allowALaCarte: false,
    aLaCarteSig,
  });
  assert.equal(res.status, 403);
  assert.equal(res.body.error, "forbidden");
  assert.equal(hits.length, 0);
});

test("POST /api/articles/a-la-carte rejects a signature replayed for another article or flag", async () => {
  resetDb();
  const message = serverALaCarteMessage({
    articleId: SLUG,
    publisher: owner.address,
    allowALaCarte: true,
  });
  const aLaCarteSig = await owner.signMessage({ message });
  const otherArticle = await post("/api/articles/a-la-carte", {
    articleId: "other-piece",
    publisher: owner.address,
    allowALaCarte: true,
    aLaCarteSig,
  });
  const otherFlag = await post("/api/articles/a-la-carte", {
    articleId: SLUG,
    publisher: owner.address,
    allowALaCarte: false,
    aLaCarteSig,
  });
  assert.equal(otherArticle.status, 403);
  assert.equal(otherFlag.status, 403);
  assert.equal(writes().length, 0);
  assert.equal(hits.length, 0);
});

test("POST /api/articles/a-la-carte rejects the signer when they do not own the article", async () => {
  resetDb();
  articlePublisher = other.address.toLowerCase();
  const body = {
    articleId: SLUG,
    publisher: owner.address,
    allowALaCarte: false,
  };
  const aLaCarteSig = await owner.signMessage({ message: serverALaCarteMessage(body) });
  const res = await post("/api/articles/a-la-carte", { ...body, aLaCarteSig });
  assert.equal(res.status, 403);
  assert.equal(res.body.error, "forbidden");
  assert.equal(writes().length, 0);
  assert.equal(hits.length, 1);
  assert.equal(hits[0].method, "GET");
});

test("POST /api/articles/a-la-carte accepts the owning publisher signature", async () => {
  resetDb();
  const body = {
    articleId: SLUG,
    publisher: owner.address,
    allowALaCarte: false,
  };
  const aLaCarteSig = await owner.signMessage({ message: serverALaCarteMessage(body) });
  const res = await post("/api/articles/a-la-carte", { ...body, aLaCarteSig });
  assert.equal(res.status, 200, `${JSON.stringify(res.body)}\n${serverLog}`);
  assert.equal(res.body.articleId, SLUG);
  assert.equal(res.body.allowALaCarte, false);
  assert.equal(writes().length, 1);
  assert.equal(writes()[0].method, "PATCH");
  assert.equal(writes()[0].body.allow_a_la_carte, false);
});
