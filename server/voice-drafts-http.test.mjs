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

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const APP_PORT = 18820;
const OFF_PORT = 18822;
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

const app = spawnApp(APP_PORT);
const off = spawnApp(OFF_PORT, { VOICE_DRAFT_API_KEY: "", OPENAI_API_KEY: "", ANTHROPIC_API_KEY: "" });
await once(app.stdout, "data");
await once(off.stdout, "data");

after(() => {
  app.kill("SIGTERM");
  off.kill("SIGTERM");
  mock.close();
});

const origin = `http://127.0.0.1:${APP_PORT}`;
const offOrigin = `http://127.0.0.1:${OFF_PORT}`;

test("GET /api/voice-drafts/status reports enabled without leaking the key", async () => {
  const res = await fetch(`${origin}/api/voice-drafts/status`);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.enabled, true);
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
    body: JSON.stringify({
      samples: ["Walking home in the rain. That's the post."],
      notes: "Dry. Short.",
      title: "July rain walk",
      body: "Walking home in the rain.\n---\nPaid rest.",
    }),
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
    body: JSON.stringify({ samples: ["sample"], title: "Hi" }),
  });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.ok, false);
  assert.equal(body.code, "llm_error");
  assert.match(body.message, /Nothing was posted/);
  mockMode = "ok";
});

test("POST /api/voice-drafts without a key is HTTP 200 missing_api_key", async () => {
  const res = await fetch(`${offOrigin}/api/voice-drafts`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ samples: ["sample"], title: "Hi" }),
  });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.ok, false);
  assert.equal(body.code, "missing_api_key");
  assert.equal(body.autopost, false);
});

test("GET /api/voice-drafts/status without a key is disabled", async () => {
  const res = await fetch(`${offOrigin}/api/voice-drafts/status`);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.enabled, false);
  assert.match(body.message, /VOICE_DRAFT_API_KEY/);
});
