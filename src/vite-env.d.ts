/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_PRIVY_APP_ID?: string;
  readonly VITE_WALLETCONNECT_PROJECT_ID?: string;
  readonly VITE_CHECKOUT_ORIGIN?: string;
  readonly VITE_RAMP_HOST_API_KEY?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

declare module "*.css" {}
