/**
 * The follow migration is service-role only and does not email existing posts.
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

test("writer follows migration enables RLS, revokes anon, and backfills notified_at", () => {
  const sql = read("supabase/migrations/0015_writer_follows.sql");
  const code = sql.replace(/--[^\n]*/g, "");
  for (const table of ["follows", "email_suppressions", "follow_notifications", "follow_deliveries"]) {
    assert.match(sql, new RegExp(`alter table public\\.${table}\\s+enable row level security`, "i"));
  }
  assert.match(
    code,
    /revoke all on public\.follows, public\.email_suppressions,\s*public\.follow_notifications, public\.follow_deliveries\s*from anon, authenticated/i
  );
  assert.doesNotMatch(code, /create policy/i);
  assert.match(sql, /update public\.articles set followers_notified_at = now\(\)/i);
  assert.match(sql, /where listing_status = 'listed' and followers_notified_at is null/i);
  assert.match(sql, /enqueue_follow_notification/);
  assert.match(sql, /articles_enqueue_follow_notification/);
  assert.match(sql, /follows_no_self/);
  assert.match(sql, /on conflict \(article_id\)/);
});

test("follow notify cron reads the vault secret and does not commit it", () => {
  const sql = read("supabase/migrations/0016_follow_notify_cron.sql");
  assert.match(sql, /open-paywall-follow-notify/);
  assert.match(sql, /follow_notify_secret/);
  assert.match(sql, /x-follow-notify-secret/);
  assert.match(sql, /https:\/\/openpaywall\.app\/api\/follows\/notify\/process/);
  assert.match(sql, /'\*\/2 \* \* \* \*'/);
  assert.doesNotMatch(sql, /FOLLOW_NOTIFY_SECRET\s*=\s*['"][^'"]+['"]/);
  assert.match(sql, /do not commit/i);
});
