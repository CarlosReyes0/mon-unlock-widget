/**
 * HTTP tests for optional article edition NFT. No live Base RPC, no mainnet mint.
 */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { test, after } from "node:test";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const PORT = 18840;

const child = spawn(process.execPath, ["server/index.mjs"], {
  cwd: ROOT,
  env: {
    ...process.env,
    PORT: String(PORT),
    ARTICLE_EDITION_NFT_CONTRACT: "",
    ARTICLE_EDITION_NFT_CHAIN_ID: "",
    SUPABASE_URL: "",
    SUPABASE_SERVICE_ROLE_KEY: "",
    CDP_API_KEY_ID: "",
    CDP_API_KEY_SECRET: "",
    STRIPE_SECRET_KEY: "",
    MPP_SECRET_KEY: "",
    RELAYER_PRIVATE_KEY: "",
  },
  stdio: ["ignore", "pipe", "pipe"],
});

await once(child.stdout, "data");

after(() => {
  child.kill("SIGTERM");
});

const origin = `http://127.0.0.1:${PORT}`;

test("GET /api/nft/health is unconfigured without a contract address", async () => {
  const res = await fetch(`${origin}/api/nft/health`);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.ok, true);
  assert.equal(body.configured, false);
  assert.equal(body.contract, null);
  assert.equal(body.chainId, 8453);
  assert.equal(body.unlockSeparate, true);
});

test("GET /api/nft/{id} is 503 without Supabase (no chain call)", async () => {
  const res = await fetch(`${origin}/api/nft/1`);
  assert.equal(res.status, 503);
  const body = await res.json();
  assert.equal(body.error, "supabase_not_configured");
});

test("GET /api/articles/{slug}/nft is 503 without Supabase", async () => {
  const res = await fetch(`${origin}/api/articles/demo-slug/nft`);
  assert.equal(res.status, 503);
  const body = await res.json();
  assert.equal(body.error, "supabase_not_configured");
});

test("POST /api/articles/{slug}/nft validates before any mint", async () => {
  const bad = await fetch(`${origin}/api/articles/demo-slug/nft`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ publisher: "not-an-address", tokenId: "1" }),
  });
  assert.equal(bad.status, 400);
  assert.equal((await bad.json()).error, "invalid_publisher");

  const unconfigured = await fetch(`${origin}/api/articles/demo-slug/nft`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      publisher: "0x1111111111111111111111111111111111111111",
      tokenId: "1",
    }),
  });
  assert.equal(unconfigured.status, 503);
  assert.equal((await unconfigured.json()).error, "nft_not_configured");
});

test("GET /api/agents/health includes articleNft and does not require mint", async () => {
  const res = await fetch(`${origin}/api/agents/health`);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.articleNft.configured, false);
  assert.equal(body.articleNft.unlockSeparate, true);
  assert.equal(body.articleEditionNft.configured, false);
  assert.equal(body.articleEditionNft.unlockSeparate, true);
});
