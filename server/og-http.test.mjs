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

test("tryHandleOgRequest injects OG tags for the articles feed at /", async () => {
  const res = mockRes();
  const handled = await tryHandleOgRequest(
    { method: "GET", url: "/", headers: { host: "127.0.0.1:5173" } },
    res
  );
  assert.equal(handled, true);
  assert.equal(res.statusCode, 200);
  assert.match(res.headers["Content-Type"], /text\/html/);
  const html = res.body.toString("utf8");
  assert.match(html, /property="og:title" content="Open Paywall"/);
  assert.match(html, /name="twitter:card" content="summary_large_image"/);
  assert.match(html, /http:\/\/127\.0\.0\.1:5173\/og\.jpg/);
  assert.match(html, /id="feed"/);
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
  assert.match(html, /http:\/\/127\.0\.0\.1:5173\/og\.jpg/);
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
    /property="og:image" content="https:\/\/mon-unlock-widget-production\.up\.railway\.app\/og\.jpg"/
  );
});

test("tryHandleOgRequest serves /og.jpg as a cacheable JPEG", async () => {
  const res = mockRes();
  const handled = await tryHandleOgRequest(
    { method: "GET", url: "/og.jpg", headers: { host: "127.0.0.1:5173" } },
    res
  );
  assert.equal(handled, true);
  assert.equal(res.statusCode, 200);
  assert.equal(res.headers["Content-Type"], "image/jpeg");
  assert.match(res.headers["Cache-Control"], /public/);
  assert.equal(res.body[0], 0xff);
  assert.equal(res.body[1], 0xd8);
});

test("tryHandleOgRequest ignores unrelated paths", async () => {
  const res = mockRes();
  const handled = await tryHandleOgRequest({ method: "GET", url: "/write" }, res);
  assert.equal(handled, false);
});

test("tryHandleOgRequest serves a generated listing card from OG_LISTING_FIXTURES", async () => {
  const prev = process.env.OG_LISTING_FIXTURES;
  const prevCache = process.env.OG_CACHE_DIR;
  const dir = await import("node:os").then((os) => os.tmpdir());
  const pathMod = await import("node:path");
  const fs = await import("node:fs");
  const fixture = pathMod.join(dir, "og-http-fixture.json");
  fs.writeFileSync(
    fixture,
    JSON.stringify({
      "the-quote-was-a-trap": {
        title: "The Quote Was a Trap",
        teaser: "A short free preview everyone can read.",
        priceWei: "500000",
        paymentAsset: "usdc",
      },
    })
  );
  process.env.OG_LISTING_FIXTURES = fixture;
  process.env.OG_CACHE_DIR = fs.mkdtempSync(pathMod.join(dir, "og-http-cache-"));
  try {
    const htmlRes = mockRes();
    const handledHtml = await tryHandleOgRequest(
      { method: "GET", url: "/articles/the-quote-was-a-trap", headers: { host: "127.0.0.1:5173" } },
      htmlRes
    );
    assert.equal(handledHtml, true);
    const html = htmlRes.body.toString("utf8");
    assert.match(html, /\/og\/the-quote-was-a-trap\.jpg\?v=[a-f0-9]{16}/);
    assert.match(html, /name="twitter:image" content="http:\/\/127\.0\.0\.1:5173\/og\/the-quote-was-a-trap\.jpg"/);
    assert.doesNotMatch(html, /name="twitter:image" content="[^"]+\?v=/);
    assert.match(html, /property="og:title" content="The Quote Was a Trap"/);

    const imgRes = mockRes();
    const handledImg = await tryHandleOgRequest(
      { method: "GET", url: "/og/the-quote-was-a-trap.jpg?v=deadbeef", headers: { host: "127.0.0.1:5173" } },
      imgRes
    );
    assert.equal(handledImg, true);
    assert.equal(imgRes.headers["Content-Type"], "image/jpeg");
    const { defaultOgJpegBuffer } = await import("./og-card.mjs");
    assert.equal(imgRes.body.equals(defaultOgJpegBuffer()), false);
  } finally {
    if (prev === undefined) delete process.env.OG_LISTING_FIXTURES;
    else process.env.OG_LISTING_FIXTURES = prev;
    if (prevCache === undefined) delete process.env.OG_CACHE_DIR;
    else process.env.OG_CACHE_DIR = prevCache;
  }
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
