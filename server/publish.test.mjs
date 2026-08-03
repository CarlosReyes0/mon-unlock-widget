import assert from "node:assert/strict";
import { test } from "node:test";
import {
  validatePublishInput,
  generateEmbed,
  buildFinishRegistrationUrl,
  toArticleIdHash,
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
});

test("generateEmbed includes contract and teaser", () => {
  const html = generateEmbed({
    title: "Hello",
    articleId: "hello-world",
    teaser: "Free preview <b>x</b>",
    price: "1",
  });
  assert.match(html, /<open-paywall/);
  assert.match(html, /article-id="hello-world"/);
  assert.match(html, /Free preview &lt;b&gt;x&lt;\/b&gt;/);
  assert.match(html, /unlock-contract=/);
  assert.match(html, /openpaywall\.js/);
  assert.doesNotMatch(html, /embed-sig=/);
});

test("generateEmbed includes embed-sig when provided", () => {
  const html = generateEmbed(
    {
      title: "Hello",
      articleId: "hello-world",
      teaser: "Preview",
      price: "1",
    },
    "0xabc123",
  );
  assert.match(html, /embed-sig="0xabc123"/);
});

test("buildFinishRegistrationUrl encodes slug + price", () => {
  const url = buildFinishRegistrationUrl("my-slug", "3");
  assert.match(url, /register\.html\?/);
  assert.match(url, /slug=my-slug/);
  assert.match(url, /price=3/);
});

test("buildFinishRegistrationUrl includes title author teaser meta", () => {
  const url = buildFinishRegistrationUrl("my-slug", "2", {
    title: "Rain Walk",
    author: "Carlos",
    teaser: "A short preview",
  });
  assert.match(url, /title=Rain\+Walk|title=Rain%20Walk/);
  assert.match(url, /author=Carlos/);
  assert.match(url, /teaser=A\+short\+preview|teaser=A%20short%20preview/);
});

test("buildFinishRegistrationUrl omits very long teasers", () => {
  const url = buildFinishRegistrationUrl("my-slug", "1", {
    title: "T",
    teaser: "x".repeat(1600),
  });
  assert.match(url, /title=T/);
  assert.doesNotMatch(url, /teaser=/);
});

test("toArticleIdHash is stable hex", () => {
  const a = toArticleIdHash("demo");
  const b = toArticleIdHash("demo");
  assert.equal(a, b);
  assert.match(a, /^0x[a-f0-9]{64}$/);
});
