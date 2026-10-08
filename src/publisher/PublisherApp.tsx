import { useCallback, useEffect, useState } from "react";
import { peekResumableDraft, type ResumableDraft } from "../core/write-drafts.js";
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

type MembershipInfo = {
  priceLabel: string;
  renewsAt: string | null;
};

type RosterRow = {
  wallet: string;
  name: string;
  following: boolean;
  membership: MembershipInfo | null;
};

const FOLLOWER_TOKEN_KEY = "opw_follower";

function shortAddr(addr: string) {
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

function readFollowerToken() {
  try {
    return window.localStorage.getItem(FOLLOWER_TOKEN_KEY) || "";
  } catch {
    return "";
  }
}

function followerTokenWallet(token: string) {
  const dot = token.lastIndexOf(".");
  if (dot <= 0) return "";
  try {
    let body = token.slice(0, dot).replace(/-/g, "+").replace(/_/g, "/");
    const pad = body.length % 4 === 0 ? "" : "=".repeat(4 - (body.length % 4));
    const data = JSON.parse(atob(body + pad)) as { kind?: string; id?: string };
    if (data.kind === "wallet" && typeof data.id === "string") return data.id.toLowerCase();
  } catch {
    return "";
  }
  return "";
}

function renewalLabel(iso: string | null) {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return `Renews ${date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}`;
}

export function PublisherApp() {
  const [signedIn, setSignedIn] = useState(false);
  const [payoutBusy, setPayoutBusy] = useState(false);
  const [payoutMsg, setPayoutMsg] = useState("");
  const [subs, setSubs] = useState<SubRow[]>([]);
  const [roster, setRoster] = useState<RosterRow[] | null>(null);
  const [planPrices, setPlanPrices] = useState<Record<string, string>>({});
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

  const loadRoster = useCallback(async (wallet: string) => {
    const token = readFollowerToken();
    if (!wallet || followerTokenWallet(token) !== wallet.toLowerCase()) {
      setRoster(null);
      return;
    }
    try {
      const res = await fetch("/api/follows/me/roster", {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        setRoster(null);
        return;
      }
      const data = (await res.json()) as { writers?: RosterRow[] };
      setRoster(Array.isArray(data.writers) ? data.writers : []);
    } catch {
      setRoster(null);
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
        setRoster(null);
        return;
      }
      const wallet = address();
      void loadSubs(wallet);
      void loadRoster(wallet);
      void loadPlan(wallet);
    },
    [loadPlan, loadRoster, loadSubs]
  );

  useEffect(() => {
    if (!signedIn) return;
    const wallet = address();
    void loadSubs(wallet);
    void loadRoster(wallet);
    void loadPlan(wallet);
  }, [signedIn, loadPlan, loadRoster, loadSubs]);

  useEffect(() => {
    try {
      setResume(peekResumableDraft(window.localStorage));
    } catch {
      setResume(null);
    }
  }, []);

  useEffect(() => {
    if (roster) return;
    const writers = subs.filter((s) => s.live).map((s) => s.writer);
    if (!writers.length) {
      setPlanPrices({});
      return;
    }
    let cancelled = false;
    void (async () => {
      const next: Record<string, string> = {};
      await Promise.all(
        writers.map(async (writer) => {
          try {
            const res = await fetch(`/api/writers/${encodeURIComponent(writer)}/plan`);
            const data = (await res.json()) as { plan?: { monthlyPriceLabel?: string } };
            next[writer.toLowerCase()] = data.plan?.monthlyPriceLabel || "";
          } catch {
            next[writer.toLowerCase()] = "";
          }
        })
      );
      if (!cancelled) setPlanPrices(next);
    })();
    return () => {
      cancelled = true;
    };
  }, [roster, subs]);

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
      await loadRoster(reader);
    } catch (e) {
      setSubMsg(e instanceof Error ? e.message : "Could not cancel");
    }
  }

  async function unfollow(writer: string) {
    const token = readFollowerToken();
    const reader = address();
    if (!token || !reader) return;
    setSubMsg("");
    try {
      const res = await fetch("/api/follows/wallet", {
        method: "DELETE",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ writer }),
      });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(data.error || "unfollow_failed");
      setSubMsg("Unfollowed.");
      await loadRoster(reader);
    } catch (e) {
      setSubMsg(e instanceof Error ? e.message : "Could not unfollow");
    }
  }

  const liveSubs = subs.filter((s) => s.live);
  const rows: RosterRow[] =
    roster ??
    liveSubs.map((s) => ({
      wallet: s.writer,
      name: shortAddr(s.writer),
      following: false,
      membership: {
        priceLabel: planPrices[s.writer.toLowerCase()] || "",
        renewsAt: s.current_period_end || null,
      },
    }));

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

            <div className="mon-pub-shell__card" style={{ marginTop: "1.25rem" }}>
              <h2 className="mon-pub-shell__card-title">Following & memberships</h2>
              {rows.length === 0 ? (
                <p className="mon-pub-auth__hint">
                  You are not following anyone, and you have no memberships.
                </p>
              ) : (
                <ul className="mon-pub-shell__follow-list">
                  {rows.map((row) => {
                    const meta = [
                      row.membership?.priceLabel || "",
                      row.membership ? renewalLabel(row.membership.renewsAt) : "",
                    ]
                      .filter(Boolean)
                      .join(" · ");
                    return (
                      <li key={row.wallet}>
                        <div>
                          <a className="mon-pub-shell__follow-name" href={`/writers/${row.wallet}`}>
                            {row.name || shortAddr(row.wallet)}
                          </a>
                          {meta ? <p className="mon-pub-shell__follow-meta">{meta}</p> : null}
                        </div>
                        <div className="mon-pub-shell__follow-actions">
                          {row.following ? (
                            <button
                              type="button"
                              className="mon-pub-auth__btn"
                              onClick={() => void unfollow(row.wallet)}
                            >
                              Unfollow
                            </button>
                          ) : null}
                          {row.membership ? (
                            <button
                              type="button"
                              className="mon-pub-auth__btn"
                              onClick={() => void cancelSub(row.wallet)}
                            >
                              Cancel
                            </button>
                          ) : null}
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
              {subMsg ? <p className="mon-pub-auth__hint">{subMsg}</p> : null}
            </div>
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
