/**
 * Audit L1/L2: revoke anon and authenticated writes, and EXECUTE on the two
 * SECURITY DEFINER trigger functions. Applies the repo migrations to a local
 * Postgres cluster when initdb is installed (CI installs postgresql).
 *
 * pg_cron, pg_net, and supabase_vault are not in stock Postgres. Those three
 * migration files still run; only their CREATE EXTENSION lines are replaced
 * with select 1, and the harness creates the cron/net/vault/storage objects
 * those statements call. Every other migration, including 0017, is applied
 * from the file on disk. 0017 is applied twice.
 */
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const MIGRATION = "supabase/migrations/0017_revoke_anon_authenticated_writes.sql";
const TABLES = [
  "articles",
  "unlocks",
  "indexer_state",
  "fiat_unlocks",
  "publisher_accounts",
  "payout_jobs",
  "writer_plans",
  "subscriptions",
  "article_nfts",
  "follows",
  "email_suppressions",
  "follow_notifications",
  "follow_deliveries",
];

function read(rel) {
  return fs.readFileSync(path.join(ROOT, rel), "utf8");
}

function pgBinDir() {
  const root = "/usr/lib/postgresql";
  if (!fs.existsSync(root)) return "";
  const versions = fs.readdirSync(root).filter((name) => fs.existsSync(path.join(root, name, "bin", "initdb")));
  if (!versions.length) return "";
  versions.sort();
  return path.join(root, versions[versions.length - 1], "bin");
}

test("revoke migration names the audited tables and trigger functions", () => {
  const sql = read(MIGRATION);
  const code = sql.replace(/--[^\n]*/g, "");
  assert.match(code, /revoke insert, update, delete, truncate on table/i);
  for (const table of TABLES) {
    assert.match(code, new RegExp(`public\\.${table}\\b`));
  }
  assert.match(code, /from anon, authenticated/i);
  assert.match(
    code,
    /revoke execute on function public\.enqueue_follow_notification\(\)\s*from public, anon, authenticated/i
  );
  assert.match(code, /rls_auto_enable/);
  assert.match(code, /revoke execute on function %s from public, anon, authenticated/i);
  assert.doesNotMatch(code, /revoke select/i);
  assert.doesNotMatch(code, /from service_role/i);
  assert.doesNotMatch(code, /grant\s+(insert|update|delete|truncate|all)/i);
});

test("browser supabase client only reads; writes use the service role", () => {
  const dashboard = read("dashboard.html");
  assert.match(dashboard, /SUPABASE_ANON_KEY/);
  assert.match(dashboard, /\.from\(['"]articles['"]\)/);
  assert.match(dashboard, /\.from\(['"]unlocks['"]\)/);
  assert.match(dashboard, /\.from\(["']indexer_state["']\)/);
  assert.doesNotMatch(dashboard, /\.(insert|update|upsert|delete)\(/);
  for (const rel of [
    "supabase/functions/indexer/index.ts",
    "supabase/functions/register-article/index.ts",
    "supabase/functions/update-listing/index.ts",
    "supabase/functions/article-body/index.ts",
    "server/subscriptions.mjs",
    "server/stripe.mjs",
    "server/listings-api.mjs",
    "server/follow-store.mjs",
    "server/article-nft.mjs",
    "server/media-host.mjs",
  ]) {
    assert.match(read(rel), /SUPABASE_SERVICE_ROLE_KEY/, rel);
  }
});

test("repo migrations apply and anon writes are denied", async (t) => {
  const bin = pgBinDir();
  if (!bin) {
    if (process.env.GITHUB_ACTIONS) {
      throw new Error("postgresql is not installed; the CI test job should apt-get install it");
    }
    t.skip("PostgreSQL initdb is not installed");
    return;
  }

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "op-revoke-"));
  const data = path.join(dir, "data");
  const socket = path.join(dir, "sock");
  fs.mkdirSync(socket);
  const port = 55432;
  const initdb = path.join(bin, "initdb");
  const pgCtl = path.join(bin, "pg_ctl");
  const psql = fs.existsSync("/usr/bin/psql") ? "/usr/bin/psql" : path.join(bin, "psql");
  const db = "openpaywall";
  let started = false;

  function run(file, args, opts = {}) {
    const result = spawnSync(file, args, { encoding: "utf8", ...opts });
    if (result.status !== 0 && !opts.allowFail) {
      throw new Error(
        `${path.basename(file)} ${args.join(" ")}\n${result.stdout || ""}\n${result.stderr || ""}`
      );
    }
    return result;
  }

  function sql(statement, opts = {}) {
    return run(
      psql,
      ["-h", socket, "-p", String(port), "-d", db, "-v", "ON_ERROR_STOP=1", "-tA", "-c", statement],
      { env: { ...process.env, COLUMNS: "10000" }, ...opts }
    );
  }

  function sqlFile(file) {
    run(psql, ["-h", socket, "-p", String(port), "-d", db, "-v", "ON_ERROR_STOP=1", "-f", file]);
  }

  try {
    execFileSync(initdb, ["-D", data, "--auth=trust", "--username", process.env.USER || "postgres", "--no-instructions"], {
      stdio: "pipe",
    });
    run(pgCtl, [
      "-D",
      data,
      "-l",
      path.join(dir, "postgres.log"),
      "-w",
      "-o",
      `-p ${port} -k ${socket} -c listen_addresses=`,
      "start",
    ]);
    started = true;
    run(psql, [
      "-h",
      socket,
      "-p",
      String(port),
      "-d",
      "postgres",
      "-v",
      "ON_ERROR_STOP=1",
      "-c",
      `create database ${db}`,
    ]);

    sqlFileText(`
      create role anon nologin;
      create role authenticated nologin;
      create role service_role nologin bypassrls;
      grant anon, authenticated, service_role to current_user;
      grant usage on schema public to anon, authenticated, service_role;
      alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
      alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
      alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;
      create schema if not exists extensions;
      create schema if not exists storage;
      create table if not exists storage.buckets (
        id text primary key,
        name text,
        public boolean,
        file_size_limit bigint,
        allowed_mime_types text[]
      );
      create schema if not exists cron;
      create or replace function cron.unschedule(job_name text) returns bigint
        language plpgsql as $$ begin return 1; end $$;
      create or replace function cron.schedule(job_name text, schedule text, command text) returns bigint
        language plpgsql as $$ begin return 1; end $$;
      create schema if not exists net;
      create or replace function net.http_post(
        url text,
        headers jsonb,
        body jsonb,
        timeout_milliseconds integer
      ) returns bigint language sql as $$ select 1::bigint $$;
      create schema if not exists vault;
      create table if not exists vault.decrypted_secrets (
        name text,
        decrypted_secret text
      );
    `);

    const migrations = fs
      .readdirSync(path.join(ROOT, "supabase/migrations"))
      .filter((name) => name.endsWith(".sql"))
      .sort();
    assert.ok(migrations.includes("0017_revoke_anon_authenticated_writes.sql"));
    for (const name of migrations) {
      const full = path.join(ROOT, "supabase/migrations", name);
      const raw = fs.readFileSync(full, "utf8");
      if (!/^create extension\b/im.test(raw)) {
        sqlFile(full);
        continue;
      }
      const filtered = raw.replace(/^create extension\b[^;]*;/gim, "select 1;");
      const copy = path.join(dir, name);
      fs.writeFileSync(copy, filtered);
      sqlFile(copy);
    }
    sqlFile(path.join(ROOT, MIGRATION));

    const privileges = sql(
      `select string_agg(check_name || '=' || ok::text, ',' order by check_name)
       from (
         select rel || ':' || priv as check_name,
                has_table_privilege(role_name, 'public.' || rel, priv) as ok
         from unnest(array[${TABLES.map((table) => `'${table}'`).join(",")}]) as rel
         cross join unnest(array['anon','authenticated']) as role_name
         cross join unnest(array['INSERT','UPDATE','DELETE','TRUNCATE']) as priv
       ) s`
    ).stdout;
    for (const flag of privileges.split(",")) {
      const [name, ok] = flag.trim().split("=");
      assert.equal(ok, "false", name);
    }

    const reads = sql(
      `select
         has_column_privilege('anon', 'public.articles', 'title', 'SELECT') as title,
         has_column_privilege('anon', 'public.articles', 'body', 'SELECT') as body,
         has_table_privilege('anon', 'public.writer_plans', 'SELECT') as plans,
         has_function_privilege('anon', 'public.enqueue_follow_notification()', 'EXECUTE') as anon_fn,
         has_function_privilege('authenticated', 'public.enqueue_follow_notification()', 'EXECUTE') as auth_fn,
         has_function_privilege('public', 'public.enqueue_follow_notification()', 'EXECUTE') as public_fn,
         has_function_privilege('service_role', 'public.enqueue_follow_notification()', 'EXECUTE') as service_fn`
    ).stdout;
    assert.match(reads, /t\|f\|t\|f\|f\|f\|t/);

    const denied = sql(
      `set role anon;
       insert into public.writer_plans (publisher) values ('0x1111111111111111111111111111111111111111');`,
      { allowFail: true }
    );
    assert.notEqual(denied.status, 0);
    assert.match(`${denied.stderr}\n${denied.stdout}`, /permission denied for table writer_plans/i);

    const deniedArticle = sql(
      `set role authenticated;
       insert into public.articles (article_id_hash, publisher, price_wei)
       values ('hash-denied', '0x1111111111111111111111111111111111111111', 1);`,
      { allowFail: true }
    );
    assert.notEqual(deniedArticle.status, 0);
    assert.match(`${deniedArticle.stderr}\n${deniedArticle.stdout}`, /permission denied for table articles/i);

    sql(
      `set role service_role;
       insert into public.articles (
         article_id, article_id_hash, publisher, price_wei, listing_status, registration_status
       ) values (
         'grant-check', 'hash-grant-check',
         '0x1111111111111111111111111111111111111111',
         1, 'listed', 'registered'
       );
       reset role;`
    );
    const queued = sql(
      `select count(*) from public.follow_notifications where article_id = 'grant-check'`
    ).stdout;
    assert.match(queued, /\b1\b/);
    const readable = sql(
      `set role anon;
       select article_id from public.articles where article_id = 'grant-check';`
    ).stdout;
    assert.match(readable, /grant-check/);

    sql(
      `create or replace function public.rls_auto_enable()
       returns event_trigger
       language plpgsql
       security definer
       set search_path = pg_catalog
       as $$ begin end $$;`
    );
    sqlFile(path.join(ROOT, MIGRATION));
    const auto = sql(
      `select
         has_function_privilege('anon', 'public.rls_auto_enable()', 'EXECUTE'),
         has_function_privilege('authenticated', 'public.rls_auto_enable()', 'EXECUTE'),
         has_function_privilege('public', 'public.rls_auto_enable()', 'EXECUTE')`
    ).stdout;
    assert.match(auto, /f\|f\|f/);
  } finally {
    if (started) {
      spawnSync(pgCtl, ["-D", data, "-w", "-m", "immediate", "stop"], { encoding: "utf8" });
    }
  }

  function sqlFileText(statement) {
    const file = path.join(dir, "prelude.sql");
    fs.writeFileSync(file, statement);
    sqlFile(file);
  }
});
