import React from "react";
import { createRoot } from "react-dom/client";
import { PrivyProvider } from "@privy-io/react-auth";
import { WriteApp } from "./WriteApp.js";
import { publisherPrivyConfig } from "./privy-config.js";
import "./publisher-auth.css";

const appId = (import.meta.env.VITE_PRIVY_APP_ID as string | undefined)?.trim() ?? "";
const rootEl = document.getElementById("root");
if (!rootEl) throw new Error("Missing #root");

const root = createRoot(rootEl);

if (!appId) {
  root.render(
    <React.StrictMode>
      <WriteApp auth="injected" />
    </React.StrictMode>
  );
} else {
  root.render(
    <React.StrictMode>
      <PrivyProvider appId={appId} config={publisherPrivyConfig()}>
        <WriteApp />
      </PrivyProvider>
    </React.StrictMode>
  );
}
