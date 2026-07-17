import { useCallback, useState } from "react";
import { PublisherAuth } from "./PublisherAuth.js";

export function PublisherApp() {
  const [signedIn, setSignedIn] = useState(false);
  const [payoutBusy, setPayoutBusy] = useState(false);
  const [payoutMsg, setPayoutMsg] = useState("");

  const onReadyChange = useCallback((ready: boolean) => {
    setSignedIn(ready);
    if (!ready) setPayoutMsg("");
  }, []);

  async function setupStripePayouts() {
    const publisher = window.__monPublisherAddress;
    if (!publisher) {
      setPayoutMsg("Sign in first.");
      return;
    }
    setPayoutBusy(true);
    setPayoutMsg("");
    try {
      const returnUrl = new URL("/dashboard.html", window.location.origin);
      returnUrl.searchParams.set("stripe_onboard", "return");
      const refreshUrl = new URL("/account.html", window.location.origin);
      refreshUrl.searchParams.set("stripe_onboard", "refresh");

      const res = await fetch("/api/stripe/connect/onboard", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          publisher,
          returnUrl: returnUrl.toString(),
          refreshUrl: refreshUrl.toString(),
        }),
      });
      const body = (await res.json().catch(() => ({}))) as { url?: string; error?: string };
      if (!res.ok || !body.url) {
        throw new Error(body.error || `onboard_failed_${res.status}`);
      }
      window.location.href = body.url;
    } catch (e) {
      setPayoutMsg(e instanceof Error ? e.message : "Could not start Stripe onboarding");
    } finally {
      setPayoutBusy(false);
    }
  }

  return (
    <div className="mon-pub-shell">
      <div className="mon-pub-shell__inner">
        <p className="mon-pub-shell__brand">MON Unlock</p>
        <h1>Publisher account</h1>
        <p className="mon-pub-shell__lead">
          Create an account with email or Google — or connect a wallet. Readers can still pay with card; you get paid
          on-chain in MON, or via Stripe Connect for fiat unlocks.
        </p>

        <div className="mon-pub-shell__card">
          <PublisherAuth variant="page" onReadyChange={onReadyChange} />

          {signedIn ? (
            <>
              <div className="mon-pub-shell__links">
                <a className="primary" href="/generator.html">
                  Create embed
                </a>
                <a href="/dashboard.html">Writer dashboard</a>
                <button
                  type="button"
                  className="mon-pub-auth__btn"
                  disabled={payoutBusy}
                  onClick={() => void setupStripePayouts()}
                >
                  {payoutBusy ? "Opening Stripe…" : "Set up Stripe payouts"}
                </button>
              </div>
              {payoutMsg ? <p className="mon-pub-auth__error">{payoutMsg}</p> : null}
              <p className="mon-pub-auth__hint" style={{ marginTop: "1rem" }}>
                Stripe payouts: readers pay you through the platform; after you finish Connect onboarding, pending
                fiat unlocks transfer to your Stripe account automatically. You do not need the site owner to send
                money by hand.
              </p>
            </>
          ) : null}
        </div>
      </div>
    </div>
  );
}
