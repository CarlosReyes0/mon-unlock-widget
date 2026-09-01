/**
 * WalletConnect Cloud project ID — used by the unlock widget, generator embeds,
 * and Privy publisher auth for mobile wallet connections.
 *
 * Keep in sync with server/publish.mjs `WC_PROJECT_ID` and static HTML pages.
 */
export const WALLETCONNECT_PROJECT_ID = "c2a289e11ad2998f8ea4633db536334c";

/** Resolve at runtime; `VITE_WALLETCONNECT_PROJECT_ID` overrides the default when set at build. */
export function resolveWalletConnectProjectId(): string {
  const fromEnv = (import.meta.env.VITE_WALLETCONNECT_PROJECT_ID as string | undefined)?.trim();
  return fromEnv || WALLETCONNECT_PROJECT_ID;
}
