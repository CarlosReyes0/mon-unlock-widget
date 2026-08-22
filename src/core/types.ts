export interface Article {
  id: string;
  title: string;
  author: string;
  teaser: string;
  body: string;
  /** Price in MON (18 decimals when token exists) */
  priceMon: bigint;
  publishedAt: string;
}

export interface UnlockRecord {
  articleId: string;
  wallet: string;
  unlockedAt: number;
  mode: "demo" | "onchain";
  /** Transaction hash when mode is "onchain" */
  txHash?: string;
}

export interface WalletState {
  connected: boolean;
  address: string | null;
}

export function formatMon(amount: bigint, decimals = 18): string {
  const divisor = 10n ** BigInt(decimals);
  const whole = amount / divisor;
  const frac = amount % divisor;
  const fracStr = frac.toString().padStart(decimals, "0").slice(0, 2);
  return `${whole}.${fracStr}`;
}

/** Human-readable MON amount → wei-style bigint */
export function parseMonAmount(mon: string): bigint {
  const trimmed = mon.trim();
  if (!trimmed || Number.isNaN(Number(trimmed))) return 0n;
  const [whole, frac = ""] = trimmed.split(".");
  const fracPadded = (frac + "000000000000000000").slice(0, 18);
  return BigInt(whole) * 10n ** 18n + BigInt(fracPadded);
}

/** USDC uses 6 decimals. Human "0.50" → 500000n */
export function parseUsdAmount(usd: string): bigint {
  const trimmed = usd.trim();
  if (!trimmed || Number.isNaN(Number(trimmed))) return 0n;
  const [whole, frac = ""] = trimmed.split(".");
  const fracPadded = (frac + "000000").slice(0, 6);
  return BigInt(whole || "0") * 10n ** 6n + BigInt(fracPadded || "0");
}

/** USDC base units → human string with up to 2 decimal places for display. */
export function formatUsd(amount: bigint, decimals = 6): string {
  const divisor = 10n ** BigInt(decimals);
  const whole = amount / divisor;
  const frac = amount % divisor;
  const fracStr = frac.toString().padStart(decimals, "0").slice(0, 2);
  return `${whole}.${fracStr}`;
}
