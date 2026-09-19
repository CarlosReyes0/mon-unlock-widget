/**
 * Home-screen icon + title: iOS uses apple-touch-icon and
 * apple-mobile-web-app-title, not favicon.ico or the page <title>.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { ICON_BG, ICON_FILES, renderAppIconPng } from "../scripts/generate-app-icons.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function pngDimensions(buf) {
  const b = Buffer.isBuffer(buf) ? buf : Buffer.from(buf);
  if (b.length < 24) return null;
  if (b[0] !== 0x89 || b[1] !== 0x50 || b[2] !== 0x4e || b[3] !== 0x47) return null;
  return { width: b.readUInt32BE(16), height: b.readUInt32BE(20) };
}

const PRODUCT_HTML = [
  "articles.html",
  "article.html",
  "index.html",
  "write.html",
  "account.html",
  "dashboard.html",
  "generator.html",
  "agents.html",
  "register.html",
  "unlock.html",
  "publisher-auth.html",
];

test("committed app icons are PNGs at the sizes iOS/Android expect", () => {
  const expected = {
    "apple-touch-icon.png": 180,
    "assets/icon-32.png": 32,
    "assets/icon-192.png": 192,
    "assets/icon-512.png": 512,
  };
  for (const [rel, size] of Object.entries(expected)) {
    const buf = fs.readFileSync(path.join(ROOT, rel));
    assert.deepEqual(pngDimensions(buf), { width: size, height: size }, rel);
  }
});

test("committed icons match generate-app-icons.mjs", () => {
  for (const file of ICON_FILES) {
    const expected = renderAppIconPng(file.size, { padRatio: file.padRatio });
    const actual = fs.readFileSync(path.join(ROOT, file.rel));
    assert.equal(actual.equals(expected), true, file.rel);
  }
});

test("web app manifest names the home-screen app Open Paywall", () => {
  const manifest = JSON.parse(
    fs.readFileSync(path.join(ROOT, "manifest.webmanifest"), "utf8")
  );
  assert.equal(manifest.name, "Open Paywall");
  assert.equal(manifest.short_name, "Open Paywall");
  assert.equal(manifest.start_url, "/");
  assert.equal(manifest.display, "standalone");
  assert.equal(manifest.theme_color, ICON_BG);
  const srcs = (manifest.icons || []).map((icon) => icon.src);
  assert.ok(srcs.includes("/assets/icon-192.png"));
  assert.ok(srcs.includes("/assets/icon-512.png"));
});

test("product HTML sets home-screen title independently of <title>", () => {
  for (const name of PRODUCT_HTML) {
    const html = fs.readFileSync(path.join(ROOT, name), "utf8");
    assert.match(
      html,
      /rel="apple-touch-icon"[^>]*href="\/apple-touch-icon\.png"/,
      name
    );
    assert.match(
      html,
      /name="apple-mobile-web-app-title" content="Open Paywall"/,
      name
    );
    assert.match(html, /rel="manifest" href="\/manifest\.webmanifest"/, name);
  }
  const articles = fs.readFileSync(path.join(ROOT, "articles.html"), "utf8");
  assert.match(articles, /<title>Articles — Open Paywall<\/title>/);
});

test("Dockerfile copies apple-touch-icon.png and the web manifest", () => {
  const dockerfile = fs.readFileSync(path.join(ROOT, "Dockerfile"), "utf8");
  assert.match(dockerfile, /apple-touch-icon\.png/);
  assert.match(dockerfile, /manifest\.webmanifest/);
});
