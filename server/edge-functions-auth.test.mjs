/**
 * Source guards for edge-function auth. Signature math lives in
 * src/core/publish-auth.test.ts. These checks make sure the handlers and
 * callers actually use it.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function read(rel) {
  return fs.readFileSync(path.join(ROOT, rel), "utf8");
}

test("config.toml keeps verify_jwt on and documents why the anon JWT is not enough", () => {
  const toml = read("supabase/config.toml");
  for (const name of ["indexer", "article-body", "register-article", "update-listing"]) {
    const block = toml.split(`[functions.${name}]`)[1]?.split("[functions.")[0] || "";
    assert.match(block, /verify_jwt = true/, name);
  }
  assert.match(toml, /x-indexer-secret/);
  assert.match(toml, /INDEXER_SECRET/);
  assert.match(toml, /REGISTER_PUBLISH_SECRET/);
  assert.match(toml, /LISTING_ADMIN_SECRET/);
  assert.match(toml, /backfill-unlock was removed/);
});

test("indexer rejects callers that do not present INDEXER_SECRET", () => {
  const edge = read("supabase/functions/indexer/index.ts");
  const cron = read("cron/indexer.ts");
  const docker = read("cron/Dockerfile");
  const migration = read("supabase/migrations/20260928143000_indexer_cron_secret.sql");
  assert.match(edge, /INDEXER_SECRET/);
  assert.match(edge, /x-indexer-secret/);
  assert.match(edge, /indexer_auth_not_configured/);
  assert.match(edge, /unauthorized/);
  assert.match(cron, /x-indexer-secret/);
  assert.match(cron, /INDEXER_SECRET is not set/);
  assert.match(docker, /--allow-env/);
  assert.match(migration, /indexer_secret/);
  assert.match(migration, /x-indexer-secret/);
  assert.doesNotMatch(read("dashboard.html"), /functions\/v1\/indexer/);
});

test("register-article requires a publish signature or REGISTER_PUBLISH_SECRET", () => {
  const edge = read("supabase/functions/register-article/index.ts");
  const write = read("src/publisher/publish-post.ts");
  const railway = read("server/publish.mjs");
  const generator = read("generator.html");
  const register = read("register.html");
  assert.match(edge, /REGISTER_PUBLISH_SECRET/);
  assert.match(edge, /x-publish-secret/);
  assert.match(edge, /buildPublishAuthMessage/);
  assert.match(edge, /unauthorized/);
  assert.match(edge, /shouldApplyListing/);
  assert.match(write, /buildPublishAuthMessage/);
  assert.match(write, /publishSig/);
  assert.match(write, /listOnOpenPaywall: true/);
  assert.match(railway, /x-publish-secret/);
  assert.match(railway, /REGISTER_PUBLISH_SECRET/);
  assert.match(generator, /buildPublishAuthMessage/);
  assert.match(generator, /publishSig/);
  assert.match(register, /buildPublishAuthMessage/);
  assert.match(register, /publishSig/);
});

test("update-listing requires a listing signature or LISTING_ADMIN_SECRET", () => {
  const edge = read("supabase/functions/update-listing/index.ts");
  const dashboard = read("dashboard.html");
  assert.match(edge, /LISTING_ADMIN_SECRET/);
  assert.match(edge, /x-listing-admin-secret/);
  assert.match(edge, /buildListingAuthMessage/);
  assert.match(edge, /listingSig/);
  assert.match(edge, /unauthorized/);
  assert.match(dashboard, /buildListingAuthMessage/);
  assert.match(dashboard, /listingSig/);
  assert.match(read(".env.example"), /INDEXER_SECRET=/);
  assert.match(read(".env.example"), /REGISTER_PUBLISH_SECRET=/);
  assert.match(read(".env.example"), /LISTING_ADMIN_SECRET=/);
});

test("article-body ignores unlock contracts that are not on the allowlist", () => {
  const edge = read("supabase/functions/article-body/index.ts");
  assert.match(edge, /isAllowedUnlockContract/);
  assert.match(edge, /allowedUnlockContracts/);
  assert.match(edge, /fake hasUnlocked/);
  assert.match(edge, /Not unlocked/);
  assert.doesNotMatch(edge, /DEFAULT_CONTRACT/);
  assert.doesNotMatch(edge, /searchParams\.get\('unlock_contract'\) \|\|/);
});
