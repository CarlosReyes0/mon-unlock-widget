/**
 * Follow / unfollow, confirm, one-click unsubscribe, notify dedupe, and the
 * flag-off path (no new-post email). Uses an in-memory store — no live Supabase.
 */
import assert from "node:assert/strict";
import http from "node:http";
import { test } from "node:test";
import { privateKeyToAccount } from "viem/accounts";
import { createMemoryFollowStore } from "./follow-store.mjs";
import { signReaderSessionToken } from "./reader-session.mjs";
import {
  buildFollowerAuthMessage,
  buildFollowersExportAuthMessage,
  canonicalWriterPath,
  dispatchFollowRequest,
  followerCountLabel,
  newPostEmailsAllowed,
  processFollowNotifications,
  usdPriceParts,
} from "./follows.mjs";
import {
  followerToken,
  sha256Hex,
  unsubscribeToken,
} from "./follow-core.mjs";

const KEY = "0xac0974bec39a17e36ba4a6b4d4aad435cce0e4c9335790421507b8a191e28881";
const OTHER_KEY = "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d";
const account = privateKeyToAccount(KEY);
const other = privateKeyToAccount(OTHER_KEY);
const WRITER = account.address.toLowerCase();
const OTHER = other.address.toLowerCase();

function baseEnv(extra = {}) {
  return {
    RESEND_API_KEY: "re_test",
    FOLLOW_TOKEN_SECRET: "test-follow-token-secret",
    FOLLOW_NOTIFY_SECRET: "notify-secret",
    FOLLOW_EMAIL_FROM: "posts@mail.openpaywall.app",
    FOLLOW_EMAILS_ENABLED: "false",
    POSTAL_ADDRESS: "",
    PUBLIC_ORIGIN: "https://openpaywall.app",
    ...extra,
  };
}

function listen(handler) {
  const server = http.createServer(handler);
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      resolve({ server, origin: `http://127.0.0.1:${port}` });
    });
  });
}

function close(server) {
  return new Promise((resolve) => server.close(resolve));
}

async function start({ store, env, sendEmail, clock }) {
  const { server, origin } = await listen(async (req, res) => {
    const url = new URL(req.url, origin);
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const raw = Buffer.concat(chunks).toString("utf8");
    let body = {};
    if (raw) {
      try {
        body = JSON.parse(raw);
      } catch {
        body = {};
      }
    }
    const result = await dispatchFollowRequest({
      method: req.method,
      pathname: url.pathname,
      searchParams: url.searchParams,
      headers: req.headers,
      body,
      ip: String(req.headers["x-forwarded-for"] || "127.0.0.1"),
      store,
      env,
      sendEmail,
      now: clock.now,
    });
    if (!result) {
      res.writeHead(404);
      res.end();
      return;
    }
    if (result.html != null) {
      res.writeHead(result.status, { "content-type": "text/html; charset=utf-8" });
      res.end(result.html);
      return;
    }
    if (result.text != null) {
      res.writeHead(result.status, {
        "content-type": "text/csv; charset=utf-8",
        ...(result.headers || {}),
      });
      res.end(result.text);
      return;
    }
    res.writeHead(result.status, {
      "content-type": "application/json; charset=utf-8",
      ...(result.headers || {}),
    });
    res.end(JSON.stringify(result.json ?? {}));
  });
  return { server, origin };
}

function article(overrides = {}) {
  return {
    article_id: "hello-world",
    title: "Hello",
    author: "Ada Lovelace",
    teaser: "<p>A short teaser about the piece.</p>",
    price_cents: 50,
    price_wei: "500000",
    payment_asset: "usdc",
    publisher: WRITER,
    listing_status: "listed",
    registration_status: "registered",
    listed_at: "2026-10-01T00:00:00.000Z",
    followers_notified_at: null,
    ...overrides,
  };
}

test("wallet and email normalization reject bad input and lowercase email", async () => {
  const store = createMemoryFollowStore();
  const sent = [];
  const { server, origin } = await start({
    store,
    env: baseEnv(),
    sendEmail: async (message) => {
      sent.push(message);
      return { ok: true, id: "re_1" };
    },
    clock: { now: Date.now() },
  });
  try {
    const badWallet = await fetch(`${origin}/api/follows/email`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-forwarded-for": "10.0.0.1" },
      body: JSON.stringify({ writer: "0x123", email: "ada@example.com", via: "feed" }),
    });
    assert.equal(badWallet.status, 400);
    assert.equal((await badWallet.json()).error, "invalid_writer");

    const badEmail = await fetch(`${origin}/api/follows/email`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-forwarded-for": "10.0.0.1" },
      body: JSON.stringify({ writer: WRITER, email: "not-an-email", via: "feed" }),
    });
    assert.equal(badEmail.status, 400);

    const ok = await fetch(`${origin}/api/follows/email`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-forwarded-for": "10.0.0.2" },
      body: JSON.stringify({ writer: WRITER.toUpperCase(), email: "Ada@Example.com", via: "feed" }),
    });
    assert.equal(ok.status, 202);
    const row = await store.findFollowByEmail(WRITER, "ada@example.com");
    assert.ok(row);
    assert.equal(row.follower_email, "ada@example.com");
    assert.equal(sent.length, 1);
    assert.equal(sent[0].to, "ada@example.com");
  } finally {
    await close(server);
  }
});

test("email follow returns the same 202 for new, existing, and suppressed", async () => {
  const store = createMemoryFollowStore({
    articles: [article()],
    follows: [
      {
        id: 1,
        writer_wallet: WRITER,
        follower_email: "kept@example.com",
        follower_wallet: null,
        source: "email",
        verified_at: "2026-10-01T00:00:00.000Z",
        unsubscribed_at: null,
        confirm_sent_count: 1,
        last_confirm_sent_at: "2026-10-01T00:00:00.000Z",
      },
    ],
    suppressions: [{ email: "gone@example.com", reason: "global_unsubscribe" }],
  });
  const sent = [];
  const { server, origin } = await start({
    store,
    env: baseEnv(),
    sendEmail: async (message) => {
      sent.push(message);
      return { ok: true, id: "re_1" };
    },
    clock: { now: Date.parse("2026-10-08T00:00:00.000Z") },
  });
  try {
    const bodies = [];
    for (const email of ["new@example.com", "kept@example.com", "gone@example.com"]) {
      const res = await fetch(`${origin}/api/follows/email`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-forwarded-for": "10.2.0.1" },
        body: JSON.stringify({ writer: WRITER, email, via: "article" }),
      });
      assert.equal(res.status, 202);
      bodies.push(await res.json());
    }
    assert.deepEqual(bodies[0], { status: "check_inbox" });
    assert.deepEqual(bodies[1], bodies[0]);
    assert.deepEqual(bodies[2], bodies[0]);
    assert.equal(sent.length, 1);
    assert.equal(sent[0].to, "new@example.com");
    assert.equal(await store.isSuppressed("gone@example.com"), true);
    assert.equal(await store.findFollowByEmail(WRITER, "gone@example.com"), null);
  } finally {
    await close(server);
  }
});

test("confirm email is not resent within 10 minutes", async () => {
  const store = createMemoryFollowStore({ articles: [article()] });
  const sent = [];
  const { server, origin } = await start({
    store,
    env: baseEnv(),
    sendEmail: async (message) => {
      sent.push(message);
      return { ok: true, id: "re_1" };
    },
    clock: { now: Date.parse("2026-10-08T12:00:00.000Z") },
  });
  try {
    const post = () =>
      fetch(`${origin}/api/follows/email`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-forwarded-for": "10.3.0.8" },
        body: JSON.stringify({ writer: WRITER, email: "ada@example.com", via: "feed" }),
      });
    const first = await post();
    const second = await post();
    assert.equal(first.status, 202);
    assert.equal(second.status, 202);
    assert.deepEqual(await second.json(), { status: "check_inbox" });
    assert.equal(sent.length, 1);
  } finally {
    await close(server);
  }
});

test("confirm token is hashed, single-use, and expiry rejects", async () => {
  const store = createMemoryFollowStore({ articles: [article()] });
  const sent = [];
  const clock = { now: Date.parse("2026-10-08T12:00:00.000Z") };
  const { server, origin } = await start({
    store,
    env: baseEnv(),
    sendEmail: async (message) => {
      sent.push(message);
      return { ok: true, id: "re_1" };
    },
    clock,
  });
  try {
    const created = await fetch(`${origin}/api/follows/email`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-forwarded-for": "10.4.0.1" },
      body: JSON.stringify({ writer: WRITER, email: "ada@example.com", via: "writer_page" }),
    });
    assert.equal(created.status, 202);
    const link = sent[0].text.match(/https:\/\/openpaywall\.app\/follow\/confirm\?t=([^\s]+)/);
    assert.ok(link, "confirm email contains a confirm link");
    const token = decodeURIComponent(link[1]);
    const pending = await store.findFollowByEmail(WRITER, "ada@example.com");
    assert.equal(pending.confirm_token_hash, sha256Hex(token));
    assert.notEqual(pending.confirm_token_hash, token);
    assert.equal(pending.verified_at, null);

    const confirm = await fetch(`${origin}/api/follows/confirm`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-forwarded-for": "10.4.0.1" },
      body: JSON.stringify({ t: token }),
    });
    assert.equal(confirm.status, 200);
    const body = await confirm.json();
    assert.equal(body.writer, WRITER);
    assert.equal(body.displayName, "Ada Lovelace");
    assert.ok(body.followerToken);
    const verified = await store.findFollowById(pending.id);
    assert.ok(verified.verified_at);
    assert.equal(verified.confirm_token_hash, null);
    const count = await store.countFollowers(WRITER);
    assert.equal(count.followers, 1);

    const again = await fetch(`${origin}/api/follows/confirm`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ t: token }),
    });
    assert.equal(again.status, 400);
    assert.equal((await again.json()).error, "invalid_token");

    await store.insertFollow({
      writer_wallet: WRITER,
      follower_email: "old@example.com",
      follower_wallet: null,
      source: "email",
      confirm_token_hash: sha256Hex("expired-token"),
      confirm_expires_at: "2020-01-01T00:00:00.000Z",
      confirm_sent_count: 1,
    });
    const expired = await fetch(`${origin}/api/follows/confirm`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ t: "expired-token" }),
    });
    assert.equal(expired.status, 400);
    assert.equal((await expired.json()).error, "expired_token");
  } finally {
    await close(server);
  }
});

test("one-click unsubscribe verifies the HMAC, rejects tampering, and is idempotent", async () => {
  const store = createMemoryFollowStore({
    articles: [article()],
    follows: [
      {
        id: 7,
        writer_wallet: WRITER,
        follower_email: "ada@example.com",
        follower_wallet: null,
        source: "email",
        verified_at: "2026-10-01T00:00:00.000Z",
        unsubscribed_at: null,
      },
    ],
  });
  const env = baseEnv();
  const { server, origin } = await start({
    store,
    env,
    sendEmail: async () => ({ ok: true }),
    clock: { now: Date.parse("2026-10-08T12:00:00.000Z") },
  });
  try {
    const token = unsubscribeToken(7, env.FOLLOW_TOKEN_SECRET);
    const peek = await fetch(`${origin}/api/follows/unsubscribe?t=${encodeURIComponent(token)}`, {
      headers: { "x-forwarded-for": "10.5.0.1" },
    });
    assert.equal(peek.status, 200);
    const peekHtml = await peek.text();
    assert.match(peekHtml, /Unfollow Ada Lovelace/);
    assert.equal((await store.findFollowById(7)).unsubscribed_at, null);

    const tampered = `${token.slice(0, -2)}aa`;
    const bad = await fetch(`${origin}/api/follows/unsubscribe?t=${encodeURIComponent(tampered)}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ t: tampered }),
    });
    assert.equal(bad.status, 400);

    const ok = await fetch(`${origin}/api/follows/unsubscribe?t=${encodeURIComponent(token)}`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-forwarded-for": "10.5.0.1" },
      body: JSON.stringify({ t: token }),
    });
    assert.equal(ok.status, 200);
    assert.equal((await ok.json()).unsubscribed, true);
    assert.ok((await store.findFollowById(7)).unsubscribed_at);

    const again = await fetch(`${origin}/api/follows/unsubscribe?t=${encodeURIComponent(token)}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "List-Unsubscribe=One-Click",
    });
    assert.equal(again.status, 200);

    const stop = await fetch(`${origin}/api/follows/unsubscribe?t=${encodeURIComponent(token)}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ t: token, action: "stop_all" }),
    });
    assert.equal(stop.status, 200);
    assert.equal((await stop.json()).stoppedAll, true);
    assert.equal(await store.isSuppressed("ada@example.com"), true);
  } finally {
    await close(server);
  }
});

test("wallet follow is one signature then unfollow; self-follow is 400; stale export is 401", async () => {
  const store = createMemoryFollowStore({ articles: [article()] });
  const env = baseEnv();
  const { server, origin } = await start({
    store,
    env,
    sendEmail: async () => {
      throw new Error("email should not send for wallet follow");
    },
    clock: { now: Date.parse("2026-10-08T12:00:00.000Z") },
  });
  try {
    const issuedAt = "2026-10-08T12:00:00.000Z";
    const message = buildFollowerAuthMessage({
      wallet: account.address,
      origin: "openpaywall.app",
      issuedAt,
    });
    assert.match(message, /^Open Paywall follower v1\nchain:143\nwallet:0x/);
    const sig = await account.signMessage({ message });
    const session = await fetch(`${origin}/api/follows/session`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-forwarded-for": "10.6.0.1" },
      body: JSON.stringify({ wallet: account.address, issuedAt, sig, origin: "openpaywall.app" }),
    });
    assert.equal(session.status, 200);
    const { followerToken } = await session.json();
    assert.ok(followerToken);

    const self = await fetch(`${origin}/api/follows/wallet`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${followerToken}`,
        "x-forwarded-for": "10.6.0.1",
      },
      body: JSON.stringify({ writer: WRITER, via: "article" }),
    });
    assert.equal(self.status, 400);
    assert.equal((await self.json()).error, "self_follow");

    const staleAt = "2026-10-08T11:00:00.000Z";
    const staleMessage = buildFollowerAuthMessage({
      wallet: account.address,
      origin: "openpaywall.app",
      issuedAt: staleAt,
    });
    const staleSig = await account.signMessage({ message: staleMessage });
    const stale = await fetch(`${origin}/api/follows/session`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-forwarded-for": "10.6.0.2" },
      body: JSON.stringify({
        wallet: account.address,
        issuedAt: staleAt,
        sig: staleSig,
        origin: "openpaywall.app",
      }),
    });
    assert.equal(stale.status, 401);

    const otherSessionMsg = buildFollowerAuthMessage({
      wallet: other.address,
      origin: "openpaywall.app",
      issuedAt,
    });
    const otherSig = await other.signMessage({ message: otherSessionMsg });
    const otherSession = await fetch(`${origin}/api/follows/session`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-forwarded-for": "10.6.0.3" },
      body: JSON.stringify({ wallet: other.address, issuedAt, sig: otherSig, origin: "openpaywall.app" }),
    });
    const otherToken = (await otherSession.json()).followerToken;
    const follow = await fetch(`${origin}/api/follows/wallet`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${otherToken}`,
        "x-forwarded-for": "10.6.0.3",
      },
      body: JSON.stringify({ writer: WRITER, via: "article" }),
    });
    assert.equal(follow.status, 200);
    assert.equal((await store.countFollowers(WRITER)).followers, 1);

    const away = await fetch(`${origin}/api/follows/wallet`, {
      method: "DELETE",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${otherToken}`,
        "x-forwarded-for": "10.6.0.3",
      },
      body: JSON.stringify({ writer: WRITER }),
    });
    assert.equal(away.status, 200);
    assert.equal((await away.json()).following, false);
    assert.equal((await store.countFollowers(WRITER)).followers, 0);

    const exportMessage = buildFollowersExportAuthMessage({ writer: WRITER, issuedAt });
    const exportSig = await other.signMessage({ message: exportMessage });
    const denied = await fetch(`${origin}/api/writers/followers/export`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-forwarded-for": "10.6.0.4" },
      body: JSON.stringify({ writer: WRITER, issuedAt, sig: exportSig }),
    });
    assert.equal(denied.status, 401);

    const oldExport = buildFollowersExportAuthMessage({
      writer: WRITER,
      issuedAt: "2026-10-07T12:00:00.000Z",
    });
    const oldSig = await account.signMessage({ message: oldExport });
    const staleExport = await fetch(`${origin}/api/writers/followers/export`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-forwarded-for": "10.6.0.5" },
      body: JSON.stringify({ writer: WRITER, issuedAt: "2026-10-07T12:00:00.000Z", sig: oldSig }),
    });
    assert.equal(staleExport.status, 401);
  } finally {
    await close(server);
  }
});

test("email follow rate limit returns 429", async () => {
  const store = createMemoryFollowStore();
  const { server, origin } = await start({
    store,
    env: baseEnv(),
    sendEmail: async () => ({ ok: true, id: "re_1" }),
    clock: { now: Date.parse("2026-10-08T15:00:00.000Z") },
  });
  try {
    let last = 0;
    for (let i = 0; i < 11; i++) {
      const res = await fetch(`${origin}/api/follows/email`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-forwarded-for": "10.9.9.9" },
        body: JSON.stringify({ writer: WRITER, email: `r${i}@example.com`, via: "feed" }),
      });
      last = res.status;
    }
    assert.equal(last, 429);
  } finally {
    await close(server);
  }
});

test("missing Resend key hides email with 503 and config.email false", async () => {
  const store = createMemoryFollowStore();
  const { server, origin } = await start({
    store,
    env: baseEnv({ RESEND_API_KEY: "" }),
    sendEmail: async () => {
      throw new Error("should not send");
    },
    clock: { now: Date.now() },
  });
  try {
    const config = await fetch(`${origin}/api/follows/config`);
    assert.equal(config.status, 200);
    assert.equal((await config.json()).email, false);
    const res = await fetch(`${origin}/api/follows/email`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-forwarded-for": "10.8.0.1" },
      body: JSON.stringify({ writer: WRITER, email: "ada@example.com" }),
    });
    assert.equal(res.status, 503);
    assert.equal((await res.json()).error, "email_not_configured");
  } finally {
    await close(server);
  }
});

test("public follower count includes 0 and writer profile lists articles", async () => {
  const store = createMemoryFollowStore({ articles: [article()] });
  const { server, origin } = await start({
    store,
    env: baseEnv(),
    sendEmail: async () => ({ ok: true }),
    clock: { now: Date.now() },
  });
  try {
    const count = await fetch(`${origin}/api/writers/${WRITER.toUpperCase()}/followers/count`);
    assert.equal(count.status, 200);
    assert.deepEqual(await count.json(), { followers: 0 });
    const page = await fetch(`${origin}/api/writers/${WRITER}`);
    assert.equal(page.status, 200);
    const body = await page.json();
    assert.equal(body.displayName, "Ada Lovelace");
    assert.equal(body.followers, 0);
    assert.equal(body.articles.length, 1);
    assert.equal(body.articles[0].priceLabel, "$0.50");
    assert.equal(followerCountLabel(0), "0 followers");
  } finally {
    await close(server);
  }
});

test("uppercase writer paths redirect to lowercase", () => {
  assert.equal(
    canonicalWriterPath(`/writers/${WRITER.toUpperCase()}`),
    `/writers/${WRITER}`
  );
  assert.equal(canonicalWriterPath(`/writers/${WRITER}`), null);
});

function notifyEnv(extra = {}) {
  return baseEnv({
    FOLLOW_EMAILS_ENABLED: "true",
    POSTAL_ADDRESS: "PO Box 100, Austin, TX 78701",
    ...extra,
  });
}

async function seedDue(store, extra = {}) {
  await store.insertNotification({
    article_id: extra.article_id || "hello-world",
    writer_wallet: WRITER,
    send_after: "2026-10-08T00:00:00.000Z",
    status: "pending",
    attempts: 0,
  });
}

test("flag off sends no new-post email and leaves the outbox pending", async () => {
  const store = createMemoryFollowStore({
    articles: [article()],
    follows: [
      {
        id: 1,
        writer_wallet: WRITER,
        follower_email: "ada@example.com",
        source: "email",
        verified_at: "2026-10-01T00:00:00.000Z",
        unsubscribed_at: null,
      },
    ],
  });
  await seedDue(store);
  let calls = 0;
  const env = baseEnv();
  assert.equal(newPostEmailsAllowed(env).ok, false);
  const result = await processFollowNotifications({
    headers: { "x-follow-notify-secret": env.FOLLOW_NOTIFY_SECRET },
    env,
    store,
    now: Date.parse("2026-10-08T12:00:00.000Z"),
    sendEmail: async () => {
      calls += 1;
      return { ok: true, id: "nope" };
    },
  });
  assert.equal(result.status, 200);
  assert.equal(result.json.disabled, true);
  assert.equal(result.json.sent, 0);
  assert.equal(calls, 0);
  assert.equal(store.notifications[0].status, "pending");

  const postalOnly = await processFollowNotifications({
    headers: { "x-follow-notify-secret": env.FOLLOW_NOTIFY_SECRET },
    env: baseEnv({ FOLLOW_EMAILS_ENABLED: "true", POSTAL_ADDRESS: "" }),
    store,
    now: Date.parse("2026-10-08T12:00:00.000Z"),
    sendEmail: async () => {
      calls += 1;
      return { ok: true };
    },
  });
  assert.equal(postalOnly.json.reason, "postal_address_missing");
  assert.equal(calls, 0);
  assert.equal(store.notifications[0].status, "pending");
});

test("notify job dedupes titles, skips unlisted and suppressed, and does not resend", async () => {
  const store = createMemoryFollowStore({
    articles: [
      article(),
      article({
        article_id: "hello-again",
        title: "Hello",
        listed_at: "2026-10-02T00:00:00.000Z",
      }),
      article({
        article_id: "draft",
        title: "Draft",
        listing_status: "unlisted",
      }),
    ],
    follows: [
      {
        id: 1,
        writer_wallet: WRITER,
        follower_email: "ada@example.com",
        source: "email",
        verified_at: "2026-10-01T00:00:00.000Z",
        unsubscribed_at: null,
      },
      {
        id: 2,
        writer_wallet: WRITER,
        follower_email: "stop@example.com",
        source: "email",
        verified_at: "2026-10-01T00:00:00.000Z",
        unsubscribed_at: null,
      },
    ],
    suppressions: [{ email: "stop@example.com", reason: "bounce" }],
  });
  await seedDue(store, { article_id: "hello-world" });
  await seedDue(store, { article_id: "hello-again" });
  await seedDue(store, { article_id: "draft" });
  const sent = [];
  const env = notifyEnv();
  const now = Date.parse("2026-10-08T12:00:00.000Z");
  const first = await processFollowNotifications({
    headers: { "x-follow-notify-secret": env.FOLLOW_NOTIFY_SECRET },
    env,
    store,
    now,
    sendEmail: async (message) => {
      sent.push(message);
      return { ok: true, id: "re_post" };
    },
  });
  assert.equal(first.json.disabled, false);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].to, "ada@example.com");
  assert.equal(sent[0].subject, "Hello");
  assert.match(sent[0].fromHeader, /Ada Lovelace via Open Paywall/);
  assert.match(sent[0].fromHeader, /posts@mail\.openpaywall\.app/);
  assert.match(sent[0].text, /\$0\.50 to read/);
  assert.match(sent[0].html, /ref=follow&amp;unlock=1|ref=follow&unlock=1/);
  assert.match(sent[0].text, /PO Box 100, Austin, TX 78701/);
  assert.match(sent[0].headers["List-Unsubscribe"], /api\/follows\/unsubscribe\?t=/);
  assert.equal(sent[0].headers["List-Unsubscribe-Post"], "List-Unsubscribe=One-Click");
  assert.equal(sent[0].idempotencyKey.startsWith("follow-"), true);
  assert.doesNotMatch(`${sent[0].text}\n${sent[0].html}\n${sent[0].subject}`, /\bMON\b/);
  const suppressed = store.deliveries.find((row) => row.follow_id === 2);
  assert.equal(suppressed.status, "suppressed");
  assert.equal(store.notifications.find((row) => row.article_id === "hello-again").skip_reason, "duplicate");
  assert.equal(store.notifications.find((row) => row.article_id === "draft").skip_reason, "unlisted");

  store.notifications.find((row) => row.article_id === "hello-world").status = "pending";
  store.notifications.find((row) => row.article_id === "hello-world").send_after = "2026-10-08T00:00:00.000Z";
  await processFollowNotifications({
    headers: { "x-follow-notify-secret": env.FOLLOW_NOTIFY_SECRET },
    env,
    store,
    now,
    sendEmail: async (message) => {
      sent.push(message);
      return { ok: true, id: "re_again" };
    },
  });
  assert.equal(sent.length, 1);
  assert.equal(store.deliveries.filter((row) => row.status === "sent").length, 1);
});

test("quota exceeded leaves the notification pending and sends nothing further", async () => {
  const store = createMemoryFollowStore({
    articles: [article({ payment_asset: "mon", price_cents: null, price_wei: "1000000000000000000" })],
    follows: [
      {
        id: 1,
        writer_wallet: WRITER,
        follower_email: "ada@example.com",
        source: "email",
        verified_at: "2026-10-01T00:00:00.000Z",
        unsubscribed_at: null,
      },
    ],
  });
  await seedDue(store);
  const env = notifyEnv();
  const result = await processFollowNotifications({
    headers: { "x-follow-notify-secret": env.FOLLOW_NOTIFY_SECRET },
    env,
    store,
    now: Date.parse("2026-10-08T12:00:00.000Z"),
    sendEmail: async () => ({ ok: false, error: "daily_quota_exceeded" }),
  });
  assert.equal(result.json.sent, 0);
  const note = store.notifications[0];
  assert.equal(note.status, "pending");
  assert.ok(Date.parse(note.send_after) > Date.parse("2026-10-08T12:00:00.000Z"));
  assert.equal(usdPriceParts({ payment_asset: "mon", price_wei: "1" }).label, "$0.50");
});

test("notify HTTP endpoint stays quiet when the flag is off", async () => {
  const store = createMemoryFollowStore({
    articles: [article()],
    follows: [
      {
        id: 1,
        writer_wallet: WRITER,
        follower_email: "ada@example.com",
        source: "email",
        verified_at: "2026-10-01T00:00:00.000Z",
        unsubscribed_at: null,
      },
    ],
  });
  await seedDue(store);
  let calls = 0;
  const { server, origin } = await start({
    store,
    env: baseEnv(),
    sendEmail: async () => {
      calls += 1;
      return { ok: true };
    },
    clock: { now: Date.parse("2026-10-08T12:00:00.000Z") },
  });
  try {
    const res = await fetch(`${origin}/api/follows/notify/process`, {
      method: "POST",
      headers: { "x-follow-notify-secret": "notify-secret" },
    });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.disabled, true);
    assert.equal(body.sent, 0);
    assert.equal(calls, 0);
    assert.equal(store.notifications[0].status, "pending");
  } finally {
    await close(server);
  }
});

test("feed counts include 0 and the account roster merges follows with live memberships", async () => {
  const member = "0x00000000000000000000000000000000000000a1";
  const both = "0x00000000000000000000000000000000000000b2";
  const nobody = "0x00000000000000000000000000000000000000c3";
  const reader = other.address.toLowerCase();
  const now = Date.parse("2026-10-08T12:00:00.000Z");
  const store = createMemoryFollowStore({
    articles: [
      article(),
      article({
        article_id: "grace",
        title: "Grace notes",
        author: "Grace Hopper",
        publisher: member,
      }),
      article({
        article_id: "both-piece",
        title: "Both sides",
        author: "Lin",
        publisher: both,
      }),
    ],
    plans: [
      { publisher: member, monthly_price_cents: 500 },
      { publisher: both, monthly_price_cents: 700 },
    ],
    memberships: [
      {
        reader,
        writer: member,
        status: "active",
        canceled_at: null,
        current_period_end: "2026-12-01T00:00:00.000Z",
      },
      {
        reader,
        writer: both,
        status: "active",
        canceled_at: null,
        current_period_end: "2026-11-15T00:00:00.000Z",
      },
      {
        reader,
        writer: WRITER,
        status: "active",
        canceled_at: "2026-10-01T00:00:00.000Z",
        current_period_end: "2026-12-01T00:00:00.000Z",
      },
    ],
  });
  await store.insertFollow({
    writer_wallet: member,
    follower_email: "pending@example.com",
    source: "email",
    verified_at: null,
    unsubscribed_at: null,
  });
  assert.deepEqual(await store.countFollowersMany([member, nobody]), { [member]: 0, [nobody]: 0 });
  assert.deepEqual(await store.listLiveMemberships(reader), [
    { writer: member, current_period_end: "2026-12-01T00:00:00.000Z" },
    { writer: both, current_period_end: "2026-11-15T00:00:00.000Z" },
  ]);

  const env = baseEnv({ READER_SESSION_SECRET: "test-reader-session-secret" });
  const { server, origin } = await start({
    store,
    env,
    sendEmail: async () => {
      throw new Error("roster should not send email");
    },
    clock: { now },
  });
  try {
    const openList = await fetch(`${origin}/api/follows?reader=${reader}`);
    assert.equal(openList.status, 404);

    const denied = await fetch(`${origin}/api/follows/me/roster`);
    assert.equal(denied.status, 401);

    const issuedAt = "2026-10-08T12:00:00.000Z";
    const message = buildFollowerAuthMessage({
      wallet: other.address,
      origin: "openpaywall.app",
      issuedAt,
    });
    const sig = await other.signMessage({ message });
    const session = await fetch(`${origin}/api/follows/session`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-forwarded-for": "10.9.0.1" },
      body: JSON.stringify({ wallet: other.address, issuedAt, sig, origin: "openpaywall.app" }),
    });
    const { followerToken: token } = await session.json();
    const auth = { authorization: `Bearer ${token}`, "content-type": "application/json" };
    for (const writer of [WRITER, both]) {
      const follow = await fetch(`${origin}/api/follows/wallet`, {
        method: "POST",
        headers: { ...auth, "x-forwarded-for": "10.9.0.1" },
        body: JSON.stringify({ writer, via: "feed" }),
      });
      assert.equal(follow.status, 200);
    }

    const counts = await fetch(
      `${origin}/api/writers/followers/counts?wallets=${[WRITER, member, both, nobody, "nope"].join(",")}`
    );
    assert.equal(counts.status, 200);
    assert.equal(counts.headers.get("cache-control"), "public, max-age=60");
    assert.deepEqual(await counts.json(), {
      counts: { [WRITER]: 1, [member]: 0, [both]: 1, [nobody]: 0 },
    });

    const feed = await fetch(`${origin}/api/follows/me/feed`, { headers: auth });
    assert.equal(feed.status, 200);
    const feedBody = await feed.json();
    assert.equal(feedBody.following, 2);
    assert.equal(feedBody.articles.length, 2);
    assert.equal(feedBody.articles.find((row) => row.publisher === WRITER).followers, 1);
    assert.equal(feedBody.articles.find((row) => row.publisher === both).followers, 1);

    const otherWallet = "0x00000000000000000000000000000000000000d4";
    const feedForOther = await fetch(`${origin}/api/follows/me/feed?reader=${otherWallet}`, { headers: auth });
    assert.equal(feedForOther.status, 200);
    const feedForOtherBody = await feedForOther.json();
    assert.equal(feedForOtherBody.following, feedBody.following);
    assert.deepEqual(
      feedForOtherBody.articles.map((row) => row.publisher),
      feedBody.articles.map((row) => row.publisher)
    );

    const emptyFeed = await fetch(`${origin}/api/follows/me/feed`, {
      headers: { authorization: "Bearer not-a-token" },
    });
    assert.equal(emptyFeed.status, 401);

    const roster = await fetch(`${origin}/api/follows/me/roster`, { headers: auth });
    assert.equal(roster.status, 200);
    const rosterBody = await roster.json();
    assert.deepEqual(
      rosterBody.writers.map((row) => row.wallet),
      [WRITER, both]
    );
    const ada = rosterBody.writers.find((row) => row.wallet === WRITER);
    const lin = rosterBody.writers.find((row) => row.wallet === both);
    assert.equal(ada.name, "Ada Lovelace");
    assert.equal(ada.following, true);
    assert.equal(ada.membership, null);
    assert.equal(lin.name, "Lin");
    assert.equal(lin.following, true);
    assert.equal(lin.membership, null);
    assert.equal(rosterBody.writers.some((row) => row.wallet === member), false);

    const claimed = await fetch(`${origin}/api/follows/me/roster?reader=${member}`, { headers: auth });
    assert.equal(claimed.status, 401);
    assert.equal((await claimed.json()).error, "reader_session_required");

    const domain = new URL(origin).host;
    const sessionToken = signReaderSessionToken(
      {
        address: reader,
        domain,
        issuedAt: Math.floor(now / 1000),
        expiresAt: Math.floor(now / 1000) + 3600,
      },
      env.READER_SESSION_SECRET
    );
    const withSession = await fetch(`${origin}/api/follows/me/roster`, {
      headers: { ...auth, "x-reader-session": sessionToken },
    });
    assert.equal(withSession.status, 200);
    const sessionBody = await withSession.json();
    assert.deepEqual(
      sessionBody.writers.map((row) => row.wallet),
      [WRITER, member, both]
    );
    const grace = sessionBody.writers.find((row) => row.wallet === member);
    const linPaid = sessionBody.writers.find((row) => row.wallet === both);
    assert.equal(grace.name, "Grace Hopper");
    assert.equal(grace.following, false);
    assert.deepEqual(grace.membership, { priceLabel: "$5/mo", renewsAt: "2026-12-01T00:00:00.000Z" });
    assert.equal(linPaid.following, true);
    assert.deepEqual(linPaid.membership, { priceLabel: "$7/mo", renewsAt: "2026-11-15T00:00:00.000Z" });
    assert.equal(sessionBody.writers.find((row) => row.wallet === WRITER).membership, null);

    const viaCookie = await fetch(`${origin}/api/follows/me/roster`, {
      headers: { ...auth, cookie: `op_reader=${encodeURIComponent(sessionToken)}` },
    });
    assert.equal(viaCookie.status, 200);
    assert.equal((await viaCookie.json()).writers.some((row) => row.membership), true);

    const wrong = signReaderSessionToken(
      {
        address: WRITER,
        domain,
        issuedAt: Math.floor(now / 1000),
        expiresAt: Math.floor(now / 1000) + 3600,
      },
      env.READER_SESSION_SECRET
    );
    const mismatch = await fetch(`${origin}/api/follows/me/roster`, {
      headers: { ...auth, "x-reader-session": wrong },
    });
    assert.equal(mismatch.status, 403);
    const mismatchBody = await mismatch.json();
    assert.equal(mismatchBody.error, "reader_mismatch");
    assert.equal(mismatchBody.writers, undefined);

    const otherClaim = await fetch(`${origin}/api/follows/me/roster?reader=${member}`, {
      headers: { ...auth, "x-reader-session": sessionToken },
    });
    assert.equal(otherClaim.status, 403);
    assert.equal((await otherClaim.json()).writers, undefined);

    const sessionOnly = await fetch(`${origin}/api/follows/me/roster`, {
      headers: { "x-reader-session": sessionToken },
    });
    assert.equal(sessionOnly.status, 401);
    assert.equal((await sessionOnly.json()).error, "unauthorized");

    const emailTok = followerToken({
      kind: "email",
      id: "ada@example.com",
      secret: env.FOLLOW_TOKEN_SECRET,
      now,
    });
    const emailRoster = await fetch(`${origin}/api/follows/me/roster`, {
      headers: { authorization: `Bearer ${emailTok}` },
    });
    assert.equal(emailRoster.status, 200);
    assert.deepEqual(await emailRoster.json(), { writers: [] });
  } finally {
    await close(server);
  }
});
