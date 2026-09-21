import { useCallback, useEffect, useState } from "react";
import { peekResumableDraft, type ResumableDraft } from "../core/write-drafts.js";
import { PublisherAuth } from "./PublisherAuth.js";
import { SiteFooter, SiteNav } from "./SiteNav.js";

type SubRow = {
  writer: string;
  source: string;
  status: string;
  live?: boolean;
  current_period_end?: string | null;
};

function shortAddr(addr: string) {
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

export function PublisherApp() {
  const [signedIn, setSignedIn] = useState(false);
  const [payoutBusy, setPayoutBusy] = useState(false);
  const [payoutMsg, setPayoutMsg] = useState("");
  const [subs, setSubs] = useState<SubRow[]>([]);
  const [subMsg, setSubMsg] = useState("");
  const [priceDollars, setPriceDollars] = useState("5");
  const [allowBuy, setAllowBuy] = useState(true);
  const [planMsg, setPlanMsg] = useState("");
  const [resume, setResume] = useState<ResumableDraft | null>(null);

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

  useEffect(() => {
    try {
      setResume(peekResumableDraft(window.localStorage));
    } catch {
      setResume(null);
    }
  }, []);

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
      setPayoutMsg(e instanceof Error ? e.message : "Could not start payouts");
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
      setPlanMsg("Saved.");
    } catch (e) {
      setPlanMsg(e instanceof Error ? e.message : "Could not save");
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
      setSubMsg("Unsubscribed.");
      await loadSubs(reader);
    } catch (e) {
      setSubMsg(e instanceof Error ? e.message : "Could not cancel");
    }
  }

  const following = subs.filter((s) => s.live);

  return (
    <div className="mon-pub-shell">
      <div className="mon-pub-shell__inner">
        <SiteNav />
        <p className="mon-pub-shell__brand">Account</p>
        <h1>Account</h1>
        <p className="mon-pub-shell__lead">
          {signedIn
            ? "Set your price. Readers pay you with a card or USDC."
            : "Drafts save without an account. Sign in to publish and get paid — email or Google, no password."}
        </p>

        <div className="mon-pub-shell__card">
          {signedIn ? <h2 className="mon-pub-shell__card-title">You</h2> : null}
          <PublisherAuth variant="page" onReadyChange={onReadyChange} />
        </div>

        {signedIn ? (
          <>
            <div className="mon-pub-shell__card" style={{ marginTop: "1.25rem" }}>
              <h2 className="mon-pub-shell__card-title">Get paid</h2>
              <p className="mon-pub-auth__hint">
                Card: connect payments, then money goes to your bank.
              </p>
              <p className="mon-pub-auth__hint">
                USDC: a reader pays, it goes to the wallet you are signed in with. Automatic. No extra
                setup.
              </p>
              <label className="mon-pub-shell__field-label" htmlFor="planPrice">
                Monthly price (USD)
              </label>
              <input
                id="planPrice"
                type="number"
                min="0.50"
                step="0.50"
                value={priceDollars}
                onChange={(e) => setPriceDollars(e.target.value)}
                className="mon-pub-shell__input"
              />
              <label className="mon-pub-shell__check">
                <input
                  type="checkbox"
                  checked={allowBuy}
                  onChange={(e) => setAllowBuy(e.target.checked)}
                />
                Allow pay-per-article
              </label>
              <div className="mon-pub-shell__links">
                <button type="button" className="mon-pub-auth__btn" onClick={() => void savePlan()}>
                  Save
                </button>
                <button
                  type="button"
                  className="mon-pub-auth__btn mon-pub-auth__btn--primary"
                  disabled={payoutBusy}
                  onClick={() => void setupStripePayouts()}
                >
                  {payoutBusy ? "Opening…" : "Connect payments"}
                </button>
              </div>
              {planMsg ? <p className="mon-pub-auth__hint">{planMsg}</p> : null}
              {payoutMsg ? <p className="mon-pub-auth__error">{payoutMsg}</p> : null}
            </div>

            {following.length > 0 ? (
              <div className="mon-pub-shell__card" style={{ marginTop: "1.25rem" }}>
                <h2 className="mon-pub-shell__card-title">Following</h2>
                <ul className="mon-pub-shell__follow-list">
                  {following.map((s) => (
                    <li key={`${s.writer}-${s.source}`}>
                      {shortAddr(s.writer)}
                      <button
                        type="button"
                        className="mon-pub-auth__btn"
                        onClick={() => void cancelSub(s.writer)}
                      >
                        Cancel
                      </button>
                    </li>
                  ))}
                </ul>
                {subMsg ? <p className="mon-pub-auth__hint">{subMsg}</p> : null}
              </div>
            ) : null}
          </>
        ) : null}

        {resume ? (
          <div className="mon-write__resume" style={{ marginTop: "1.25rem" }}>
            <p className="mon-write__resume-kicker">Your draft is waiting</p>
            <a href={`/write?draft=${encodeURIComponent(resume.id)}`}>Continue “{resume.label}”</a>
            <p className="mon-write__resume-hint">Saved on this device. A few paragraphs is a post.</p>
          </div>
        ) : (
          <p className="mon-pub-shell__next">
            <a href="/write">Write a post</a>
            <span aria-hidden="true"> · </span>
            <a href="/articles">Articles feed</a>
          </p>
        )}
        {resume ? (
          <p className="mon-pub-shell__next">
            <a href="/write?new=1">Start a new draft</a>
            <span aria-hidden="true"> · </span>
            <a href="/articles">Articles feed</a>
          </p>
        ) : null}
        <SiteFooter />
      </div>
    </div>
  );
}
