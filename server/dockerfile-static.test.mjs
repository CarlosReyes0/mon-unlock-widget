/**
 * Guard: root HTML pages must be copied into the Docker runtime image.
 *
 * Production 404s for /articles happened because Dockerfile uses an explicit
 * HTML allowlist and new pages were added without updating it. Fail CI if
 * that happens again.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/**
 * Built by Vite into dist-checkout / dist-publisher — do NOT copy source HTML.
 * Demo pages are intentionally omitted from production images.
 */
const EXCLUDE_FROM_DOCKERFILE = new Set([
  "account.html",
  "write.html",
  "unlock.html",
  "publisher-auth.html",
  "demo-checkout-mock.html",
  "demo-unlock-recording.html",
]);

function rootHtmlFiles() {
  return fs
    .readdirSync(ROOT)
    .filter((name) => name.endsWith(".html"))
    .sort();
}

function dockerfileCopies(htmlName) {
  const dockerfile = fs.readFileSync(path.join(ROOT, "Dockerfile"), "utf8");
  return dockerfile.includes(`/app/${htmlName}`);
}

test("Dockerfile copies every production root HTML page", () => {
  const missing = [];
  for (const name of rootHtmlFiles()) {
    if (EXCLUDE_FROM_DOCKERFILE.has(name)) continue;
    if (!dockerfileCopies(name)) missing.push(name);
  }
  assert.deepEqual(
    missing,
    [],
    `Add these to the Dockerfile runtime COPY allowlist (or EXCLUDE_FROM_DOCKERFILE if intentional):\n${missing.join("\n")}`
  );
});

test("Dockerfile copies VOICE_DRAFTS.md so /VOICE_DRAFTS.md is not a production 404", () => {
  const dockerfile = fs.readFileSync(path.join(ROOT, "Dockerfile"), "utf8");
  assert.match(dockerfile, /VOICE_DRAFTS\.md/);
});

test("Dockerfile copies write-draft-resume.js so resume banners work in production", () => {
  const dockerfile = fs.readFileSync(path.join(ROOT, "Dockerfile"), "utf8");
  assert.match(dockerfile, /write-draft-resume\.js/);
});

test("Dockerfile copies generator-media.js so generator media validation loads", () => {
  const dockerfile = fs.readFileSync(path.join(ROOT, "Dockerfile"), "utf8");
  const generator = fs.readFileSync(path.join(ROOT, "generator.html"), "utf8");
  assert.match(generator, /import\("\/generator-media\.js"\)/);
  assert.equal(fs.existsSync(path.join(ROOT, "generator-media.js")), true);
  assert.match(
    dockerfile,
    /COPY --from=builder \/app\/generator-media\.js \.\/generator-media\.js/
  );
});

test("Dockerfile still excludes Vite-built publisher/checkout source HTML", () => {
  const dockerfile = fs.readFileSync(path.join(ROOT, "Dockerfile"), "utf8");
  // Source account.html / write.html must not overwrite dist-publisher output.
  assert.equal(
    /COPY\s+--from=builder\s+\/app\/account\.html/.test(dockerfile),
    false,
    "Do not COPY source account.html — dist-publisher provides the built page"
  );
  assert.equal(
    /COPY\s+--from=builder\s+\/app\/write\.html/.test(dockerfile),
    false,
    "Do not COPY source write.html — dist-publisher provides the built page"
  );
});
