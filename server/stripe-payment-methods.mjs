/**
 * Hide Stripe payment methods that are not active on the account.
 * Test mode otherwise previews unactivated methods at checkout.
 *
 * Never set Checkout `payment_method_types` — exclude inactive types instead.
 * Wallets (link, apple_pay, google_pay) are not valid session exclusions;
 * the Express Checkout Element hides those with `never`.
 */

function expressCheckoutPaymentMethods(inactiveTypes) {
  const off = new Set(inactiveTypes);
  const vis = (id) => (off.has(id) ? "never" : "auto");
  return {
    applePay: vis("apple_pay"),
    googlePay: vis("google_pay"),
    link: vis("link"),
    paypal: "never",
    amazonPay: vis("amazon_pay"),
    klarna: vis("klarna"),
  };
}

/**
 * Shown in test mode even when the live account has not activated them.
 * Hide these unless Payment Method Configurations says they are available.
 */
export const UNACTIVATED_PREVIEW_METHODS = ["link", "amazon_pay", "klarna", "cashapp"];

/** Checkout Session `excluded_payment_method_types` (no wallets, no card). */
export const SESSION_EXCLUDABLE_PAYMENT_METHOD_TYPES = new Set([
  "acss_debit",
  "affirm",
  "afterpay_clearpay",
  "alipay",
  "alma",
  "amazon_pay",
  "au_becs_debit",
  "bacs_debit",
  "bancontact",
  "billie",
  "bizum",
  "blik",
  "boleto",
  "cashapp",
  "crypto",
  "customer_balance",
  "eps",
  "fpx",
  "giropay",
  "grabpay",
  "ideal",
  "kakao_pay",
  "klarna",
  "konbini",
  "kr_card",
  "mb_way",
  "mobilepay",
  "multibanco",
  "naver_pay",
  "nz_bank_account",
  "oxxo",
  "p24",
  "pay_by_bank",
  "payco",
  "paynow",
  "paypal",
  "payto",
  "pix",
  "promptpay",
  "revolut_pay",
  "samsung_pay",
  "satispay",
  "scalapay",
  "sepa_debit",
  "sofort",
  "sunbit",
  "swish",
  "twint",
  "upi",
  "us_bank_account",
  "wechat_pay",
  "zip",
]);

const PMC_META = new Set([
  "id",
  "object",
  "active",
  "application",
  "is_default",
  "livemode",
  "name",
  "parent",
]);

/**
 * Stripe payment method identifiers that must not be offered (`available: false`).
 * @param {object | null | undefined} config
 * @returns {string[]}
 */
export function inactivePaymentMethodTypesFromConfig(config) {
  if (!config || typeof config !== "object") return [];
  const inactive = [];
  for (const [key, spec] of Object.entries(config)) {
    if (PMC_META.has(key)) continue;
    if (!spec || typeof spec !== "object" || typeof spec.available !== "boolean") continue;
    if (!spec.available) inactive.push(key);
  }
  return inactive;
}

/**
 * @param {Iterable<string>} inactiveTypes
 * @returns {string[]}
 */
export function sessionExcludedPaymentMethodTypes(inactiveTypes) {
  const excluded = [];
  for (const type of inactiveTypes) {
    if (SESSION_EXCLUDABLE_PAYMENT_METHOD_TYPES.has(type)) excluded.push(type);
  }
  return excluded;
}

/**
 * @param {object | null | undefined} config
 */
export function checkoutMethodVisibility(config) {
  const inactiveTypes = inactivePaymentMethodTypesFromConfig(config);
  return visibilityFromInactive(inactiveTypes);
}

function visibilityFromInactive(inactiveTypes) {
  return {
    inactiveTypes: [...inactiveTypes],
    excludedPaymentMethodTypes: sessionExcludedPaymentMethodTypes(inactiveTypes),
    expressPaymentMethods: expressCheckoutPaymentMethods(inactiveTypes),
  };
}

/**
 * When the Dashboard config cannot be read, hide methods Stripe only previews
 * in test mode so checkout matches live (inactive methods stay hidden).
 * @param {object | null | undefined} config
 */
export function checkoutMethodVisibilityOrFallback(config) {
  if (config) return checkoutMethodVisibility(config);
  return visibilityFromInactive(UNACTIVATED_PREVIEW_METHODS);
}

let pmcCache = { at: 0, config: null };
const PMC_TTL_MS = 60_000;

/**
 * @param {import("stripe").default} stripe
 * @returns {Promise<object | null>}
 */
export async function loadDefaultPaymentMethodConfiguration(stripe) {
  if (pmcCache.config && Date.now() - pmcCache.at < PMC_TTL_MS) {
    return pmcCache.config;
  }
  try {
    const list = await stripe.paymentMethodConfigurations.list({ limit: 20 });
    const config = list.data.find((row) => row.is_default) || list.data[0] || null;
    pmcCache = { at: Date.now(), config };
    return config;
  } catch (err) {
    console.warn("[stripe] payment method configuration:", err instanceof Error ? err.message : err);
    return null;
  }
}

/**
 * @param {import("stripe").default} stripe
 */
export async function checkoutMethodVisibilityForAccount(stripe) {
  const config = await loadDefaultPaymentMethodConfiguration(stripe);
  return checkoutMethodVisibilityOrFallback(config);
}

/** Test helper — drop the PMC cache. */
export function resetPaymentMethodConfigurationCache() {
  pmcCache = { at: 0, config: null };
}
