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
  const [planDollars, setPlanDollars] = useState("5");
  const [planMsg, setPlanMsg] = useState("");
  useEffect(() => {
    try {
      setResume(peekResumableDraft(window.localStorage));
    } catch {
      setResume(null);
    }
  }, []);
  function savePlan() {
    const cents = Math.round(Number(planDollars) * 100);
    if (!Number.isFinite(cents) || cents < 50) {
      setPlanMsg("Minimum is $0.50.");
      return;
    }
    if (cents > 100_000) {
      setPlanMsg("Maximum is $1,000.00 per month.");
      return;
    }
    setPlanMsg("Connect a wallet to save the plan.");
  }
  const planIsError = planMsg.startsWith("Maximum") || planMsg.startsWith("Minimum");
  return (
    <div className="mon-pub-shell">
      <div className="mon-pub-shell__inner">
        <SiteNav />
        <p className="mon-pub-shell__brand">Account</p>
        <h1>Publisher account</h1>
        <p className="mon-pub-shell__lead">
          Drafts save without an account. Set <code>VITE_PRIVY_APP_ID</code> to enable email / Google
          sign-in. Until then, use MetaMask on the <a href="/generator.html">generator</a> to publish.
        </p>
        <div className="mon-pub-shell__card" style={{ marginTop: "1.25rem" }}>
          <h2 className="mon-pub-shell__card-title">Paid membership (optional)</h2>
          <p className="mon-pub-auth__hint">Maximum $1,000.00 per month.</p>
          <label className="mon-pub-shell__field-label" htmlFor="planPrice">
            Monthly price (USD)
          </label>
          <input
            id="planPrice"
            className="mon-pub-shell__input"
            type="number"
            min="0.50"
            max="1000"
            step="0.01"
            value={planDollars}
            onChange={(event) => setPlanDollars(event.currentTarget.value)}
          />
          <div className="mon-pub-shell__links">
            <button type="button" className="mon-pub-auth__btn" onClick={savePlan}>
              Save plan
            </button>
          </div>
          {planMsg ? (
            <p className={planIsError ? "mon-pub-auth__error" : "mon-pub-auth__hint"}>{planMsg}</p>
          ) : null}
        </div>
        <div className="mon-pub-shell__card mon-pub-articles">
          <h2 className="mon-pub-shell__card-title">Your articles</h2>
          <p className="mon-pub-auth__hint">Sign in to see unlocks, revenue, and listings.</p>
        </div>
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
