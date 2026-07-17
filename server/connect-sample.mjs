/**
 * Stripe Connect sample (Accounts v2 + destination charges).
 *
 * This module is a self-contained demo of:
 *  1. Creating connected accounts (platform collects fees / losses)
 *  2. Onboarding via V2 Account Links
 *  3. Creating platform-level Products mapped to a connected account
 *  4. A storefront Checkout Session (destination charge + application fee)
 *  5. Thin webhook handling for V2 account requirement / capability updates
 *
 * All Stripe calls go through a single Stripe Client (`stripeClient`).
 *
 * Env:
 *   STRIPE_SECRET_KEY              — required (sk_test_… / sk_live_…)
 *   STRIPE_CONNECT_WEBHOOK_SECRET  — for thin Connect account events (whsec_…)
 *   STRIPE_PLATFORM_FEE_BPS        — optional application fee (default 1000 = 10%)
 */

import Stripe from "stripe";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ─── Config / placeholders ───────────────────────────────────────────────────

/**
 * PLACEHOLDER: set STRIPE_SECRET_KEY in Railway / .env
 * Create keys at https://dashboard.stripe.com/apikeys
 */
const STRIPE_SECRET_KEY = (process.env.STRIPE_SECRET_KEY || "").trim();

/**
 * PLACEHOLDER: Stripe Dashboard → Developers → Webhooks → Add destination
 * (Connected accounts, Thin payload, V2 account events). Use the signing secret here.
 */
const STRIPE_CONNECT_WEBHOOK_SECRET = (
  process.env.STRIPE_CONNECT_WEBHOOK_SECRET ||
  process.env.STRIPE_WEBHOOK_SECRET ||
  ""
).trim();

/** Platform take rate in basis points (1000 = 10%). */
const PLATFORM_FEE_BPS = Math.max(
  0,
  Number(process.env.STRIPE_PLATFORM_FEE_BPS || "1000") || 1000
);

/** Local JSON map: app user id → Stripe connected account id (demo persistence). */
const SELLERS_PATH = path.join(__dirname, "data", "connect-sellers.json");

// ─── Stripe Client ───────────────────────────────────────────────────────────

/** @type {Stripe | null} */
let stripeClient = null;

/**
 * Returns a configured Stripe Client, or throws a helpful error if the secret key
 * placeholder was never filled in.
 */
export function getStripeClient() {
  if (!STRIPE_SECRET_KEY) {
    const err = new Error(
      "STRIPE_SECRET_KEY is not set. Add your Stripe secret key (sk_test_… or sk_live_…) " +
        "to the environment — see https://dashboard.stripe.com/apikeys"
    );
    err.status = 503;
    err.code = "stripe_not_configured";
    throw err;
  }
  if (!stripeClient) {
    // Latest SDK picks the current API version automatically (incl. 2026-06-24.dahlia).
    // Do not pass apiVersion unless you intentionally pin an older snapshot.
    stripeClient = new Stripe(STRIPE_SECRET_KEY);
  }
  return stripeClient;
}

export function connectSampleConfigured() {
  return Boolean(STRIPE_SECRET_KEY);
}

// ─── Local seller → account mapping ──────────────────────────────────────────

function ensureDataDir() {
  const dir = path.dirname(SELLERS_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

/** @returns {Record<string, { accountId: string, displayName: string, contactEmail: string, createdAt: string }>} */
function readSellers() {
  try {
    ensureDataDir();
    if (!fs.existsSync(SELLERS_PATH)) return {};
    return JSON.parse(fs.readFileSync(SELLERS_PATH, "utf8"));
  } catch {
    return {};
  }
}

/** @param {Record<string, unknown>} sellers */
function writeSellers(sellers) {
  ensureDataDir();
  fs.writeFileSync(SELLERS_PATH, JSON.stringify(sellers, null, 2));
}

export function listLocalSellers() {
  const sellers = readSellers();
  return Object.entries(sellers).map(([userId, row]) => ({
    userId,
    ...row,
  }));
}

// ─── 1) Create connected accounts (Accounts v2) ──────────────────────────────

/**
 * Create a connected Account where the **platform** is responsible for pricing
 * and fee collection (`fees_collector` / `losses_collector` = application).
 *
 * Uses only the V2 properties from the Connect sample guide — never pass
 * top-level `type: 'express'|'standard'|'custom'`.
 *
 * @param {{ userId: string, displayName: string, contactEmail: string, country?: string }} input
 */
export async function createConnectedAccount(input) {
  const stripeClient = getStripeClient();
  const userId = String(input.userId || "").trim();
  const displayName = String(input.displayName || "").trim();
  const contactEmail = String(input.contactEmail || "").trim();
  const country = String(input.country || "us").trim().toLowerCase() || "us";

  if (!userId) {
    const err = new Error("userId is required");
    err.status = 400;
    throw err;
  }
  if (!displayName) {
    const err = new Error("displayName is required");
    err.status = 400;
    throw err;
  }
  if (!contactEmail || !contactEmail.includes("@")) {
    const err = new Error("contactEmail must be a valid email");
    err.status = 400;
    throw err;
  }

  // Reuse an existing mapping if this app user already has a Connect account.
  const sellers = readSellers();
  if (sellers[userId]?.accountId) {
    return {
      accountId: sellers[userId].accountId,
      reused: true,
      userId,
    };
  }

  // Step: create Account via V2 Core API (recipient config + Express dashboard).
  const account = await stripeClient.v2.core.accounts.create({
    display_name: displayName,
    contact_email: contactEmail,
    identity: {
      country,
    },
    dashboard: "express",
    defaults: {
      responsibilities: {
        // Platform collects Stripe fees and covers losses (marketplace model).
        fees_collector: "application",
        losses_collector: "application",
      },
    },
    configuration: {
      recipient: {
        capabilities: {
          stripe_balance: {
            stripe_transfers: {
              requested: true,
            },
          },
        },
      },
    },
  });

  // Persist user → account id mapping (demo file store; swap for Supabase in prod).
  sellers[userId] = {
    accountId: account.id,
    displayName,
    contactEmail,
    createdAt: new Date().toISOString(),
  };
  writeSellers(sellers);

  return { accountId: account.id, reused: false, userId, account };
}

// ─── 2) Onboard with V2 Account Links + live status from API ─────────────────

/**
 * Create a V2 Account Link so the connected account can finish Express onboarding.
 * @param {{ accountId: string, returnUrl: string, refreshUrl: string }} input
 */
export async function createOnboardingLink(input) {
  const stripeClient = getStripeClient();
  const accountId = String(input.accountId || "").trim();
  if (!accountId) {
    const err = new Error("accountId is required");
    err.status = 400;
    throw err;
  }

  // Step: hosted onboarding URL for the `recipient` configuration.
  const accountLink = await stripeClient.v2.core.accountLinks.create({
    account: accountId,
    use_case: {
      type: "account_onboarding",
      account_onboarding: {
        configurations: ["recipient"],
        refresh_url: input.refreshUrl,
        return_url: input.returnUrl,
      },
    },
  });

  return {
    url: accountLink.url,
    accountId,
    expiresAt: accountLink.expires_at,
  };
}

/**
 * Always fetch onboarding status live from the Accounts API (do not cache in DB).
 * @param {string} accountId
 */
export async function getAccountOnboardingStatus(accountId) {
  const stripeClient = getStripeClient();
  const id = String(accountId || "").trim();
  if (!id) {
    const err = new Error("accountId is required");
    err.status = 400;
    throw err;
  }

  // Step: retrieve with includes so capability + requirements are populated.
  const account = await stripeClient.v2.core.accounts.retrieve(id, {
    include: ["configuration.recipient", "requirements"],
  });

  const transferStatus =
    account?.configuration?.recipient?.capabilities?.stripe_balance?.stripe_transfers
      ?.status;
  const readyToReceivePayments = transferStatus === "active";

  const requirementsStatus = account.requirements?.summary?.minimum_deadline?.status;
  const onboardingComplete =
    requirementsStatus !== "currently_due" && requirementsStatus !== "past_due";

  return {
    accountId: id,
    displayName: account.display_name || null,
    contactEmail: account.contact_email || null,
    transferStatus: transferStatus || "unknown",
    readyToReceivePayments,
    requirementsStatus: requirementsStatus || null,
    onboardingComplete,
    // Raw snippets for the demo UI debugger panel.
    currentlyDue: account.requirements?.entries
      ? undefined
      : account.requirements?.currently_due || null,
  };
}

// ─── 3) Thin webhooks for requirement / capability changes ───────────────────

/**
 * Handle Stripe thin events for V2 connected accounts.
 *
 * Dashboard setup (once):
 *  1. Developers → Webhooks → + Add destination
 *  2. Events from: Connected accounts
 *  3. Advanced → Payload style: Thin
 *  4. Select:
 *     - v2.core.account[requirements].updated
 *     - v2.core.account[configuration.recipient].capability_status_updated
 *
 * Local CLI:
 *   stripe listen --thin-events \
 *     'v2.core.account[requirements].updated,v2.core.account[configuration.recipient].capability_status_updated' \
 *     --forward-thin-to localhost:8080/api/connect-sample/webhook
 *
 * @param {Buffer|string} rawBody
 * @param {string|string[]|undefined} signatureHeader
 */
export async function handleConnectThinWebhook(rawBody, signatureHeader) {
  const stripeClient = getStripeClient();

  if (!STRIPE_CONNECT_WEBHOOK_SECRET) {
    const err = new Error(
      "STRIPE_CONNECT_WEBHOOK_SECRET is not set. Create a Thin event destination " +
        "for Connected accounts in the Stripe Dashboard and paste the signing secret."
    );
    err.status = 503;
    err.code = "connect_webhook_not_configured";
    throw err;
  }

  const sig = Array.isArray(signatureHeader) ? signatureHeader[0] : signatureHeader;
  if (!sig) {
    const err = new Error("Missing Stripe-Signature header");
    err.status = 400;
    throw err;
  }

  // SDK renamed parseThinEvent → parseEventNotification (stripe-node ≥ 18+).
  // This verifies the signature and returns a thin notification envelope.
  const thinEvent = stripeClient.parseEventNotification(
    rawBody,
    sig,
    STRIPE_CONNECT_WEBHOOK_SECRET
  );

  // Thin payloads are envelopes — fetch the full event for details.
  const event = await stripeClient.v2.core.events.retrieve(thinEvent.id);

  switch (event.type) {
    case "v2.core.account[requirements].updated": {
      // Requirements changed (KYC, bank info, etc.). Re-fetch account and nudge seller.
      const accountId = event.related_object?.id || thinEvent.related_object?.id;
      console.log(
        "[connect-sample] requirements updated for",
        accountId,
        "— fetch status via getAccountOnboardingStatus"
      );
      if (accountId) {
        const status = await getAccountOnboardingStatus(accountId);
        console.log("[connect-sample] live status", status);
      }
      break;
    }
    case "v2.core.account[configuration.recipient].capability_status_updated": {
      // Recipient transfer capability flipped (e.g. pending → active).
      const accountId = event.related_object?.id || thinEvent.related_object?.id;
      console.log("[connect-sample] recipient capability updated for", accountId);
      if (accountId) {
        const status = await getAccountOnboardingStatus(accountId);
        console.log("[connect-sample] ready?", status.readyToReceivePayments);
      }
      break;
    }
    default:
      console.log("[connect-sample] ignored thin event type:", event.type);
  }

  return { received: true, type: event.type, id: event.id };
}

// ─── 4) Products (platform level) ────────────────────────────────────────────

/**
 * Create a Product on the **platform** account (not on the connected account).
 * Stores `connected_account_id` in product metadata for destination charges later.
 *
 * @param {{ name: string, description?: string, priceInCents: number, currency?: string, connectedAccountId: string }} input
 */
export async function createPlatformProduct(input) {
  const stripeClient = getStripeClient();
  const name = String(input.name || "").trim();
  const description = String(input.description || "").trim();
  const priceInCents = Math.round(Number(input.priceInCents));
  const currency = String(input.currency || "usd").trim().toLowerCase() || "usd";
  const connectedAccountId = String(input.connectedAccountId || "").trim();

  if (!name) {
    const err = new Error("name is required");
    err.status = 400;
    throw err;
  }
  if (!Number.isFinite(priceInCents) || priceInCents < 50) {
    const err = new Error("priceInCents must be at least 50 (Stripe minimum)");
    err.status = 400;
    throw err;
  }
  if (!connectedAccountId) {
    const err = new Error("connectedAccountId is required (map product → seller)");
    err.status = 400;
    throw err;
  }

  // Step: platform Product + default Price; metadata holds the seller mapping.
  const product = await stripeClient.products.create({
    name,
    description: description || undefined,
    default_price_data: {
      unit_amount: priceInCents,
      currency,
    },
    metadata: {
      connected_account_id: connectedAccountId,
      sample: "mon_unlock_connect_demo",
    },
  });

  return {
    productId: product.id,
    name: product.name,
    description: product.description,
    defaultPriceId:
      typeof product.default_price === "string"
        ? product.default_price
        : product.default_price?.id || null,
    connectedAccountId,
  };
}

/**
 * List platform products created by this sample (metadata.sample filter).
 */
export async function listPlatformProducts() {
  const stripeClient = getStripeClient();

  // Step: list recent products; expand default_price for storefront display.
  const listed = await stripeClient.products.list({
    limit: 50,
    active: true,
    expand: ["data.default_price"],
  });

  const products = listed.data
    .filter((p) => p.metadata?.sample === "mon_unlock_connect_demo")
    .map((p) => {
      const price =
        typeof p.default_price === "object" && p.default_price
          ? p.default_price
          : null;
      return {
        productId: p.id,
        name: p.name,
        description: p.description,
        connectedAccountId: p.metadata?.connected_account_id || null,
        unitAmount: price?.unit_amount ?? null,
        currency: price?.currency ?? "usd",
        defaultPriceId: price?.id || null,
      };
    });

  return { products };
}

// ─── 5) Destination charge via Checkout ──────────────────────────────────────

/**
 * Create a hosted Checkout Session: destination charge + application fee.
 * Funds land on the platform PaymentIntent, then transfer to the connected account
 * (minus the platform fee).
 *
 * @param {{ productId: string, quantity?: number, successUrl: string, cancelUrl: string }} input
 */
export async function createDestinationCheckout(input) {
  const stripeClient = getStripeClient();
  const productId = String(input.productId || "").trim();
  const quantity = Math.max(1, Math.round(Number(input.quantity || 1)) || 1);

  if (!productId) {
    const err = new Error("productId is required");
    err.status = 400;
    throw err;
  }

  // Step: load product + price from platform; read seller from metadata.
  const product = await stripeClient.products.retrieve(productId, {
    expand: ["default_price"],
  });
  const connectedAccountId = product.metadata?.connected_account_id;
  if (!connectedAccountId) {
    const err = new Error(
      "Product is missing metadata.connected_account_id — recreate it from the sample UI"
    );
    err.status = 400;
    throw err;
  }

  const price =
    typeof product.default_price === "object" && product.default_price
      ? product.default_price
      : null;
  if (!price?.unit_amount || !price.currency) {
    const err = new Error("Product has no default price");
    err.status = 400;
    throw err;
  }

  const totalCents = price.unit_amount * quantity;
  const applicationFeeAmount = Math.max(
    0,
    Math.floor((totalCents * PLATFORM_FEE_BPS) / 10_000)
  );

  // Step: Checkout in `payment` mode with destination charge fields on the PI.
  const session = await stripeClient.checkout.sessions.create({
    mode: "payment",
    line_items: [
      {
        price_data: {
          currency: price.currency,
          unit_amount: price.unit_amount,
          product_data: {
            name: product.name,
            description: product.description || undefined,
          },
        },
        quantity,
      },
    ],
    payment_intent_data: {
      application_fee_amount: applicationFeeAmount,
      transfer_data: {
        destination: connectedAccountId,
      },
      metadata: {
        product_id: productId,
        connected_account_id: connectedAccountId,
        sample: "mon_unlock_connect_demo",
      },
    },
    success_url: input.successUrl,
    cancel_url: input.cancelUrl,
    metadata: {
      product_id: productId,
      connected_account_id: connectedAccountId,
    },
  });

  return {
    sessionId: session.id,
    url: session.url,
    applicationFeeAmount,
    connectedAccountId,
    totalCents,
  };
}

/**
 * Fetch Checkout Session details for the success page.
 * @param {string} sessionId
 */
export async function getCheckoutSession(sessionId) {
  const stripeClient = getStripeClient();
  const id = String(sessionId || "").trim();
  if (!id) {
    const err = new Error("session_id is required");
    err.status = 400;
    throw err;
  }
  const session = await stripeClient.checkout.sessions.retrieve(id, {
    expand: ["payment_intent"],
  });
  return {
    sessionId: session.id,
    paymentStatus: session.payment_status,
    amountTotal: session.amount_total,
    currency: session.currency,
    connectedAccountId: session.metadata?.connected_account_id || null,
    productId: session.metadata?.product_id || null,
  };
}
