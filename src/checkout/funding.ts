import type { FundWalletConfig } from "@privy-io/react-auth";
import { monad } from "viem/chains";

const RAMP_HOST_API_KEY = (import.meta.env.VITE_RAMP_HOST_API_KEY as string | undefined)?.trim() ?? "";

/**
 * Card buy via Privy. Prefer Coinbase over MoonPay — MoonPay blocks several US states
 * including Texas, so MoonPay-first always fails for those readers.
 *
 * Note: Ramp Network also blocks Texas. Prefer openCoinbaseBuy() (session-token URL)
 * for card buys; keep Privy fundWallet as a secondary path when Coinbase is unavailable.
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

export type BuyAsset = "USDC" | "MON";

/**
 * Ask our CDN for a Coinbase Onramp URL (session token minted server-side with CDP keys).
 * Returns null when the endpoint is missing/unconfigured or the request fails.
 */
export async function fetchCoinbaseBuyUrl(
  address: string,
  asset: BuyAsset,
  amount?: string
): Promise<string | null> {
  try {
    const res = await fetch("/api/coinbase/session-token", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        address,
        asset,
        amount,
        // Fiat so $0.50 USDC (or a 0.05 MON gas top-up) still clears Coinbase's ~$1 min.
        amountKind: "fiat",
        redirectUrl: window.location.href,
      }),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { url?: string };
    return typeof data.url === "string" && data.url.startsWith("https://") ? data.url : null;
  } catch {
    return null;
  }
}

/** Open Coinbase Onramp in a new tab. Returns false if session token is unavailable. */
export async function openCoinbaseBuy(
  address: string,
  asset: BuyAsset,
  amount?: string
): Promise<boolean> {
  const url = await fetchCoinbaseBuyUrl(address, asset, amount);
  if (!url) return false;
  window.open(url, "_blank", "noopener,noreferrer");
  return true;
}

/** Ramp Network — kept for non-Texas regions; Ramp blocks Texas. */
export function buildRampBuyUrl(address: string, outAsset: "MONAD_MON" | "MONAD_USDC" = "MONAD_MON"): string {
  const params = new URLSearchParams({
    hostAppName: "Open Paywall",
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

/**
 * Prefer Coinbase (works in Texas). Caller should try Privy fundWallet next;
 * use openRampBuy only as last resort (Ramp blocks Texas).
 */
export async function openCardBuy(
  address: string,
  asset: BuyAsset,
  amount?: string
): Promise<"coinbase" | null> {
  const opened = await openCoinbaseBuy(address, asset, amount);
  return opened ? "coinbase" : null;
}

/**
 * Same relayer as article registration: send ~0.05 MON so the reader can pay
 * approve/unlock gas. Coinbase is not used for this.
 * Returns true when funded, a drip was submitted, or rate-limited (in flight).
 */
export async function requestGasDrip(address: string): Promise<boolean> {
  try {
    const res = await fetch("/api/relay/gas", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ address }),
    });
    if (res.status === 429) return true;
    if (!res.ok) return false;
    const data = (await res.json()) as { ok?: boolean };
    return data.ok === true;
  } catch {
    return false;
  }
}
