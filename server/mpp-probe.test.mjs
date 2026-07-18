/**
 * Registry probes often POST with an empty/invalid body. Those must still 402.
 */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { test, after } from "node:test";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const PORT = 18768;

const child = spawn(process.execPath, ["server/index.mjs"], {
  cwd: ROOT,
  env: {
    ...process.env,
    PORT: String(PORT),
    CDP_API_KEY_ID: "",
    CDP_API_KEY_SECRET: "",
    STRIPE_SECRET_KEY: "",
    MPP_DEV_BYPASS: "",
    MPP_SECRET_KEY: "abcdefghijklmnopqrstuvwxyz0123456789ABCD",
    MPP_TEMPO_RECIPIENT: "0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb0",
    MPP_REALM: "mon-unlock-widget-production.up.railway.app",
    RAILWAY_PUBLIC_DOMAIN: "",
  },
  stdio: ["ignore", "pipe", "pipe"],
});

await once(child.stdout, "data");

after(() => {
  child.kill("SIGTERM");
});

test("empty POST /api/agents/publish returns 402 with WWW-Authenticate", async () => {
  const res = await fetch(`http://127.0.0.1:${PORT}/api/agents/publish`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "{}",
  });
  assert.equal(res.status, 402);
  const www = res.headers.get("www-authenticate") || "";
  assert.match(www, /Payment/i);
  assert.match(www, /method="tempo"/i);
  assert.match(
    www,
    /realm="mon-unlock-widget-production\.up\.railway\.app"/i
  );
  // Both tempo + stripe challenges must include recipient (mppscan warning).
  const requests = [...www.matchAll(/request="([^"]+)"/g)].map((m) => {
    const pad = m[1] + "=".repeat((4 - (m[1].length % 4)) % 4);
    return JSON.parse(Buffer.from(pad, "base64url").toString("utf8"));
  });
  assert.ok(requests.length >= 1);
  for (const req of requests) {
    assert.equal(typeof req.recipient, "string");
    assert.match(req.recipient, /^0x[a-fA-F0-9]{40}$/);
  }
});

test("POST with no body returns 402", async () => {
  const res = await fetch(`http://127.0.0.1:${PORT}/api/agents/publish`, {
    method: "POST",
  });
  assert.equal(res.status, 402);
  assert.match(res.headers.get("www-authenticate") || "", /Payment/i);
});
