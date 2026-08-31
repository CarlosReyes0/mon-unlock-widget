import assert from "node:assert/strict";
import { test } from "node:test";
import {
  validatePublishInput,
  generateEmbed,
  buildFinishRegistrationUrl,
  toArticleIdHash,
  toPriceWei,
  slugFromTitle,
  uniqueSlugFromTitle,
  uniqueSlugSuffix,
  parsePublishPaste,
  formatPublishPaste,
  MAINNET_USDC_CONTRACT,
  MAINNET_MON_CONTRACT,
} from "./publish.mjs";

test("validatePublishInput requires core fields", () => {
  const result = validatePublishInput({});
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => e.includes("title")));
});

test("validatePublishInput accepts a good payload", () => {
  const result = validatePublishInput({
    title: "Hello",
    articleId: "hello-world",
    teaser: "Teaser",
    body: "Body",
    publisher: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    price: "2",
  });
  assert.equal(result.ok, true);
  assert.equal(result.input.articleId, "hello-world");
  assert.equal(result.input.paymentAsset, "usdc");
  assert.equal(result.input.price, "2");
});

test("validatePublishInput defaults to USDC $0.50 when price and paymentAsset omitted", () => {
  const result = validatePublishInput({
    title: "Hello",
    articleId: "hello-world",
    teaser: "Teaser",
    body: "Body",
    publisher: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  });
  assert.equal(result.ok, true);
  assert.equal(result.input.paymentAsset, "usdc");
  assert.equal(result.input.price, "0.50");
});

test("validatePublishInput accepts explicit MON with default price 1", () => {
  const result = validatePublishInput({
    title: "Hello",
    articleId: "hello-world",
    teaser: "Teaser",
    body: "Body",
    publisher: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    paymentAsset: "mon",
  });
  assert.equal(result.ok, true);
  assert.equal(result.input.paymentAsset, "mon");
  assert.equal(result.input.price, "1");
});

test("toPriceWei uses 6 decimals for USDC and 18 for MON", () => {
  assert.equal(toPriceWei("0.50", "usdc"), "500000");
  assert.equal(toPriceWei("1", "mon"), "1000000000000000000");
});

test("generateEmbed defaults to USDC contract and payment-asset", () => {
  const html = generateEmbed({
    title: "Hello",
    articleId: "hello-world",
    teaser: "Free preview <b>x</b>",
  });
  assert.match(html, /<open-paywall/);
  assert.match(html, /article-id="hello-world"/);
  assert.match(html, /payment-asset="usdc"/);
  assert.match(html, new RegExp(`unlock-contract="${MAINNET_USDC_CONTRACT}"`));
  assert.match(html, /price="0.50"/);
  assert.match(html, /Free preview &lt;b&gt;x&lt;\/b&gt;/);
  assert.match(html, /openpaywall\.js/);
  assert.doesNotMatch(html, /embed-sig=/);
});

test("generateEmbed includes MON contract when paymentAsset is mon", () => {
  const html = generateEmbed({
    title: "Hello",
    articleId: "hello-world",
    teaser: "Preview",
    price: "2",
    paymentAsset: "mon",
  });
  assert.match(html, /payment-asset="mon"/);
  assert.match(html, new RegExp(`unlock-contract="${MAINNET_MON_CONTRACT}"`));
  assert.match(html, /price="2"/);
});

test("generateEmbed includes embed-sig when provided", () => {
  const html = generateEmbed(
    {
      title: "Hello",
      articleId: "hello-world",
      teaser: "Preview",
      price: "1",
      paymentAsset: "mon",
    },
    "0xabc123",
  );
  assert.match(html, /embed-sig="0xabc123"/);
});

test("buildFinishRegistrationUrl encodes slug + price + paymentAsset", () => {
  const url = buildFinishRegistrationUrl("my-slug", "3", { paymentAsset: "mon" });
  assert.match(url, /register\.html\?/);
  assert.match(url, /slug=my-slug/);
  assert.match(url, /price=3/);
  assert.match(url, /paymentAsset=mon/);
});

test("buildFinishRegistrationUrl defaults paymentAsset to usdc", () => {
  const url = buildFinishRegistrationUrl("my-slug");
  assert.match(url, /paymentAsset=usdc/);
  assert.match(url, /price=0\.50/);
});

test("buildFinishRegistrationUrl includes title author teaser meta", () => {
  const url = buildFinishRegistrationUrl("my-slug", "2", {
    title: "Rain Walk",
    author: "Carlos",
    teaser: "A short preview",
    paymentAsset: "usdc",
  });
  assert.match(url, /title=Rain\+Walk|title=Rain%20Walk/);
  assert.match(url, /author=Carlos/);
  assert.match(url, /teaser=A\+short\+preview|teaser=A%20short%20preview/);
  assert.match(url, /paymentAsset=usdc/);
});

test("buildFinishRegistrationUrl omits very long teasers", () => {
  const url = buildFinishRegistrationUrl("my-slug", "1", {
    title: "T",
    teaser: "x".repeat(1600),
    paymentAsset: "mon",
  });
  assert.match(url, /title=T/);
  assert.doesNotMatch(url, /teaser=/);
});

test("slugFromTitle kebab-cases titles", () => {
  assert.equal(slugFromTitle("July rain walk"), "july-rain-walk");
  assert.equal(slugFromTitle("  Hello, World!  "), "hello-world");
});

test("uniqueSlugFromTitle appends a unique suffix", () => {
  const a = uniqueSlugFromTitle("July rain walk");
  const b = uniqueSlugFromTitle("July rain walk");
  assert.match(a, /^july-rain-walk-[a-z0-9]+$/);
  assert.notEqual(a, b);
  assert.match(a, /^[a-z0-9][a-z0-9-]{1,62}[a-z0-9]$/);
});

test("parsePublishPaste converts casual human paste", () => {
  const result = parsePublishPaste(
    `Title: July rain walk
Price: 0.50
Teaser: Walking home in the rain…
---
Full article text. Keep going as long as you want.`,
    { publisher: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" },
  );
  assert.equal(result.ok, true);
  assert.equal(result.input.title, "July rain walk");
  assert.match(result.input.articleId, /^july-rain-walk-[a-z0-9]+$/);
  assert.equal(result.input.teaser, "Walking home in the rain…");
  assert.equal(result.input.body.includes("Full article text"), true);
  assert.equal(result.input.price, "0.50");
  assert.equal(result.input.paymentAsset, "usdc");
  assert.match(result.formattedPaste, /^Title: July rain walk/);
  assert.match(result.formattedPaste, /Slug: july-rain-walk-[a-z0-9]+/);
});

test("parsePublishPaste requires Title Price Teaser", () => {
  const result = parsePublishPaste(
    `Title: Only title
---
Body`,
    { publisher: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" },
  );
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => e.includes("Price")));
  assert.ok(result.errors.some((e) => e.includes("Teaser")));
});

test("parsePublishPaste ignores human Slug and generates a new one", () => {
  const result = parsePublishPaste(
    `Title: July rain walk
Price: 0.50
Teaser: Preview
Slug: human-picked-slug
---
Body text.`,
    { publisher: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" },
  );
  assert.equal(result.ok, true);
  assert.notEqual(result.input.articleId, "human-picked-slug");
  assert.match(result.input.articleId, /^july-rain-walk-[a-z0-9]+$/);
});

test("formatPublishPaste includes all header fields", () => {
  const text = formatPublishPaste({
    title: "July rain walk",
    articleId: "july-rain-walk-k3m9x2",
    teaser: "Walking home",
    body: "Full text",
    price: "0.50",
    paymentAsset: "usdc",
  });
  assert.match(text, /Title: July rain walk/);
  assert.match(text, /Price: 0.50/);
  assert.match(text, /Teaser: Walking home/);
  assert.match(text, /Slug: july-rain-walk-k3m9x2/);
  assert.match(text, /---\nFull text/);
});

test("parsePublishPaste requires --- separator", () => {
  const result = parsePublishPaste("Title: Nope\nTeaser: x", {
    publisher: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  });
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => e.includes("---")));
});

test("toArticleIdHash is stable hex", () => {
  const a = toArticleIdHash("demo");
  const b = toArticleIdHash("demo");
  assert.equal(a, b);
  assert.match(a, /^0x[a-f0-9]{64}$/);
});
