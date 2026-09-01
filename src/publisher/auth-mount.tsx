import React from "react";
import { createRoot } from "react-dom/client";
import { PrivyProvider } from "@privy-io/react-auth";
import { PublisherAuth } from "./PublisherAuth.js";
import { publisherPrivyConfig } from "./privy-config.js";
import "./publisher-auth.css";

const appId = (import.meta.env.VITE_PRIVY_APP_ID as string | undefined)?.trim() ?? "";

function MissingPrivy({ el }: { el: HTMLElement }) {
  el.innerHTML = `
    <div class="mon-pub-auth">
      <div class="mon-pub-auth__row">
        <button type="button" class="mon-pub-auth__btn" id="mon-pub-fallback-wallet">Connect MetaMask</button>
      </div>
      <p class="mon-pub-auth__hint">
        Email / Google sign-in is not configured (<code>VITE_PRIVY_APP_ID</code>). You can still use an injected wallet.
      </p>
    </div>
  `;
  const btn = el.querySelector("#mon-pub-fallback-wallet");
  btn?.addEventListener("click", () => {
    window.dispatchEvent(new CustomEvent("mon-publisher-auth-fallback-wallet"));
  });
}

function mount() {
  const el = document.getElementById("mon-publisher-auth");
  if (!el) return;

  if (!appId) {
    MissingPrivy({ el });
    return;
  }

  const root = createRoot(el);
  root.render(
    <React.StrictMode>
      <PrivyProvider appId={appId} config={publisherPrivyConfig()}>
        <PublisherAuth variant="inline" />
      </PrivyProvider>
    </React.StrictMode>
  );
}

mount();
