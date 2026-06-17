import type { Chain } from "viem";

export const monadTestnet = {
  id: 10143,
  name: "Monad Testnet",
  nativeCurrency: { name: "MON", symbol: "MON", decimals: 18 },
  rpcUrls: {
    default: { http: ["https://testnet-rpc.monad.xyz"] },
  },
  blockExplorers: {
    default: { name: "MonadVision", url: "https://testnet.monadvision.com" },
  },
} as const satisfies Chain;

export const monadMainnet = {
  id: 10143, // TODO: confirm final mainnet chain ID
  name: "Monad",
  nativeCurrency: { name: "MON", symbol: "MON", decimals: 18 },
  rpcUrls: {
    default: { http: ["https://rpc.monad.xyz"] }, // placeholder – replace with production RPC
  },
  blockExplorers: {
    default: { name: "MonadVision", url: "https://monadvision.com" }, // placeholder
  },
} as const satisfies Chain;
