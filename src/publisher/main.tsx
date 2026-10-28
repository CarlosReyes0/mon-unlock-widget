import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { PrivyProvider } from "@privy-io/react-auth";
import { peekResumableDraft, type ResumableDraft } from "../core/write-drafts.js";
import { cardPayoutHint, PublisherApp, requestConnectOnboarding } from "./PublisherApp.js";
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
          sign-in. Until then, use MetaMask on the <a href="/generator.html">generator</a> to publish.
        </p>
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

function PaymentsPreview() {
  const modelParam = new URLSearchParams(window.location.search).get("model");
  const connectModel = modelParam === "direct" || modelParam === "legacy" ? modelParam : null;
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  async function start(reonboard: boolean) {
    setBusy(true);
    setMessage("Approve the payout signature…");
    try {
      const key =
        sessionStorage.getItem("op_preview_key") ||
        String(import.meta.env.VITE_PREVIEW_KEY || "");
      const { privateKeyToAccount } = await import("viem/accounts");
      const { hexToString } = await import("viem");
      const signer = privateKeyToAccount(key as `0x${string}`);
      const provider = {
        request: async ({ method, params }: { method: string; params?: unknown[] }) => {
          if (method === "personal_sign") {
            const data = String(params?.[0] ?? "");
            const message = data.startsWith("0x") ? hexToString(data as `0x${string}`) : data;
            return signer.signMessage({ message });
          }
          if (method === "eth_requestAccounts" || method === "eth_accounts") return [signer.address];
          throw new Error(method);
        },
      };
      const url = await requestConnectOnboarding({
        publisher: signer.address,
        provider,
        reonboard,
      });
      window.location.href = url;
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Could not start payouts");
      setBusy(false);
    }
  }

  return (
    <div className="mon-pub-shell">
      <div className="mon-pub-shell__inner">
        <SiteNav />
        <p className="mon-pub-shell__brand">Account</p>
        <h1>Account</h1>
        <p className="mon-pub-shell__lead">Local preview. No live Stripe account is created.</p>
        <div className="mon-pub-shell__card" style={{ marginTop: "1.25rem" }}>
          <h2 className="mon-pub-shell__card-title">Get paid</h2>
          <p className="mon-pub-auth__hint">{cardPayoutHint(true, connectModel)}</p>
          <p className="mon-pub-auth__hint">
            USDC: a reader pays, it goes to the wallet you are signed in with. Automatic. No extra setup.
          </p>
          <div className="mon-pub-shell__links">
            <button
              type="button"
              className="mon-pub-auth__btn mon-pub-auth__btn--primary"
              disabled={busy}
              onClick={() => void start(false)}
            >
              {busy ? "Opening…" : "Connect payments"}
            </button>
            {connectModel === "legacy" ? (
              <button type="button" className="mon-pub-auth__btn" disabled={busy} onClick={() => void start(true)}>
                Switch card payments
              </button>
            ) : null}
          </div>
          {message ? <p className="mon-pub-auth__error">{message}</p> : null}
        </div>
      </div>
    </div>
  );
}

if (import.meta.env.DEV && new URLSearchParams(window.location.search).get("preview") === "payments") {
  root.render(<PaymentsPreview />);
} else if (!appId) {
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
