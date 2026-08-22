/** Payment asset helpers for dual MON / USDC unlock paths. */

export type PaymentAsset = "mon" | "usdc";

/** Circle USDC on Monad mainnet (same as swap module). */
export const MONAD_USDC_ADDRESS =
  "0x754704Bc059F8C67012fEd69BC8A327a5aafb603" as const;

/**
 * USDC unlock contract (ArticleUnlockUsdc).
 * Empty until deployed — set VITE_USDC_UNLOCK_CONTRACT after forge deploy.
 */
export const MAINNET_USDC_UNLOCK_CONTRACT: string = (
  typeof import.meta !== "undefined" &&
  import.meta.env &&
  typeof import.meta.env.VITE_USDC_UNLOCK_CONTRACT === "string"
    ? import.meta.env.VITE_USDC_UNLOCK_CONTRACT.trim()
    : ""
);

/** Legacy native-MON unlock contract (kept live — path A). */
export const MAINNET_MON_UNLOCK_CONTRACT =
  "0x27cA0c23835328e2Ab1424b66330be86fe177FA6" as const;

export function normalizePaymentAsset(value: string | null | undefined): PaymentAsset {
  const v = (value ?? "").trim().toLowerCase();
  if (v === "usdc" || v === "usd" || v === "stable") return "usdc";
  return "mon";
}

/** Infer asset from unlock-contract address when embed omits payment-asset. */
export function paymentAssetForContract(contract: string): PaymentAsset {
  const c = contract.trim().toLowerCase();
  const usdc = MAINNET_USDC_UNLOCK_CONTRACT.trim().toLowerCase();
  if (usdc && usdc.startsWith("0x") && usdc.length === 42 && c === usdc) return "usdc";
  return "mon";
}

export function resolvePaymentAsset(opts: {
  explicit?: string | null;
  contract?: string | null;
}): PaymentAsset {
  if (opts.explicit) return normalizePaymentAsset(opts.explicit);
  if (opts.contract) return paymentAssetForContract(opts.contract);
  return "mon";
}

export function isUsdcUnlockConfigured(): boolean {
  const c = MAINNET_USDC_UNLOCK_CONTRACT.trim();
  return /^0x[a-fA-F0-9]{40}$/.test(c);
}
