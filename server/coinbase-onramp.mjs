/**
 * Coinbase Onramp URL helpers (no CDP credentials required).
 *
 * Checkout used /buy/select-asset with presetCryptoAmount=0.05 MON for gas.
 * That page is an asset picker, and 0.05 MON is below Coinbase's ~$1 minimum,
 * so "Pay with USDC" opened a broken "Buy Monad" sheet.
 */

export const MONAD_BLOCKCHAIN = "monad";

/** One-click buy — honors defaultAsset. `/buy/select-asset` is the picker. */
export const PAY_BASE = "https://pay.coinbase.com/buy";

/** Coinbase Onramp rejects dust buys (screenshot: min ~45 MON ≈ $1). */
export const COINBASE_MIN_USD = 1;

export function normalizeOnrampAsset(assetRaw) {
  const a = String(assetRaw || "USDC").trim().toUpperCase();
  if (a === "MON" || a === "MONAD" || a === "MONAD_MON" || a === "NATIVE") return "MON";
  return "USDC";
}

/**
 * Coinbase ignores presetFiatAmount when presetCryptoAmount is also set.
 * Always quote fiat so a $0.50 USDC article (or 0.05 MON gas) still clears the ~$1 minimum.
 *
 * @param {{ asset?: string, amount?: string, amountKind?: string }} opts
 * @returns {{ presetFiatAmount: string }}
 */
export function resolveOnrampPreset(opts = {}) {
  const raw = opts.amount != null ? String(opts.amount).trim() : "";
  const n = raw ? Number(raw) : COINBASE_MIN_USD;
  const fiat = Number.isFinite(n) && n > 0 ? Math.max(n, COINBASE_MIN_USD) : COINBASE_MIN_USD;
  return { presetFiatAmount: String(fiat) };
}

export function buildPayUrl(token, { asset, amount, amountKind, redirectUrl } = {}) {
  const params = new URLSearchParams({
    sessionToken: token,
    defaultNetwork: MONAD_BLOCKCHAIN,
    defaultAsset: asset || "USDC",
    defaultExperience: "buy",
    fiatCurrency: "USD",
    ...resolveOnrampPreset({ asset, amount, amountKind }),
  });
  if (redirectUrl) {
    params.set("redirectUrl", redirectUrl);
  }
  return `${PAY_BASE}?${params.toString()}`;
}
