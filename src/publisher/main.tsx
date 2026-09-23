import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { PrivyProvider } from "@privy-io/react-auth";
import { peekResumableDraft, type ResumableDraft } from "../core/write-drafts.js";
import { PublisherApp } from "./PublisherApp.js";
import { ResumeDraftCard } from "./ResumeDraftCard.js";
import { publisherPrivyConfig } from "./privy-config.js";
import { SiteFooter, SiteNav } from "./SiteNav.js";
import "./publisher-auth.css";

const appId = (import.meta.env.VITE_PRIVY_APP_ID as string | undefined)?.trim() ?? "";
const rootEl = document.getElementById("root");
if (!rootEl) throw new Error("Missing #root");

const root = createRoot(rootEl);

function AccountFallback() {
  const [resume, setResume] = useState<ResumableDraft | null>(null);
  useEffect(() => {
    try {
      setResume(peekResumableDraft(window.localStorage));
    } catch {
      setResume(null);
    }
  }, []);
  return (
    <div className="mon-pub-shell">
      <div className="mon-pub-shell__inner">
        <SiteNav />
        <p className="mon-pub-shell__brand">Account</p>
        <h1>Publisher account</h1>
        <p className="mon-pub-shell__lead">
          Drafts save without an account. Set <code>VITE_PRIVY_APP_ID</code> to enable email / Google
          sign-in. Until then, use MetaMask on the <a href="/generator.html">generator</a> or{" "}
          <a href="/dashboard.html">dashboard</a> to publish.
        </p>
        <ResumeDraftCard resume={resume} />
        <SiteFooter />
      </div>
    </div>
  );
}

if (!appId) {
  root.render(<AccountFallback />);
} else {
  root.render(
    <React.StrictMode>
      <PrivyProvider appId={appId} config={publisherPrivyConfig()}>
        <PublisherApp />
      </PrivyProvider>
    </React.StrictMode>
  );
}
