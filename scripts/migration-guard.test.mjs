import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import { test } from "node:test";
import {
  createdTables,
  decide,
  isApplied,
  migrationIdentity,
  parseMigrationList,
  tablesMentioned,
} from "./migration-guard.mjs";

/** Names observed on project flczjqljgntmkanipugo. Versions are apply_migration timestamps. */
const PROD = [
  { version: "0001", name: "initial_schema" },
  { version: "0002", name: "indexer_state" },
  { version: "0003", name: "fix_articles_make_article_id_nullable" },
  { version: "0004", name: "add_teaser_body_to_articles" },
  { version: "20260808025233", name: "article_slug_reservation" },
  { version: "20260903042936", name: "article_listings" },
  { version: "20260905080825", name: "writer_subscriptions" },
  { version: "20260916094116", name: "restrict_articles_body" },
  { version: "20260918061000", name: "article_nfts" },
  { version: "20260928015406", name: "indexer_cron_secret" },
  { version: "20261005071742", name: "article_price_cents" },
  { version: "20261008050930", name: "0015_writer_follows" },
  { version: "20261008051254", name: "0016_follow_notify_cron" },
  { version: "20261017054024", name: "revoke_anon_authenticated_writes" },
  { version: "20261017055345", name: "gas_drip_claims_service_role" },
];

test("names match either the filename stem or the slug, not the version", () => {
  const restrict = migrationIdentity("supabase/migrations/20260916094014_restrict_articles_body.sql");
  assert.equal(restrict.version, "20260916094014");
  assert.notEqual(restrict.version, "20260916094116");
  assert.equal(isApplied(restrict, PROD), true);

  const follows = migrationIdentity("supabase/migrations/0015_writer_follows.sql");
  assert.equal(isApplied(follows, PROD), true);

  const reservation = migrationIdentity("supabase/migrations/0007_article_slug_reservation.sql");
  assert.equal(isApplied(reservation, PROD), true);

  const payment = migrationIdentity("supabase/migrations/0008_payment_asset.sql");
  assert.equal(isApplied(payment, PROD), false);

  const gas = migrationIdentity("supabase/migrations/20261017041000_gas_drip_claims_service_role.sql");
  assert.notEqual(gas.version, "20261017055345");
  assert.equal(isApplied(gas, PROD), true);
});

test("a new migration fails when the token is set and warns when it is not", () => {
  const files = [
    {
      filename: "supabase/migrations/0018_widgets.sql",
      status: "added",
      head: "create table if not exists public.widgets (id bigint primary key);",
    },
  ];
  const codeDiff = "+++ server/widgets.mjs\n+fetch(`${url}/rest/v1/widgets`)";
  const blocked = decide({ files, codeDiff, prod: PROD, hasToken: true });
  assert.equal(blocked.exitCode, 1);
  assert.equal(blocked.level, "fail");
  assert.match(blocked.comment, /0018_widgets\.sql/);
  assert.match(blocked.comment, /SUPABASE_ACCESS_TOKEN/);
  assert.deepEqual(blocked.mentions, ["widgets"]);

  const warned = decide({ files, codeDiff, prod: null, hasToken: false });
  assert.equal(warned.exitCode, 0);
  assert.equal(warned.level, "warn");
  assert.match(warned.comment, /<!-- migration-guard -->/);
  assert.match(warned.comment, /- \[ \]/);
});

test("editing a recorded migration is not treated as already applied", () => {
  const files = [
    {
      filename: "supabase/migrations/0015_writer_follows.sql",
      status: "modified",
      base: "create table public.follows (id bigint);",
      head: "create table public.follows (id bigint);\nalter table public.follows add column note text;",
    },
  ];
  const result = decide({ files, prod: PROD, hasToken: true });
  assert.equal(result.exitCode, 1);
  assert.match(result.edited[0].reason, /will not re-run/);
});

test("an added file whose name is already recorded passes", () => {
  const files = [
    {
      filename: "supabase/migrations/20261017041000_gas_drip_claims_service_role.sql",
      status: "added",
      head: "create table public.gas_drip_claims (address text);",
    },
  ];
  const result = decide({ files, prod: PROD, hasToken: true });
  assert.equal(result.exitCode, 0);
  assert.equal(result.level, "ok");
  assert.equal(result.pending.length, 0);
});

test("a pull request that does not touch migrations passes", () => {
  const result = decide({ files: [], hasToken: true, prod: PROD });
  assert.equal(result.exitCode, 0);
  assert.equal(result.comment, "");
});

test("an API failure blocks when the token is set and does not echo the token", () => {
  const files = [{ filename: "supabase/migrations/0018_widgets.sql", status: "added", head: "" }];
  const result = decide({
    files,
    hasToken: true,
    apiError: "Supabase management API GET /database/migrations returned HTTP 401",
  });
  assert.equal(result.exitCode, 1);
  assert.match(result.comment, /HTTP 401/);
  assert.equal(result.comment.includes("sbp_"), false);
});

test("migration list payloads may be an array or a migrations field", () => {
  assert.equal(parseMigrationList([{ version: "1", name: "a" }])[0].name, "a");
  assert.equal(parseMigrationList({ migrations: [{ version: "1", name: "b" }] })[0].name, "b");
});

test("create table parsing ignores comments", () => {
  const sql = "-- create table public.not_real (id int);\ncreate table public.widgets (id int);";
  assert.deepEqual(createdTables(sql), ["widgets"]);
  assert.deepEqual(tablesMentioned("rest/v1/widgets", ["widgets"]), ["widgets"]);
});

test("the workflow only lists migrations and skips the check when the secret is absent", () => {
  const script = fs.readFileSync(new URL("./migration-guard.mjs", import.meta.url), "utf8");
  const workflow = fs.readFileSync(new URL("../.github/workflows/migration-guard.yml", import.meta.url), "utf8");
  assert.match(script, /method: "GET"/);
  assert.match(script, /\/database\/migrations/);
  assert.doesNotMatch(script, /method: "POST"|database\/query/);
  assert.match(workflow, /secrets\.SUPABASE_ACCESS_TOKEN/);
  assert.match(workflow, /flczjqljgntmkanipugo/);
  assert.match(workflow, /pull-requests: write/);
});

test("the cli exits 0 when the diff contains no migrations and no token", () => {
  const result = spawnSync(process.execPath, ["scripts/migration-guard.mjs", "--base", "HEAD"], {
    encoding: "utf8",
    env: { ...process.env, SUPABASE_ACCESS_TOKEN: "" },
  });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /no supabase migration changes/);
});
