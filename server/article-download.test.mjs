import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildDownloadHtml,
  contentDisposition,
  createArticleDownload,
  parseDownloadPath,
  safeDownloadFilename,
} from "./article-download.mjs";

const PAID = "SECRET_PAID_PARAGRAPH_DO_NOT_LEAK";

test("parseDownloadPath only matches /api/articles/{slug}/download", () => {
  assert.equal(parseDownloadPath("/api/articles/the-quote/download"), "the-quote");
  assert.equal(parseDownloadPath("/api/articles/the-quote/download/"), "the-quote");
  assert.equal(parseDownloadPath("/api/articles/hello%20world/download"), "hello world");
  assert.equal(parseDownloadPath("/api/articles/the-quote"), null);
  assert.equal(parseDownloadPath("/api/articles/the-quote/download/extra"), null);
  assert.equal(parseDownloadPath("/api/article-body"), null);
  assert.equal(parseDownloadPath("/articles/the-quote/download"), null);
  assert.equal(parseDownloadPath("/api/articles/a-la-carte"), null);
});

test("safeDownloadFilename strips junk and stays .html", () => {
  assert.equal(safeDownloadFilename("The Quote Was a Trap"), "the-quote-was-a-trap.html");
  assert.equal(safeDownloadFilename("../etc/passwd"), "etc-passwd.html");
  assert.equal(safeDownloadFilename(""), "article.html");
});

test("contentDisposition is an attachment, not inline", () => {
  const header = contentDisposition("the-quote.html");
  assert.match(header, /^attachment;/);
  assert.match(header, /filename="the-quote\.html"/);
});

test("buildDownloadHtml includes title, author, and entitled body", () => {
  const html = buildDownloadHtml({
    title: "The Quote Was a Trap",
    author: "Ada",
    teaser: "Free preview.",
    body: `<p>${PAID}</p>`,
    articleId: "the-quote",
    canonicalUrl: "https://example.com/articles/the-quote",
  });
  assert.match(html, /<!DOCTYPE html>/i);
  assert.match(html, /<h1>The Quote Was a Trap<\/h1>/);
  assert.match(html, /By Ada/);
  assert.match(html, new RegExp(PAID));
  assert.match(html, /Free preview/);
  assert.match(html, /noindex/);
  assert.match(html, /canonical/);
  assert.match(html, /Included with your unlock/);
});

test("buildDownloadHtml escapes a hostile title", () => {
  const html = buildDownloadHtml({
    title: `<script>alert(1)</script>`,
    author: `Ada "O'Reilly"`,
    body: "Safe body",
  });
  assert.equal(html.includes("<script>alert(1)</script>"), false);
  assert.match(html, /&lt;script&gt;/);
});

test("createArticleDownload entitled reader gets HTML with paid body", async () => {
  const file = await createArticleDownload(
    {
      articleId: "secret-post",
      reader: "0x1111111111111111111111111111111111111111",
      origin: "https://openpaywall.app",
    },
    {
      resolveArticleAccess: async ({ includeBody }) => {
        assert.equal(includeBody, true);
        return {
          allowed: true,
          reason: "purchase",
          articleId: "secret-post",
          title: "Secret Post",
          author: "Writer",
          teaser: "Preview",
          body: PAID,
        };
      },
    }
  );
  assert.equal(file.contentType, "text/html; charset=utf-8");
  assert.equal(file.filename, "secret-post.html");
  assert.match(file.contentDisposition, /^attachment;/);
  assert.match(file.html, new RegExp(PAID));
  assert.match(file.html, /Secret Post/);
});

test("createArticleDownload locked reader fails closed with no body bytes", async () => {
  await assert.rejects(
    () =>
      createArticleDownload(
        {
          articleId: "secret-post",
          reader: "0x0000000000000000000000000000000000000001",
        },
        {
          resolveArticleAccess: async () => {
            const err = new Error("not_unlocked");
            err.status = 403;
            throw err;
          },
        }
      ),
    (err) => {
      assert.equal(err.status, 403);
      assert.equal(err.message, "not_unlocked");
      assert.equal(JSON.stringify(err).includes(PAID), false);
      return true;
    }
  );
});

test("createArticleDownload ignores a buggy allowed:false payload that still has body", async () => {
  await assert.rejects(
    () =>
      createArticleDownload(
        { articleId: "secret-post", reader: "0x0000000000000000000000000000000000000001" },
        {
          resolveArticleAccess: async () => ({
            allowed: false,
            reason: "locked",
            body: PAID,
            title: "Secret Post",
          }),
        }
      ),
    (err) => {
      assert.equal(err.status, 403);
      assert.equal(String(err.html || "").includes(PAID), false);
      return true;
    }
  );
});
