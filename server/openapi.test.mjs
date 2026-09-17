import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { test, after } from "node:test";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildOpenApiDocument } from "./openapi.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const PORT = 18769;
const RECIPIENT = "0x340f0aAAE5A6FB14B37F55De96EF429f08B6659F";

test("buildOpenApiDocument uses MPPscan protocols object shape", () => {
  process.env.MPP_TEMPO_RECIPIENT = RECIPIENT;
  process.env.MPP_PUBLISH_AMOUNT = "0.05";
  const doc = buildOpenApiDocument();
  const pay = doc.paths["/api/agents/publish"].post["x-payment-info"];
  assert.ok(Array.isArray(pay.protocols));
  assert.equal(typeof pay.protocols[0].mpp, "object");
  assert.equal(pay.protocols[0].mpp.method, "tempo");
  assert.equal(pay.protocols[0].mpp.recipient, RECIPIENT);
  assert.equal(pay.protocols[0].mpp.amount, "50000");
  assert.equal(pay.protocols[0].mpp.chainId, 4217);
});

test("buildOpenApiDocument includes x402 publish path", () => {
  process.env.X402_PAY_TO = RECIPIENT;
  process.env.X402_PUBLISH_AMOUNT = "0.05";
  const doc = buildOpenApiDocument();
  const pay = doc.paths["/api/x402/publish"].post["x-payment-info"];
  assert.equal(pay.protocols[0].x402.network, "base");
  assert.equal(pay.protocols[0].x402.chainId, 8453);
  assert.equal(pay.protocols[0].x402.recipient, RECIPIENT);
  assert.ok(doc.paths["/api/x402/unlock"]);
  assert.ok(doc.paths["/api/x402/articles/{slug}"]);
  assert.ok(doc.paths["/api/miroshark/preview"]);
  assert.ok(doc.paths["/api/miroshark/status"]);
  assert.ok(doc.paths["/api/voice-drafts"]);
  assert.ok(doc.paths["/api/voice-drafts/status"]);
});

const child = spawn(process.execPath, ["server/index.mjs"], {
  cwd: ROOT,
  env: {
    ...process.env,
    PORT: String(PORT),
    MPP_TEMPO_RECIPIENT: RECIPIENT,
    MPP_SECRET_KEY: "abcdefghijklmnopqrstuvwxyz0123456789ABCD",
    MPP_PUBLISH_AMOUNT: "0.05",
    STRIPE_SECRET_KEY: "",
    MPP_DEV_BYPASS: "",
  },
  stdio: ["ignore", "pipe", "pipe"],
});

await once(child.stdout, "data");

after(() => {
  child.kill("SIGTERM");
});

test("GET /openapi.json is served dynamically with mpp protocol object", async () => {
  const res = await fetch(`http://127.0.0.1:${PORT}/openapi.json`);
  assert.equal(res.status, 200);
  const doc = await res.json();
  const pay = doc.paths["/api/agents/publish"].post["x-payment-info"];
  assert.equal(pay.protocols[0].mpp.recipient, RECIPIENT);
  assert.equal(doc.info.version, "1.2.0");
});
