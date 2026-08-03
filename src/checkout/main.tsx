import React from "react";
import { createRoot } from "react-dom/client";
import { PrivyProvider } from "@privy-io/react-auth";
import { monad } from "viem/chains";
import { CheckoutApp } from "./CheckoutApp.js";
import { stripeFiatEnabled } from "./StripeFiatPay.js";
import "./checkout.css";

const appId = (import.meta.env.VITE_PRIVY_APP_ID as string | undefined)?.trim() ?? "";

const rootEl = document.getElementById("root");
if (!rootEl) {
  throw new Error("Missing #root");
}

const root = createRoot(rootEl);

const app = <CheckoutApp />;

if (!appId && !stripeFiatEnabled()) {
  root.render(
    <div className="checkout-shell">
      <div className="checkout-card">
        <p className="checkout-brand">Open Paywall</p>
        <h1>Checkout not configured</h1>
        <p className="checkout-copy">
          Set <code>VITE_STRIPE_PUBLISHABLE_KEY</code> for Apple Pay / card unlock, and/or{" "}
          <code>VITE_PRIVY_APP_ID</code> for crypto unlock.
        </p>
      </div>
    </div>
  );
} else if (!appId) {
  root.render(<React.StrictMode>{app}</React.StrictMode>);
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
          fundingMethodConfig: {
            moonpay: {
              useSandbox: false,
            },
          },
        }}
      >
        {app}
      </PrivyProvider>
    </React.StrictMode>
  );
}
