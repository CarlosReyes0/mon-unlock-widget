import React from "react";
import { createRoot } from "react-dom/client";
import { PrivyProvider } from "@privy-io/react-auth";
import { PublisherApp } from "./PublisherApp.js";
import { publisherPrivyConfig } from "./privy-config.js";
import "./publisher-auth.css";

const appId = (import.meta.env.VITE_PRIVY_APP_ID as string | undefined)?.trim() ?? "";
const rootEl = document.getElementById("root");
if (!rootEl) throw new Error("Missing #root");

const root = createRoot(rootEl);

if (!appId) {
  root.render(
    <div className="mon-pub-shell">
      <div className="mon-pub-shell__inner">
        <nav className="mon-site-nav" aria-label="Product">
          <a href="/">Home</a>
          <a href="/generator.html">Create embed</a>
          <a className="active" href="/account.html">
            Account
          </a>
          <a href="/dashboard.html">Dashboard</a>
          <a href="/agents">Agents</a>
        </nav>
        <p className="mon-pub-shell__brand">Account</p>
        <h1>Publisher account</h1>
        <p className="mon-pub-shell__lead">
          Set <code>VITE_PRIVY_APP_ID</code> to enable email / Google accounts. Until then, use MetaMask on the{" "}
          <a href="/generator.html">generator</a> or <a href="/dashboard.html">dashboard</a>.
        </p>
      </div>
    </div>
  );
} else {
  root.render(
    <React.StrictMode>
      <PrivyProvider appId={appId} config={publisherPrivyConfig()}>
        <PublisherApp />
      </PrivyProvider>
    </React.StrictMode>
  );
}
