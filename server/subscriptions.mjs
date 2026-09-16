/**
 * Per-writer subscriptions: Stripe Billing + Monad USDC.
 *
 * Access is stored in `subscriptions`. Cancel sets canceled_at immediately.
 * Fiat invoices queue payout_jobs (same Connect path as article unlocks).
 */
import {
  CRYPTO_PERIOD_MS,
  centsToUsdcUnits,
  evaluateAccess,
  normalizeAddress,
  normalizeMonthlyCents,
  resolveAllowALaCarte,
  subscriptionIsLive,
} from "./access.mjs";
import {
  articleIdHash,
  checkoutIntegrationId,
  getStripe,
  isUniqueViolation,
  supabaseConfigured,
} from "./stripe.mjs";
import { checkoutMethodVisibilityForAccount } from "./stripe-payment-methods.mjs";

const SUPABASE_URL = (process.env.SUPABASE_URL || "").trim().replace(/\/$/, "");
const SUPABASE_SERVICE_ROLE_KEY = (process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim();
const SUBSCRIPTION_CONTRACT = (process.env.SUBSCRIPTION_CONTRACT || "").trim();

export function subscriptionContractAddress() {
  return SUBSCRIPTION_CONTRACT;
}

/**
 * Hosted Checkout params for a writer subscription.
 * Tax uses the platform Texas registration (`liability: self`).
 * Checkout collects the address; do not force billing_address_collection.
 * @param {{
 *   reader: string,
 *   writer: string,
 *   priceId: string,
 *   successUrl: string,
 *   cancelUrl: string,
 *   integrationId?: string,
 *   excludedPaymentMethodTypes?: string[],
 * }} input
 */
export function writerSubscriptionCheckoutSessionParams(input) {
  return {
    mode: "subscription",
    line_items: [{ price: input.priceId, quantity: 1 }],
    success_url: input.successUrl,
    cancel_url: input.cancelUrl,
    client_reference_id: `${input.reader}:${input.writer}`,
    automatic_tax: { enabled: true, liability: { type: "self" } },
    integration_identifier: input.integrationId || checkoutIntegrationId("op_writer_sub"),
    metadata: {
      reader: input.reader,
      writer: input.writer,
      product: "writer_subscription",
    },
    subscription_data: {
      metadata: {
        reader: input.reader,
        writer: input.writer,
        product: "writer_subscription",
      },
    },
    ...(input.excludedPaymentMethodTypes?.length
      ? { excluded_payment_method_types: input.excludedPaymentMethodTypes }
      : {}),
  };
}

/**
 * @param {string} path
 * @param {object} [opts]
 */
async function supabase(path, opts = {}) {
  if (!supabaseConfigured()) {
    const err = new Error("supabase_not_configured");
    err.status = 503;
    throw err;
  }
  const method = opts.method || "GET";
  const headers = {
    apikey: SUPABASE_SERVICE_ROLE_KEY,
    Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
    "Content-Type": "application/json",
    Prefer: opts.prefer || "return=representation",
    ...(opts.headers || {}),
  };
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    method,
    headers,
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
    const err = new Error(
      (data && data.message) || (data && data.error) || `supabase_${res.status}`
    );
    err.status = res.status >= 400 && res.status < 600 ? res.status : 502;
    err.details = data;
    throw err;
  }
  return data;
}

function httpError(message, status = 400) {
  const err = new Error(message);
  err.status = status;
  return err;
}

export function publicPlan(row, publisher) {
  const cents = normalizeMonthlyCents(row?.monthly_price_cents);
  const offered = Boolean(row) && cents >= 50;
  return {
    publisher,
    monthlyPriceCents: offered ? cents : 0,
    monthlyPriceUsdc: offered ? String(row.monthly_price_usdc || centsToUsdcUnits(cents)) : "0",
    monthlyPriceLabel: offered ? `$${(cents / 100).toFixed(cents % 100 ? 2 : 0)}/mo` : "",
    allowALaCarte: row?.allow_a_la_carte !== false,
    offered,
  };
}

export async function getWriterPlan(publisherRaw) {
  const publisher = normalizeAddress(publisherRaw);
  if (!publisher) throw httpError("invalid_publisher");
  const rows = await supabase(
    `writer_plans?select=*&publisher=eq.${encodeURIComponent(publisher)}&limit=1`
  );
  const row = Array.isArray(rows) ? rows[0] : null;
  return publicPlan(row, publisher);
}

/**
 * @param {{ publisher: string, monthlyPriceCents?: number, allowALaCarte?: boolean }} input
 */
export async function upsertWriterPlan(input) {
  const publisher = normalizeAddress(input.publisher);
  if (!publisher) throw httpError("invalid_publisher");
  const cents = normalizeMonthlyCents(input.monthlyPriceCents);
  const allowALaCarte = input.allowALaCarte !== false;
  const rows = await supabase("writer_plans?on_conflict=publisher", {
    method: "POST",
    headers: { Prefer: "resolution=merge-duplicates,return=representation" },
    body: [
      {
        publisher,
        monthly_price_cents: cents,
        monthly_price_usdc: centsToUsdcUnits(cents),
        allow_a_la_carte: allowALaCarte,
        updated_at: new Date().toISOString(),
      },
    ],
  });
  const row = Array.isArray(rows) ? rows[0] : rows;
  return publicPlan(row, publisher);
}

async function listLiveSubscriptions(reader, writer) {
  const r = normalizeAddress(reader);
  const w = normalizeAddress(writer);
  if (!r || !w) return [];
  const rows = await supabase(
    `subscriptions?select=*&reader=eq.${encodeURIComponent(r)}&writer=eq.${encodeURIComponent(w)}`
  );
  return (Array.isArray(rows) ? rows : []).filter((row) => subscriptionIsLive(row));
}

export async function listReaderSubscriptions(readerRaw) {
  const reader = normalizeAddress(readerRaw);
  if (!reader) throw httpError("invalid_reader");
  const rows = await supabase(
    `subscriptions?select=*&reader=eq.${encodeURIComponent(reader)}&order=updated_at.desc`
  );
  return (Array.isArray(rows) ? rows : []).map((row) => ({
    ...row,
    live: subscriptionIsLive(row),
  }));
}

async function lookupArticleRow(articleId, cols) {
  const slug = String(articleId || "").trim();
  if (!slug) throw httpError("invalid_article_id");
  const hash = articleIdHash(slug);
  const bySlug = await supabase(
    `articles?select=${cols}&article_id=eq.${encodeURIComponent(slug)}&limit=1`
  );
  if (Array.isArray(bySlug) && bySlug[0]) return bySlug[0];
  const byHash = await supabase(
    `articles?select=${cols}&article_id_hash=eq.${encodeURIComponent(hash)}&limit=1`
  );
  if (Array.isArray(byHash) && byHash[0]) return byHash[0];
  return null;
}

async function lookupArticleForAccess(articleId) {
  const cols =
    "article_id,article_id_hash,publisher,price_wei,listing_status,payment_asset,allow_a_la_carte,body";
  return lookupArticleRow(articleId, cols);
}

const UNLOCK_QUOTE_COLS =
  "article_id,article_id_hash,publisher,price_wei,listing_status,payment_asset,allow_a_la_carte,teaser,title";

/**
 * Public metadata for an agent unlock quote. Never includes `body`.
 * @param {string} articleId
 */
export async function quoteArticleUnlock(articleId) {
  return lookupArticleRow(articleId, UNLOCK_QUOTE_COLS);
}

/**
 * Paid-text load for the x402 unlock handler. Call only after payment / entitlement.
 * @param {string} articleId
 */
export async function loadArticleBodyAfterPayment(articleId) {
  const article = await lookupArticleForAccess(articleId);
  if (!article) return null;
  return {
    articleId: article.article_id,
    articleIdHash: article.article_id_hash,
    publisher: article.publisher,
    paymentAsset: article.payment_asset || "usdc",
    priceWei: article.price_wei,
    listingStatus: article.listing_status,
    allowALaCarte: article.allow_a_la_carte,
    body: article.body || "",
  };
}

async function hasPurchase({ article, reader, fiatSession }) {
  const hash = article.article_id_hash;
  if (fiatSession) {
    const fiat = await supabase(
      `fiat_unlocks?select=id&article_id_hash=eq.${encodeURIComponent(hash)}` +
        `&session_token=eq.${encodeURIComponent(fiatSession)}&status=eq.succeeded&limit=1`
    );
    if (Array.isArray(fiat) && fiat[0]) return true;
  }
  if (reader) {
    const onchain = await supabase(
      `unlocks?select=id&article_id_hash=eq.${encodeURIComponent(hash)}` +
        `&reader=eq.${encodeURIComponent(reader)}&limit=1`
    );
    if (Array.isArray(onchain) && onchain[0]) return true;
    const fiatReader = await supabase(
      `fiat_unlocks?select=id&article_id_hash=eq.${encodeURIComponent(hash)}` +
        `&reader=eq.${encodeURIComponent(reader)}&status=eq.succeeded&limit=1`
    );
    if (Array.isArray(fiatReader) && fiatReader[0]) return true;
  }
  return false;
}

/**
 * The door. Used by /api/access and /api/article-body.
 * @param {{ articleId: string, reader?: string, fiatSession?: string, includeBody?: boolean }} input
 */
export async function resolveArticleAccess(input) {
  const reader = normalizeAddress(input.reader);
  const fiatSession = String(input.fiatSession || "").trim();
  if (!reader && !fiatSession) throw httpError("reader_or_fiat_session_required");

  const article = await lookupArticleForAccess(input.articleId);
  if (!article?.publisher) throw httpError("article_not_found", 404);

  const writer = normalizeAddress(article.publisher);
  const plan = await getWriterPlan(writer);
  const allowALaCarte = resolveAllowALaCarte({
    articleAllow: article.allow_a_la_carte,
    writerAllow: plan.allowALaCarte,
  });

  const purchased = await hasPurchase({ article, reader, fiatSession });
  const liveSubs = reader ? await listLiveSubscriptions(reader, writer) : [];
  const subscriptionLive = liveSubs.length > 0;
  const decision = evaluateAccess({ purchased, subscriptionLive, allowALaCarte });

  const payload = {
    ...decision,
    articleId: article.article_id,
    writer,
    reader: reader || null,
    plan,
    allowALaCarte,
    purchased,
    subscriptionLive,
  };

  if (input.includeBody) {
    if (!decision.allowed) {
      const err = httpError("not_unlocked", 403);
      err.access = payload;
      throw err;
    }
    payload.body = article.body || "";
  }
  return payload;
}

async function upsertSubscriptionRow(row) {
  const body = [
    {
      reader: row.reader,
      writer: row.writer,
      status: row.status || "active",
      source: row.source,
      stripe_subscription_id: row.stripe_subscription_id || null,
      stripe_customer_id: row.stripe_customer_id || null,
      tx_hash: row.tx_hash || null,
      current_period_end: row.current_period_end || null,
      canceled_at: row.canceled_at || null,
      updated_at: new Date().toISOString(),
    },
  ];
  try {
    const rows = await supabase("subscriptions?on_conflict=reader,writer,source", {
      method: "POST",
      headers: { Prefer: "resolution=merge-duplicates,return=representation" },
      body,
    });
    return Array.isArray(rows) ? rows[0] : rows;
  } catch (e) {
    if (!isUniqueViolation(e)) throw e;
    const existing = await supabase(
      `subscriptions?select=*&reader=eq.${encodeURIComponent(row.reader)}` +
        `&writer=eq.${encodeURIComponent(row.writer)}&source=eq.${encodeURIComponent(row.source)}&limit=1`
    );
    return Array.isArray(existing) ? existing[0] : existing;
  }
}

async function queueSubscriptionPayout({ subscriptionId, writer, amountCents }) {
  const feeBps = Math.max(0, Number(process.env.STRIPE_PLATFORM_FEE_BPS || "0") || 0);
  const fee = Math.floor((amountCents * feeBps) / 10_000);
  const payoutCents = Math.max(0, amountCents - fee);
  if (payoutCents <= 0) return null;
  const rows = await supabase("payout_jobs", {
    method: "POST",
    prefer: "return=representation",
    body: [
      {
        publisher: writer,
        amount_cents: payoutCents,
        currency: "usd",
        status: "pending",
        subscription_id: subscriptionId,
      },
    ],
  });
  return Array.isArray(rows) ? rows[0] : rows;
}

async function ensureStripePrice(plan, writer) {
  const stripe = getStripe();
  if (plan.stripe_price_id && plan.monthly_price_cents === normalizeMonthlyCents(plan.monthly_price_cents)) {
    // Price objects are immutable; reuse if cents match our stored amount.
  }
  const cents = normalizeMonthlyCents(plan.monthly_price_cents);
  if (plan.stripe_price_id && Number(plan.monthly_price_cents) === cents) {
    return { productId: plan.stripe_product_id, priceId: plan.stripe_price_id };
  }

  let productId = plan.stripe_product_id;
  if (!productId) {
    const product = await stripe.products.create({
      name: `Open Paywall — ${writer.slice(0, 8)}…`,
      metadata: { writer, product: "writer_subscription" },
    });
    productId = product.id;
  }

  const price = await stripe.prices.create({
    currency: "usd",
    unit_amount: cents,
    recurring: { interval: "month" },
    product: productId,
    tax_behavior: "exclusive",
    metadata: { writer, product: "writer_subscription" },
  });

  await supabase(`writer_plans?publisher=eq.${encodeURIComponent(writer)}`, {
    method: "PATCH",
    body: {
      stripe_product_id: productId,
      stripe_price_id: price.id,
      updated_at: new Date().toISOString(),
    },
  });

  return { productId, priceId: price.id };
}

/**
 * @param {{ reader: string, writer: string, successUrl: string, cancelUrl: string }} input
 */
export async function createStripeSubscriptionCheckout(input) {
  const reader = normalizeAddress(input.reader);
  const writer = normalizeAddress(input.writer);
  if (!reader) throw httpError("invalid_reader");
  if (!writer) throw httpError("invalid_writer");
  if (reader === writer) throw httpError("cannot_subscribe_to_self");

  const live = await listLiveSubscriptions(reader, writer);
  if (live.length) throw httpError("already_subscribed", 409);

  const plan = await getWriterPlan(writer);
  if (!plan.offered) throw httpError("plan_not_offered", 404);

  const stored = await supabase(
    `writer_plans?select=*&publisher=eq.${encodeURIComponent(writer)}&limit=1`
  );
  const row = Array.isArray(stored) ? stored[0] : null;
  if (!row) throw httpError("plan_not_offered", 404);

  const { priceId } = await ensureStripePrice(row, writer);
  const stripe = getStripe();
  const methods = await checkoutMethodVisibilityForAccount(stripe);
  const session = await stripe.checkout.sessions.create(
    writerSubscriptionCheckoutSessionParams({
      reader,
      writer,
      priceId,
      successUrl: input.successUrl,
      cancelUrl: input.cancelUrl,
      excludedPaymentMethodTypes: methods.excludedPaymentMethodTypes,
    })
  );

  return { url: session.url, sessionId: session.id };
}

async function activateStripeSubscription({
  reader,
  writer,
  stripeSubscriptionId,
  stripeCustomerId,
  periodEnd,
  amountCents,
}) {
  const row = await upsertSubscriptionRow({
    reader,
    writer,
    status: "active",
    source: "stripe",
    stripe_subscription_id: stripeSubscriptionId,
    stripe_customer_id: stripeCustomerId,
    current_period_end: periodEnd,
    canceled_at: null,
  });
  if (row?.id && amountCents > 0) {
    await queueSubscriptionPayout({
      subscriptionId: row.id,
      writer,
      amountCents,
    });
  }
  return row;
}

/**
 * Stripe Billing webhooks. Safe to call for unrelated events (returns ignored).
 * @param {import("stripe").Stripe.Event} event
 */
export async function applyStripeSubscriptionEvent(event) {
  if (!event?.type) return { ignored: true };

  if (event.type === "invoice.paid") {
    const invoice = event.data.object;
    const subId =
      typeof invoice.subscription === "string"
        ? invoice.subscription
        : invoice.subscription?.id;
    if (!subId) return { ignored: true, reason: "no_subscription" };

    const stripe = getStripe();
    const subscription = await stripe.subscriptions.retrieve(subId);
    if (subscription.metadata?.product !== "writer_subscription") {
      return { ignored: true, reason: "wrong_product" };
    }
    const reader = normalizeAddress(subscription.metadata.reader);
    const writer = normalizeAddress(subscription.metadata.writer);
    if (!reader || !writer) return { ignored: true, reason: "missing_metadata" };

    const periodEnd = subscription.current_period_end
      ? new Date(subscription.current_period_end * 1000).toISOString()
      : new Date(Date.now() + CRYPTO_PERIOD_MS).toISOString();
    const amountCents = invoice.amount_paid || invoice.amount_due || 0;
    const customerId =
      typeof subscription.customer === "string"
        ? subscription.customer
        : subscription.customer?.id;

    const row = await activateStripeSubscription({
      reader,
      writer,
      stripeSubscriptionId: subId,
      stripeCustomerId: customerId,
      periodEnd,
      amountCents,
    });
    return { applied: true, type: event.type, subscriptionId: row?.id };
  }

  if (
    event.type === "customer.subscription.deleted" ||
    event.type === "customer.subscription.updated"
  ) {
    const subscription = event.data.object;
    if (subscription.metadata?.product !== "writer_subscription") {
      return { ignored: true, reason: "wrong_product" };
    }
    const reader = normalizeAddress(subscription.metadata.reader);
    const writer = normalizeAddress(subscription.metadata.writer);
    if (!reader || !writer) return { ignored: true, reason: "missing_metadata" };

    const canceled =
      event.type === "customer.subscription.deleted" ||
      subscription.status === "canceled" ||
      subscription.status === "unpaid";

    if (canceled) {
      await upsertSubscriptionRow({
        reader,
        writer,
        status: "canceled",
        source: "stripe",
        stripe_subscription_id: subscription.id,
        stripe_customer_id:
          typeof subscription.customer === "string"
            ? subscription.customer
            : subscription.customer?.id,
        current_period_end: subscription.current_period_end
          ? new Date(subscription.current_period_end * 1000).toISOString()
          : null,
        canceled_at: new Date().toISOString(),
      });
      return { applied: true, type: event.type, canceled: true };
    }

    if (subscription.status === "past_due") {
      await upsertSubscriptionRow({
        reader,
        writer,
        status: "past_due",
        source: "stripe",
        stripe_subscription_id: subscription.id,
        current_period_end: subscription.current_period_end
          ? new Date(subscription.current_period_end * 1000).toISOString()
          : null,
      });
      return { applied: true, type: event.type, pastDue: true };
    }

    if (subscription.status === "active") {
      await upsertSubscriptionRow({
        reader,
        writer,
        status: "active",
        source: "stripe",
        stripe_subscription_id: subscription.id,
        current_period_end: subscription.current_period_end
          ? new Date(subscription.current_period_end * 1000).toISOString()
          : null,
        canceled_at: null,
      });
      return { applied: true, type: event.type };
    }
  }

  return { ignored: true, type: event.type };
}

/**
 * Record a crypto sub after the reader paid first-month USDC on Monad.
 * @param {{ reader: string, writer: string, txHash?: string, periodEnd?: string }} input
 */
export async function confirmCryptoSubscription(input) {
  const reader = normalizeAddress(input.reader);
  const writer = normalizeAddress(input.writer);
  if (!reader) throw httpError("invalid_reader");
  if (!writer) throw httpError("invalid_writer");
  if (reader === writer) throw httpError("cannot_subscribe_to_self");

  const plan = await getWriterPlan(writer);
  if (!plan.offered) throw httpError("plan_not_offered", 404);

  const live = await listLiveSubscriptions(reader, writer);
  if (live.some((row) => row.source === "crypto")) {
    return { already: true, subscription: live.find((row) => row.source === "crypto") };
  }

  const periodEnd =
    input.periodEnd || new Date(Date.now() + CRYPTO_PERIOD_MS).toISOString();
  const row = await upsertSubscriptionRow({
    reader,
    writer,
    status: "active",
    source: "crypto",
    tx_hash: input.txHash || null,
    current_period_end: periodEnd,
    canceled_at: null,
  });
  return { already: false, subscription: row };
}

/**
 * Immediate cancel for this reader→writer pair (all sources).
 * Stripe cancel is best-effort; local row always drops access.
 */
export async function cancelWriterSubscription({ reader: readerRaw, writer: writerRaw }) {
  const reader = normalizeAddress(readerRaw);
  const writer = normalizeAddress(writerRaw);
  if (!reader) throw httpError("invalid_reader");
  if (!writer) throw httpError("invalid_writer");

  const rows = await supabase(
    `subscriptions?select=*&reader=eq.${encodeURIComponent(reader)}&writer=eq.${encodeURIComponent(writer)}`
  );
  const list = Array.isArray(rows) ? rows : [];
  const now = new Date().toISOString();

  for (const row of list) {
    if (row.source === "stripe" && row.stripe_subscription_id) {
      try {
        const stripe = getStripe();
        await stripe.subscriptions.cancel(row.stripe_subscription_id);
      } catch {
        /* local cancel still wins */
      }
    }
    await supabase(`subscriptions?id=eq.${row.id}`, {
      method: "PATCH",
      body: {
        status: "canceled",
        canceled_at: now,
        updated_at: now,
      },
    });
  }

  return { canceled: list.length, reader, writer };
}

/**
 * Mark expired crypto subs lapsed. Optional on-chain renew is a separate cron
 * once SUBSCRIPTION_CONTRACT + KEEPER_PRIVATE_KEY are set.
 */
export async function lapseExpiredCryptoSubscriptions({ now = new Date() } = {}) {
  const iso = now.toISOString();
  const rows = await supabase(
    `subscriptions?select=id&source=eq.crypto&status=eq.active&canceled_at=is.null&current_period_end=lte.${encodeURIComponent(iso)}`
  );
  const list = Array.isArray(rows) ? rows : [];
  for (const row of list) {
    await supabase(`subscriptions?id=eq.${row.id}`, {
      method: "PATCH",
      body: { status: "lapsed", updated_at: iso },
    });
  }
  return { lapsed: list.length };
}

export async function setArticleALaCarte({ articleId, publisher, allowALaCarte }) {
  const writer = normalizeAddress(publisher);
  const slug = String(articleId || "").trim();
  if (!writer) throw httpError("invalid_publisher");
  if (!slug) throw httpError("invalid_article_id");

  const rows = await supabase(
    `articles?article_id=eq.${encodeURIComponent(slug)}&publisher=eq.${encodeURIComponent(writer)}`,
    {
      method: "PATCH",
      body: {
        allow_a_la_carte: allowALaCarte !== false,
        updated_at: new Date().toISOString(),
      },
    }
  );
  const row = Array.isArray(rows) ? rows[0] : rows;
  if (!row) throw httpError("article_not_found", 404);
  return {
    articleId: row.article_id,
    allowALaCarte: row.allow_a_la_carte !== false,
  };
}
