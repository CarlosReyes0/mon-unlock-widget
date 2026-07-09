import type { FundWalletConfig, MoonpayCurrencyCode } from "@privy-io/react-auth";
import { monad } from "viem/chains";

const RAMP_HOST_API_KEY = (import.meta.env.VITE_RAMP_HOST_API_KEY as string | undefined)?.trim() ?? "";

/**
 * MoonPay's code for native MON on Monad. Supported by MoonPay (`mon_mon`) and newer Privy
 * SDKs (`MON_MON`), but missing from @privy-io/react-auth@2.25's MoonpayCurrencyCode union —
 * so NativeFundingConfig with chain:monad + card falls back to Receive-only.
 */
const MON_MON = "MON_MON" as MoonpayCurrencyCode;

/**
 * Force the MoonPay widget for MON (not Privy's generic "add funds" picker).
 * Using NativeFundingConfig + defaultFundingMethod:'card' still shows Receive when Privy
 * cannot map Monad native currency → MoonPay.
 */
export function cardFundConfig(amountMon: string): FundWalletConfig {
  const quote = Number.parseFloat(amountMon);
  return {
    provider: "moonpay",
    config: {
      currencyCode: MON_MON,
      ...(Number.isFinite(quote) && quote > 0 ? { quoteCurrencyAmount: quote } : {}),
    },
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
    // Ramp expects fiat minor units for inAssetValue when using USD; omit and let user pick amount.
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
