/**
 * Follow persistence. Production uses the Supabase service role.
 * Tests pass createMemoryFollowStore() so nothing touches a live project.
 */
import { subscriptionIsLive } from "./access.mjs";
import { normalizeWallet, shortWallet } from "./follow-core.mjs";
import { publicPlan } from "./subscriptions.mjs";

function uniqueWallets(writers) {
  const out = [];
  const seen = new Set();
  for (const raw of writers || []) {
    const wallet = normalizeWallet(raw);
    if (!wallet || seen.has(wallet)) continue;
    seen.add(wallet);
    out.push(wallet);
  }
  return out;
}

function collapseLiveMemberships(rows, now = new Date()) {
  const byWriter = new Map();
  for (const row of rows || []) {
    if (!subscriptionIsLive(row, now)) continue;
    const writer = normalizeWallet(row.writer);
    if (!writer) continue;
    const next = { writer, current_period_end: row.current_period_end || null };
    const prev = byWriter.get(writer);
    if (!prev || Date.parse(next.current_period_end || 0) > Date.parse(prev.current_period_end || 0)) {
      byWriter.set(writer, next);
    }
  }
  return [...byWriter.values()];
}

function clone(row) {
  return row ? { ...row } : null;
}

function httpError(message, status = 400) {
  const err = new Error(message);
  err.status = status;
  return err;
}

export function createMemoryFollowStore(seed = {}) {
  const follows = (seed.follows || []).map((row) => ({ ...row }));
  const suppressions = (seed.suppressions || []).map((row) => ({ ...row }));
  const notifications = (seed.notifications || []).map((row) => ({ ...row }));
  const deliveries = (seed.deliveries || []).map((row) => ({ ...row }));
  const articles = (seed.articles || []).map((row) => ({ ...row }));
  const plans = (seed.plans || []).map((row) => ({ ...row }));
  const fiatUnlocks = (seed.fiatUnlocks || []).map((row) => ({ ...row }));
  const memberships = (seed.memberships || []).map((row) => ({ ...row }));
  let followSeq = follows.reduce((m, row) => Math.max(m, Number(row.id) || 0), 0);
  let noteSeq = notifications.reduce((m, row) => Math.max(m, Number(row.id) || 0), 0);

  function followById(id) {
    return follows.find((row) => Number(row.id) === Number(id)) || null;
  }

  return {
    kind: "memory",
    follows,
    notifications,
    deliveries,
    articles,
    async findFollowByEmail(writer, email) {
      return clone(follows.find((row) => row.writer_wallet === writer && row.follower_email === email));
    },
    async findFollowByWallet(writer, wallet) {
      return clone(follows.find((row) => row.writer_wallet === writer && row.follower_wallet === wallet));
    },
    async findFollowById(id) {
      return clone(followById(id));
    },
    async findFollowByConfirmHash(hash) {
      return clone(follows.find((row) => row.confirm_token_hash && row.confirm_token_hash === hash));
    },
    async listFollowsByEmail(email) {
      return follows.filter((row) => row.follower_email === email).map(clone);
    },
    async insertFollow(row) {
      followSeq += 1;
      const saved = {
        id: followSeq,
        confirm_sent_count: 0,
        created_at: row.created_at || new Date().toISOString(),
        updated_at: row.updated_at || new Date().toISOString(),
        ...row,
        id: followSeq,
      };
      follows.push(saved);
      return clone(saved);
    },
    async updateFollow(id, patch) {
      const row = followById(id);
      if (!row) return null;
      Object.assign(row, patch, { updated_at: patch.updated_at || new Date().toISOString() });
      return clone(row);
    },
    async countFollowers(writer) {
      const rows = follows.filter((row) => row.writer_wallet === writer);
      const active = rows.filter((row) => row.verified_at && !row.unsubscribed_at);
      return {
        followers: active.length,
        email: active.filter((row) => row.source === "email").length,
        wallet: active.filter((row) => row.source === "wallet").length,
        pending: rows.filter((row) => row.source === "email" && !row.verified_at && !row.unsubscribed_at).length,
      };
    },
    async countFollowersMany(writers) {
      const wanted = uniqueWallets(writers);
      const counts = Object.fromEntries(wanted.map((wallet) => [wallet, 0]));
      for (const row of follows) {
        if (!Object.prototype.hasOwnProperty.call(counts, row.writer_wallet)) continue;
        if (row.verified_at && !row.unsubscribed_at) counts[row.writer_wallet] += 1;
      }
      return counts;
    },
    async listLiveMemberships(reader) {
      const wallet = normalizeWallet(reader);
      if (!wallet) return [];
      return collapseLiveMemberships(memberships.filter((row) => normalizeWallet(row.reader) === wallet));
    },
    async writerLabels(writers) {
      const wanted = uniqueWallets(writers);
      const labels = {};
      for (const wallet of wanted) {
        const named = articles
          .filter((row) => row.publisher === wallet && row.listing_status === "listed" && row.article_id)
          .slice()
          .sort((a, b) => Date.parse(b.listed_at || 0) - Date.parse(a.listed_at || 0))
          .find((row) => row.author && row.author !== "Author");
        const plan = publicPlan(plans.find((row) => row.publisher === wallet) || null, wallet);
        labels[wallet] = {
          name: named?.author || shortWallet(wallet),
          priceLabel: plan.monthlyPriceLabel || "",
        };
      }
      return labels;
    },
    async listActiveEmailFollows(writer) {
      return follows
        .filter(
          (row) =>
            row.writer_wallet === writer &&
            row.source === "email" &&
            row.follower_email &&
            row.verified_at &&
            !row.unsubscribed_at
        )
        .map(clone);
    },
    async listFollowing({ kind, id }) {
      return follows
        .filter((row) => {
          if (!row.verified_at || row.unsubscribed_at) return false;
          if (kind === "wallet") return row.follower_wallet === id;
          return row.follower_email === id;
        })
        .map((row) => row.writer_wallet);
    },
    async listExportRows(writer) {
      const blocked = new Set(suppressions.map((row) => row.email));
      return follows
        .filter(
          (row) =>
            row.writer_wallet === writer &&
            row.verified_at &&
            !row.unsubscribed_at &&
            !(row.follower_email && blocked.has(row.follower_email))
        )
        .map(clone);
    },
    async isSuppressed(email) {
      return suppressions.some((row) => row.email === email);
    },
    async addSuppression(email, reason) {
      if (!suppressions.some((row) => row.email === email)) {
        suppressions.push({ email, reason, created_at: new Date().toISOString() });
      }
      return true;
    },
    async unsubscribeAllForEmail(email, at) {
      for (const row of follows) {
        if (row.follower_email === email && !row.unsubscribed_at) row.unsubscribed_at = at;
      }
    },
    async getArticle(articleId) {
      return clone(articles.find((row) => row.article_id === articleId));
    },
    async listListedArticlesByPublisher(writer) {
      return articles
        .filter((row) => row.publisher === writer && row.listing_status === "listed" && row.article_id)
        .slice()
        .sort((a, b) => Date.parse(b.listed_at || 0) - Date.parse(a.listed_at || 0))
        .map(clone);
    },
    async setFollowersNotified(articleId, at) {
      const row = articles.find((item) => item.article_id === articleId);
      if (row) row.followers_notified_at = at;
    },
    async claimDueNotifications(now, limit = 10) {
      const due = notifications
        .filter((row) => row.status === "pending" && Date.parse(row.send_after || 0) <= now)
        .sort((a, b) => Number(a.id) - Number(b.id))
        .slice(0, limit);
      for (const row of due) {
        row.status = "sending";
        row.attempts = (Number(row.attempts) || 0) + 1;
      }
      return due.map(clone);
    },
    async updateNotification(id, patch) {
      const row = notifications.find((item) => Number(item.id) === Number(id));
      if (!row) return null;
      Object.assign(row, patch);
      return clone(row);
    },
    async listSentNotifications(writer, sinceIso) {
      const since = Date.parse(sinceIso);
      return notifications
        .filter(
          (row) =>
            row.writer_wallet === writer &&
            row.status === "sent" &&
            Date.parse(row.finished_at || row.created_at || 0) >= since
        )
        .map(clone);
    },
    async getDelivery(notificationId, followId) {
      return clone(
        deliveries.find(
          (row) =>
            Number(row.notification_id) === Number(notificationId) &&
            Number(row.follow_id) === Number(followId)
        )
      );
    },
    async insertDelivery(row) {
      const existing = deliveries.find(
        (item) =>
          Number(item.notification_id) === Number(row.notification_id) &&
          Number(item.follow_id) === Number(row.follow_id)
      );
      if (existing) {
        if (existing.status !== "sent") Object.assign(existing, row);
        return clone(existing);
      }
      const saved = { created_at: new Date().toISOString(), ...row };
      deliveries.push(saved);
      return clone(saved);
    },
    async getPlan(writer) {
      const row = plans.find((item) => item.publisher === writer) || null;
      return publicPlan(row, writer);
    },
    async receiptEmail(session) {
      const row = fiatUnlocks.find((item) => item.session_token === session && item.status === "succeeded");
      return row?.buyer_email ? String(row.buyer_email).trim().toLowerCase() : null;
    },
    async insertNotification(row) {
      if (notifications.some((item) => item.article_id === row.article_id)) return null;
      noteSeq += 1;
      const saved = {
        id: noteSeq,
        status: "pending",
        attempts: 0,
        created_at: new Date().toISOString(),
        ...row,
        id: noteSeq,
      };
      notifications.push(saved);
      return clone(saved);
    },
  };
}

function supabaseConfigured(env) {
  return Boolean(String(env.SUPABASE_URL || "").trim() && String(env.SUPABASE_SERVICE_ROLE_KEY || "").trim());
}

async function rest(env, path, opts = {}) {
  if (!supabaseConfigured(env)) throw httpError("supabase_not_configured", 503);
  const base = String(env.SUPABASE_URL).trim().replace(/\/$/, "");
  const key = String(env.SUPABASE_SERVICE_ROLE_KEY).trim();
  const res = await fetch(`${base}/rest/v1/${path}`, {
    method: opts.method || "GET",
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
      Prefer: opts.prefer || "return=representation",
      ...(opts.headers || {}),
    },
    body: opts.body != null ? JSON.stringify(opts.body) : undefined,
  });
  const text = await res.text();
  let data = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = text;
    }
  }
  if (!res.ok) {
    const err = httpError((data && data.message) || (data && data.error) || `supabase_${res.status}`, res.status);
    err.details = data;
    err.code = data && data.code;
    throw err;
  }
  return data;
}

function first(rows) {
  return Array.isArray(rows) ? rows[0] || null : null;
}

export function createSupabaseFollowStore(env = process.env) {
  return {
    kind: "supabase",
    async findFollowByEmail(writer, email) {
      const rows = await rest(
        env,
        `follows?select=*&writer_wallet=eq.${encodeURIComponent(writer)}&follower_email=eq.${encodeURIComponent(email)}&limit=1`
      );
      return first(rows);
    },
    async findFollowByWallet(writer, wallet) {
      const rows = await rest(
        env,
        `follows?select=*&writer_wallet=eq.${encodeURIComponent(writer)}&follower_wallet=eq.${encodeURIComponent(wallet)}&limit=1`
      );
      return first(rows);
    },
    async findFollowById(id) {
      const rows = await rest(env, `follows?select=*&id=eq.${encodeURIComponent(id)}&limit=1`);
      return first(rows);
    },
    async findFollowByConfirmHash(hash) {
      const rows = await rest(
        env,
        `follows?select=*&confirm_token_hash=eq.${encodeURIComponent(hash)}&limit=1`
      );
      return first(rows);
    },
    async listFollowsByEmail(email) {
      const rows = await rest(
        env,
        `follows?select=*&follower_email=eq.${encodeURIComponent(email)}&limit=1000`
      );
      return Array.isArray(rows) ? rows : [];
    },
    async insertFollow(row) {
      try {
        const rows = await rest(env, "follows", { method: "POST", body: row });
        return first(rows) || row;
      } catch (err) {
        if (err.status === 409) return null;
        throw err;
      }
    },
    async updateFollow(id, patch) {
      const rows = await rest(env, `follows?id=eq.${encodeURIComponent(id)}`, {
        method: "PATCH",
        body: patch,
      });
      return first(rows);
    },
    async countFollowers(writer) {
      const rows = await rest(
        env,
        `follows?select=source,verified_at,unsubscribed_at&writer_wallet=eq.${encodeURIComponent(writer)}&limit=10000`
      );
      const list = Array.isArray(rows) ? rows : [];
      const active = list.filter((row) => row.verified_at && !row.unsubscribed_at);
      return {
        followers: active.length,
        email: active.filter((row) => row.source === "email").length,
        wallet: active.filter((row) => row.source === "wallet").length,
        pending: list.filter((row) => row.source === "email" && !row.verified_at && !row.unsubscribed_at).length,
      };
    },
    async countFollowersMany(writers) {
      const wanted = uniqueWallets(writers);
      const counts = Object.fromEntries(wanted.map((wallet) => [wallet, 0]));
      if (!wanted.length) return counts;
      const rows = await rest(
        env,
        `follows?select=writer_wallet&writer_wallet=in.(${wanted.join(",")})&verified_at=not.is.null&unsubscribed_at=is.null&limit=10000`
      );
      for (const row of Array.isArray(rows) ? rows : []) {
        const wallet = normalizeWallet(row.writer_wallet);
        if (Object.prototype.hasOwnProperty.call(counts, wallet)) counts[wallet] += 1;
      }
      return counts;
    },
    async listLiveMemberships(reader) {
      const wallet = normalizeWallet(reader);
      if (!wallet) return [];
      const rows = await rest(
        env,
        `subscriptions?select=writer,status,canceled_at,current_period_end&reader=eq.${encodeURIComponent(wallet)}&status=eq.active&canceled_at=is.null&limit=200`
      );
      return collapseLiveMemberships(Array.isArray(rows) ? rows : []);
    },
    async writerLabels(writers) {
      const wanted = uniqueWallets(writers);
      const labels = {};
      for (const wallet of wanted) labels[wallet] = { name: shortWallet(wallet), priceLabel: "" };
      if (!wanted.length) return labels;
      const list = wanted.join(",");
      const articles = await rest(
        env,
        `articles?select=publisher,author,listed_at&publisher=in.(${list})&listing_status=eq.listed&article_id=not.is.null&order=listed_at.desc&limit=500`
      );
      const named = new Set();
      for (const row of Array.isArray(articles) ? articles : []) {
        const wallet = normalizeWallet(row.publisher);
        if (!wallet || named.has(wallet) || !labels[wallet]) continue;
        const author = String(row.author || "").trim();
        if (!author || author === "Author") continue;
        labels[wallet].name = author;
        named.add(wallet);
      }
      const planRows = await rest(
        env,
        `writer_plans?select=publisher,monthly_price_cents,monthly_price_usdc,allow_a_la_carte&publisher=in.(${list})`
      );
      for (const row of Array.isArray(planRows) ? planRows : []) {
        const wallet = normalizeWallet(row.publisher);
        if (!labels[wallet]) continue;
        labels[wallet].priceLabel = publicPlan(row, wallet).monthlyPriceLabel || "";
      }
      return labels;
    },
    async listActiveEmailFollows(writer) {
      const rows = await rest(
        env,
        `follows?select=*&writer_wallet=eq.${encodeURIComponent(writer)}&source=eq.email&verified_at=not.is.null&unsubscribed_at=is.null&limit=10000`
      );
      return Array.isArray(rows) ? rows : [];
    },
    async listFollowing({ kind, id }) {
      const filter =
        kind === "wallet"
          ? `follower_wallet=eq.${encodeURIComponent(id)}`
          : `follower_email=eq.${encodeURIComponent(id)}`;
      const rows = await rest(
        env,
        `follows?select=writer_wallet&${filter}&verified_at=not.is.null&unsubscribed_at=is.null&limit=1000`
      );
      return (Array.isArray(rows) ? rows : []).map((row) => row.writer_wallet);
    },
    async listExportRows(writer) {
      const rows = await rest(
        env,
        `follows?select=follower_email,follower_wallet,source,verified_at,created_at,via&writer_wallet=eq.${encodeURIComponent(writer)}&verified_at=not.is.null&unsubscribed_at=is.null&limit=10000`
      );
      const list = Array.isArray(rows) ? rows : [];
      const emails = [...new Set(list.map((row) => row.follower_email).filter(Boolean))];
      if (!emails.length) return list;
      const suppressed = await rest(
        env,
        `email_suppressions?select=email&email=in.(${emails.map(encodeURIComponent).join(",")})`
      );
      const blocked = new Set((Array.isArray(suppressed) ? suppressed : []).map((row) => row.email));
      return list.filter((row) => !row.follower_email || !blocked.has(row.follower_email));
    },
    async isSuppressed(email) {
      const rows = await rest(
        env,
        `email_suppressions?select=email&email=eq.${encodeURIComponent(email)}&limit=1`
      );
      return Boolean(first(rows));
    },
    async addSuppression(email, reason) {
      try {
        await rest(env, "email_suppressions", {
          method: "POST",
          prefer: "resolution=ignore-duplicates,return=minimal",
          body: { email, reason },
        });
      } catch (err) {
        if (err.status !== 409) throw err;
      }
      return true;
    },
    async unsubscribeAllForEmail(email, at) {
      await rest(
        env,
        `follows?follower_email=eq.${encodeURIComponent(email)}&unsubscribed_at=is.null`,
        { method: "PATCH", body: { unsubscribed_at: at, updated_at: at } }
      );
    },
    async getArticle(articleId) {
      const rows = await rest(
        env,
        `articles?select=article_id,title,author,teaser,price_wei,price_cents,payment_asset,publisher,listing_status,registration_status,followers_notified_at,listed_at&article_id=eq.${encodeURIComponent(articleId)}&limit=1`
      );
      return first(rows);
    },
    async listListedArticlesByPublisher(writer) {
      const rows = await rest(
        env,
        `articles?select=article_id,title,author,teaser,price_wei,price_cents,payment_asset,publisher,listing_status,listed_at&publisher=eq.${encodeURIComponent(writer)}&listing_status=eq.listed&article_id=not.is.null&order=listed_at.desc.nullslast&limit=100`
      );
      return Array.isArray(rows) ? rows : [];
    },
    async setFollowersNotified(articleId, at) {
      await rest(env, `articles?article_id=eq.${encodeURIComponent(articleId)}`, {
        method: "PATCH",
        body: { followers_notified_at: at },
      });
    },
    async claimDueNotifications(now, limit = 10) {
      const iso = new Date(now).toISOString();
      const rows = await rest(
        env,
        `follow_notifications?select=*&status=eq.pending&send_after=lte.${encodeURIComponent(iso)}&order=id.asc&limit=${limit}`
      );
      const claimed = [];
      for (const row of Array.isArray(rows) ? rows : []) {
        const nextAttempts = (Number(row.attempts) || 0) + 1;
        const updated = await rest(
          env,
          `follow_notifications?id=eq.${encodeURIComponent(row.id)}&status=eq.pending`,
          { method: "PATCH", body: { status: "sending", attempts: nextAttempts } }
        );
        const saved = first(updated);
        if (saved) claimed.push(saved);
      }
      return claimed;
    },
    async updateNotification(id, patch) {
      const rows = await rest(env, `follow_notifications?id=eq.${encodeURIComponent(id)}`, {
        method: "PATCH",
        body: patch,
      });
      return first(rows);
    },
    async listSentNotifications(writer, sinceIso) {
      const rows = await rest(
        env,
        `follow_notifications?select=*&writer_wallet=eq.${encodeURIComponent(writer)}&status=eq.sent&finished_at=gte.${encodeURIComponent(sinceIso)}&limit=200`
      );
      return Array.isArray(rows) ? rows : [];
    },
    async getDelivery(notificationId, followId) {
      const rows = await rest(
        env,
        `follow_deliveries?select=*&notification_id=eq.${encodeURIComponent(notificationId)}&follow_id=eq.${encodeURIComponent(followId)}&limit=1`
      );
      return first(rows);
    },
    async insertDelivery(row) {
      try {
        const rows = await rest(env, "follow_deliveries", { method: "POST", body: row });
        return first(rows) || row;
      } catch (err) {
        if (err.status !== 409) throw err;
        const existing = await this.getDelivery(row.notification_id, row.follow_id);
        if (!existing || existing.status === "sent") return existing;
        const rows = await rest(
          env,
          `follow_deliveries?notification_id=eq.${encodeURIComponent(row.notification_id)}&follow_id=eq.${encodeURIComponent(row.follow_id)}`,
          { method: "PATCH", body: row }
        );
        return first(rows) || existing;
      }
    },
    async getPlan(writer) {
      const rows = await rest(
        env,
        `writer_plans?select=*&publisher=eq.${encodeURIComponent(writer)}&limit=1`
      );
      return publicPlan(first(rows), writer);
    },
    async receiptEmail(session) {
      const rows = await rest(
        env,
        `fiat_unlocks?select=buyer_email,status&session_token=eq.${encodeURIComponent(session)}&status=eq.succeeded&limit=1`
      );
      const row = first(rows);
      return row?.buyer_email ? String(row.buyer_email).trim().toLowerCase() : null;
    },
  };
}
