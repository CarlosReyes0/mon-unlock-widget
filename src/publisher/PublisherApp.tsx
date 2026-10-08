import { useCallback, useEffect, useState } from "react";
import { createWalletClient, custom, type Address } from "viem";
import { monadMainnet } from "../core/chains.js";
import { buildPlanAuthMessage } from "../core/publish-auth.js";
import { establishReaderSession, READER_SESSION_HEADER } from "../core/reader-session.js";
import { peekResumableDraft, type ResumableDraft } from "../core/write-drafts.js";
import type { Eip1193Provider } from "../core/wallet.js";
import { AccountArticles } from "./AccountArticles.js";
import { PublisherAuth } from "./PublisherAuth.js";
import { ResumeDraftCard } from "./ResumeDraftCard.js";
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

  async function readerAuthHeaders(wallet: string): Promise<Record<string, string>> {
    const provider = window.__monPublisherProvider as Eip1193Provider | undefined;
    if (!provider) throw new Error("Connect a wallet to continue.");
    const account = wallet as Address;
    const walletClient = createWalletClient({
      account,
      chain: monadMainnet,
      transport: custom(provider),
    });
    const session = await establishReaderSession({
      address: wallet,
      domain: window.location.host,
      sessionUrl: "/api/reader/session",
      storage: window.localStorage,
      signMessage: (message) => walletClient.signMessage({ account, message }),
    });
    return { [READER_SESSION_HEADER]: session.token };
  }

  const loadSubs = useCallback(async (wallet: string) => {
    if (!wallet) return;
    try {
      const headers = await readerAuthHeaders(wallet);
      const res = await fetch(`/api/subscriptions?reader=${encodeURIComponent(wallet)}`, { headers });
      const data = (await res.json()) as { subscriptions?: SubRow[]; error?: string };
      if (!res.ok) throw new Error(data.error || "list_failed");
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
      const returnUrl = new URL("/account.html", window.location.origin);
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
    const provider = window.__monPublisherProvider as Eip1193Provider | undefined;
    if (!provider) {
      setPlanMsg("Connect a wallet to save the plan.");
      return;
    }
    setPlanMsg("Approve the plan signature…");
    const cents = Math.round(Number(priceDollars) * 100);
    const allowALaCarte = allowBuy;
    try {
      const message = buildPlanAuthMessage({
        publisher,
        monthlyPriceCents: cents,
        allowALaCarte,
      });
      const account = publisher as Address;
      const walletClient = createWalletClient({
        account,
        chain: monadMainnet,
        transport: custom(provider),
      });
      const planSig = await walletClient.signMessage({ account, message });
      const res = await fetch("/api/writers/plan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          publisher,
          monthlyPriceCents: cents,
          allowALaCarte,
          planSig,
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
        headers: {
          "Content-Type": "application/json",
          ...(await readerAuthHeaders(reader)),
        },
        body: JSON.stringify({ writer }),
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

        {signedIn ? (
          <AccountArticles wallet={address()} />
        ) : (
          <div className="mon-pub-shell__card mon-pub-articles">
            <h2 className="mon-pub-shell__card-title">Your articles</h2>
            <p className="mon-pub-auth__hint">Sign in to see unlocks, revenue, and listings.</p>
          </div>
        )}

        <ResumeDraftCard resume={resume} />
        <SiteFooter />
      </div>
    </div>
  );
}
