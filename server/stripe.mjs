/**
 * Stripe fiat unlock + Connect USDC payout scaffolding.
 *
 * Flow:
 * 1. POST /api/stripe/create-intent — PaymentIntent for Apple Pay / cards
 * 2. Webhook payment_intent.succeeded OR POST /api/stripe/confirm — grant fiat_unlock
 * 3. payout_jobs row queued; processPayouts transfers to Connect (USDC when enabled)
 *
 * Env:
 *   STRIPE_SECRET_KEY
 *   STRIPE_WEBHOOK_SECRET
 *   SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY
 *   STRIPE_PLATFORM_FEE_BPS (optional, default 0)
 */
import Stripe from "stripe";
import { createHash, randomUUID } from "node:crypto";
import { keccak256, toBytes } from "viem";
import { assertFiatEmbedAuthorized, isOfficialUnlockContract, MAINNET_USDC_UNLOCK_CONTRACT } from "./embed-signature.mjs";

const STRIPE_SECRET_KEY = (process.env.STRIPE_SECRET_KEY || "").trim();
const STRIPE_WEBHOOK_SECRET = (process.env.STRIPE_WEBHOOK_SECRET || "").trim();
const SUPABASE_URL = (process.env.SUPABASE_URL || "").trim().replace(/\/$/, "");
const SUPABASE_SERVICE_ROLE_KEY = (process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim();
const PLATFORM_FEE_BPS = Math.max(0, Number(process.env.STRIPE_PLATFORM_FEE_BPS || "0") || 0);

/** @type {Stripe | null} */
let stripeSingleton = null;

export function stripeConfigured() {
  return Boolean(STRIPE_SECRET_KEY);
}

export function supabaseConfigured() {
  return Boolean(SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY);
}

export function getStripe() {
  if (!STRIPE_SECRET_KEY) {
    const err = new Error("stripe_not_configured");
    err.status = 503;
    throw err;
  }
  if (!stripeSingleton) {
    stripeSingleton = new Stripe(STRIPE_SECRET_KEY);
  }
  return stripeSingleton;
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

/**
 * Look up publisher wallet for an article slug (or hash).
 * @param {string} articleId
 */
export async function lookupArticle(articleId) {
  const hash = articleIdHash(articleId);
  const bySlug = await supabase(
    `articles?select=article_id,article_id_hash,publisher,price_wei,payment_asset&article_id=eq.${encodeURIComponent(articleId)}&limit=1`
  );
  if (Array.isArray(bySlug) && bySlug[0]) return bySlug[0];

  const byHash = await supabase(
    `articles?select=article_id,article_id_hash,publisher,price_wei,payment_asset&article_id_hash=eq.${encodeURIComponent(hash)}&limit=1`
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
 * }} input
 */
export async function createPaymentIntent(input) {
  const stripe = getStripe();
  const articleId = String(input.articleId || "").trim();
  const amountUsdCents = Math.round(Number(input.amountUsdCents));
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
  if (!Number.isFinite(amountUsdCents) || amountUsdCents < 50) {
    const err = new Error("invalid_amount");
    err.status = 400;
    throw err;
  }
  if (amountUsdCents > 100_000) {
    const err = new Error("amount_too_large");
    err.status = 400;
    throw err;
  }

  const article = await lookupArticle(articleId);
  if (!article?.publisher) {
    const err = new Error("article_not_found");
    err.status = 404;
    throw err;
  }

  const paymentAsset = String(article.payment_asset || "mon").toLowerCase();
  if (!embedSig) {
    // Short embeds (e.g. homepage): allow fiat when USD cents match registered USDC price.
    if (paymentAsset !== "usdc") {
      const err = new Error("missing_embed_sig");
      err.status = 400;
      throw err;
    }
    if (!isOfficialUnlockContract(contract)) {
      const err = new Error("unsupported_contract");
      err.status = 400;
      throw err;
    }
    if (contract.toLowerCase() !== MAINNET_USDC_UNLOCK_CONTRACT.toLowerCase()) {
      const err = new Error("unsupported_contract");
      err.status = 400;
      throw err;
    }
    let expectedCents;
    try {
      expectedCents = Number(BigInt(article.price_wei) / 10_000n);
    } catch {
      const err = new Error("invalid_price");
      err.status = 400;
      throw err;
    }
    if (!Number.isFinite(expectedCents) || expectedCents < 50 || amountUsdCents !== expectedCents) {
      const err = new Error("amount_mismatch");
      err.status = 400;
      throw err;
    }
  } else {
    const auth = await assertFiatEmbedAuthorized({
      embedSig,
      contract,
      articleId,
      priceWei: article.price_wei,
      publisher: article.publisher,
    });
    if (!auth.ok) {
      const err = new Error(auth.error);
      err.status = auth.status;
      throw err;
    }
  }

  const sessionToken = randomUUID();
  const hash = article.article_id_hash || articleIdHash(articleId);

  const intent = await stripe.paymentIntents.create({
    amount: amountUsdCents,
    currency: "usd",
    automatic_payment_methods: { enabled: true },
    receipt_email: buyerEmail,
    metadata: {
      articleId,
      articleIdHash: hash,
      publisher: String(article.publisher).toLowerCase(),
      sessionToken,
      product: "mon_unlock_fiat",
    },
    description: input.title
      ? `Unlock: ${String(input.title).slice(0, 120)}`
      : `Unlock article ${articleId}`,
  });

  return {
    clientSecret: intent.client_secret,
    paymentIntentId: intent.id,
    sessionToken,
    amountUsdCents,
    publisher: String(article.publisher).toLowerCase(),
    articleIdHash: hash,
  };
}

/** Postgres unique_violation (23505) from PostgREST / Supabase. */
export function isUniqueViolation(err) {
  const code = err?.details?.code;
  const msg = String(err?.message || "");
  return code === "23505" || /duplicate key value violates unique constraint/i.test(msg);
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
  const amountCents = intent.amount_received || intent.amount;

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

  let unlock;
  try {
    const rows = await supabase("fiat_unlocks", {
      method: "POST",
      headers: { Prefer: "return=representation" },
      body: [
        {
          article_id: articleId,
          article_id_hash: articleIdHash,
          publisher,
          session_token: sessionToken,
          stripe_payment_intent_id: intent.id,
          amount_cents: amountCents,
          currency: intent.currency || "usd",
          buyer_email: intent.receipt_email || null,
          status: "succeeded",
        },
      ],
    });
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

  const fee = Math.floor((amountCents * PLATFORM_FEE_BPS) / 10_000);
  const payoutCents = Math.max(0, amountCents - fee);

  if (payoutCents > 0) {
    await supabase("payout_jobs", {
      method: "POST",
      headers: { Prefer: "return=minimal" },
      body: [
        {
          fiat_unlock_id: unlock.id,
          publisher,
          amount_cents: payoutCents,
          currency: "usd",
          status: "pending",
        },
      ],
    });
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
 * @param {string} paymentIntentId
 */
export async function confirmPaymentIntent(paymentIntentId) {
  const stripe = getStripe();
  const id = String(paymentIntentId || "").trim();
  if (!id.startsWith("pi_")) {
    const err = new Error("invalid_payment_intent");
    err.status = 400;
    throw err;
  }
  const intent = await stripe.paymentIntents.retrieve(id);
  return grantFiatUnlockFromIntent(intent);
}

/**
 * @param {string} rawBody
 * @param {string | string[] | undefined} signature
 */
export async function handleStripeWebhook(rawBody, signature) {
  const stripe = getStripe();
  if (!STRIPE_WEBHOOK_SECRET) {
    const err = new Error("stripe_webhook_not_configured");
    err.status = 503;
    throw err;
  }
  const sig = Array.isArray(signature) ? signature[0] : signature;
  if (!sig) {
    const err = new Error("missing_signature");
    err.status = 400;
    throw err;
  }

  const event = stripe.webhooks.constructEvent(rawBody, sig, STRIPE_WEBHOOK_SECRET);

  if (event.type === "payment_intent.succeeded") {
    const intent = event.data.object;
    const result = await grantFiatUnlockFromIntent(intent);
    return { received: true, type: event.type, ...result };
  }

  if (event.type === "charge.refunded" || event.type === "charge.dispute.created") {
    // Soft-revoke: mark unlock refunded/disputed when possible.
    const charge = event.data.object;
    const pi =
      typeof charge.payment_intent === "string"
        ? charge.payment_intent
        : charge.payment_intent?.id;
    if (pi) {
      const status = event.type === "charge.refunded" ? "refunded" : "disputed";
      await supabase(
        `fiat_unlocks?stripe_payment_intent_id=eq.${encodeURIComponent(pi)}`,
        {
          method: "PATCH",
          headers: { Prefer: "return=minimal" },
          body: { status },
        }
      );
    }
    return { received: true, type: event.type };
  }

  return { received: true, type: event.type, ignored: true };
}

/**
 * Create / reuse Connect Express account and return onboarding link.
 * Publisher links a wallet in Express for USDC stablecoin payouts (private preview).
 * @param {{ publisher: string, refreshUrl: string, returnUrl: string }} input
 */
export async function createConnectOnboardingLink(input) {
  const stripe = getStripe();
  const publisher = String(input.publisher || "").trim().toLowerCase();
  if (!/^0x[a-f0-9]{40}$/.test(publisher)) {
    const err = new Error("invalid_publisher");
    err.status = 400;
    throw err;
  }

  let accountId;
  const existing = await supabase(
    `publisher_accounts?select=stripe_account_id&publisher=eq.${encodeURIComponent(publisher)}&limit=1`
  );
  if (Array.isArray(existing) && existing[0]?.stripe_account_id) {
    accountId = existing[0].stripe_account_id;
  } else {
    const account = await stripe.accounts.create({
      type: "express",
      capabilities: {
        transfers: { requested: true },
      },
      metadata: { publisher, product: "mon_unlock" },
    });
    accountId = account.id;
    await supabase("publisher_accounts?on_conflict=publisher", {
      method: "POST",
      headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
      body: [
        {
          publisher,
          stripe_account_id: accountId,
          updated_at: new Date().toISOString(),
        },
      ],
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

/**
 * Attempt Transfers for pending payout_jobs.
 * When Connect stablecoin payouts are enabled, publishers receive USDC in their linked wallet.
 * Until then, jobs stay pending with a clear error (no silent drop).
 */
export async function processPendingPayouts({ limit = 20 } = {}) {
  const stripe = getStripe();
  const jobs = await supabase(
    `payout_jobs?select=*&status=eq.pending&order=created_at.asc&limit=${Math.min(50, Math.max(1, limit))}`
  );
  if (!Array.isArray(jobs) || jobs.length === 0) {
    return { processed: 0, results: [] };
  }

  const results = [];
  for (const job of jobs) {
    try {
      await supabase(`payout_jobs?id=eq.${job.id}`, {
        method: "PATCH",
        headers: { Prefer: "return=minimal" },
        body: { status: "processing", updated_at: new Date().toISOString() },
      });

      const accounts = await supabase(
        `publisher_accounts?select=*&publisher=eq.${encodeURIComponent(job.publisher)}&limit=1`
      );
      const account = Array.isArray(accounts) ? accounts[0] : null;
      if (!account?.stripe_account_id) {
        await supabase(`payout_jobs?id=eq.${job.id}`, {
          method: "PATCH",
          headers: { Prefer: "return=minimal" },
          body: {
            status: "pending",
            error: "publisher_not_onboarded",
            updated_at: new Date().toISOString(),
          },
        });
        results.push({ id: job.id, status: "pending", error: "publisher_not_onboarded" });
        continue;
      }

      const stripeAccount = await stripe.accounts.retrieve(account.stripe_account_id);
      if (!stripeAccount?.payouts_enabled && !stripeAccount?.charges_enabled) {
        await supabase(`payout_jobs?id=eq.${job.id}`, {
          method: "PATCH",
          headers: { Prefer: "return=minimal" },
          body: {
            status: "pending",
            error: "publisher_not_onboarded",
            updated_at: new Date().toISOString(),
          },
        });
        results.push({ id: job.id, status: "pending", error: "publisher_not_onboarded" });
        continue;
      }
      if (!account.onboarded_at && (stripeAccount.payouts_enabled || stripeAccount.charges_enabled)) {
        await supabase(`publisher_accounts?publisher=eq.${encodeURIComponent(job.publisher)}`, {
          method: "PATCH",
          headers: { Prefer: "return=minimal" },
          body: {
            onboarded_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          },
        });
      }

      // USD transfer to Connect account. With Stripe stablecoin payouts (private preview),
      // the connected account can set USDC as payout currency → crypto wallet.
      const transfer = await stripe.transfers.create({
        amount: job.amount_cents,
        currency: "usd",
        destination: account.stripe_account_id,
        metadata: {
          payout_job_id: String(job.id),
          publisher: job.publisher,
          fiat_unlock_id: String(job.fiat_unlock_id),
        },
      });

      await supabase(`payout_jobs?id=eq.${job.id}`, {
        method: "PATCH",
        headers: { Prefer: "return=minimal" },
        body: {
          status: "paid",
          stripe_transfer_id: transfer.id,
          error: null,
          updated_at: new Date().toISOString(),
        },
      });
      results.push({ id: job.id, status: "paid", transferId: transfer.id });
    } catch (e) {
      const message = e?.message || "transfer_failed";
      await supabase(`payout_jobs?id=eq.${job.id}`, {
        method: "PATCH",
        headers: { Prefer: "return=minimal" },
        body: {
          status: "failed",
          error: message,
          updated_at: new Date().toISOString(),
        },
      });
      results.push({ id: job.id, status: "failed", error: message });
    }
  }

  return { processed: results.length, results };
}

export async function getUnlockBySession(sessionToken) {
  const token = String(sessionToken || "").trim();
  if (!token) return null;
  const rows = await supabase(
    `fiat_unlocks?select=id,article_id,article_id_hash,session_token,status,amount_cents&session_token=eq.${encodeURIComponent(token)}&limit=1`
  );
  return Array.isArray(rows) && rows[0] ? rows[0] : null;
}
