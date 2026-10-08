/**
 * Free per-writer follow.
 *
 * Email confirm sends when RESEND_API_KEY and FOLLOW_TOKEN_SECRET are set.
 * New-post mail stays off unless FOLLOW_EMAILS_ENABLED is true AND POSTAL_ADDRESS
 * is set. The footer prints that address and never invents one.
 */
import { verifyMessage } from "viem";
import { takeRateLimitToken } from "./relay-register.mjs";
import { dedupePublicArticles } from "./listings.mjs";
import { escapeHtml, publicOrigin } from "./article-og.mjs";
import { READER_SESSION_COOKIE, verifyReaderSessionToken } from "./reader-session.mjs";
import { createMemoryFollowStore, createSupabaseFollowStore } from "./follow-store.mjs";
import { confirmEmail, newPostEmail, sendResendEmail } from "./follow-mail.mjs";
import {
  CONSENT_VERSION,
  CONFIRM_TTL_MS,
  DAY_MS,
  HOUR_MS,
  TITLE_DEDUPE_MS,
  activeFollow,
  bearerToken,
  buildFollowerAuthMessage,
  buildFollowersExportAuthMessage,
  confirmSendAllowed,
  emailFollowAvailable,
  followerCountLabel,
  followerToken,
  followersToCsv,
  hashIp,
  headerSecret,
  isQuotaError,
  issuedAtFresh,
  limitFromEnv,
  newConfirmToken,
  newPostEmailsAllowed,
  nextConfirmCount,
  nextUtcMidnight,
  normalizeEmail,
  normalizeVia,
  normalizeWallet,
  originAllowed,
  postalAddress,
  readFollowerToken,
  readUnsubscribeToken,
  requestHasHeaderSecret,
  sha256Hex,
  shortWallet,
  titlesMatch,
  tokenSecret,
  usdPriceParts,
} from "./follow-core.mjs";

export { createMemoryFollowStore, createSupabaseFollowStore };
export {
  buildFollowerAuthMessage,
  buildFollowersExportAuthMessage,
  followerCountLabel,
  newPostEmailsAllowed,
  usdPriceParts,
};

const WRITER_RE = /^\/api\/writers\/(0x[a-fA-F0-9]{40})$/i;
const COUNT_RE = /^\/api\/writers\/(0x[a-fA-F0-9]{40})\/followers\/count$/i;

function jsonResult(status, body, headers = {}) {
  return { status, json: body, headers };
}

function htmlResult(status, html, headers = {}) {
  return { status, html, headers };
}

function textResult(status, text, headers = {}) {
  return { status, text, headers };
}

function writerArticle(row) {
  const price = usdPriceParts(row);
  const slug = String(row.article_id || "").trim();
  return {
    slug,
    title: row.title || slug,
    author: row.author || "",
    teaser: row.teaser || "",
    publisher: String(row.publisher || "").toLowerCase(),
    listedAt: row.listed_at || null,
    priceLabel: price.label,
    priceLine: price.line,
    href: `/articles/${encodeURIComponent(slug)}`,
  };
}

export async function loadWriterProfile(wallet, store) {
  const rows = await store.listListedArticlesByPublisher(wallet);
  const articles = dedupePublicArticles(rows.map(writerArticle));
  if (!articles.length) return null;
  const named = articles.find((article) => article.author && article.author !== "Author");
  const displayName = named?.author || shortWallet(wallet);
  const counts = await store.countFollowers(wallet);
  let plan = null;
  try {
    plan = await store.getPlan(wallet);
  } catch {
    plan = null;
  }
  return {
    wallet,
    displayName,
    followers: counts.followers,
    counts,
    plan,
    articles,
  };
}

function displayNameFromArticles(articles, wallet) {
  const named = (articles || []).find((article) => article.author && article.author !== "Author");
  return named?.author || shortWallet(wallet) || "this writer";
}

async function writerDisplayName(store, wallet) {
  const rows = await store.listListedArticlesByPublisher(wallet);
  return displayNameFromArticles(rows.map(writerArticle), wallet);
}

function allow(key, limit, windowMs, now) {
  return takeRateLimitToken(key, limit, windowMs, now);
}

async function verifyWalletMessage({ address, message, signature }) {
  try {
    return await verifyMessage({
      address,
      message,
      signature,
    });
  } catch {
    return false;
  }
}

function pageShell({ title, body }) {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta name="robots" content="noindex" />
  <title>${escapeHtml(title)}</title>
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600&family=Literata:opsz,wght@7..72,600&display=swap" rel="stylesheet" />
  <style>
    body { margin: 0; font-family: "DM Sans", system-ui, sans-serif; color: #111827; background: #fff; }
    main { width: min(36rem, calc(100% - 2rem)); margin: 3rem auto; }
    h1 { font-family: Literata, Georgia, serif; font-size: 1.8rem; font-weight: 600; }
    p { color: #57534e; line-height: 1.5; }
    a, button { font: inherit; }
    button, .btn { display: inline-block; background: #0f766e; color: #fff; border: 0; border-radius: 999px; padding: 0.65rem 1rem; text-decoration: none; cursor: pointer; }
    button.secondary, a.secondary { background: transparent; color: #0f766e; }
    .row { display: flex; gap: 0.75rem; flex-wrap: wrap; align-items: center; }
  </style>
</head>
<body><main>${body}</main></body></html>`;
}

export function writerNotFoundHtml() {
  return pageShell({
    title: "Writer not found — Open Paywall",
    body: `<h1>No listed articles for this writer</h1>
      <p>Follow is available once a writer lists a post on Open Paywall.</p>
      <p><a class="btn" href="/articles">All articles</a></p>`,
  });
}

function unsubscribeHtml({ name, token, state }) {
  const safeName = escapeHtml(name || "this writer");
  if (state === "invalid") {
    return pageShell({
      title: "Link expired — Open Paywall",
      body: `<h1>This unsubscribe link is not valid</h1>
        <p><a href="/articles">All articles</a></p>`,
    });
  }
  if (state === "done") {
    return pageShell({
      title: `Unfollowed ${name} — Open Paywall`,
      body: `<h1>Unfollowed ${safeName}</h1>
        <p>You will not get new-post emails for ${safeName}.</p>
        <div class="row">
          <button type="button" id="undo">Undo</button>
          <button type="button" class="secondary" id="stop">Stop all emails</button>
        </div>
        <p id="note"></p>
        <script>
          const token = ${JSON.stringify(token)};
          async function post(action) {
            const res = await fetch("/api/follows/unsubscribe?t=" + encodeURIComponent(token), {
              method: "POST",
              headers: { "Content-Type": "application/json", "Accept": "application/json" },
              body: JSON.stringify({ t: token, action })
            });
            const note = document.getElementById("note");
            if (!res.ok) { note.textContent = "Something went wrong. Try again."; return; }
            note.textContent = action === "stop_all"
              ? "All Open Paywall emails are stopped."
              : action === "undo"
                ? "You're following again."
                : "Unfollowed.";
          }
          document.getElementById("undo").onclick = () => post("undo");
          document.getElementById("stop").onclick = () => post("stop_all");
        </script>`,
    });
  }
  return pageShell({
    title: `Unfollow ${name} — Open Paywall`,
    body: `<h1>Unfollow ${safeName}?</h1>
      <p>You will stop getting new-post emails for ${safeName}. This does not affect posts you already paid for.</p>
      <div class="row">
        <button type="button" id="go">Unfollow</button>
        <button type="button" class="secondary" id="stop">Stop all emails</button>
      </div>
      <p id="note"></p>
      <script>
        const token = ${JSON.stringify(token)};
        async function post(action) {
          const res = await fetch("/api/follows/unsubscribe?t=" + encodeURIComponent(token), {
            method: "POST",
            headers: { "Content-Type": "application/json", "Accept": "application/json" },
            body: JSON.stringify({ t: token, action })
          });
          const note = document.getElementById("note");
          if (!res.ok) { note.textContent = "This link is not valid."; return; }
          const data = await res.json().catch(() => ({}));
          note.textContent = data.stoppedAll
            ? "All Open Paywall emails are stopped."
            : "Unfollowed " + (data.displayName || "this writer") + ".";
        }
        document.getElementById("go").onclick = () => post("unsubscribe");
        document.getElementById("stop").onclick = () => post("stop_all");
      </script>`,
  });
}

async function authedIdentity(ctx) {
  const secret = tokenSecret(ctx.env);
  if (!secret) return { error: jsonResult(503, { error: "follow_not_configured" }) };
  const token = bearerToken(ctx.headers);
  const identity = readFollowerToken(token, secret, ctx.now);
  if (!identity) return { error: jsonResult(401, { error: "unauthorized" }) };
  return { identity, token };
}

async function verifyExportSignature(ctx, writer) {
  const issuedAt = String(ctx.body?.issuedAt || headerSecret(ctx.headers, "x-writer-issued-at") || ctx.searchParams?.get("issuedAt") || "").trim();
  const sig = String(ctx.body?.sig || headerSecret(ctx.headers, "x-writer-sig") || ctx.searchParams?.get("sig") || "").trim();
  if (!issuedAtFresh(issuedAt, ctx.now)) return false;
  const message = buildFollowersExportAuthMessage({ writer, issuedAt });
  return verifyWalletMessage({ address: writer, message, signature: sig });
}

async function postEmail(ctx) {
  const writer = normalizeWallet(ctx.body?.writer);
  const email = normalizeEmail(ctx.body?.email);
  if (!writer) return jsonResult(400, { error: "invalid_writer" });
  if (!email) return jsonResult(400, { error: "invalid_email" });
  if (!String(ctx.env?.RESEND_API_KEY || "").trim()) {
    return jsonResult(503, { error: "email_not_configured" });
  }
  const secret = tokenSecret(ctx.env);
  if (!secret) return jsonResult(503, { error: "follow_not_configured" });
  const ipLimit = limitFromEnv(ctx.env, "FOLLOW_EMAIL_IP_PER_HOUR", 10);
  if (!allow(`follow:email:ip:${ctx.ip}`, ipLimit, HOUR_MS, ctx.now)) {
    return jsonResult(429, { error: "rate_limited" });
  }
  const same = { status: "check_inbox" };
  if (await ctx.store.isSuppressed(email)) return jsonResult(202, same);
  const existing = await ctx.store.findFollowByEmail(writer, email);
  if (existing && activeFollow(existing)) return jsonResult(202, same);
  const emailRows = await ctx.store.listFollowsByEmail(email);
  if (!confirmSendAllowed(existing, emailRows, ctx.now)) return jsonResult(202, same);

  const token = newConfirmToken();
  const nowIso = new Date(ctx.now).toISOString();
  const patch = {
    confirm_token_hash: sha256Hex(token),
    confirm_expires_at: new Date(ctx.now + CONFIRM_TTL_MS).toISOString(),
    confirm_sent_count: nextConfirmCount(existing, ctx.now),
    last_confirm_sent_at: nowIso,
    verified_at: null,
    unsubscribed_at: null,
    consent_version: CONSENT_VERSION,
    via: normalizeVia(ctx.body?.via),
    updated_at: nowIso,
  };
  let row = existing;
  if (!row) {
    row = await ctx.store.insertFollow({
      writer_wallet: writer,
      follower_email: email,
      follower_wallet: null,
      source: "email",
      created_ip_hash: hashIp(ctx.ip, secret),
      created_at: nowIso,
      ...patch,
    });
    if (!row) {
      row = await ctx.store.findFollowByEmail(writer, email);
      if (row) row = await ctx.store.updateFollow(row.id, patch);
    }
  } else {
    row = await ctx.store.updateFollow(row.id, patch);
  }
  if (!row) return jsonResult(500, { error: "follow_failed" });
  const author = await writerDisplayName(ctx.store, writer);
  const message = { ...confirmEmail({ author, token, env: ctx.env }), to: email };
  try {
    await ctx.sendEmail(message);
  } catch (err) {
    console.error("[follows] confirm send failed", err?.code || err?.message || err);
    return jsonResult(err?.status || 502, { error: err?.code || "email_failed" });
  }
  return jsonResult(202, same);
}

async function postConfirm(ctx) {
  const secret = tokenSecret(ctx.env);
  if (!secret) return jsonResult(503, { error: "follow_not_configured" });
  const token = String(ctx.body?.t || ctx.searchParams?.get("t") || "").trim();
  if (!token) return jsonResult(400, { error: "invalid_token" });
  const row = await ctx.store.findFollowByConfirmHash(sha256Hex(token));
  if (!row || !row.follower_email) return jsonResult(400, { error: "invalid_token" });
  const exp = Date.parse(row.confirm_expires_at || "");
  if (!Number.isFinite(exp) || exp <= ctx.now) return jsonResult(400, { error: "expired_token" });
  const nowIso = new Date(ctx.now).toISOString();
  const updated = await ctx.store.updateFollow(row.id, {
    verified_at: nowIso,
    unsubscribed_at: null,
    confirm_token_hash: null,
    confirm_expires_at: null,
    updated_at: nowIso,
  });
  const profileArticles = (await ctx.store.listListedArticlesByPublisher(row.writer_wallet)).map(writerArticle);
  const articles = dedupePublicArticles(profileArticles);
  return jsonResult(200, {
    writer: row.writer_wallet,
    displayName: displayNameFromArticles(articles, row.writer_wallet),
    followerToken: followerToken({
      kind: "email",
      id: row.follower_email,
      secret,
      now: ctx.now,
    }),
    articles,
    followId: updated?.id || row.id,
  });
}

async function postSession(ctx) {
  const secret = tokenSecret(ctx.env);
  if (!secret) return jsonResult(503, { error: "follow_not_configured" });
  const ipLimit = limitFromEnv(ctx.env, "FOLLOW_SESSION_IP_PER_HOUR", 20);
  if (!allow(`follow:session:ip:${ctx.ip}`, ipLimit, HOUR_MS, ctx.now)) {
    return jsonResult(429, { error: "rate_limited" });
  }
  const wallet = normalizeWallet(ctx.body?.wallet);
  const issuedAt = String(ctx.body?.issuedAt || "").trim();
  const sig = String(ctx.body?.sig || "").trim();
  const origin = String(ctx.body?.origin || "").trim().toLowerCase();
  if (!wallet || !sig) return jsonResult(400, { error: "invalid_wallet" });
  if (!originAllowed(origin)) return jsonResult(400, { error: "invalid_origin" });
  if (!issuedAtFresh(issuedAt, ctx.now)) return jsonResult(401, { error: "stale_signature" });
  const message = buildFollowerAuthMessage({ wallet, origin, issuedAt });
  const ok = await verifyWalletMessage({ address: wallet, message, signature: sig });
  if (!ok) return jsonResult(401, { error: "unauthorized" });
  return jsonResult(200, {
    followerToken: followerToken({ kind: "wallet", id: wallet, secret, now: ctx.now }),
    wallet,
    expiresInDays: 90,
  });
}

async function postWalletFollow(ctx) {
  const auth = await authedIdentity(ctx);
  if (auth.error) return auth.error;
  if (auth.identity.kind !== "wallet") return jsonResult(401, { error: "unauthorized" });
  const writer = normalizeWallet(ctx.body?.writer);
  if (!writer) return jsonResult(400, { error: "invalid_writer" });
  if (writer === auth.identity.id) return jsonResult(400, { error: "self_follow" });
  const tokenLimit = limitFromEnv(ctx.env, "FOLLOW_WALLET_TOKEN_PER_HOUR", 60);
  const dayLimit = limitFromEnv(ctx.env, "FOLLOW_WALLET_DAY", 200);
  const tokenKey = sha256Hex(auth.token).slice(0, 24);
  if (!allow(`follow:wallet:token:${tokenKey}`, tokenLimit, HOUR_MS, ctx.now)) {
    return jsonResult(429, { error: "rate_limited" });
  }
  if (!allow(`follow:wallet:addr:${auth.identity.id}`, dayLimit, DAY_MS, ctx.now)) {
    return jsonResult(429, { error: "rate_limited" });
  }
  const nowIso = new Date(ctx.now).toISOString();
  const existing = await ctx.store.findFollowByWallet(writer, auth.identity.id);
  if (existing) {
    await ctx.store.updateFollow(existing.id, {
      verified_at: existing.verified_at || nowIso,
      unsubscribed_at: null,
      via: normalizeVia(ctx.body?.via) || existing.via,
      updated_at: nowIso,
    });
  } else {
    const inserted = await ctx.store.insertFollow({
      writer_wallet: writer,
      follower_email: null,
      follower_wallet: auth.identity.id,
      source: "wallet",
      verified_at: nowIso,
      unsubscribed_at: null,
      consent_version: CONSENT_VERSION,
      created_ip_hash: hashIp(ctx.ip, tokenSecret(ctx.env)),
      via: normalizeVia(ctx.body?.via),
      created_at: nowIso,
      updated_at: nowIso,
    });
    if (!inserted) {
      const raced = await ctx.store.findFollowByWallet(writer, auth.identity.id);
      if (raced) {
        await ctx.store.updateFollow(raced.id, { verified_at: nowIso, unsubscribed_at: null, updated_at: nowIso });
      }
    }
  }
  return jsonResult(200, { following: true, writer });
}

async function deleteWalletFollow(ctx) {
  const auth = await authedIdentity(ctx);
  if (auth.error) return auth.error;
  const writer = normalizeWallet(ctx.body?.writer || ctx.searchParams?.get("writer"));
  if (!writer) return jsonResult(400, { error: "invalid_writer" });
  const tokenLimit = limitFromEnv(ctx.env, "FOLLOW_WALLET_TOKEN_PER_HOUR", 60);
  const dayLimit = limitFromEnv(ctx.env, "FOLLOW_WALLET_DAY", 200);
  const tokenKey = sha256Hex(auth.token).slice(0, 24);
  if (!allow(`follow:wallet:token:${tokenKey}`, tokenLimit, HOUR_MS, ctx.now)) {
    return jsonResult(429, { error: "rate_limited" });
  }
  const identityKey = auth.identity.kind === "wallet" ? auth.identity.id : auth.identity.id;
  if (!allow(`follow:wallet:addr:${identityKey}`, dayLimit, DAY_MS, ctx.now)) {
    return jsonResult(429, { error: "rate_limited" });
  }
  const existing =
    auth.identity.kind === "wallet"
      ? await ctx.store.findFollowByWallet(writer, auth.identity.id)
      : await ctx.store.findFollowByEmail(writer, auth.identity.id);
  if (!existing) return jsonResult(200, { following: false, writer });
  const nowIso = new Date(ctx.now).toISOString();
  await ctx.store.updateFollow(existing.id, { unsubscribed_at: nowIso, updated_at: nowIso });
  return jsonResult(200, { following: false, writer });
}

async function getMe(ctx) {
  const auth = await authedIdentity(ctx);
  if (auth.error) return auth.error;
  const following = await ctx.store.listFollowing(auth.identity);
  return jsonResult(200, { following, kind: auth.identity.kind });
}

async function getFeed(ctx) {
  const auth = await authedIdentity(ctx);
  if (auth.error) return auth.error;
  const writers = await ctx.store.listFollowing(auth.identity);
  const merged = [];
  for (const writer of writers) {
    const rows = await ctx.store.listListedArticlesByPublisher(writer);
    merged.push(...rows.map(writerArticle));
  }
  merged.sort((a, b) => Date.parse(b.listedAt || 0) - Date.parse(a.listedAt || 0));
  const articles = dedupePublicArticles(merged).slice(0, 50);
  const counts = await ctx.store.countFollowersMany(articles.map((article) => article.publisher));
  for (const article of articles) {
    article.followers = counts[article.publisher] ?? 0;
  }
  return jsonResult(200, { articles, following: writers.length });
}

function readerSessionSecret(env) {
  const dedicated = String(env?.READER_SESSION_SECRET || "").trim();
  if (dedicated) return dedicated;
  const fromEnv = String(env?.SUPABASE_SERVICE_ROLE_KEY || "").trim();
  if (fromEnv) return fromEnv;
  const processDedicated = String(process.env.READER_SESSION_SECRET || "").trim();
  if (processDedicated) return processDedicated;
  return String(process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim();
}

function presentedReaderSessionToken(headers) {
  const header = headerSecret(headers, "x-reader-session").trim();
  if (header) return header;
  const raw = headerSecret(headers, "cookie");
  for (const part of raw.split(";")) {
    const trimmed = part.trim();
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    if (trimmed.slice(0, eq) !== READER_SESSION_COOKIE) continue;
    const value = trimmed.slice(eq + 1);
    try {
      return decodeURIComponent(value);
    } catch {
      return value;
    }
  }
  return "";
}

/**
 * Reader session for roster memberships.
 * The Authorization bearer is the follower token, so it is not read here.
 * X-Reader-Session and the op_reader cookie are the session.
 * @returns {null | { address: string }}
 */
function rosterReaderSession(ctx) {
  const token = presentedReaderSessionToken(ctx.headers);
  if (!token) return null;
  const secret = readerSessionSecret(ctx.env);
  if (!secret) {
    const err = new Error("reader_session_not_configured");
    err.status = 503;
    throw err;
  }
  let domain = "";
  try {
    domain = new URL(publicOrigin({ headers: ctx.headers })).host.toLowerCase();
  } catch {
    domain = "";
  }
  const claims = verifyReaderSessionToken(token, secret, {
    nowMs: ctx.now,
    expectedDomain: domain || undefined,
  });
  if (!claims) {
    const err = new Error("invalid_reader_session");
    err.status = 401;
    throw err;
  }
  return claims;
}

async function getRoster(ctx) {
  const auth = await authedIdentity(ctx);
  if (auth.error) return auth.error;
  const claimed = normalizeWallet(ctx.searchParams?.get("reader") || ctx.body?.reader);
  const session = rosterReaderSession(ctx);
  if (claimed && !session) return jsonResult(401, { error: "reader_session_required" });
  if (claimed && session.address !== claimed) return jsonResult(403, { error: "reader_mismatch" });
  if (session && auth.identity.kind === "wallet" && session.address !== auth.identity.id) {
    return jsonResult(403, { error: "reader_mismatch" });
  }
  const followed = new Set(
    (await ctx.store.listFollowing(auth.identity)).map((wallet) => normalizeWallet(wallet)).filter(Boolean)
  );
  const memberships =
    auth.identity.kind === "wallet" && session?.address === auth.identity.id
      ? await ctx.store.listLiveMemberships(session.address)
      : [];
  const wallets = [...new Set([...followed, ...memberships.map((row) => row.writer)])];
  const labels = await ctx.store.writerLabels(wallets);
  const membershipByWriter = new Map(memberships.map((row) => [row.writer, row]));
  const writers = wallets
    .map((wallet) => {
      const membership = membershipByWriter.get(wallet);
      const label = labels[wallet] || {};
      return {
        wallet,
        name: label.name || shortWallet(wallet),
        following: followed.has(wallet),
        membership: membership
          ? {
              priceLabel: label.priceLabel || "",
              renewsAt: membership.current_period_end || null,
            }
          : null,
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name) || a.wallet.localeCompare(b.wallet));
  return jsonResult(200, { writers });
}

async function getFollowerCounts(ctx) {
  const unique = [
    ...new Set(
      String(ctx.searchParams?.get("wallets") || "")
        .split(",")
        .map((part) => normalizeWallet(part))
        .filter(Boolean)
    ),
  ].slice(0, 50);
  const counts = await ctx.store.countFollowersMany(unique);
  return jsonResult(200, { counts }, { "Cache-Control": "public, max-age=60" });
}

async function lookupUnsub(ctx, token) {
  const secret = tokenSecret(ctx.env);
  if (!secret) return { error: jsonResult(503, { error: "follow_not_configured" }) };
  const id = readUnsubscribeToken(token, secret);
  if (!id) return { error: jsonResult(400, { error: "invalid_token" }) };
  const row = await ctx.store.findFollowById(id);
  if (!row) return { error: jsonResult(400, { error: "invalid_token" }) };
  return { row, secret };
}

async function getUnsubscribe(ctx) {
  const token = String(ctx.searchParams?.get("t") || "").trim();
  const found = await lookupUnsub(ctx, token);
  if (found.error) {
    if (found.error.status === 400) {
      return htmlResult(400, unsubscribeHtml({ state: "invalid" }));
    }
    return found.error;
  }
  const name = await writerDisplayName(ctx.store, found.row.writer_wallet);
  const state = found.row.unsubscribed_at ? "done" : "ask";
  return htmlResult(200, unsubscribeHtml({ name, token, state }));
}

async function postUnsubscribe(ctx) {
  const token = String(ctx.body?.t || ctx.searchParams?.get("t") || "").trim();
  const found = await lookupUnsub(ctx, token);
  if (found.error) return found.error;
  const action = String(ctx.body?.action || "unsubscribe").trim();
  const nowIso = new Date(ctx.now).toISOString();
  const row = found.row;
  const name = await writerDisplayName(ctx.store, row.writer_wallet);
  if (action === "undo") {
    await ctx.store.updateFollow(row.id, { unsubscribed_at: null, updated_at: nowIso });
    return jsonResult(200, { ok: true, following: true, writer: row.writer_wallet, displayName: name });
  }
  if (action === "stop_all") {
    if (row.follower_email) {
      await ctx.store.addSuppression(row.follower_email, "global_unsubscribe");
      await ctx.store.unsubscribeAllForEmail(row.follower_email, nowIso);
    } else if (!row.unsubscribed_at) {
      await ctx.store.updateFollow(row.id, { unsubscribed_at: nowIso, updated_at: nowIso });
    }
    return jsonResult(200, {
      ok: true,
      stoppedAll: Boolean(row.follower_email),
      writer: row.writer_wallet,
      displayName: name,
    });
  }
  if (!row.unsubscribed_at) {
    await ctx.store.updateFollow(row.id, { unsubscribed_at: nowIso, updated_at: nowIso });
  }
  return jsonResult(200, { ok: true, unsubscribed: true, writer: row.writer_wallet, displayName: name });
}

async function getReceiptEmail(ctx) {
  const limit = limitFromEnv(ctx.env, "FOLLOW_RECEIPT_IP_PER_HOUR", 30);
  if (!allow(`follow:receipt:ip:${ctx.ip}`, limit, HOUR_MS, ctx.now)) {
    return jsonResult(429, { error: "rate_limited" });
  }
  const session = String(ctx.searchParams?.get("session") || "").trim();
  if (!session) return jsonResult(200, { email: null });
  try {
    const email = await ctx.store.receiptEmail(session);
    const normalized = normalizeEmail(email || "");
    return jsonResult(200, { email: normalized || null });
  } catch {
    return jsonResult(200, { email: null });
  }
}

async function getWriter(ctx, walletRaw) {
  const wallet = normalizeWallet(walletRaw);
  if (!wallet) return jsonResult(400, { error: "invalid_writer" });
  const profile = await loadWriterProfile(wallet, ctx.store);
  if (!profile) return jsonResult(404, { error: "not_found" });
  return jsonResult(
    200,
    {
      wallet: profile.wallet,
      displayName: profile.displayName,
      followers: profile.followers,
      plan: profile.plan,
      articles: profile.articles,
    },
    { "Cache-Control": "public, max-age=60" }
  );
}

async function getCount(ctx, walletRaw) {
  const wallet = normalizeWallet(walletRaw);
  if (!wallet) return jsonResult(400, { error: "invalid_writer" });
  const counts = await ctx.store.countFollowers(wallet);
  const body = { followers: counts.followers };
  const detail = ctx.searchParams?.get("detail") === "1";
  if (detail) {
    const ok = await verifyExportSignature(ctx, wallet);
    if (!ok) return jsonResult(401, { error: "unauthorized" });
    body.email = counts.email;
    body.wallet = counts.wallet;
    body.pending = counts.pending;
  }
  return jsonResult(200, body, { "Cache-Control": "public, max-age=60" });
}

async function postExport(ctx) {
  const writer = normalizeWallet(ctx.body?.writer);
  if (!writer) return jsonResult(400, { error: "invalid_writer" });
  const exportLimit = limitFromEnv(ctx.env, "FOLLOW_EXPORT_PER_HOUR", 10);
  if (!allow(`follow:export:${writer}`, exportLimit, HOUR_MS, ctx.now)) {
    return jsonResult(429, { error: "rate_limited" });
  }
  const ok = await verifyExportSignature(ctx, writer);
  if (!ok) return jsonResult(401, { error: "unauthorized" });
  const rows = await ctx.store.listExportRows(writer);
  const counts = await ctx.store.countFollowers(writer);
  const csv = followersToCsv(rows);
  const day = new Date(ctx.now).toISOString().slice(0, 10);
  const filename = `openpaywall-followers-${writer.slice(0, 6)}-${day}.csv`;
  const accept = headerSecret(ctx.headers, "accept");
  if (accept.includes("application/json") || ctx.searchParams?.get("format") === "json") {
    return jsonResult(200, {
      filename,
      csv,
      followers: counts.followers,
      email: counts.email,
      wallet: counts.wallet,
      pending: counts.pending,
    });
  }
  return textResult(200, csv, {
    "Content-Type": "text/csv; charset=utf-8",
    "Content-Disposition": `attachment; filename="${filename}"`,
    "X-Followers-Email": String(counts.email),
    "X-Followers-Wallet": String(counts.wallet),
    "X-Followers-Pending": String(counts.pending),
  });
}

function defaultSendEmail(env) {
  return (message) => sendResendEmail(message, env);
}

/**
 * @param {object} ctx
 */
export async function dispatchFollowRequest(ctx) {
  const method = String(ctx.method || "GET").toUpperCase();
  const pathname = String(ctx.pathname || "");
  const context = {
    ...ctx,
    method,
    now: ctx.now ?? Date.now(),
    env: ctx.env || process.env,
    ip: ctx.ip || "127.0.0.1",
    body: ctx.body || {},
    headers: ctx.headers || {},
    searchParams: ctx.searchParams || new URLSearchParams(),
    sendEmail: ctx.sendEmail || defaultSendEmail(ctx.env || process.env),
  };
  try {
    if (method === "GET" && pathname === "/api/follows/config") {
      return jsonResult(200, { email: emailFollowAvailable(context.env) });
    }
    if (method === "POST" && pathname === "/api/follows/notify/process") {
      return processFollowNotifications(context);
    }
    if (!context.store) return jsonResult(503, { error: "supabase_not_configured" });
    if (method === "POST" && pathname === "/api/follows/email") return postEmail(context);
    if (method === "POST" && pathname === "/api/follows/confirm") return postConfirm(context);
    if (method === "POST" && pathname === "/api/follows/session") return postSession(context);
    if (method === "POST" && pathname === "/api/follows/wallet") return postWalletFollow(context);
    if (method === "DELETE" && pathname === "/api/follows/wallet") return deleteWalletFollow(context);
    if (method === "GET" && pathname === "/api/follows/me") return getMe(context);
    if (method === "GET" && pathname === "/api/follows/me/feed") return getFeed(context);
    if (method === "GET" && pathname === "/api/follows/me/roster") return getRoster(context);
    if (method === "GET" && pathname === "/api/writers/followers/counts") return getFollowerCounts(context);
    if (method === "GET" && pathname === "/api/follows/unsubscribe") return getUnsubscribe(context);
    if (method === "POST" && pathname === "/api/follows/unsubscribe") return postUnsubscribe(context);
    if (method === "GET" && pathname === "/api/follows/receipt-email") return getReceiptEmail(context);
    if (method === "POST" && pathname === "/api/writers/followers/export") return postExport(context);
    const count = pathname.match(COUNT_RE);
    if (count && method === "GET") return getCount(context, count[1]);
    const writer = pathname.match(WRITER_RE);
    if (writer && method === "GET") return getWriter(context, writer[1]);
    return null;
  } catch (err) {
    const status = err?.status || 500;
    return jsonResult(status, { error: err?.message || "follow_failed" });
  }
}

async function finishSkip(store, note, reason, now) {
  await store.updateNotification(note.id, {
    status: "skipped",
    skip_reason: reason,
    finished_at: new Date(now).toISOString(),
  });
}

/**
 * Drain due follow notifications.
 * When new-post mail is disabled, returns before claiming rows or calling the provider.
 */
export async function processFollowNotifications(ctx) {
  const env = ctx.env || process.env;
  const now = ctx.now ?? Date.now();
  const secret = String(env.FOLLOW_NOTIFY_SECRET || "");
  if (!requestHasHeaderSecret(ctx.headers, secret, "x-follow-notify-secret")) {
    return jsonResult(401, { error: "unauthorized" });
  }
  const gate = newPostEmailsAllowed(env);
  if (!gate.ok) {
    return jsonResult(200, { ok: true, disabled: true, reason: gate.reason, sent: 0, processed: 0 });
  }
  if (!ctx.store) return jsonResult(503, { error: "supabase_not_configured" });
  const sendEmail = ctx.sendEmail || defaultSendEmail(env);
  const due = await ctx.store.claimDueNotifications(now, 10);
  let sentMessages = 0;
  for (const note of due) {
    const article = await ctx.store.getArticle(note.article_id);
    if (!article || article.listing_status !== "listed") {
      await finishSkip(ctx.store, note, "unlisted", now);
      continue;
    }
    if (article.registration_status && article.registration_status !== "registered") {
      await finishSkip(ctx.store, note, "not_registered", now);
      continue;
    }
    const since = new Date(now - TITLE_DEDUPE_MS).toISOString();
    const prior = await ctx.store.listSentNotifications(article.publisher || note.writer_wallet, since);
    let duplicate = false;
    for (const prev of prior) {
      if (Number(prev.id) === Number(note.id)) continue;
      const other = await ctx.store.getArticle(prev.article_id);
      if (other && titlesMatch(other.title, article.title)) {
        duplicate = true;
        break;
      }
    }
    if (duplicate) {
      await finishSkip(ctx.store, note, "duplicate", now);
      continue;
    }

    const follows = await ctx.store.listActiveEmailFollows(note.writer_wallet);
    const pending = [];
    for (const follow of follows) {
      const existing = await ctx.store.getDelivery(note.id, follow.id);
      if (existing && (existing.status === "sent" || existing.status === "suppressed")) continue;
      if (await ctx.store.isSuppressed(follow.follower_email)) {
        await ctx.store.insertDelivery({
          notification_id: note.id,
          follow_id: follow.id,
          status: "suppressed",
        });
        continue;
      }
      const message = newPostEmail({
        article: { ...article, notificationId: note.id },
        follow,
        env,
      });
      pending.push({ follow, message });
    }

    let quota = false;
    let failed = false;
    for (let i = 0; i < pending.length; i += 100) {
      const chunk = pending.slice(i, i + 100);
      const settled = await Promise.all(
        chunk.map(async ({ follow, message }) => {
          try {
            const res = await sendEmail(message);
            if (res && res.ok === false) {
              return { follow, error: res.error || "send_failed", id: res.id || null };
            }
            return { follow, error: null, id: res?.id || null };
          } catch (err) {
            return { follow, error: err?.code || err?.message || "send_failed", id: null };
          }
        })
      );
      for (const item of settled) {
        if (isQuotaError(item.error)) {
          quota = true;
          continue;
        }
        if (item.error) {
          failed = true;
          await ctx.store.insertDelivery({
            notification_id: note.id,
            follow_id: item.follow.id,
            status: "failed",
            error: String(item.error).slice(0, 500),
          });
          continue;
        }
        sentMessages += 1;
        await ctx.store.insertDelivery({
          notification_id: note.id,
          follow_id: item.follow.id,
          status: "sent",
          provider_id: item.id,
        });
      }
      if (quota) break;
    }

    if (quota) {
      console.error(
        "[follows] daily_quota_exceeded; leaving notification pending until next UTC day",
        note.id
      );
      await ctx.store.updateNotification(note.id, {
        status: "pending",
        attempts: Math.max(0, (Number(note.attempts) || 1) - 1),
        send_after: nextUtcMidnight(now),
      });
      continue;
    }
    if (failed) {
      const attempts = Number(note.attempts) || 1;
      if (attempts >= 5) {
        await ctx.store.updateNotification(note.id, {
          status: "failed",
          finished_at: new Date(now).toISOString(),
        });
      } else {
        const delay = Math.min(60, 2 ** attempts) * 60 * 1000;
        await ctx.store.updateNotification(note.id, {
          status: "pending",
          send_after: new Date(now + delay).toISOString(),
        });
      }
      continue;
    }
    const finished = new Date(now).toISOString();
    await ctx.store.setFollowersNotified(note.article_id, finished);
    await ctx.store.updateNotification(note.id, {
      status: "sent",
      skip_reason: null,
      finished_at: finished,
    });
  }
  return jsonResult(200, { ok: true, disabled: false, processed: due.length, sent: sentMessages });
}

export function canonicalWriterPath(pathname) {
  const match = /^\/writers\/(0x[a-fA-F0-9]{40})\/?$/i.exec(String(pathname || ""));
  if (!match) return null;
  const lower = match[1].toLowerCase();
  if (match[1] !== lower) return `/writers/${lower}`;
  return null;
}

export function writerWalletFromPath(pathname) {
  const match = /^\/writers\/(0x[a-fA-F0-9]{40})\/?$/.exec(String(pathname || ""));
  if (!match) return "";
  return match[1].toLowerCase();
}

function followPath(pathname) {
  if (pathname === "/api/follows/config") return true;
  if (pathname.startsWith("/api/follows/")) return true;
  if (pathname === "/api/writers/followers/export") return true;
  if (pathname === "/api/writers/followers/counts") return true;
  if (COUNT_RE.test(pathname)) return true;
  if (WRITER_RE.test(pathname)) return true;
  return false;
}

function parseBody(raw, contentType) {
  const text = String(raw || "");
  if (!text) return {};
  const type = String(contentType || "");
  if (type.includes("application/x-www-form-urlencoded") || text.startsWith("List-Unsubscribe=")) {
    const params = new URLSearchParams(text);
    return {
      t: params.get("t") || undefined,
      action: params.get("action") || (params.get("List-Unsubscribe") === "One-Click" ? "unsubscribe" : undefined),
    };
  }
  return JSON.parse(text);
}

export async function tryHandleFollowRequest(req, res, url, helpers) {
  const method = req.method || "GET";
  const pathname = url.pathname;
  if (!followPath(pathname)) return false;
  if (method !== "GET" && method !== "POST" && method !== "DELETE" && method !== "HEAD") return false;
  let body = {};
  if (method === "POST" || method === "DELETE") {
    try {
      const raw = await helpers.readBody(req);
      body = raw ? parseBody(raw, req.headers["content-type"]) : {};
    } catch (err) {
      if (err?.message === "body_too_large") {
        helpers.sendJson(res, 413, { error: "body_too_large" });
        return true;
      }
      helpers.sendJson(res, 400, { error: "invalid_json" });
      return true;
    }
  }
  const result = await dispatchFollowRequest({
    method,
    pathname,
    searchParams: url.searchParams,
    headers: req.headers,
    body,
    ip: helpers.clientIp(req),
    store: createSupabaseFollowStore(process.env),
    env: process.env,
  });
  if (!result) return false;
  writeFollowResult(req, res, result, helpers);
  return true;
}

export function writeFollowResult(req, res, result, helpers) {
  if (result.html != null) {
    helpers.sendHtml(req, res, result.status, result.html, result.headers || {});
    return;
  }
  if (result.text != null) {
    helpers.sendText(res, result.status, result.text, result.headers || {}, req.method);
    return;
  }
  const headers = { ...(result.headers || {}) };
  helpers.sendJson(res, result.status, result.json ?? {}, headers);
}
