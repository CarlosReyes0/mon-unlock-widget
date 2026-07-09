import type { FundWalletConfig } from "@privy-io/react-auth";
import { monad } from "viem/chains";

const RAMP_HOST_API_KEY = (import.meta.env.VITE_RAMP_HOST_API_KEY as string | undefined)?.trim() ?? "";

/**
 * Card buy via Privy → MoonPay for native MON on Monad.
 * Requires @privy-io/react-auth ≥3.x (adds MON_MON / Monad funding support).
 * On v2, Privy could not map Monad native currency and fell back to Receive-only.
 */
export function cardFundConfig(amountMon: string): FundWalletConfig {
  return {
    chain: monad,
    amount: amountMon,
    asset: "native-currency",
    defaultFundingMethod: "card",
    card: { preferredProvider: "moonpay" },
  };
}

/** Deposit-address / QR path when the user already has MON elsewhere. */
export function receiveFundConfig(amountMon?: string): FundWalletConfig {
  return {
    chain: monad,
    ...(amountMon ? { amount: amountMon, asset: "native-currency" as const } : {}),
    defaultFundingMethod: "manual",
    uiConfig: {
      receiveFundsTitle: "Receive MON",
      receiveFundsSubtitle: "Send MON on Monad to this address from an exchange or another wallet.",
    },
  };
}

export function hasRampBuy(): boolean {
  return Boolean(RAMP_HOST_API_KEY);
}

/** Ramp Network supports native MON on Monad (MONAD_MON). Requires a host API key from Ramp. */
export function buildRampBuyUrl(address: string, amountMon?: string): string | null {
  if (!RAMP_HOST_API_KEY) return null;
  const params = new URLSearchParams({
    hostApiKey: RAMP_HOST_API_KEY,
    hostAppName: "MON Unlock",
    defaultFlow: "ONRAMP",
    outAsset: "MONAD_MON",
    userAddress: address,
    enabledCryptoAssets: "MONAD_MON",
  });
  if (amountMon) {
    params.set("inAsset", "USD");
  }
  return `https://app.rampnetwork.com/?${params.toString()}`;
}

export function openRampBuy(address: string, amountMon?: string): boolean {
  const url = buildRampBuyUrl(address, amountMon);
  if (!url) return false;
  window.open(url, "_blank", "noopener,noreferrer");
  return true;
}
