import type { FundWalletConfig } from "@privy-io/react-auth";
import { monad } from "viem/chains";

const RAMP_HOST_API_KEY = (import.meta.env.VITE_RAMP_HOST_API_KEY as string | undefined)?.trim() ?? "";

/**
 * Card buy via Privy. Prefer Coinbase over MoonPay — MoonPay blocks several US states
 * including Texas, so MoonPay-first always fails for those readers.
 */
export function cardFundConfig(amountMon: string): FundWalletConfig {
  return {
    chain: monad,
    amount: amountMon,
    asset: "native-currency",
    defaultFundingMethod: "card",
    card: { preferredProvider: "coinbase" },
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

/** Ramp Network supports MON on Monad in the US (including states MoonPay blocks). */
export function buildRampBuyUrl(address: string, _amountMon?: string): string {
  const params = new URLSearchParams({
    hostAppName: "MON Unlock",
    hostLogoUrl: "https://mon-unlock-widget-production.up.railway.app/favicon.ico",
    defaultFlow: "ONRAMP",
    outAsset: "MONAD_MON",
    userAddress: address,
    enabledCryptoAssets: "MONAD_MON",
    inAsset: "USD",
  });
  if (RAMP_HOST_API_KEY) {
    params.set("hostApiKey", RAMP_HOST_API_KEY);
  }
  return `https://app.rampnetwork.com/?${params.toString()}`;
}

export function openRampBuy(address: string, amountMon?: string): boolean {
  const url = buildRampBuyUrl(address, amountMon);
  window.open(url, "_blank", "noopener,noreferrer");
  return true;
}
