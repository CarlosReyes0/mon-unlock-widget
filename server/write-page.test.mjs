import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("write page is title + body + Publish, not an embed form", () => {
  const app = fs.readFileSync(path.join(ROOT, "src/publisher/WriteApp.tsx"), "utf8");
  const html = fs.readFileSync(path.join(ROOT, "write.html"), "utf8");
  assert.match(html, /Write — Open Paywall/);
  assert.match(app, /Publish/);
  assert.match(app, /Write, or paste/);
  assert.match(app, /\/articles\/\$\{encodeURIComponent\(slug\)\}/);
  assert.doesNotMatch(app, /articleId/);
  assert.doesNotMatch(app, /paymentAsset/);
  assert.doesNotMatch(app, /Copy full embed/);
  assert.match(app, /Sign out/);
  assert.match(app, /Free above · paid below/);
  assert.match(app, /locatePaywall/);
});

test("publishPost lists USDC posts on Open Paywall", () => {
  const src = fs.readFileSync(path.join(ROOT, "src/publisher/publish-post.ts"), "utf8");
  assert.match(src, /listOnOpenPaywall: true/);
  assert.match(src, /paymentAsset: "usdc"/);
  assert.match(src, /parseUnits\(PRICE_USDC, 6\)/);
  assert.match(src, /\/api\/relay\/register/);
  assert.match(src, /tryRelayRegister/);
  assert.match(src, /registerArticleFor|relayer_not_configured|fallback/);
});

test("publish sends registerArticle via eth_sendTransaction and checks MON for gas", () => {
  const src = fs.readFileSync(path.join(ROOT, "src/publisher/publish-post.ts"), "utf8");
  assert.match(src, /eth_sendTransaction/);
  assert.match(src, /getBalance/);
  assert.match(src, /Use a different wallet/);
  assert.doesNotMatch(src, /writeContract/);
  assert.match(src, /mapWalletSendToEthSend/);
});

test("publisher auth prefers a connected wallet over the Privy embedded wallet", () => {
  const auth = fs.readFileSync(path.join(ROOT, "src/publisher/PublisherAuth.tsx"), "utf8");
  assert.match(auth, /pickPublisherWallet/);
  assert.match(auth, /Use a different wallet/);
  assert.match(auth, /wantsEmbeddedWallet/);
  assert.match(auth, /mapWalletSendToEthSend/);
});
