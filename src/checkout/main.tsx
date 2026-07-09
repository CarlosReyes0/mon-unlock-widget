import React from "react";
import { createRoot } from "react-dom/client";
import { PrivyProvider } from "@privy-io/react-auth";
import { monad } from "viem/chains";
import { CheckoutApp } from "./CheckoutApp.js";
import "./checkout.css";

const appId = (import.meta.env.VITE_PRIVY_APP_ID as string | undefined)?.trim() ?? "";

const rootEl = document.getElementById("root");
if (!rootEl) {
  throw new Error("Missing #root");
}

const root = createRoot(rootEl);

if (!appId) {
  root.render(
    <div className="checkout-shell">
      <div className="checkout-card">
        <p className="checkout-brand">MON Unlock</p>
        <h1>Checkout not configured</h1>
        <p className="checkout-copy">
          Set <code>VITE_PRIVY_APP_ID</code> when building, allowlist this domain in the Privy
          dashboard, and enable wallet funding for MON on Monad.
        </p>
      </div>
    </div>
  );
} else {
  root.render(
    <React.StrictMode>
      <PrivyProvider
        appId={appId}
        config={{
          loginMethods: ["email", "google"],
          appearance: {
            theme: "light",
            accentColor: "#5b7c5a",
            logo: undefined,
          },
          embeddedWallets: {
            ethereum: {
              createOnLogin: "users-without-wallets",
            },
          },
          defaultChain: monad,
          supportedChains: [monad],
        }}
      >
        <CheckoutApp />
      </PrivyProvider>
    </React.StrictMode>
  );
}
