/**
 * supabase/seed/staging.sql must not insert on a database that still calls production.
 * Applies the file to a throwaway Postgres when initdb is installed (CI does).
 */
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SEED = path.join(ROOT, "supabase/seed/staging.sql");
const DEMO_HASH = "0xe8c2732a36a54ccc29f7af7c790533d127a986d13b6ad5534181a66131377951";

function pgBinDir() {
  const root = "/usr/lib/postgresql";
  if (!fs.existsSync(root)) return "";
  const versions = fs.readdirSync(root).filter((name) => fs.existsSync(path.join(root, name, "bin", "initdb")));
  if (!versions.length) return "";
  versions.sort();
  return path.join(root, versions[versions.length - 1], "bin");
}

test("staging seed refuses production and inserts the demo listing only after ack", async (t) => {
  const bin = pgBinDir();
  if (!bin) {
    if (process.env.GITHUB_ACTIONS) {
      throw new Error("postgresql is not installed; the CI test job should apt-get install it");
    }
    t.skip("PostgreSQL initdb is not installed");
    return;
  }

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "op-staging-seed-"));
  const data = path.join(dir, "data");
  const socket = path.join(dir, "sock");
  fs.mkdirSync(socket);
  const port = 55441;
  const pgCtl = path.join(bin, "pg_ctl");
  const psql = fs.existsSync(path.join(bin, "psql")) ? path.join(bin, "psql") : "psql";
  const db = "staging_seed";
  let started = false;

  function run(file, args, opts = {}) {
    const result = spawnSync(file, args, { encoding: "utf8", ...opts });
    if (result.status !== 0 && !opts.allowFail) {
      throw new Error(`${path.basename(file)} ${args.join(" ")}\n${result.stdout || ""}\n${result.stderr || ""}`);
    }
    return result;
  }

  function sql(statement, opts = {}) {
    return run(
      psql,
      ["-h", socket, "-p", String(port), "-d", db, "-v", "ON_ERROR_STOP=1", "-tA", "-c", statement],
      opts
    );
  }

  function sqlFile(file, opts = {}) {
    return run(
      psql,
      ["-h", socket, "-p", String(port), "-d", db, "-v", "ON_ERROR_STOP=1", "-f", file],
      opts
    );
  }

  try {
    execFileSync(path.join(bin, "initdb"), ["-D", data, "--auth=trust", "--username", process.env.USER || "postgres", "--no-instructions"], {
      stdio: "pipe",
    });
    run(pgCtl, ["-D", data, "-l", path.join(dir, "postgres.log"), "-w", "-o", `-p ${port} -k ${socket} -c listen_addresses=`, "start"]);
    started = true;
    run(psql, ["-h", socket, "-p", String(port), "-d", "postgres", "-c", `create database ${db}`]);
    sql(`
      create schema if not exists cron;
      create table cron.job (
        jobid bigint generated always as identity primary key,
        command text
      );
      create table public.articles (
        id bigint generated always as identity primary key,
        article_id text,
        article_id_hash text unique,
        publisher text not null,
        price_wei numeric not null,
        teaser text,
        body text,
        title text,
        author text,
        payment_asset text,
        price_cents integer,
        listing_status text,
        listed_at timestamptz,
        registration_status text,
        allow_a_la_carte boolean,
        followers_notified_at timestamptz,
        updated_at timestamptz
      );
      create table public.writer_plans (
        publisher text primary key,
        monthly_price_cents integer,
        monthly_price_usdc numeric,
        allow_a_la_carte boolean,
        updated_at timestamptz
      );
    `);

    const blind = sqlFile(SEED, { allowFail: true });
    assert.notEqual(blind.status, 0);
    assert.match(`${blind.stdout}\n${blind.stderr}`, /staging seed refused/);
    assert.equal(sql("select count(*) from public.articles").stdout.trim(), "0");

    const acknowledged = fs.readFileSync(SEED, "utf8").replace("seed_ack text := 'no'", "seed_ack text := 'yes'");
    const ackPath = path.join(dir, "staging-ack.sql");
    fs.writeFileSync(ackPath, acknowledged);

    sql("insert into cron.job (command) values ('https://flczjqljgntmkanipugo.supabase.co/functions/v1/indexer')");
    const prodCron = sqlFile(ackPath, { allowFail: true });
    assert.notEqual(prodCron.status, 0);
    assert.match(`${prodCron.stdout}\n${prodCron.stderr}`, /pg_cron/);
    sql("delete from cron.job");

    sql("insert into cron.job (command) values ('https://openpaywall.app/api/follows/notify/process')");
    const followCron = sqlFile(ackPath, { allowFail: true });
    assert.notEqual(followCron.status, 0);
    assert.match(`${followCron.stdout}\n${followCron.stderr}`, /pg_cron/);
    sql("delete from cron.job");

    sql("insert into public.articles (article_id, article_id_hash, publisher, price_wei) values ('the-quote-was-a-trap-939i9e', '0xabc', '0x2222222222222222222222222222222222222222', 1)");
    const prodArticle = sqlFile(ackPath, { allowFail: true });
    assert.notEqual(prodArticle.status, 0);
    assert.match(`${prodArticle.stdout}\n${prodArticle.stderr}`, /production article/);
    sql("delete from public.articles");

    const ok = sqlFile(ackPath);
    assert.equal(ok.status, 0);
    assert.equal(sql("select count(*) from public.articles").stdout.trim(), "1");
    assert.equal(
      sql("select article_id || '|' || listing_status || '|' || price_cents::text || '|' || left(teaser, 11) || '|' || left(body, 11) from public.articles").stdout.trim(),
      "staging-demo-walk|listed|50|This is the|This is the"
    );
    assert.equal(sql(`select article_id_hash from public.articles`).stdout.trim(), DEMO_HASH);
    assert.equal(
      sql("select publisher from public.writer_plans").stdout.trim(),
      "0x1111111111111111111111111111111111111111"
    );
    assert.equal(sql("select followers_notified_at is not null from public.articles").stdout.trim(), "t");
  } finally {
    if (started) {
      spawnSync(pgCtl, ["-D", data, "-m", "immediate", "stop"], { encoding: "utf8" });
    }
  }
});
