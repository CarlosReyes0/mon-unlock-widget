/**
 * Publish path with MPP_DEV_BYPASS (no real Tempo/Stripe payment).
 */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { test, after } from "node:test";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const PORT = 18766;

const child = spawn(process.execPath, ["server/index.mjs"], {
  cwd: ROOT,
  env: {
    ...process.env,
    PORT: String(PORT),
    CDP_API_KEY_ID: "",
    CDP_API_KEY_SECRET: "",
    STRIPE_SECRET_KEY: "",
    MPP_DEV_BYPASS: "1",
    MPP_SECRET_KEY: "",
    MPP_TEMPO_RECIPIENT: "",
  },
  stdio: ["ignore", "pipe", "pipe"],
});

await once(child.stdout, "data");

after(() => {
  child.kill("SIGTERM");
});

test("POST /api/agents/publish succeeds with MPP_DEV_BYPASS", async () => {
  const res = await fetch(`http://127.0.0.1:${PORT}/api/agents/publish`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      title: "Bypass demo",
      articleId: `bypass-${Date.now()}`,
      teaser: "Preview text",
      body: "Full article body for agent publish bypass test.",
      publisher: "0x1111111111111111111111111111111111111111",
      price: "1",
      author: "Agent",
    }),
  });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.ok, true);
  assert.match(body.embed, /<mon-unlock/);
  assert.doesNotMatch(body.embed, /embed-sig=/);
  assert.equal(body.needsManualOnChainRegistration, true);
  assert.match(body.finishRegistrationUrl, /register\.html\?/);
  assert.match(body.finishRegistrationUrl, /title=Bypass(\+|%20)demo/);
  assert.match(body.finishRegistrationUrl, /teaser=Preview(\+|%20)text/);
  assert.ok(body.nextSteps.some((s) => /Copy signed embed/i.test(s)));
});
