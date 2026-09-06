import { useCallback, useEffect, useState } from "react";
import { PublisherAuth } from "./PublisherAuth.js";
import { SiteFooter, SiteNav } from "./SiteNav.js";

type SubRow = {
  writer: string;
  source: string;
  status: string;
  live?: boolean;
  current_period_end?: string | null;
};

export function PublisherApp() {
  const [signedIn, setSignedIn] = useState(false);
  const [payoutBusy, setPayoutBusy] = useState(false);
  const [payoutMsg, setPayoutMsg] = useState("");
  const [subs, setSubs] = useState<SubRow[]>([]);
  const [subMsg, setSubMsg] = useState("");
  const [priceDollars, setPriceDollars] = useState("5");
  const [allowBuy, setAllowBuy] = useState(true);
  const [planMsg, setPlanMsg] = useState("");

  const address = () => window.__monPublisherAddress || "";

  const loadSubs = useCallback(async (wallet: string) => {
    if (!wallet) return;
    try {
      const res = await fetch(`/api/subscriptions?reader=${encodeURIComponent(wallet)}`);
      const data = (await res.json()) as { subscriptions?: SubRow[] };
      setSubs(Array.isArray(data.subscriptions) ? data.subscriptions : []);
    } catch {
      setSubs([]);
    }
  }, []);

  const loadPlan = useCallback(async (wallet: string) => {
    if (!wallet) return;
    try {
      const res = await fetch(`/api/writers/${wallet}/plan`);
      const data = (await res.json()) as {
        plan?: { monthlyPriceCents?: number; allowALaCarte?: boolean };
      };
      if (data.plan?.monthlyPriceCents) {
        setPriceDollars(String(data.plan.monthlyPriceCents / 100));
      }
      if (typeof data.plan?.allowALaCarte === "boolean") setAllowBuy(data.plan.allowALaCarte);
    } catch {
      /* keep defaults */
    }
  }, []);

  const onReadyChange = useCallback(
    (ready: boolean) => {
      setSignedIn(ready);
      if (!ready) {
        setPayoutMsg("");
        setSubs([]);
        return;
      }
      const wallet = address();
      void loadSubs(wallet);
      void loadPlan(wallet);
    },
    [loadPlan, loadSubs]
  );

  useEffect(() => {
    if (!signedIn) return;
    const wallet = address();
    void loadSubs(wallet);
    void loadPlan(wallet);
  }, [signedIn, loadPlan, loadSubs]);

  async function setupStripePayouts() {
    const publisher = address();
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

  async function savePlan() {
    const publisher = address();
    if (!publisher) return;
    setPlanMsg("");
    const cents = Math.round(Number(priceDollars) * 100);
    try {
      const res = await fetch("/api/writers/plan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          publisher,
          monthlyPriceCents: cents,
          allowALaCarte: allowBuy,
        }),
      });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(data.error || "save_failed");
      setPlanMsg("Saved. Readers can subscribe at this price.");
    } catch (e) {
      setPlanMsg(e instanceof Error ? e.message : "Could not save plan");
    }
  }

  async function cancelSub(writer: string) {
    const reader = address();
    if (!reader) return;
    setSubMsg("");
    try {
      const res = await fetch("/api/subscriptions/cancel", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reader, writer }),
      });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(data.error || "cancel_failed");
      setSubMsg("Unsubscribed. Articles you did not buy are locked again.");
      await loadSubs(reader);
    } catch (e) {
      setSubMsg(e instanceof Error ? e.message : "Could not cancel");
    }
  }

  return (
    <div className="mon-pub-shell">
      <div className="mon-pub-shell__inner">
        <SiteNav />
        <p className="mon-pub-shell__brand">Account</p>
        <h1>Account</h1>
        <p className="mon-pub-shell__lead">
          Sign in with email, Google, or a wallet. Same account for writing and reading. No password
          stored here.
        </p>

        <div className="mon-pub-shell__card">
          <PublisherAuth variant="page" onReadyChange={onReadyChange} />

          {signedIn ? (
            <>
              <div className="mon-pub-shell__links">
                <button
                  type="button"
                  className="mon-pub-auth__btn mon-pub-auth__btn--primary"
                  disabled={payoutBusy}
                  onClick={() => void setupStripePayouts()}
                >
                  {payoutBusy ? "Opening Stripe…" : "Set up Stripe payouts"}
                </button>
              </div>
              {payoutMsg ? <p className="mon-pub-auth__error">{payoutMsg}</p> : null}
              <p className="mon-pub-auth__hint" style={{ marginTop: "1rem" }}>
                Card unlocks and card subscriptions pay out through Stripe Connect. USDC
                subscriptions go to your Monad wallet.
              </p>
            </>
          ) : null}
        </div>

        {signedIn ? (
          <>
            <div className="mon-pub-shell__card" style={{ marginTop: "1.25rem" }}>
              <h2 style={{ fontSize: "1.1rem", margin: "0 0 0.5rem" }}>Your writer plan</h2>
              <p className="mon-pub-auth__hint">
                Readers subscribe to you (not a site-wide pass). Cancel drops their sub access
                immediately. Articles they bought stay unlocked.
              </p>
              <label className="mon-pub-auth__hint" htmlFor="planPrice">
                Monthly price (USD)
              </label>
              <input
                id="planPrice"
                type="number"
                min="0.50"
                step="0.50"
                value={priceDollars}
                onChange={(e) => setPriceDollars(e.target.value)}
                style={{
                  width: "8rem",
                  margin: "0.35rem 0 0.75rem",
                  padding: "0.5rem 0.65rem",
                  borderRadius: 8,
                  border: "1px solid #d6d3d1",
                }}
              />
              <label style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
                <input
                  type="checkbox"
                  checked={allowBuy}
                  onChange={(e) => setAllowBuy(e.target.checked)}
                />
                Allow pay-per-article (uncheck = subscribe only)
              </label>
              <div className="mon-pub-shell__links" style={{ marginTop: "0.75rem" }}>
                <button type="button" className="mon-pub-auth__btn" onClick={() => void savePlan()}>
                  Save plan
                </button>
              </div>
              {planMsg ? <p className="mon-pub-auth__hint">{planMsg}</p> : null}
            </div>

            <div className="mon-pub-shell__card" style={{ marginTop: "1.25rem" }}>
              <h2 style={{ fontSize: "1.1rem", margin: "0 0 0.5rem" }}>Subscriptions you pay for</h2>
              {subs.filter((s) => s.live).length === 0 ? (
                <p className="mon-pub-auth__hint">You are not subscribed to any writer.</p>
              ) : (
                <ul style={{ paddingLeft: "1.1rem", margin: "0.5rem 0" }}>
                  {subs
                    .filter((s) => s.live)
                    .map((s) => (
                      <li key={`${s.writer}-${s.source}`} style={{ marginBottom: "0.5rem" }}>
                        {s.writer.slice(0, 6)}…{s.writer.slice(-4)} · {s.source}
                        <button
                          type="button"
                          className="mon-pub-auth__btn"
                          style={{ marginLeft: "0.5rem" }}
                          onClick={() => void cancelSub(s.writer)}
                        >
                          Cancel
                        </button>
                      </li>
                    ))}
                </ul>
              )}
              {subMsg ? <p className="mon-pub-auth__hint">{subMsg}</p> : null}
            </div>
          </>
        ) : null}
        <SiteFooter />
      </div>
    </div>
  );
}
