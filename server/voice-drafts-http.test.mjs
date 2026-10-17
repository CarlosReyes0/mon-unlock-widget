/**
 * HTTP tests for optional voice drafts. A local mock stands in for the LLM
 * — no live OpenAI/Anthropic spend in CI. Nothing posts to X.
 */
import assert from "node:assert/strict";
import http from "node:http";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { test, after } from "node:test";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { privateKeyToAccount } from "viem/accounts";
import { startMockRateLimitDb } from "./rate-limit-mock.mjs";
import { buildVoiceAuthMessage } from "./writer-mutation-auth.mjs";

const WRITER_KEY = "0xac0974bec39a17e36ba4a6b4d4aad435cce0e4c9335790421507b8a191e28881";
const CAP_KEY = "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d";
const RESTART_KEY = "0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6";
const writer = privateKeyToAccount(WRITER_KEY);
const capWriter = privateKeyToAccount(CAP_KEY);
const restartWriter = privateKeyToAccount(RESTART_KEY);

async function signedDraftAs(account, extra = {}) {
  const issuedAt = new Date().toISOString();
  const message = buildVoiceAuthMessage({ address: account.address, issuedAt });
  const signature = await account.signMessage({ message });
  return { address: account.address, issuedAt, signature, ...extra };
}

async function signedDraft(extra = {}) {
  return signedDraftAs(writer, extra);
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const APP_PORT = 18820;
const OFF_PORT = 18822;
const HIDDEN_PORT = 18823;
const CAP_PORT = 18824;
const MOCK_PORT = 18821;

const seen = [];
let mockMode = "ok";

const mock = http.createServer(async (req, res) => {
  const url = new URL(req.url || "/", `http://127.0.0.1:${MOCK_PORT}`);
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const rawBody = Buffer.concat(chunks).toString("utf8");
  seen.push({
    method: req.method,
    path: url.pathname,
    auth: req.headers.authorization || "",
    body: rawBody,
  });

  if (req.method === "POST" && url.pathname === "/v1/chat/completions") {
    if (mockMode === "error") {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "boom" }));
      return;
    }
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify({
        choices: [
          {
            message: {
              content: JSON.stringify({
                drafts: [
                  { text: "Walking home in the rain — rest is behind the fold." },
                  { text: "July rain walk is up if you want the rest." },
                  { text: "Fifty cents. That's the unlock." },
                ],
              }),
            },
          },
        ],
      })
    );
    return;
  }

  res.writeHead(404);
  res.end("nope");
});

await new Promise((resolve) => mock.listen(MOCK_PORT, "127.0.0.1", resolve));
const rateDb = await startMockRateLimitDb();
const downDb = await startMockRateLimitDb();
downDb.setFail(true);

function spawnApp(port, extraEnv = {}) {
  const child = spawn(process.execPath, ["server/index.mjs"], {
    cwd: ROOT,
    env: {
      ...process.env,
      PORT: String(port),
      SUPABASE_URL: rateDb.url,
      SUPABASE_SERVICE_ROLE_KEY: "service-role-test",
      VOICE_DRAFTS_VISIBLE: "true",
      VOICE_DRAFT_API_KEY: "sk-test-voice",
      VOICE_DRAFT_BASE_URL: `http://127.0.0.1:${MOCK_PORT}/v1`,
      OPENAI_API_KEY: "",
      ANTHROPIC_API_KEY: "",
      CDP_API_KEY_ID: "",
      CDP_API_KEY_SECRET: "",
      STRIPE_SECRET_KEY: "",
      MPP_SECRET_KEY: "",
      MPP_TEMPO_RECIPIENT: "",
      RELAYER_PRIVATE_KEY: "",
      BASE_BUILDER_CODE: "",
      MIROSHARK_X402_PRIVATE_KEY: "",
      ...extraEnv,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  children.push(child);
  return child;
}

const children = [];

const app = spawnApp(APP_PORT, { VOICE_DRAFT_DAILY_LIMIT: "20" });
const off = spawnApp(OFF_PORT, { VOICE_DRAFT_API_KEY: "", OPENAI_API_KEY: "", ANTHROPIC_API_KEY: "" });
const hidden = spawnApp(HIDDEN_PORT, { VOICE_DRAFTS_VISIBLE: "" });
const capped = spawnApp(CAP_PORT, { VOICE_DRAFT_DAILY_LIMIT: "1" });
await once(app.stdout, "data");
await once(off.stdout, "data");
await once(hidden.stdout, "data");
await once(capped.stdout, "data");

after(() => {
  for (const child of children) child.kill("SIGTERM");
  mock.close();
  rateDb.server.close();
  downDb.server.close();
});

const origin = `http://127.0.0.1:${APP_PORT}`;
const offOrigin = `http://127.0.0.1:${OFF_PORT}`;

test("GET /api/voice-drafts/status reports enabled without leaking the key", async () => {
  const res = await fetch(`${origin}/api/voice-drafts/status`);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.enabled, true);
  assert.equal(body.visible, true);
  assert.equal(body.draftsOnly, true);
  assert.equal(body.autopost, false);
  assert.equal(body.provider, "openai");
  assert.equal(JSON.stringify(body).includes("sk-test-voice"), false);
});

test("GET /api/agents/health includes voice draft status", async () => {
  const res = await fetch(`${origin}/api/agents/health`);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.voiceDrafts.enabled, true);
  assert.equal(body.voiceDrafts.autopost, false);
});

test("POST /api/voice-drafts returns 2–3 drafts from the mocked LLM", async () => {
  seen.length = 0;
  mockMode = "ok";
  const res = await fetch(`${origin}/api/voice-drafts`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(
      await signedDraft({
        samples: ["Walking home in the rain. That's the post."],
        notes: "Dry. Short.",
        title: "July rain walk",
        body: "Walking home in the rain.\n---\nPaid rest.",
      })
    ),
  });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.ok, true);
  assert.equal(body.draftsOnly, true);
  assert.equal(body.autopost, false);
  assert.equal(body.drafts.length, 3);
  assert.match(body.drafts[0].text, /Walking home/);
  assert.equal(seen.length, 1);
  assert.equal(seen[0].path, "/v1/chat/completions");
  assert.match(seen[0].body, /DRAFTS ONLY/);
  assert.match(seen[0].body, /Dry\. Short/);
  assert.doesNotMatch(seen[0].path, /tweets|statuses\/update/i);
});

test("POST /api/voice-drafts fail-softs when the LLM errors", async () => {
  mockMode = "error";
  const res = await fetch(`${origin}/api/voice-drafts`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(await signedDraft({ samples: ["sample"], title: "Hi" })),
  });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.ok, false);
  assert.equal(body.code, "llm_error");
  assert.match(body.message, /Nothing was posted/);
  mockMode = "ok";
});

test("hidden voice drafts still require auth before the flag", async () => {
  const before = seen.length;
  const status = await fetch(`http://127.0.0.1:${HIDDEN_PORT}/api/voice-drafts/status`);
  const statusBody = await status.json();
  assert.equal(statusBody.visible, false);
  assert.equal(statusBody.enabled, false);
  assert.equal(statusBody.provider, null);

  const unsigned = await fetch(`http://127.0.0.1:${HIDDEN_PORT}/api/voice-drafts`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ samples: ["sample"], title: "Hi" }),
  });
  assert.equal(unsigned.status, 401);
  const denied = await unsigned.json();
  assert.equal(denied.code, "unauthorized");
  assert.equal(seen.length, before);

  const res = await fetch(`http://127.0.0.1:${HIDDEN_PORT}/api/voice-drafts`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(await signedDraft({ samples: ["sample"], title: "Hi" })),
  });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.ok, false);
  assert.equal(body.code, "hidden");
  assert.equal(body.visible, false);
  assert.equal(seen.length, before);
});

test("POST /api/voice-drafts without a key is HTTP 200 missing_api_key", async () => {
  const unsigned = await fetch(`${offOrigin}/api/voice-drafts`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ samples: ["sample"], title: "Hi" }),
  });
  assert.equal(unsigned.status, 401);
  const res = await fetch(`${offOrigin}/api/voice-drafts`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(await signedDraft({ samples: ["sample"], title: "Hi" })),
  });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.ok, false);
  assert.equal(body.code, "missing_api_key");
  assert.equal(body.autopost, false);
});

test("POST /api/voice-drafts returns 429 over the daily cap", async () => {
  const first = await fetch(`http://127.0.0.1:${CAP_PORT}/api/voice-drafts`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(await signedDraftAs(capWriter, { samples: ["sample"], title: "Hi" })),
  });
  assert.equal(first.status, 200);
  const second = await fetch(`http://127.0.0.1:${CAP_PORT}/api/voice-drafts`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(
      await signedDraftAs(capWriter, { samples: ["sample"], title: "cap-second-should-not-call" })
    ),
  });
  assert.equal(second.status, 429);
  const body = await second.json();
  assert.equal(body.code, "rate_limited");
  assert.equal(body.autopost, false);
  assert.equal(seen.filter((entry) => entry.body.includes("cap-second-should-not-call")).length, 0);
});

test("voice daily cap holds after a new process uses the same database", async () => {
  const marker = "restart-second-should-not-call";
  const first = spawnApp(18840, { VOICE_DRAFT_DAILY_LIMIT: "1" });
  await once(first.stdout, "data");
  const ok = await fetch("http://127.0.0.1:18840/api/voice-drafts", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(await signedDraftAs(restartWriter, { samples: ["sample"], title: "First life" })),
  });
  assert.equal(ok.status, 200);
  first.kill("SIGTERM");
  await once(first, "exit");

  const second = spawnApp(18841, { VOICE_DRAFT_DAILY_LIMIT: "1" });
  await once(second.stdout, "data");
  const limited = await fetch("http://127.0.0.1:18841/api/voice-drafts", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(await signedDraftAs(restartWriter, { samples: ["sample"], title: marker })),
  });
  assert.equal(limited.status, 429);
  const body = await limited.json();
  assert.equal(body.code, "rate_limited");
  assert.equal(seen.filter((entry) => entry.body.includes(marker)).length, 0);
  second.kill("SIGTERM");
  await once(second, "exit");
});

test("POST /api/voice-drafts returns 503 and skips the model when the database errors", async () => {
  const marker = "db-down-should-not-call";
  const child = spawnApp(18842, { SUPABASE_URL: downDb.url, VOICE_DRAFT_DAILY_LIMIT: "8" });
  await once(child.stdout, "data");
  const res = await fetch("http://127.0.0.1:18842/api/voice-drafts", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(await signedDraft({ samples: ["sample"], title: marker })),
  });
  assert.equal(res.status, 503);
  const body = await res.json();
  assert.equal(body.code, "rate_limit_unavailable");
  assert.equal(body.autopost, false);
  assert.equal(seen.filter((entry) => entry.body.includes(marker)).length, 0);
  child.kill("SIGTERM");
  await once(child, "exit");
});

test("GET /api/voice-drafts/status without a key is disabled", async () => {
  const res = await fetch(`${offOrigin}/api/voice-drafts/status`);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.enabled, false);
  assert.match(body.message, /VOICE_DRAFT_API_KEY/);
});
