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
  assert.match(app, /Add image, audio, or video/);
  assert.match(app, /snippetFromPastedText/);
  assert.match(app, /WriteMediaSheet/);
  assert.match(app, /We don’t host files yet/);
  assert.match(app, /\/articles\/\$\{encodeURIComponent\(slug\)\}/);
  assert.doesNotMatch(app, /articleId/);
  assert.doesNotMatch(app, /paymentAsset/);
  assert.doesNotMatch(app, /Copy full embed/);
  assert.match(app, /Sign out/);
  assert.match(app, /preferredSlug: reservedSlug/);
  assert.match(app, /onSlugReserved: setReservedSlug/);
  assert.match(app, /reservedSlug/);
  assert.match(app, /Free above · paid below/);
  assert.match(app, /locatePaywall/);
  assert.match(app, /MirosharkPreview/);
  assert.match(app, /VoiceDrafts/);
  const publishStart = app.indexOf("async function onPublish");
  const publishEnd = app.indexOf("return (", publishStart);
  assert.ok(publishStart >= 0 && publishEnd > publishStart);
  const publishFn = app.slice(publishStart, publishEnd);
  assert.doesNotMatch(publishFn, /MirosharkPreview|\/api\/miroshark/);
  assert.doesNotMatch(publishFn, /VoiceDrafts|\/api\/voice-drafts/);
});

test("Miroshark preview is optional and fail-soft", () => {
  const preview = fs.readFileSync(path.join(ROOT, "src/publisher/MirosharkPreview.tsx"), "utf8");
  assert.match(preview, /\/api\/miroshark\/preview/);
  assert.match(preview, /\/api\/miroshark\/status/);
  assert.match(preview, /Publish still works/);
  assert.match(preview, /BASE_BUILDER_CODE/);
  assert.doesNotMatch(preview, /onPublish/);
});

test("voice drafts are optional, drafts-only, and never post", () => {
  const voice = fs.readFileSync(path.join(ROOT, "src/publisher/VoiceDrafts.tsx"), "utf8");
  const docs = fs.readFileSync(path.join(ROOT, "VOICE_DRAFTS.md"), "utf8");
  assert.match(voice, /\/api\/voice-drafts/);
  assert.match(voice, /Drafts only/);
  assert.match(voice, /Nothing posts from here/);
  assert.match(voice, /Use as reply seed/);
  assert.match(voice, /mon-write__media-btn/);
  assert.match(voice, /openpaywall-voice-samples/);
  assert.doesNotMatch(voice, /Post to X/);
  assert.doesNotMatch(voice, /\/2\/tweets/);
  assert.doesNotMatch(voice, /onPublish/);
  assert.match(docs, /Autopost is future work|out of scope/i);
  assert.match(docs, /VOICE_DRAFT_API_KEY/);
});

test("publishPost lists USDC posts on Open Paywall", () => {
  const src = fs.readFileSync(path.join(ROOT, "src/publisher/publish-post.ts"), "utf8");
  assert.match(src, /listOnOpenPaywall: true/);
  assert.match(src, /paymentAsset: "usdc"/);
  assert.match(src, /parseUnits\(PRICE_USDC, 6\)/);
  assert.match(src, /\/api\/relay\/register/);
  assert.match(src, /tryRelayRegister/);
  assert.match(src, /registerArticleFor|relayer_not_configured|fallback/);
  assert.match(src, /preferredSlug/);
  assert.match(src, /onSlugReserved/);
  assert.match(src, /nextPublishSlug/);
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

test("write media sheet inserts URL snippets without hosting files", () => {
  const sheet = fs.readFileSync(path.join(ROOT, "src/publisher/WriteMediaSheet.tsx"), "utf8");
  assert.match(sheet, /Add image, audio, or video/);
  assert.match(sheet, /validateMediaUrl/);
  assert.match(sheet, /id: "audio"/);
  assert.match(sheet, /YouTube, Vimeo, and Loom/);
});

test("widget sanitizes HTML teasers and does not dump paid body on the hosted page", () => {
  const widget = fs.readFileSync(path.join(ROOT, "src/widget/mon-unlock.ts"), "utf8");
  const articlePage = fs.readFileSync(path.join(ROOT, "article.html"), "utf8");
  assert.match(widget, /slotPreview/);
  assert.match(widget, /renderTeaser/);
  assert.match(widget, /sanitizeRichHtml/);
  assert.match(articlePage, /teaser\.textContent/);
  assert.match(articlePage, /Body intentionally omitted/);
});
