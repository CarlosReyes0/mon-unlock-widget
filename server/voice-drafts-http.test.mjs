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
import { buildVoiceAuthMessage } from "./writer-mutation-auth.mjs";

const WRITER_KEY = "0xac0974bec39a17e36ba4a6b4d4aad435cce0e4c9335790421507b8a191e28881";
const writer = privateKeyToAccount(WRITER_KEY);

async function signedDraft(extra = {}) {
  const issuedAt = new Date().toISOString();
  const message = buildVoiceAuthMessage({ address: writer.address, issuedAt });
  const signature = await writer.signMessage({ message });
  return { address: writer.address, issuedAt, signature, ...extra };
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

function spawnApp(port, extraEnv = {}) {
  return spawn(process.execPath, ["server/index.mjs"], {
    cwd: ROOT,
    env: {
      ...process.env,
      PORT: String(port),
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
}

const app = spawnApp(APP_PORT, { VOICE_DRAFT_DAILY_LIMIT: "20" });
const off = spawnApp(OFF_PORT, { VOICE_DRAFT_API_KEY: "", OPENAI_API_KEY: "", ANTHROPIC_API_KEY: "" });
const hidden = spawnApp(HIDDEN_PORT, { VOICE_DRAFTS_VISIBLE: "" });
const capped = spawnApp(CAP_PORT, { VOICE_DRAFT_DAILY_LIMIT: "1" });
await once(app.stdout, "data");
await once(off.stdout, "data");
await once(hidden.stdout, "data");
await once(capped.stdout, "data");

after(() => {
  app.kill("SIGTERM");
  off.kill("SIGTERM");
  hidden.kill("SIGTERM");
  capped.kill("SIGTERM");
  mock.close();
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
    body: JSON.stringify(await signedDraft({ samples: ["sample"], title: "Hi" })),
  });
  assert.equal(first.status, 200);
  const second = await fetch(`http://127.0.0.1:${CAP_PORT}/api/voice-drafts`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(await signedDraft({ samples: ["sample"], title: "Again" })),
  });
  assert.equal(second.status, 429);
  const body = await second.json();
  assert.equal(body.code, "rate_limited");
  assert.equal(body.autopost, false);
});

test("GET /api/voice-drafts/status without a key is disabled", async () => {
  const res = await fetch(`${offOrigin}/api/voice-drafts/status`);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.enabled, false);
  assert.match(body.message, /VOICE_DRAFT_API_KEY/);
});
