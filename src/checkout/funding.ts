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

/** Buy USDC on Monad (card). Used when we swap USDC → MON for unlock. */
export function cardFundUsdcConfig(amountUsdc: string): FundWalletConfig {
  return {
    chain: monad,
    amount: amountUsdc,
    asset: "USDC",
    defaultFundingMethod: "card",
    card: { preferredProvider: "coinbase" },
  };
}

/** Tiny MON top-up so the reader can pay gas for approve/swap/unlock. */
export function cardFundGasMonConfig(amountMon = "0.05"): FundWalletConfig {
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
export function buildRampBuyUrl(address: string, outAsset: "MONAD_MON" | "MONAD_USDC" = "MONAD_MON"): string {
  const params = new URLSearchParams({
    hostAppName: "MON Unlock",
    hostLogoUrl: "https://mon-unlock-widget-production.up.railway.app/favicon.ico",
    defaultFlow: "ONRAMP",
    outAsset,
    userAddress: address,
    enabledCryptoAssets: outAsset,
    inAsset: "USD",
  });
  if (RAMP_HOST_API_KEY) {
    params.set("hostApiKey", RAMP_HOST_API_KEY);
  }
  return `https://app.rampnetwork.com/?${params.toString()}`;
}

export function openRampBuy(address: string, outAsset: "MONAD_MON" | "MONAD_USDC" = "MONAD_MON"): boolean {
  const url = buildRampBuyUrl(address, outAsset);
  window.open(url, "_blank", "noopener,noreferrer");
  return true;
}
