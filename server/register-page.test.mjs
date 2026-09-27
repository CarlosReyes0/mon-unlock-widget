/**
 * Smoke checks for the agent finish-registration page + publish handoff.
 * Wallet signing itself requires MetaMask and is out of scope here.
 */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { test, after } from "node:test";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { generateEmbed } from "./publish.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const PORT = 8791;

const child = spawn(process.execPath, ["server/index.mjs"], {
  cwd: ROOT,
  env: {
    ...process.env,
    PORT: String(PORT),
    MPP_DEV_BYPASS: "1",
    CDP_API_KEY_ID: "",
    CDP_API_KEY_SECRET: "",
    STRIPE_SECRET_KEY: "",
    MPP_SECRET_KEY: "",
    MPP_TEMPO_RECIPIENT: "",
  },
  stdio: ["ignore", "pipe", "pipe"],
});

await once(child.stdout, "data");

after(() => {
  child.kill("SIGTERM");
});

test("register.html exposes Copy signed embed UI", async () => {
  const res = await fetch(`http://127.0.0.1:${PORT}/register.html`);
  assert.equal(res.status, 200);
  const html = await res.text();
  assert.match(html, /Copy signed embed/);
  assert.match(html, /id="copyEmbedBtn"/);
  assert.match(html, /id="embedBox"/);
  assert.match(html, /function buildSignedEmbed/);
  assert.match(html, /function showSignedEmbed/);
  assert.match(html, /Approve the embed signature/);
  assert.match(html, /tryRelayRegister/);
  assert.match(html, /\/api\/relay\/register/);
  // Literal </script> inside the inline module would truncate the page script in browsers.
  // The server may stamp a CSP nonce onto the tag: <script nonce="…" type="module">.
  const open = html.match(/<script\b(?![^>]*\bsrc\s*=)[^>]*type="module"[^>]*>/);
  assert.ok(open, "inline module script");
  const moduleStart = open.index;
  assert.ok(moduleStart > 0);
  const afterModule = html.slice(moduleStart + open[0].length);
  const firstClose = afterModule.indexOf("</script>");
  const moduleBody = afterModule.slice(0, firstClose);
  assert.match(moduleBody, /scriptClose/);
  assert.doesNotMatch(moduleBody, /<\/script>/);
});

test("publish finish URL carries meta for signed embed rebuild", async () => {
  const res = await fetch(`http://127.0.0.1:${PORT}/api/agents/publish`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      title: "Rain Walk",
      articleId: `rain-walk-${Date.now()}`,
      teaser: "Walking home",
      body: "Full body for register handoff test.",
      publisher: "0x2222222222222222222222222222222222222222",
      price: "2",
      paymentAsset: "mon",
      author: "Carlos",
    }),
  });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.ok, true);
  assert.doesNotMatch(body.embed, /embed-sig=/);
  assert.match(body.embed, /payment-asset="mon"/);

  const url = new URL(body.finishRegistrationUrl);
  assert.equal(url.pathname.endsWith("/register.html"), true);
  assert.ok(url.searchParams.get("slug")?.startsWith("rain-walk-"));
  assert.equal(url.searchParams.get("price"), "2");
  assert.equal(url.searchParams.get("paymentAsset"), "mon");
  assert.equal(url.searchParams.get("title"), "Rain Walk");
  assert.equal(url.searchParams.get("author"), "Carlos");
  assert.equal(url.searchParams.get("teaser"), "Walking home");
  assert.ok(body.nextSteps.some((s) => /Copy signed embed/i.test(s)));
});

test("publish defaults to USDC $0.50 embed when paymentAsset and price omitted", async () => {
  const res = await fetch(`http://127.0.0.1:${PORT}/api/agents/publish`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      title: "Default USDC",
      articleId: `usdc-default-${Date.now()}`,
      teaser: "Preview",
      body: "Full body.",
      publisher: "0x2222222222222222222222222222222222222222",
    }),
  });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.paymentAsset, "usdc");
  assert.equal(body.price, "0.50");
  assert.match(body.embed, /payment-asset="usdc"/);
  assert.match(body.embed, /price="0\.50"/);
  assert.match(body.embed, /unlock-contract="0xd66Df017335ae80BcE5d4Ec728421f3a3DAf6f9f"/);

  const url = new URL(body.finishRegistrationUrl);
  assert.equal(url.searchParams.get("paymentAsset"), "usdc");
  assert.equal(url.searchParams.get("price"), "0.50");
});

test("signed generateEmbed matches what register page should produce", () => {
  const signed = generateEmbed(
    {
      title: "Rain Walk",
      articleId: "rain-walk",
      teaser: "Walking home",
      author: "Carlos",
      price: "2",
      paymentAsset: "mon",
    },
    "0xdeadbeef",
  );
  assert.match(signed, /article-id="rain-walk"/);
  assert.match(signed, /title="Rain Walk"/);
  assert.match(signed, /author="Carlos"/);
  assert.match(signed, /price="2"/);
  assert.match(signed, /payment-asset="mon"/);
  assert.match(signed, /embed-sig="0xdeadbeef"/);
  assert.match(signed, /Walking home/);
});
