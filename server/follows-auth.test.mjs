/**
 * Notify secret and env wiring for free per-writer follow.
 * Empty FOLLOW_NOTIFY_SECRET never authenticates.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { dispatchFollowRequest } from "./follows.mjs";
import { createMemoryFollowStore } from "./follow-store.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function read(rel) {
  return fs.readFileSync(path.join(ROOT, rel), "utf8");
}

async function notify(env, headers) {
  return dispatchFollowRequest({
    method: "POST",
    pathname: "/api/follows/notify/process",
    headers,
    env,
    store: createMemoryFollowStore(),
    sendEmail: async () => {
      throw new Error("must not send");
    },
  });
}

test("notify endpoint rejects a missing secret and an empty server secret", async () => {
  const missing = await notify({ FOLLOW_NOTIFY_SECRET: "notify-secret", FOLLOW_EMAILS_ENABLED: "false" }, {});
  assert.equal(missing.status, 401);
  assert.equal(missing.json.error, "unauthorized");

  const wrong = await notify(
    { FOLLOW_NOTIFY_SECRET: "notify-secret" },
    { "x-follow-notify-secret": "nope" }
  );
  assert.equal(wrong.status, 401);

  const empty = await notify({ FOLLOW_NOTIFY_SECRET: "" }, { "x-follow-notify-secret": "" });
  assert.equal(empty.status, 401);

  const blank = await notify({ FOLLOW_NOTIFY_SECRET: "   " }, { "x-follow-notify-secret": "secret" });
  assert.equal(blank.status, 401);
});

test(".env.example lists follow mail settings and keeps new-post mail off", () => {
  const example = read(".env.example");
  for (const name of [
    "RESEND_API_KEY",
    "FOLLOW_TOKEN_SECRET",
    "FOLLOW_NOTIFY_SECRET",
    "FOLLOW_EMAIL_FROM",
    "POSTAL_ADDRESS",
    "FOLLOW_EMAILS_ENABLED",
  ]) {
    assert.match(example, new RegExp(`^#?\\s*${name}=`, "m"), name);
  }
  assert.match(example, /FOLLOW_EMAILS_ENABLED=false/);
  assert.match(example, /follow_notify_secret/);
  assert.match(example, /x-follow-notify-secret/);
  assert.match(example, /openssl rand -base64 32/);
  assert.doesNotMatch(example, /re_[A-Za-z0-9]{8,}/);
});

test("server wires follow routes and does not copy the unauthenticated reader list", () => {
  const index = read("server/index.mjs");
  assert.match(index, /tryHandleFollowRequest/);
  assert.match(index, /writerHtmlForWallet/);
  assert.match(index, /canonicalWriterPath/);
  const follows = read("server/follows.mjs");
  assert.match(follows, /x-follow-notify-secret/);
  assert.match(follows, /secretsMatch|requestHasHeaderSecret/);
  assert.doesNotMatch(follows, /\/api\/subscriptions\?reader/);
  assert.match(read("server/openapi.mjs"), /\/api\/writers\/\{wallet\}/);
  assert.match(read("openapi.json"), /\/api\/writers\/\{wallet\}\/followers\/count/);
  assert.match(read("llms.txt"), /\/api\/writers\/\{wallet\}/);
});

test("UI surfaces follow without nesting the button inside the card link", () => {
  const feed = read("articles.html");
  assert.match(feed, /createElement\("article"\)/);
  assert.match(feed, /className = "item"/);
  assert.match(feed, /follow\.js/);
  assert.match(feed, /class="follow-slot"/);
  assert.match(feed, /id="tabFollowing"/);
  assert.match(feed, /Follow a writer to see their new posts here/);
  assert.match(feed, /\/api\/follows\/me\/feed/);
  assert.match(feed, /\/api\/writers\/followers\/counts/);
  assert.match(feed, /class="followers"/);
  assert.match(feed, /\$\{n\} followers/);
  const account = read("src/publisher/PublisherApp.tsx");
  assert.match(account, /Following & memberships/);
  assert.match(account, /\/api\/follows\/me\/roster/);
  assert.match(account, /\/api\/subscriptions\/cancel/);
  assert.match(account, /establishReaderSession/);
  assert.match(account, /READER_SESSION_HEADER/);
  assert.match(account, /fetch\("\/api\/subscriptions", \{ headers \}\)/);
  assert.match(account, /JSON\.stringify\(\{ writer \}\)/);
  assert.match(account, /Unfollow/);
  assert.doesNotMatch(account, /card-title">Following</);
  assert.doesNotMatch(account, /\/api\/subscriptions\?reader=/);
  assert.doesNotMatch(account, /JSON\.stringify\(\{ reader, writer \}\)/);
  assert.doesNotMatch(account, /\/api\/follows\/me\/roster\?/);
  assert.match(feed, /title a::after/);
  assert.doesNotMatch(feed, /createElement\("a"\)[\s\S]{0,120}className = "item"/);

  const article = read("article.html");
  assert.match(article, /id="followSlot"/);
  assert.match(article, /mon:unlocked/);
  assert.match(article, /Enjoyed this\? Follow/);
  assert.match(article, /unlock=1|get\("unlock"\)/);
  assert.match(article, /follow\.js/);

  const dashboard = read("dashboard.html");
  assert.match(dashboard, />Followers</);
  assert.match(dashboard, /Paid membership \(optional\)/);
  assert.match(dashboard, /Open Paywall followers export v1/);
  assert.match(dashboard, /Your list is yours/);
  assert.match(dashboard, /exportFollowers/);

  assert.match(read("follow.js"), /Open Paywall follower v1/);
  assert.match(read("follow.js"), /Check your inbox/);
  assert.match(read("follow.js"), /Too many tries/);
  assert.match(read("writer.html"), /0 followers/);
  assert.match(read("writer.html"), /Be the first to follow/);
  assert.match(read("writer.html"), /Free\. No subscription/);
  assert.match(read("follow-confirm.html"), /id="confirm"/);
  assert.match(read("privacy.html"), /double opt-in/i);
  assert.match(read("Dockerfile"), /writer\.html/);
  assert.match(read("Dockerfile"), /follow-confirm\.html/);
  assert.match(read("Dockerfile"), /privacy\.html/);
  assert.match(read("Dockerfile"), /follow\.js/);
});
