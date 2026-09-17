import type { PrivyClientConfig } from "@privy-io/react-auth";
import { monad, base, baseSepolia } from "viem/chains";
import { resolveWalletConnectProjectId } from "../core/walletconnect.js";

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
    supportedChains: [monad, base, baseSepolia],
    walletConnectCloudProjectId: resolveWalletConnectProjectId(),
  };
}
