/**
 * Stripe fiat unlock + Connect USDC payout scaffolding.
 *
 * Flow:
 * 1. POST /api/stripe/create-intent — Checkout Session (elements) for Apple Pay / cards + tax
 * 2. Webhook payment_intent.succeeded OR POST /api/stripe/confirm — grant fiat_unlock
 * 3. payout_jobs row queued; processPayouts transfers to Connect (USDC when enabled)
 *
 * Env:
 *   STRIPE_SECRET_KEY
 *   STRIPE_WEBHOOK_SECRET
 *   STRIPE_CONNECT_WEBHOOK_SECRET — Connect endpoint (events on connected accounts)
 *   STRIPE_CONNECT_DIRECT_CHARGES — "true" enables direct charges for new accounts
 *   SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY
 *   STRIPE_PAYOUT_CRON_SECRET — required to call the payout endpoints
 *   PAYOUTS_CRON_ENABLED — must be the string "true" or pending payouts are not sent
 *   PAYOUT_RETRY_SECRET — admin-only retry of failed rows; the cron never uses it
 *   BLOCKED_PUBLISHERS — comma-separated wallets that cannot be the payee of a new card checkout
 *
 * The writer transfer is the queued sale minus the Stripe processing fee on that
 * charge (balance transaction fee), capped at what the platform netted. The
 * platform does not add a cut. The fee is read at payout time, not estimated.
 * Direct-charge sales (connect_model = direct) are not queued: Stripe fees and
 * payouts stay on the connected account.
 */
import Stripe from "stripe";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { keccak256, toBytes } from "viem";
import { authorizeFiatUnlock } from "./embed-signature.mjs";
import { resolveUnlockChargeCents } from "./article-price.mjs";
import { checkoutMethodVisibilityForAccount } from "./stripe-payment-methods.mjs";
import { isBlockedPublisher } from "./blocked-publishers.mjs";
import { assertConnectOnboardingAuth } from "./writer-mutation-auth.mjs";

const STRIPE_SECRET_KEY = (process.env.STRIPE_SECRET_KEY || "").trim();
const STRIPE_WEBHOOK_SECRET = (process.env.STRIPE_WEBHOOK_SECRET || "").trim();
const SUPABASE_URL = (process.env.SUPABASE_URL || "").trim().replace(/\/$/, "");
const SUPABASE_SERVICE_ROLE_KEY = (process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim();

/** @type {Stripe | null} */
let stripeSingleton = null;

export function stripeConfigured() {
  return Boolean(STRIPE_SECRET_KEY);
}

export function supabaseConfigured() {
  return Boolean(SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY);
}

/**
 * Test-only loopback override. Production leaves this unset and talks to
 * api.stripe.com. A non-loopback value is ignored so the key cannot be
 * pointed at another host.
 */
function loopbackStripeConfig() {
  const raw = (process.env.STRIPE_MOCK_BASE_URL || "").trim();
  if (!raw) return null;
  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    return null;
  }
  if (parsed.protocol !== "http:") return null;
  if (parsed.hostname !== "127.0.0.1" && parsed.hostname !== "localhost") return null;
  return {
    host: parsed.hostname,
    port: parsed.port || "80",
    protocol: "http",
  };
}

export function getStripe() {
  if (!STRIPE_SECRET_KEY) {
    const err = new Error("stripe_not_configured");
    err.status = 503;
    throw err;
  }
  if (!stripeSingleton) {
    const mock = loopbackStripeConfig();
    stripeSingleton = mock ? new Stripe(STRIPE_SECRET_KEY, mock) : new Stripe(STRIPE_SECRET_KEY);
  }
  return stripeSingleton;
}

/**
 * Accounts v1 preview that allows Express dashboard + fees.payer=account
 * + losses.payments=stripe. Sent only on direct-model account creation.
 * Other Stripe calls keep the client's default API version.
 */
export const DIRECT_CONNECT_API_VERSION = "2026-06-24.preview";

export const CONNECT_MODEL_DIRECT = "direct";

/** Direct charges stay off unless this is exactly "true". */
export function directChargesEnabled(env = process.env) {
  return String(env.STRIPE_CONNECT_DIRECT_CHARGES ?? "").trim().toLowerCase() === "true";
}

/**
 * Platform fee in cents for a direct charge.
 * Zero omits application_fee_amount. There is no platform fee today.
 * @param {number} _amountUsdCents
 */
export function directChargeApplicationFeeCents(_amountUsdCents) {
  return 0;
}

/**
 * Platform fee percent for a direct-charge subscription.
 * Zero omits application_fee_percent.
 */
export function directSubscriptionApplicationFeePercent() {
  return 0;
}

/**
 * TODO(tax): a tax advisor is still deciding who is liable on direct charges.
 * Platform charges send liability "self" (the platform). A Checkout Session
 * created on the connected account would make "self" the writer, so this
 * omits liability until STRIPE_DIRECT_TAX_LIABILITY is set.
 *   account  — { type: "self" } on the connected account (writer liable)
 *   platform — { type: "application" } (gated platform-liable direct charges)
 * @param {NodeJS.ProcessEnv} [env]
 */
export function directChargeAutomaticTax(env = process.env) {
  const choice = String(env.STRIPE_DIRECT_TAX_LIABILITY ?? "").trim().toLowerCase();
  if (choice === "account") return { enabled: true, liability: { type: "self" } };
  if (choice === "platform") return { enabled: true, liability: { type: "application" } };
  return { enabled: true };
}

/**
 * Express dashboard, the connected account pays Stripe fees, and Stripe owns
 * negative balances. fees.payer stays "account". Stripe issues 1099-Ks for a
 * connected account when that account pays fees, and does not when the payer
 * is application or application_express.
 * https://docs.stripe.com/connect/tax-reporting
 * @param {string} publisher
 */
export function directConnectAccountParams(publisher) {
  return {
    controller: {
      stripe_dashboard: { type: "express" },
      fees: { payer: "account" },
      losses: { payments: "stripe" },
      requirement_collection: "stripe",
    },
    capabilities: {
      card_payments: { requested: true },
      transfers: { requested: true },
    },
    metadata: { publisher, product: "mon_unlock", connect_model: CONNECT_MODEL_DIRECT },
  };
}

/** @param {string} publisher */
export function legacyConnectAccountParams(publisher) {
  return {
    type: "express",
    capabilities: {
      transfers: { requested: true },
    },
    metadata: { publisher, product: "mon_unlock" },
  };
}

function normalizeConnectedAccountId(value) {
  const id = String(value || "").trim();
  return /^acct_[A-Za-z0-9_]+$/.test(id) ? id : "";
}

function stripeAccountOptions(stripeAccount) {
  const id = normalizeConnectedAccountId(stripeAccount);
  return id ? { stripeAccount: id } : undefined;
}

function appendReturnQuery(raw, key, value) {
  const hashAt = raw.indexOf("#");
  const before = hashAt >= 0 ? raw.slice(0, hashAt) : raw;
  const hash = hashAt >= 0 ? raw.slice(hashAt) : "";
  const join = before.includes("?") ? "&" : "?";
  return `${before}${join}${encodeURIComponent(key)}=${encodeURIComponent(value)}${hash}`;
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
      typeof data === "object" && data?.message ? data.message : `supabase_${res.status}`
    );
    err.status = res.status >= 400 && res.status < 600 ? res.status : 502;
    err.details = data;
    throw err;
  }
  return data;
}

export function articleIdHash(articleId) {
  return keccak256(toBytes(articleId));
}

/** Checkout Sessions API `integration_identifier` suffix: 8 random letters. */
export function checkoutIntegrationId(prefix) {
  const alphabet = "abcdefghijklmnopqrstuvwxyz";
  const bytes = randomBytes(8);
  let suffix = "";
  for (const b of bytes) suffix += alphabet[b % 26];
  return `${prefix}_${suffix}`;
}

/**
 * Look up publisher wallet for an article slug (or hash).
 * @param {string} articleId
 */
export async function lookupArticle(articleId) {
  const hash = articleIdHash(articleId);
  const cols =
    "article_id,article_id_hash,publisher,price_wei,price_cents,listing_status,payment_asset,allow_a_la_carte";
  const bySlug = await supabase(
    `articles?select=${cols}&article_id=eq.${encodeURIComponent(articleId)}&limit=1`
  );
  if (Array.isArray(bySlug) && bySlug[0]) return bySlug[0];

  const byHash = await supabase(
    `articles?select=${cols}&article_id_hash=eq.${encodeURIComponent(hash)}&limit=1`
  );
  if (Array.isArray(byHash) && byHash[0]) return byHash[0];
  return null;
}

/**
 * @param {{
 *   articleId: string,
 *   amountUsdCents: number,
 *   buyerEmail?: string,
 *   title?: string,
 *   embedSig?: string,
 *   contract?: string,
 *   reader?: string,
 *   returnUrl?: string,
 * }} input
 */
async function prepareArticleFiatCharge(input) {
  const articleId = String(input.articleId || "").trim();
  const buyerEmail =
    typeof input.buyerEmail === "string" && input.buyerEmail.includes("@")
      ? input.buyerEmail.trim()
      : undefined;
  const embedSig = String(input.embedSig || "").trim();
  const contract = String(input.contract || "").trim();

  if (!articleId) {
    const err = new Error("invalid_article_id");
    err.status = 400;
    throw err;
  }

  const article = await lookupArticle(articleId);
  if (!article?.publisher) {
    const err = new Error("article_not_found");
    err.status = 404;
    throw err;
  }

  const priced = resolveUnlockChargeCents(article, input.amountUsdCents);
  if (!priced.ok) {
    const err = new Error(priced.error);
    err.status = 400;
    throw err;
  }
  const amountUsdCents = priced.cents;

  const publisherKey = String(article.publisher).toLowerCase();
  if (isBlockedPublisher(publisherKey)) {
    const err = new Error("forbidden");
    err.status = 403;
    throw err;
  }
  if (article.allow_a_la_carte === false) {
    const err = new Error("a_la_carte_disabled");
    err.status = 403;
    throw err;
  }
  try {
    const plans = await supabase(
      `writer_plans?select=allow_a_la_carte&publisher=eq.${encodeURIComponent(publisherKey)}&limit=1`
    );
    if (Array.isArray(plans) && plans[0]?.allow_a_la_carte === false) {
      const err = new Error("a_la_carte_disabled");
      err.status = 403;
      throw err;
    }
  } catch (e) {
    if (e?.message === "a_la_carte_disabled") throw e;
    /* plan missing = allow buy */
  }

  const reader =
    typeof input.reader === "string" && /^0x[a-fA-F0-9]{40}$/.test(input.reader.trim())
      ? input.reader.trim().toLowerCase()
      : "";

  const auth = await authorizeFiatUnlock({
    embedSig,
    contract,
    articleId,
    priceWei: article.price_wei,
    publisher: article.publisher,
    listingStatus: article.listing_status,
  });
  if (!auth.ok) {
    const err = new Error(auth.error);
    err.status = auth.status;
    throw err;
  }

  return {
    articleId,
    amountUsdCents,
    buyerEmail,
    title: input.title,
    reader,
    sessionToken: randomUUID(),
    hash: article.article_id_hash || articleIdHash(articleId),
    publisher: publisherKey,
  };
}

function normalizeCheckoutReturnUrl(returnUrl) {
  const raw = String(returnUrl || "").trim();
  if (!raw) {
    const err = new Error("invalid_return_url");
    err.status = 400;
    throw err;
  }
  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    const err = new Error("invalid_return_url");
    err.status = 400;
    throw err;
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    const err = new Error("invalid_return_url");
    err.status = 400;
    throw err;
  }
  if (!raw.includes("{CHECKOUT_SESSION_ID}")) {
    parsed.searchParams.set("session_id", "{CHECKOUT_SESSION_ID}");
    return parsed.toString();
  }
  return raw;
}

/**
 * Checkout Sessions (ui_mode: elements) for one-time article unlocks + Stripe Tax.
 * Payouts use listed cents in metadata, not the tax-inclusive total.
 * @param {{
 *   articleId: string,
 *   title?: string,
 *   amountUsdCents: number,
 *   sessionToken: string,
 *   publisher: string,
 *   hash: string,
 *   reader?: string,
 *   returnUrl: string,
 *   buyerEmail?: string,
 *   integrationId?: string,
 *   excludedPaymentMethodTypes?: string[],
 *   directCharge?: boolean,
 * }} input
 */
export function articleUnlockCheckoutSessionParams(input) {
  const title = input.title
    ? `Unlock: ${String(input.title).slice(0, 120)}`
    : `Unlock article ${input.articleId}`;
  const directCharge = input.directCharge === true;
  const metadata = {
    articleId: input.articleId,
    articleIdHash: input.hash,
    publisher: input.publisher,
    sessionToken: input.sessionToken,
    amountUsdCents: String(input.amountUsdCents),
    product: "mon_unlock_fiat",
    ...(input.reader ? { reader: input.reader } : {}),
    ...(directCharge ? { connectModel: CONNECT_MODEL_DIRECT } : {}),
  };
  const applicationFeeCents = directCharge ? directChargeApplicationFeeCents(input.amountUsdCents) : 0;
  return {
    ui_mode: "elements",
    mode: "payment",
    automatic_tax: directCharge
      ? directChargeAutomaticTax()
      : { enabled: true, liability: { type: "self" } },
    integration_identifier: input.integrationId || checkoutIntegrationId("op_article_unlock"),
    return_url: input.returnUrl,
    customer_email: input.buyerEmail,
    line_items: [
      {
        price_data: {
          currency: "usd",
          unit_amount: input.amountUsdCents,
          tax_behavior: "exclusive",
          product_data: { name: title },
        },
        quantity: 1,
      },
    ],
    metadata,
    payment_intent_data: {
      description: title,
      metadata,
      ...(applicationFeeCents > 0 ? { application_fee_amount: applicationFeeCents } : {}),
    },
    ...(input.excludedPaymentMethodTypes?.length
      ? { excluded_payment_method_types: input.excludedPaymentMethodTypes }
      : {}),
  };
}

/**
 * @param {{
 *   articleId: string,
 *   amountUsdCents: number,
 *   buyerEmail?: string,
 *   title?: string,
 *   embedSig?: string,
 *   contract?: string,
 *   reader?: string,
 *   returnUrl?: string,
 * }} input
 */
export async function createArticleCheckoutSession(input) {
  const stripe = getStripe();
  const prepared = await prepareArticleFiatCharge(input);
  const returnUrl = normalizeCheckoutReturnUrl(input.returnUrl);
  const directAccountId = await directChargeAccountForCheckout(prepared.publisher);
  const methods = await checkoutMethodVisibilityForAccount(stripe, directAccountId || undefined);
  const session = await stripe.checkout.sessions.create(
    articleUnlockCheckoutSessionParams({
      ...prepared,
      returnUrl: directAccountId
        ? appendReturnQuery(returnUrl, "stripe_account", directAccountId)
        : returnUrl,
      excludedPaymentMethodTypes: methods.excludedPaymentMethodTypes,
      directCharge: Boolean(directAccountId),
    }),
    directAccountId ? { stripeAccount: directAccountId } : undefined
  );

  return {
    clientSecret: session.client_secret,
    sessionId: session.id,
    sessionToken: prepared.sessionToken,
    amountUsdCents: prepared.amountUsdCents,
    publisher: prepared.publisher,
    articleIdHash: prepared.hash,
    expressPaymentMethods: methods.expressPaymentMethods,
    ...(directAccountId ? { stripeAccountId: directAccountId } : {}),
  };
}

/** @deprecated Use createArticleCheckoutSession — article cards now go through Checkout Tax. */
export async function createPaymentIntent(input) {
  return createArticleCheckoutSession(input);
}

/** Postgres unique_violation (23505) from PostgREST / Supabase. */
export function isUniqueViolation(err) {
  const code = err?.details?.code;
  const msg = String(err?.message || "");
  return code === "23505" || /duplicate key value violates unique constraint/i.test(msg);
}

/** Scheduled payouts stay off until this is exactly "true". */
export function payoutsCronEnabled(env = process.env) {
  return String(env.PAYOUTS_CRON_ENABLED ?? "").trim().toLowerCase() === "true";
}

const PAYOUT_COUNT_KEYS = ["paid", "failed", "pending", "skipped", "not_claimed", "reversed"];

export function emptyPayoutCounts() {
  return { paid: 0, failed: 0, pending: 0, skipped: 0, not_claimed: 0, reversed: 0 };
}

/** Counts and statuses only. Callers must not append ids or amounts. */
export function formatPayoutLog(counts, status) {
  const parts = [];
  if (status) parts.push(`status=${status}`);
  for (const key of PAYOUT_COUNT_KEYS) {
    parts.push(`${key}=${Number(counts?.[key]) || 0}`);
  }
  return `[stripe] payouts ${parts.join(" ")}`;
}

export function payoutIdempotencyKey(jobId) {
  return `payout_job_${jobId}`;
}

/**
 * Charge id from a PaymentIntent, Charge, Invoice, or Dispute-shaped object.
 * Returns null unless the id is a charge id.
 * @param {object | null | undefined} source
 */
export function stripeChargeId(source) {
  if (!source || typeof source !== "object") return null;
  const values = [source.latest_charge, source.charge];
  if (source.object === "charge") values.push(source.id);
  for (const value of values) {
    if (typeof value === "string" && value.startsWith("ch_")) return value;
    if (value && typeof value === "object" && typeof value.id === "string" && value.id.startsWith("ch_")) {
      return value.id;
    }
  }
  const payments = source.payments?.data;
  if (Array.isArray(payments)) {
    for (const entry of payments) {
      const nested = stripeChargeId(entry?.payment) || stripeChargeId(entry);
      if (nested) return nested;
    }
  }
  const charges = source.charges?.data;
  if (Array.isArray(charges)) {
    for (const charge of charges) {
      const nested = stripeChargeId(charge);
      if (nested) return nested;
    }
  }
  return null;
}

function isUnknownColumn(err, column) {
  const blob = `${err?.message || ""} ${err?.details?.message || ""} ${err?.details?.code || ""}`;
  return blob.includes(column) && /PGRST204|42703|schema cache|does not exist/i.test(blob);
}

function transferFailureCode(err) {
  const code = String(err?.code || err?.raw?.code || "");
  if (code === "balance_insufficient" || code === "insufficient_funds") return "balance_insufficient";
  return "transfer_failed";
}

async function supabaseInsert(table, row) {
  try {
    return await supabase(table, {
      method: "POST",
      headers: { Prefer: "return=representation" },
      body: [row],
    });
  } catch (e) {
    if (!Object.prototype.hasOwnProperty.call(row, "stripe_charge_id") || !isUnknownColumn(e, "stripe_charge_id")) {
      throw e;
    }
    const copy = { ...row };
    delete copy.stripe_charge_id;
    return await supabase(table, {
      method: "POST",
      headers: { Prefer: "return=representation" },
      body: [copy],
    });
  }
}

/**
 * @param {string} paymentIntentId
 * @param {string} [sessionToken]
 */
async function findExistingFiatUnlock(paymentIntentId, sessionToken) {
  const byIntent = await supabase(
    `fiat_unlocks?select=id,session_token&stripe_payment_intent_id=eq.${encodeURIComponent(paymentIntentId)}&limit=1`
  );
  if (Array.isArray(byIntent) && byIntent[0]) return byIntent[0];

  if (sessionToken) {
    const bySession = await supabase(
      `fiat_unlocks?select=id,session_token&session_token=eq.${encodeURIComponent(sessionToken)}&limit=1`
    );
    if (Array.isArray(bySession) && bySession[0]) return bySession[0];
  }
  return null;
}

/**
 * Idempotent: grant unlock + queue USDC payout job.
 * Safe when webhook and /api/stripe/confirm race on the same PaymentIntent.
 * @param {Stripe.PaymentIntent} intent
 */
export async function grantFiatUnlockFromIntent(intent) {
  if (intent.status !== "succeeded") {
    return { granted: false, reason: "not_succeeded" };
  }
  if (intent.metadata?.product !== "mon_unlock_fiat") {
    return { granted: false, reason: "wrong_product" };
  }

  const articleId = intent.metadata.articleId;
  const articleIdHash = intent.metadata.articleIdHash || articleIdHashSafe(articleId);
  const publisher = (intent.metadata.publisher || "").toLowerCase();
  const sessionToken = intent.metadata.sessionToken || randomUUID();
  const listedCents = Math.round(Number(intent.metadata.amountUsdCents));
  const amountCents =
    Number.isFinite(listedCents) && listedCents >= 50
      ? listedCents
      : intent.amount_received || intent.amount;

  if (!articleId || !publisher || !articleIdHash) {
    const err = new Error("incomplete_intent_metadata");
    err.status = 400;
    throw err;
  }

  // Already granted? (common path when confirm runs after webhook)
  const existing = await findExistingFiatUnlock(intent.id, sessionToken);
  if (existing) {
    return {
      granted: true,
      already: true,
      sessionToken: existing.session_token,
      fiatUnlockId: existing.id,
    };
  }

  const chargeId = stripeChargeId(intent);
  let unlock;
  try {
    const unlockRow = {
      article_id: articleId,
      article_id_hash: articleIdHash,
      publisher,
      session_token: sessionToken,
      stripe_payment_intent_id: intent.id,
      amount_cents: amountCents,
      currency: intent.currency || "usd",
      buyer_email: intent.receipt_email || null,
      reader: intent.metadata?.reader || null,
      status: "succeeded",
    };
    if (chargeId) unlockRow.stripe_charge_id = chargeId;
    const rows = await supabaseInsert("fiat_unlocks", unlockRow);
    unlock = Array.isArray(rows) ? rows[0] : rows;
  } catch (e) {
    // Concurrent webhook + confirm both passed the pre-check; loser hits unique constraint.
    if (isUniqueViolation(e)) {
      const raced = await findExistingFiatUnlock(intent.id, sessionToken);
      if (raced) {
        return {
          granted: true,
          already: true,
          sessionToken: raced.session_token,
          fiatUnlockId: raced.id,
        };
      }
    }
    throw e;
  }

  if (!unlock?.id) {
    const err = new Error("fiat_unlock_insert_failed");
    err.status = 502;
    throw err;
  }

  // Queued amount is the listed sale. Stripe's fee is deducted when the transfer is created.
  // A reader who already paid still gets the unlock. No new payout row is
  // queued when that article's publisher is on BLOCKED_PUBLISHERS, or when
  // the charge was a direct charge on the writer's connected account.
  // Pending and failed rows are left alone.
  const directSale = intent.metadata?.connectModel === CONNECT_MODEL_DIRECT;
  if (amountCents > 0 && !isBlockedPublisher(publisher) && !directSale) {
    const payoutRow = {
      fiat_unlock_id: unlock.id,
      publisher,
      amount_cents: amountCents,
      currency: "usd",
      status: "pending",
    };
    if (chargeId) payoutRow.stripe_charge_id = chargeId;
    await supabaseInsert("payout_jobs", payoutRow);
  }

  return { granted: true, already: false, sessionToken, fiatUnlockId: unlock.id };
}

function articleIdHashSafe(articleId) {
  if (!articleId) return "";
  try {
    return keccak256(toBytes(articleId));
  } catch {
    return createHash("sha256").update(articleId).digest("hex");
  }
}

/**
 * @param {import("stripe").Stripe.Checkout.Session} session
 */
export async function grantFiatUnlockFromCheckoutSession(session) {
  if (session.metadata?.product !== "mon_unlock_fiat") {
    return { granted: false, reason: "wrong_product" };
  }
  if (session.payment_status !== "paid") {
    return { granted: false, reason: "not_paid" };
  }
  const paymentIntentId =
    typeof session.payment_intent === "string"
      ? session.payment_intent
      : session.payment_intent?.id;
  if (!paymentIntentId) {
    return { granted: false, reason: "no_payment_intent" };
  }
  const listedCents = Math.round(Number(session.metadata.amountUsdCents));
  return grantFiatUnlockFromIntent({
    id: paymentIntentId,
    status: "succeeded",
    amount: Number.isFinite(listedCents) && listedCents >= 50 ? listedCents : session.amount_subtotal,
    amount_received:
      Number.isFinite(listedCents) && listedCents >= 50 ? listedCents : session.amount_subtotal,
    currency: session.currency,
    receipt_email: session.customer_details?.email || session.customer_email || null,
    metadata: session.metadata,
  });
}

/**
 * @param {{ paymentIntentId?: string, sessionId?: string }} input
 */
export async function confirmFiatPayment(input) {
  const stripe = getStripe();
  const opts = stripeAccountOptions(input?.stripeAccountId);
  const sessionId = String(input.sessionId || "").trim();
  if (sessionId.startsWith("cs_")) {
    const session = await stripe.checkout.sessions.retrieve(
      sessionId,
      { expand: ["payment_intent"] },
      opts
    );
    return grantFiatUnlockFromCheckoutSession(session);
  }
  const paymentIntentId = String(input.paymentIntentId || "").trim();
  if (!paymentIntentId.startsWith("pi_")) {
    const err = new Error("invalid_payment_intent");
    err.status = 400;
    throw err;
  }
  const intent = await stripe.paymentIntents.retrieve(paymentIntentId, {}, opts);
  return grantFiatUnlockFromIntent(intent);
}

/**
 * @param {string} paymentIntentId
 */
export async function confirmPaymentIntent(paymentIntentId) {
  return confirmFiatPayment({ paymentIntentId });
}

function connectWebhookSecret() {
  return (process.env.STRIPE_CONNECT_WEBHOOK_SECRET || "").trim();
}

/**
 * @param {import("stripe").Stripe.Event} event
 * @param {string} [stripeAccount]
 */
async function dispatchStripeEvent(event, stripeAccount) {
  if (
    event.type === "checkout.session.completed" ||
    event.type === "checkout.session.async_payment_succeeded"
  ) {
    const session = event.data.object;
    const result = await grantFiatUnlockFromCheckoutSession(session);
    return { received: true, type: event.type, ...result };
  }

  if (event.type === "payment_intent.succeeded") {
    const intent = event.data.object;
    const result = await grantFiatUnlockFromIntent(intent);
    return { received: true, type: event.type, ...result };
  }

  if (
    event.type === "invoice.paid" ||
    event.type === "customer.subscription.updated" ||
    event.type === "customer.subscription.deleted"
  ) {
    const { applyStripeSubscriptionEvent } = await import("./subscriptions.mjs");
    const result = await applyStripeSubscriptionEvent(event, { stripeAccount: stripeAccount || "" });
    return { received: true, type: event.type, ...result };
  }

  if (event.type === "charge.refunded" || event.type === "charge.dispute.created") {
    const object = event.data.object;
    const paymentIntentId =
      typeof object.payment_intent === "string" ? object.payment_intent : object.payment_intent?.id;
    const chargeId = stripeChargeId(object);
    const status = event.type === "charge.refunded" ? "refunded" : "disputed";
    await markUnlockNotPayable({ paymentIntentId, chargeId, status });
    return { received: true, type: event.type };
  }

  return { received: true, type: event.type, ignored: true };
}

/**
 * @param {string} rawBody
 * @param {string | string[] | undefined} signature
 * @param {string} secret
 */
function constructStripeEvent(rawBody, signature, secret) {
  const stripe = getStripe();
  const sig = Array.isArray(signature) ? signature[0] : signature;
  if (!sig) {
    const err = new Error("missing_signature");
    err.status = 400;
    throw err;
  }
  return stripe.webhooks.constructEvent(rawBody, sig, secret);
}

/**
 * Platform webhook. Objects live on the platform account.
 * @param {string} rawBody
 * @param {string | string[] | undefined} signature
 */
export async function handleStripeWebhook(rawBody, signature) {
  if (!STRIPE_WEBHOOK_SECRET) {
    const err = new Error("stripe_webhook_not_configured");
    err.status = 503;
    throw err;
  }
  const event = constructStripeEvent(rawBody, signature, STRIPE_WEBHOOK_SECRET);
  return dispatchStripeEvent(event, "");
}

/**
 * Connect webhook. Events are for connected accounts (`event.account`).
 * Direct-charge retrieves pass that account. Idempotent with the platform handler.
 * @param {string} rawBody
 * @param {string | string[] | undefined} signature
 */
export async function handleStripeConnectWebhook(rawBody, signature) {
  const secret = connectWebhookSecret();
  if (!secret) {
    const err = new Error("stripe_connect_webhook_not_configured");
    err.status = 503;
    throw err;
  }
  const event = constructStripeEvent(rawBody, signature, secret);
  const stripeAccount = normalizeConnectedAccountId(event.account);
  if (!stripeAccount) {
    return { received: true, type: event.type, ignored: true, reason: "missing_account" };
  }
  return dispatchStripeEvent(event, stripeAccount);
}

let connectModelColumns = true;

const PUBLISHER_ACCOUNT_COLUMNS =
  "stripe_account_id,onboarded_at,connect_model,legacy_stripe_account_id";
const PUBLISHER_ACCOUNT_COLUMNS_LEGACY = "stripe_account_id,onboarded_at";

function publisherAccountColumns() {
  return connectModelColumns ? PUBLISHER_ACCOUNT_COLUMNS : PUBLISHER_ACCOUNT_COLUMNS_LEGACY;
}

function connectColumnMissing(err) {
  return isUnknownColumn(err, "connect_model") || isUnknownColumn(err, "legacy_stripe_account_id");
}

/**
 * @param {string} publisher
 */
export async function lookupPublisherAccount(publisher) {
  const cols = publisherAccountColumns();
  try {
    const rows = await supabase(
      `publisher_accounts?select=${encodeURIComponent(cols)}&publisher=eq.${encodeURIComponent(publisher)}&limit=1`
    );
    return Array.isArray(rows) && rows[0] ? rows[0] : null;
  } catch (e) {
    if (connectModelColumns && connectColumnMissing(e)) {
      connectModelColumns = false;
      return lookupPublisherAccount(publisher);
    }
    throw e;
  }
}

async function connectModelStorageReady() {
  if (!connectModelColumns) return false;
  try {
    await supabase("publisher_accounts?select=connect_model,legacy_stripe_account_id&limit=1");
    return true;
  } catch (e) {
    if (connectColumnMissing(e)) {
      connectModelColumns = false;
      return false;
    }
    throw e;
  }
}

/**
 * Connected account id for a direct-charge Checkout Session.
 * Empty string means the platform charge path (flag off, or a legacy account).
 * A writer with no account while the flag is on cannot take cards.
 * @param {string} publisher
 */
async function directChargeAccountForCheckout(publisher) {
  if (!directChargesEnabled()) return "";
  const row = await lookupPublisherAccount(publisher);
  if (!row?.stripe_account_id || row.connect_model !== CONNECT_MODEL_DIRECT) {
    if (!row?.stripe_account_id) {
      const err = new Error("publisher_not_payable");
      err.status = 409;
      throw err;
    }
    return "";
  }
  const stripe = getStripe();
  let acct;
  try {
    acct = await stripe.accounts.retrieve(row.stripe_account_id);
  } catch {
    const err = new Error("publisher_not_payable");
    err.status = 409;
    throw err;
  }
  if (!acct?.charges_enabled) {
    const err = new Error("publisher_not_payable");
    err.status = 409;
    throw err;
  }
  return row.stripe_account_id;
}

/**
 * @param {object} row
 */
async function savePublisherAccount(row) {
  try {
    await supabase("publisher_accounts?on_conflict=publisher", {
      method: "POST",
      headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
      body: [row],
    });
  } catch (e) {
    if (connectModelColumns && connectColumnMissing(e) && row.connect_model === CONNECT_MODEL_DIRECT) {
      connectModelColumns = false;
      const err = new Error("connect_model_migration_required");
      err.status = 503;
      throw err;
    }
    throw e;
  }
}

/**
 * Where a queued platform transfer is sent.
 * After a writer re-onboards, already-pending rows still use the previous account.
 * @param {object | null | undefined} account
 */
export function payoutTransferDestination(account) {
  if (
    account?.connect_model === CONNECT_MODEL_DIRECT &&
    typeof account.legacy_stripe_account_id === "string" &&
    account.legacy_stripe_account_id.startsWith("acct_")
  ) {
    return account.legacy_stripe_account_id;
  }
  return typeof account?.stripe_account_id === "string" ? account.stripe_account_id : "";
}

/**
 * Writer-facing Connect state. Does not include Stripe account ids.
 * @param {string} publisherRaw
 */
export async function getConnectStatus(publisherRaw) {
  const directCharges = directChargesEnabled();
  if (!directCharges) return { directCharges: false };
  const publisher = String(publisherRaw || "").trim().toLowerCase();
  if (!/^0x[a-f0-9]{40}$/.test(publisher) || isBlockedPublisher(publisher)) {
    return { directCharges: true, connectModel: null, needsReonboard: false, payable: false };
  }
  const row = await lookupPublisherAccount(publisher);
  if (row?.connect_model === CONNECT_MODEL_DIRECT && row.stripe_account_id) {
    return {
      directCharges: true,
      connectModel: CONNECT_MODEL_DIRECT,
      needsReonboard: false,
      payable: Boolean(row.onboarded_at),
    };
  }
  if (row?.stripe_account_id) {
    return { directCharges: true, connectModel: "legacy", needsReonboard: true, payable: false };
  }
  return { directCharges: true, connectModel: null, needsReonboard: false, payable: false };
}

/**
 * Create / reuse Connect Express account and return onboarding link.
 * Publisher links a wallet in Express for USDC stablecoin payouts (private preview).
 * Requires a fresh EIP-191 signature from that wallet. Auth runs before Stripe
 * and before the publisher_accounts lookup, so a failed proof never returns a
 * link or an existing account id.
 * @param {{ publisher: string, refreshUrl: string, returnUrl: string, issuedAt?: string, connectSig?: string, reonboard?: boolean }} input
 */
export async function createConnectOnboardingLink(input) {
  const publisherPreview = String(input?.publisher || "").trim().toLowerCase();
  if (isBlockedPublisher(publisherPreview)) {
    const err = new Error("forbidden");
    err.status = 403;
    throw err;
  }
  const reonboard = input?.reonboard === true;
  await assertConnectOnboardingAuth({
    publisher: input.publisher,
    issuedAt: input.issuedAt,
    connectSig: input.connectSig,
    reonboard,
  });
  const stripe = getStripe();
  const publisher = String(input.publisher || "").trim().toLowerCase();
  if (!/^0x[a-f0-9]{40}$/.test(publisher)) {
    const err = new Error("invalid_publisher");
    err.status = 400;
    throw err;
  }

  let accountId;
  const existing = await lookupPublisherAccount(publisher);
  const direct = directChargesEnabled();
  const model = existing?.connect_model === CONNECT_MODEL_DIRECT ? CONNECT_MODEL_DIRECT : "legacy";
  const replacing = direct && reonboard && existing?.stripe_account_id && model !== CONNECT_MODEL_DIRECT;
  if (existing?.stripe_account_id && !replacing) {
    accountId = existing.stripe_account_id;
  } else if (direct) {
    if (!(await connectModelStorageReady())) {
      const err = new Error("connect_model_migration_required");
      err.status = 503;
      throw err;
    }
    const account = await stripe.accounts.create(directConnectAccountParams(publisher), {
      apiVersion: DIRECT_CONNECT_API_VERSION,
    });
    accountId = account.id;
    await savePublisherAccount({
      publisher,
      stripe_account_id: accountId,
      connect_model: CONNECT_MODEL_DIRECT,
      legacy_stripe_account_id: replacing ? existing.stripe_account_id : null,
      onboarded_at: null,
      updated_at: new Date().toISOString(),
    });
  } else {
    const account = await stripe.accounts.create(legacyConnectAccountParams(publisher));
    accountId = account.id;
    await savePublisherAccount({
      publisher,
      stripe_account_id: accountId,
      updated_at: new Date().toISOString(),
    });
  }

  // Refresh onboarded_at when Express account can receive transfers.
  try {
    const acct = await stripe.accounts.retrieve(accountId);
    if (acct?.charges_enabled || acct?.payouts_enabled) {
      await supabase(`publisher_accounts?publisher=eq.${encodeURIComponent(publisher)}`, {
        method: "PATCH",
        headers: { Prefer: "return=minimal" },
        body: {
          onboarded_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        },
      });
    }
  } catch {
    /* non-fatal */
  }

  const link = await stripe.accountLinks.create({
    account: accountId,
    refresh_url: input.refreshUrl,
    return_url: input.returnUrl,
    type: "account_onboarding",
  });

  return { url: link.url, stripeAccountId: accountId };
}

let payoutChargeColumn = true;

function payoutProcessed(counts) {
  return PAYOUT_COUNT_KEYS.reduce((sum, key) => sum + (Number(counts[key]) || 0), 0);
}

function finishPayoutRun(counts) {
  console.log(formatPayoutLog(counts, "ran"));
  return { ...counts, processed: payoutProcessed(counts) };
}

async function selectPayoutJobs(status, limit) {
  const unlockColumns = payoutChargeColumn
    ? "id,status,stripe_payment_intent_id,stripe_charge_id"
    : "id,status,stripe_payment_intent_id";
  const select = `*,fiat_unlocks(${unlockColumns})`;
  const transferGuard = status === "failed" ? "&stripe_transfer_id=is.null" : "";
  try {
    const rows = await supabase(
      `payout_jobs?select=${encodeURIComponent(select)}&status=eq.${encodeURIComponent(status)}${transferGuard}&order=created_at.asc&limit=${limit}`
    );
    return Array.isArray(rows) ? rows : [];
  } catch (e) {
    if (payoutChargeColumn && isUnknownColumn(e, "stripe_charge_id")) {
      payoutChargeColumn = false;
      return selectPayoutJobs(status, limit);
    }
    throw e;
  }
}

/** Stripe Transfer `amount` must be a positive integer in the smallest currency unit. */
export const MIN_STRIPE_TRANSFER_CENTS = 1;

const PAYOUT_FEE_COLUMNS = ["stripe_fee_cents", "net_cents"];
let payoutFeeColumns = true;

/** @param {unknown} value */
function integerCents(value) {
  if (typeof value === "number" && Number.isInteger(value)) return value;
  if (typeof value === "string" && /^-?\d+$/.test(value)) {
    const parsed = Number(value);
    return Number.isSafeInteger(parsed) ? parsed : null;
  }
  return null;
}

function sameMoneyCurrency(a, b) {
  const left = String(a || "").trim().toLowerCase();
  const right = String(b || "").trim().toLowerCase();
  return left !== "" && left === right;
}

/**
 * Writer transfer for one card sale.
 * `saleCents` is the queued sale (listed price, not tax).
 * `feeCents` is that charge's balance transaction fee.
 * `platformNetCents` is what the platform still holds from the charge.
 * The result is sale minus that fee, and never above the platform net or the charge.
 * @param {{
 *   saleCents: number,
 *   feeCents: number,
 *   platformNetCents: number,
 *   chargeCents?: number | null,
 *   minimumCents?: number,
 * }} input
 */
export function writerCardTransferCents(input) {
  const sale = integerCents(input.saleCents);
  const fee = integerCents(input.feeCents);
  const platformNet = integerCents(input.platformNetCents);
  const minimum = integerCents(input.minimumCents ?? MIN_STRIPE_TRANSFER_CENTS);
  if (
    sale == null ||
    sale <= 0 ||
    fee == null ||
    fee < 0 ||
    platformNet == null ||
    minimum == null ||
    minimum < 1
  ) {
    return { ok: false, reason: "invalid_amounts" };
  }
  /** @type {number[]} */
  const caps = [sale - fee, platformNet, sale];
  const charge = integerCents(input.chargeCents);
  if (charge != null && charge >= 0) caps.push(charge);
  const raw = Math.min(...caps);
  const netCents = raw > 0 ? raw : 0;
  if (raw < minimum) {
    return {
      ok: true,
      action: "skip",
      transferCents: netCents,
      feeCents: fee,
      netCents,
      reason: raw <= 0 ? "net_non_positive" : "below_minimum_transfer",
    };
  }
  return {
    ok: true,
    action: "transfer",
    transferCents: raw,
    feeCents: fee,
    netCents: raw,
    reason: null,
  };
}

/**
 * Settlement for a payout from the charge's balance transaction.
 * A missing balance transaction is not ready yet — callers leave the job pending.
 * A currency that is not the payout currency is skipped; we do not estimate a conversion.
 * @param {object | null | undefined} charge
 * @param {number} saleCents
 * @param {string} [payoutCurrency]
 */
export function settlementFromCharge(charge, saleCents, payoutCurrency = "usd") {
  const bt = charge?.balance_transaction;
  if (!bt || typeof bt !== "object") {
    return { ready: false, reason: "processing_fee_unavailable" };
  }
  const payout = String(payoutCurrency || "usd").toLowerCase();
  if (
    !sameMoneyCurrency(bt.currency, payout) ||
    (charge.currency && !sameMoneyCurrency(charge.currency, bt.currency))
  ) {
    return {
      ready: true,
      action: "skip",
      transferCents: 0,
      feeCents: null,
      netCents: null,
      reason: "fee_currency_mismatch",
    };
  }
  const fee = integerCents(bt.fee);
  const net = integerCents(bt.net);
  if (fee == null || fee < 0 || net == null) {
    return { ready: false, reason: "processing_fee_unavailable" };
  }
  if (charge.refunded === true || charge.disputed === true) {
    return {
      ready: true,
      action: "skip",
      transferCents: 0,
      feeCents: fee,
      netCents: 0,
      reason: "not_payable",
    };
  }
  let platformNet = net;
  const refunded = integerCents(charge.amount_refunded);
  if (refunded != null && refunded > 0) platformNet -= refunded;
  const decision = writerCardTransferCents({
    saleCents,
    feeCents: fee,
    platformNetCents: platformNet,
    chargeCents: integerCents(charge.amount),
  });
  if (!decision.ok) return { ready: false, reason: decision.reason };
  return { ready: true, ...decision };
}

function recordedWriterNet(job) {
  const net = integerCents(job?.net_cents);
  const fee = integerCents(job?.stripe_fee_cents);
  if (net == null || net < 0 || fee == null || fee < 0) return null;
  return { netCents: net, feeCents: fee };
}

function withoutFeeColumns(patch) {
  const copy = { ...patch };
  for (const column of PAYOUT_FEE_COLUMNS) delete copy[column];
  return copy;
}

function feeAuditPatch(settlement) {
  /** @type {Record<string, number>} */
  const patch = {};
  if (Number.isInteger(settlement.feeCents) && settlement.feeCents >= 0) {
    patch.stripe_fee_cents = settlement.feeCents;
  }
  if (Number.isInteger(settlement.netCents) && settlement.netCents >= 0) {
    patch.net_cents = settlement.netCents;
  }
  return patch;
}

/** Test isolation. Production leaves the schema probe latched after the first miss. */
export function resetPayoutColumnSupportForTests() {
  payoutFeeColumns = true;
  payoutChargeColumn = true;
  connectModelColumns = true;
}

async function transitionPayout(id, fromStatus, patch) {
  const body = payoutFeeColumns ? patch : withoutFeeColumns(patch);
  try {
    const rows = await supabase(
      `payout_jobs?id=eq.${encodeURIComponent(id)}&status=eq.${encodeURIComponent(fromStatus)}`,
      {
        method: "PATCH",
        headers: { Prefer: "return=representation" },
        body: { ...body, updated_at: new Date().toISOString() },
      }
    );
    return Array.isArray(rows) && rows.length === 1 ? rows[0] : null;
  } catch (e) {
    if (payoutFeeColumns && PAYOUT_FEE_COLUMNS.some((column) => isUnknownColumn(e, column))) {
      payoutFeeColumns = false;
      return transitionPayout(id, fromStatus, patch);
    }
    throw e;
  }
}

async function claimPayout(id, fromStatus) {
  const rows = await supabase(
    `payout_jobs?id=eq.${encodeURIComponent(id)}&status=eq.${encodeURIComponent(fromStatus)}&stripe_transfer_id=is.null`,
    {
      method: "PATCH",
      headers: { Prefer: "return=representation" },
      body: { status: "processing", error: null, updated_at: new Date().toISOString() },
    }
  );
  if (!Array.isArray(rows) || rows.length !== 1 || rows[0].status !== "processing") return null;
  return rows[0];
}

async function reloadUnlock(job) {
  if (!job?.fiat_unlock_id) return null;
  const select = payoutChargeColumn
    ? "id,status,stripe_payment_intent_id,stripe_charge_id"
    : "id,status,stripe_payment_intent_id";
  try {
    const rows = await supabase(
      `fiat_unlocks?select=${encodeURIComponent(select)}&id=eq.${encodeURIComponent(job.fiat_unlock_id)}&limit=1`
    );
    return Array.isArray(rows) && rows[0] ? rows[0] : null;
  } catch (e) {
    if (payoutChargeColumn && isUnknownColumn(e, "stripe_charge_id")) {
      payoutChargeColumn = false;
      return reloadUnlock(job);
    }
    throw e;
  }
}

async function rememberChargeId(job, unlock, chargeId) {
  if (!chargeId) return;
  const writes = [];
  if (unlock?.id && unlock.stripe_charge_id !== chargeId) {
    writes.push(
      supabase(`fiat_unlocks?id=eq.${encodeURIComponent(unlock.id)}`, {
        method: "PATCH",
        headers: { Prefer: "return=minimal" },
        body: { stripe_charge_id: chargeId },
      })
    );
  }
  if (job?.id && job.stripe_charge_id !== chargeId) {
    writes.push(
      supabase(`payout_jobs?id=eq.${encodeURIComponent(job.id)}&status=eq.processing`, {
        method: "PATCH",
        headers: { Prefer: "return=minimal" },
        body: { stripe_charge_id: chargeId },
      })
    );
  }
  if (writes.length === 0) return;
  try {
    await Promise.all(writes);
  } catch {
    /* The transfer still carries the charge. A cache write must not block it. */
  }
}

async function resolveChargeId(job, unlock, stripe) {
  const stored = [job?.stripe_charge_id, unlock?.stripe_charge_id].find(
    (id) => typeof id === "string" && id.startsWith("ch_")
  );
  if (stored) return stored;
  const paymentIntentId = unlock?.stripe_payment_intent_id;
  if (typeof paymentIntentId !== "string" || !paymentIntentId.startsWith("pi_")) return null;
  const intent = await stripe.paymentIntents.retrieve(paymentIntentId);
  const chargeId = stripeChargeId(intent);
  await rememberChargeId(job, unlock, chargeId);
  return chargeId;
}

/**
 * Refunds and disputes make the unlock's payout not payable.
 * Rows that already have a transfer id are left alone.
 * @param {{ paymentIntentId?: string, chargeId?: string, status: "refunded" | "disputed" }} input
 */
export async function markUnlockNotPayable({ paymentIntentId, chargeId, status }) {
  if (status !== "refunded" && status !== "disputed") {
    const err = new Error("invalid_unlock_status");
    err.status = 400;
    throw err;
  }
  /** @type {Array<{ id: number | string }>} */
  let unlocks = [];
  if (typeof paymentIntentId === "string" && paymentIntentId.startsWith("pi_")) {
    const rows = await supabase(
      `fiat_unlocks?stripe_payment_intent_id=eq.${encodeURIComponent(paymentIntentId)}`,
      {
        method: "PATCH",
        headers: { Prefer: "return=representation" },
        body: { status },
      }
    );
    if (Array.isArray(rows)) unlocks = rows;
  }
  if (unlocks.length === 0 && typeof chargeId === "string" && chargeId.startsWith("ch_")) {
    try {
      const rows = await supabase(
        `fiat_unlocks?stripe_charge_id=eq.${encodeURIComponent(chargeId)}`,
        {
          method: "PATCH",
          headers: { Prefer: "return=representation" },
          body: { status },
        }
      );
      if (Array.isArray(rows)) unlocks = rows;
    } catch (e) {
      if (!isUnknownColumn(e, "stripe_charge_id")) throw e;
    }
  }

  let skipped = 0;
  for (const unlock of unlocks) {
    if (unlock?.id == null) continue;
    const jobs = await supabase(
      `payout_jobs?fiat_unlock_id=eq.${encodeURIComponent(unlock.id)}&or=(status.eq.pending,status.eq.processing)&stripe_transfer_id=is.null`,
      {
        method: "PATCH",
        headers: { Prefer: "return=representation" },
        body: { status: "skipped", error: "not_payable", updated_at: new Date().toISOString() },
      }
    );
    if (Array.isArray(jobs)) skipped += jobs.length;
  }
  console.log(formatPayoutLog({ ...emptyPayoutCounts(), skipped }, status));
  return { skipped };
}

async function loadChargeSettlement(stripe, chargeId, saleCents, currency) {
  const charge = await stripe.charges.retrieve(chargeId, {
    expand: ["balance_transaction"],
  });
  if (typeof charge?.balance_transaction === "string") {
    charge.balance_transaction = await stripe.balanceTransactions.retrieve(charge.balance_transaction);
  }
  return settlementFromCharge(charge, saleCents, currency);
}

/**
 * Pending rows use the charge's real fee. A failed row that never recorded a fee
 * keeps the amount already sent with its idempotency key.
 * @param {object} claimed
 * @param {import("stripe").Stripe} stripe
 * @param {string} chargeId
 * @param {string} fromStatus
 */
async function resolveTransferAmount(claimed, stripe, chargeId, fromStatus) {
  const saleCents = integerCents(claimed.amount_cents);
  if (saleCents == null || saleCents <= 0) {
    return { action: "skip", reason: "invalid_amounts", patch: {} };
  }
  const recorded = recordedWriterNet(claimed);
  if (fromStatus === "failed" && !recorded) {
    return { action: "transfer", transferCents: saleCents, patch: {} };
  }
  if (recorded) {
    if (recorded.netCents < MIN_STRIPE_TRANSFER_CENTS) {
      return {
        action: "skip",
        reason: recorded.netCents <= 0 ? "net_non_positive" : "below_minimum_transfer",
        patch: { stripe_fee_cents: recorded.feeCents, net_cents: recorded.netCents },
      };
    }
    return {
      action: "transfer",
      transferCents: recorded.netCents,
      patch: { stripe_fee_cents: recorded.feeCents, net_cents: recorded.netCents },
    };
  }
  let settlement;
  try {
    settlement = await loadChargeSettlement(stripe, chargeId, saleCents, claimed.currency || "usd");
  } catch {
    return { action: "pending", reason: "processing_fee_unavailable", patch: {} };
  }
  if (!settlement.ready) {
    return { action: "pending", reason: settlement.reason || "processing_fee_unavailable", patch: {} };
  }
  return {
    action: settlement.action,
    transferCents: settlement.transferCents,
    reason: settlement.reason,
    patch: feeAuditPatch(settlement),
  };
}

async function settlePayoutJob(job, stripe, counts, fromStatus) {
  const claimed = await claimPayout(job.id, fromStatus);
  if (!claimed) {
    counts.not_claimed++;
    return;
  }

  try {
    const unlock = await reloadUnlock(claimed);
    if (claimed.fiat_unlock_id) {
      if (!unlock) {
        await transitionPayout(claimed.id, "processing", { status: "pending", error: "missing_unlock" });
        counts.pending++;
        return;
      }
      if (unlock.status !== "succeeded") {
        await transitionPayout(claimed.id, "processing", { status: "skipped", error: "not_payable" });
        counts.skipped++;
        return;
      }
    }

    const chargeId = await resolveChargeId(claimed, unlock, stripe);
    if (!chargeId) {
      await transitionPayout(claimed.id, "processing", { status: "pending", error: "missing_source_charge" });
      counts.pending++;
      return;
    }

    const account = await lookupPublisherAccount(claimed.publisher);
    const destinationId = payoutTransferDestination(account);
    if (!destinationId) {
      await transitionPayout(claimed.id, "processing", { status: "pending", error: "publisher_not_onboarded" });
      counts.pending++;
      return;
    }

    let stripeAccount;
    try {
      stripeAccount = await stripe.accounts.retrieve(destinationId);
    } catch {
      await transitionPayout(claimed.id, "processing", { status: "pending", error: "account_lookup_failed" });
      counts.pending++;
      return;
    }
    if (!stripeAccount?.payouts_enabled && !stripeAccount?.charges_enabled) {
      await transitionPayout(claimed.id, "processing", { status: "pending", error: "publisher_not_onboarded" });
      counts.pending++;
      return;
    }
    if (!account.onboarded_at && (stripeAccount.payouts_enabled || stripeAccount.charges_enabled)) {
      try {
        await supabase(`publisher_accounts?publisher=eq.${encodeURIComponent(claimed.publisher)}`, {
          method: "PATCH",
          headers: { Prefer: "return=minimal" },
          body: { onboarded_at: new Date().toISOString(), updated_at: new Date().toISOString() },
        });
      } catch {
        /* onboarding timestamp is not required to transfer */
      }
    }

    const again = claimed.fiat_unlock_id ? await reloadUnlock(claimed) : unlock;
    if (claimed.fiat_unlock_id && (!again || again.status !== "succeeded")) {
      await transitionPayout(claimed.id, "processing", { status: "skipped", error: "not_payable" });
      counts.skipped++;
      return;
    }

    let decision;
    try {
      decision = await resolveTransferAmount(claimed, stripe, chargeId, fromStatus);
      if (decision.action === "pending") {
        await transitionPayout(claimed.id, "processing", { status: "pending", error: decision.reason });
        counts.pending++;
        return;
      }
      if (decision.action !== "transfer") {
        const skipped = await transitionPayout(claimed.id, "processing", {
          status: "skipped",
          error: decision.reason || "net_non_positive",
          ...decision.patch,
        });
        if (skipped) counts.skipped++;
        else counts.not_claimed++;
        return;
      }
      if (decision.patch && Object.keys(decision.patch).length > 0) {
        const noted = await transitionPayout(claimed.id, "processing", decision.patch);
        if (!noted) {
          counts.not_claimed++;
          return;
        }
      }
    } catch (e) {
      // A failure before the transfer must not mark a pending row failed.
      // Failed rows are retried at their original amount when no net was recorded.
      if (fromStatus === "failed") throw e;
      const released = await transitionPayout(claimed.id, "processing", {
        status: "pending",
        error: "processing_fee_unavailable",
      }).catch(() => null);
      if (released) counts.pending++;
      else counts.not_claimed++;
      return;
    }

    const transfer = await stripe.transfers.create(
      {
        amount: decision.transferCents,
        currency: claimed.currency || "usd",
        destination: destinationId,
        source_transaction: chargeId,
        metadata: {
          payout_job_id: String(claimed.id),
          ...(claimed.fiat_unlock_id ? { fiat_unlock_id: String(claimed.fiat_unlock_id) } : {}),
        },
      },
      { idempotencyKey: payoutIdempotencyKey(claimed.id) }
    );

    const saved = await transitionPayout(claimed.id, "processing", {
      status: "paid",
      stripe_transfer_id: transfer.id,
      error: null,
    });
    if (saved) {
      counts.paid++;
      return;
    }

    const after = claimed.fiat_unlock_id ? await reloadUnlock(claimed) : null;
    if (after && after.status !== "succeeded") {
      try {
        await stripe.transfers.createReversal(
          transfer.id,
          {},
          { idempotencyKey: `${payoutIdempotencyKey(claimed.id)}_reversal` }
        );
        counts.reversed++;
      } catch {
        counts.failed++;
      }
      return;
    }
    counts.failed++;
  } catch (e) {
    const saved = await transitionPayout(claimed.id, "processing", {
      status: "failed",
      error: transferFailureCode(e),
    }).catch(() => null);
    if (saved) counts.failed++;
    else counts.not_claimed++;
  }
}

async function runPayouts({ fromStatus, limit }) {
  const stripe = getStripe();
  const capped = Math.min(50, Math.max(1, Number(limit) || 20));
  const jobs = await selectPayoutJobs(fromStatus, capped);
  const counts = emptyPayoutCounts();
  for (const job of jobs) {
    if (job.status !== fromStatus || job.stripe_transfer_id) continue;
    await settlePayoutJob(job, stripe, counts, fromStatus);
  }
  return finishPayoutRun(counts);
}

/**
 * Transfer pending payout_jobs. Failed rows are not selected.
 * Each transfer is tied to the unlock charge and claimed with a status transition
 * so a second run cannot send it again.
 */
export async function processPendingPayouts({ limit = 20 } = {}) {
  return runPayouts({ fromStatus: "pending", limit });
}

/**
 * Admin-only. Moves failed rows that never received a transfer through the same
 * claim-and-transfer path. The scheduled job does not call this.
 * @param {{ limit?: number, confirm?: boolean }} [opts]
 */
export async function retryFailedPayouts({ limit = 20, confirm = false } = {}) {
  if (confirm !== true) {
    const err = new Error("payout_retry_not_confirmed");
    err.status = 400;
    throw err;
  }
  return runPayouts({ fromStatus: "failed", limit });
}

export async function getUnlockBySession(sessionToken) {
  const token = String(sessionToken || "").trim();
  if (!token) return null;
  const rows = await supabase(
    `fiat_unlocks?select=id,article_id,article_id_hash,session_token,status,amount_cents&session_token=eq.${encodeURIComponent(token)}&limit=1`
  );
  return Array.isArray(rows) && rows[0] ? rows[0] : null;
}
