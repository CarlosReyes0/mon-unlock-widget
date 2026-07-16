import { useEffect, useMemo, useState } from "react";
import { usePrivy, useWallets } from "@privy-io/react-auth";

export type PublisherAuthDetail = {
  address: string;
  source: "privy" | "wallet";
};

declare global {
  interface Window {
    __monPublisherProvider?: unknown;
    __monPublisherAddress?: string;
    __monPublisherReady?: boolean;
    MonPublisherAuth?: {
      getAddress: () => string | null;
      getProvider: () => unknown;
      logout: () => Promise<void>;
    };
  }
}

function shortAddr(addr: string) {
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

function pickWallet(wallets: ReturnType<typeof useWallets>["wallets"]) {
  if (!wallets.length) return null;
  return (
    wallets.find((w) => w.walletClientType === "privy") ||
    wallets.find((w) => w.walletClientType === "metamask") ||
    wallets[0]
  );
}

type Props = {
  /** Compact mount inside generator/dashboard */
  variant?: "inline" | "page";
  onReadyChange?: (ready: boolean) => void;
};

export function PublisherAuth({ variant = "inline", onReadyChange }: Props) {
  const { ready, authenticated, login, logout, user } = usePrivy();
  const { wallets } = useWallets();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [address, setAddress] = useState<string | null>(null);

  const activeWallet = useMemo(() => pickWallet(wallets), [wallets]);
  const email = user?.email?.address || user?.google?.email || null;

  useEffect(() => {
    let cancelled = false;

    async function syncProvider() {
      if (!authenticated || !activeWallet) {
        window.__monPublisherProvider = undefined;
        window.__monPublisherAddress = undefined;
        window.__monPublisherReady = false;
        setAddress(null);
        onReadyChange?.(false);
        window.dispatchEvent(new CustomEvent("mon-publisher-auth", { detail: null }));
        return;
      }

      try {
        const provider = await activeWallet.getEthereumProvider();
        if (cancelled) return;
        const addr = activeWallet.address;
        window.__monPublisherProvider = provider;
        window.__monPublisherAddress = addr;
        window.__monPublisherReady = true;
        setAddress(addr);
        onReadyChange?.(true);
        const detail: PublisherAuthDetail = {
          address: addr,
          source: activeWallet.walletClientType === "privy" ? "privy" : "wallet",
        };
        window.dispatchEvent(new CustomEvent("mon-publisher-auth", { detail }));
      } catch (e) {
        if (cancelled) return;
        const msg = e instanceof Error ? e.message : "Failed to load wallet provider";
        setError(msg);
      }
    }

    void syncProvider();
    return () => {
      cancelled = true;
    };
  }, [authenticated, activeWallet, onReadyChange]);

  useEffect(() => {
    window.MonPublisherAuth = {
      getAddress: () => window.__monPublisherAddress || null,
      getProvider: () => window.__monPublisherProvider,
      logout: async () => {
        await logout();
      },
    };
  }, [logout]);

  async function startLogin(method?: "email" | "google" | "wallet") {
    setError("");
    setBusy(true);
    try {
      if (method === "email") {
        await login({ loginMethods: ["email"] });
      } else if (method === "google") {
        await login({ loginMethods: ["google"] });
      } else if (method === "wallet") {
        await login({ loginMethods: ["wallet"] });
      } else {
        await login();
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Sign-in failed";
      // User closed modal — not an error worth shouting.
      if (!/exited|closed|cancelled|canceled/i.test(msg)) setError(msg);
    } finally {
      setBusy(false);
    }
  }

  async function signOut() {
    setBusy(true);
    setError("");
    try {
      await logout();
    } finally {
      setBusy(false);
    }
  }

  if (!ready) {
    return (
      <div className="mon-pub-auth">
        <p className="mon-pub-auth__status">Loading sign-in…</p>
      </div>
    );
  }

  if (authenticated && address) {
    return (
      <div className="mon-pub-auth">
        <div className="mon-pub-auth__row">
          <p className="mon-pub-auth__status">
            Signed in{email ? ` as ${email}` : ""} · <strong>{shortAddr(address)}</strong>
          </p>
          <button type="button" className="mon-pub-auth__btn" disabled={busy} onClick={() => void signOut()}>
            Sign out
          </button>
        </div>
        {variant === "page" ? (
          <p className="mon-pub-auth__hint">
            This wallet receives on-chain MON and is the publisher identity for your embeds. Set up Stripe
            payouts from the dashboard to receive fiat unlocks.
          </p>
        ) : (
          <p className="mon-pub-auth__hint">Email/Google creates an embedded wallet — no MetaMask required.</p>
        )}
        {error ? <p className="mon-pub-auth__error">{error}</p> : null}
      </div>
    );
  }

  return (
    <div className="mon-pub-auth">
      <div className="mon-pub-auth__row">
        <button
          type="button"
          className="mon-pub-auth__btn mon-pub-auth__btn--primary"
          disabled={busy}
          onClick={() => void startLogin("email")}
        >
          Continue with email
        </button>
        <button type="button" className="mon-pub-auth__btn" disabled={busy} onClick={() => void startLogin("google")}>
          Continue with Google
        </button>
        <button type="button" className="mon-pub-auth__btn" disabled={busy} onClick={() => void startLogin("wallet")}>
          Connect wallet
        </button>
      </div>
      <p className="mon-pub-auth__hint">
        Create a publisher account with email or Google (embedded wallet), or connect MetaMask / another wallet.
      </p>
      {error ? <p className="mon-pub-auth__error">{error}</p> : null}
    </div>
  );
}
