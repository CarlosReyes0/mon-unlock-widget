import assert from "node:assert/strict";
import { test } from "node:test";
import {
  parseArticleSlug,
  tryHandleOgRequest,
} from "./og-http.mjs";

test("parseArticleSlug reads /articles/{slug}", () => {
  assert.equal(parseArticleSlug("/articles/the-quote-was-a-trap"), "the-quote-was-a-trap");
  assert.equal(parseArticleSlug("/articles/foo%20bar"), "foo bar");
  assert.equal(parseArticleSlug("/articles"), null);
  assert.equal(parseArticleSlug("/articles/a/b"), null);
  assert.equal(parseArticleSlug("/og/x.jpg"), null);
});

test("tryHandleOgRequest serves a JPEG for /og/{slug}.jpg", async () => {
  const res = mockRes();
  const handled = await tryHandleOgRequest(
    { method: "GET", url: "/og/missing-slug.jpg", headers: { host: "127.0.0.1:5173" } },
    res
  );
  assert.equal(handled, true);
  assert.equal(res.statusCode, 200);
  assert.equal(res.headers["Content-Type"], "image/jpeg");
  assert.equal(res.body[0], 0xff);
  assert.equal(res.body[1], 0xd8);
});

test("tryHandleOgRequest injects OG tags for /articles/{slug}", async () => {
  const res = mockRes();
  const handled = await tryHandleOgRequest(
    { method: "GET", url: "/articles/demo-slug", headers: { host: "127.0.0.1:5173" } },
    res
  );
  assert.equal(handled, true);
  assert.equal(res.statusCode, 200);
  assert.match(res.headers["Content-Type"], /text\/html/);
  const html = res.body.toString("utf8");
  assert.match(html, /property="og:image"/);
  assert.match(html, /name="twitter:card" content="summary_large_image"/);
  assert.match(html, /http:\/\/127\.0\.0\.1:5173\/assets\/og-default\.jpg/);
});

test("tryHandleOgRequest uses https og:image on Railway when proto is omitted", async () => {
  const res = mockRes();
  const handled = await tryHandleOgRequest(
    {
      method: "GET",
      url: "/articles/demo-slug",
      headers: { host: "mon-unlock-widget-production.up.railway.app" },
    },
    res
  );
  assert.equal(handled, true);
  const html = res.body.toString("utf8");
  assert.match(
    html,
    /property="og:image" content="https:\/\/mon-unlock-widget-production\.up\.railway\.app\/assets\/og-default\.jpg"/
  );
});

test("tryHandleOgRequest ignores unrelated paths", async () => {
  const res = mockRes();
  const handled = await tryHandleOgRequest({ method: "GET", url: "/write" }, res);
  assert.equal(handled, false);
});

function mockRes() {
  const chunks = [];
  return {
    statusCode: 0,
    headers: {},
    setHeader(key, value) {
      this.headers[key] = value;
    },
    end(buf) {
      if (buf) chunks.push(Buffer.isBuffer(buf) ? buf : Buffer.from(buf));
    },
    get body() {
      return Buffer.concat(chunks);
    },
  };
}
