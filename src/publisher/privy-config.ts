import type { PrivyClientConfig } from "@privy-io/react-auth";
import { monad } from "viem/chains";

/** WalletConnect project ID — required for mobile wallet connections via Privy. */
const WALLET_CONNECT_PROJECT_ID =
  (import.meta.env.VITE_WALLETCONNECT_PROJECT_ID as string | undefined)?.trim() ||
  "c2a289e11ad2998f8ea4633db536334c";

export function publisherPrivyConfig(): PrivyClientConfig {
  return {
    loginMethods: ["email", "google", "wallet"],
    appearance: {
      theme: "light",
      accentColor: "#7c3aed",
      logo: undefined,
    },
    embeddedWallets: {
      ethereum: {
        createOnLogin: "users-without-wallets",
      },
    },
    defaultChain: monad,
    supportedChains: [monad],
    walletConnectCloudProjectId: WALLET_CONNECT_PROJECT_ID,
  };
}
