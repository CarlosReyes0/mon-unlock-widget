import { useEffect, useMemo, useState } from "react";
import {
  useCreateWallet,
  useLoginWithOAuth,
  useModalStatus,
  usePrivy,
  useWallets,
} from "@privy-io/react-auth";

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

function isMobileDevice() {
  if (typeof navigator === "undefined") return false;
  return /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
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
  const { ready, authenticated, login, logout, connectWallet, user } = usePrivy();
  const { wallets } = useWallets();
  const { createWallet } = useCreateWallet();
  const { initOAuth } = useLoginWithOAuth();
  const { isOpen: modalOpen } = useModalStatus();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [address, setAddress] = useState<string | null>(null);
  const [walletSetup, setWalletSetup] = useState(false);

  const activeWallet = useMemo(() => pickWallet(wallets), [wallets]);
  const email = user?.email?.address || user?.google?.email || null;
  const actionBusy = busy || modalOpen || walletSetup;

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

  // Email/Google sign-in can finish before the embedded wallet is ready — create it explicitly.
  useEffect(() => {
    if (!ready || !authenticated || activeWallet) return;

    let cancelled = false;
    setWalletSetup(true);
    setError("");

    void (async () => {
      try {
        await createWallet();
      } catch (e) {
        if (cancelled) return;
        const msg = e instanceof Error ? e.message : "Failed to create wallet";
        if (!/already has|already exists/i.test(msg)) setError(msg);
      } finally {
        if (!cancelled) setWalletSetup(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [ready, authenticated, activeWallet, createWallet]);

  useEffect(() => {
    window.MonPublisherAuth = {
      getAddress: () => window.__monPublisherAddress || null,
      getProvider: () => window.__monPublisherProvider,
      logout: async () => {
        await logout();
      },
    };
  }, [logout]);

  async function startEmailLogin() {
    setError("");
    setBusy(true);
    try {
      login({ loginMethods: ["email"] });
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Sign-in failed";
      if (!/exited|closed|cancelled|canceled/i.test(msg)) setError(msg);
    } finally {
      setBusy(false);
    }
  }

  async function startGoogleLogin() {
    setError("");
    setBusy(true);
    try {
      // Redirect-based OAuth works reliably on iOS Safari; the modal popup often does not.
      if (isMobileDevice()) {
        await initOAuth({ provider: "google" });
      } else {
        login({ loginMethods: ["google"] });
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Google sign-in failed";
      if (!/exited|closed|cancelled|canceled/i.test(msg)) setError(msg);
    } finally {
      setBusy(false);
    }
  }

  function startWalletLogin() {
    setError("");
    setBusy(true);
    try {
      if (authenticated) {
        connectWallet();
      } else {
        login({ loginMethods: ["wallet"] });
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Wallet connection failed";
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

  if (authenticated && !address) {
    return (
      <div className="mon-pub-auth">
        <p className="mon-pub-auth__status">Finishing sign-in…</p>
        {email ? <p className="mon-pub-auth__hint">Signed in as {email}</p> : null}
        {error ? <p className="mon-pub-auth__error">{error}</p> : null}
        <div className="mon-pub-auth__row" style={{ marginTop: "0.75rem" }}>
          <button type="button" className="mon-pub-auth__btn" disabled={actionBusy} onClick={() => void signOut()}>
            Sign out
          </button>
        </div>
      </div>
    );
  }

  if (authenticated && address) {
    return (
      <div className="mon-pub-auth">
        <div className="mon-pub-auth__row">
          <p className="mon-pub-auth__status">
            {email ? email : variant === "page" ? "Signed in" : `Signed in · ${shortAddr(address)}`}
          </p>
          <button type="button" className="mon-pub-auth__btn" disabled={actionBusy} onClick={() => void signOut()}>
            Sign out
          </button>
        </div>
        {variant !== "page" ? (
          <p className="mon-pub-auth__hint">Ready to publish.</p>
        ) : null}
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
          disabled={actionBusy}
          onClick={() => void startEmailLogin()}
        >
          Continue with email
        </button>
        <button
          type="button"
          className="mon-pub-auth__btn"
          disabled={actionBusy}
          onClick={() => void startGoogleLogin()}
        >
          Continue with Google
        </button>
        <button type="button" className="mon-pub-auth__btn" disabled={actionBusy} onClick={startWalletLogin}>
          Connect wallet
        </button>
      </div>
      <p className="mon-pub-auth__hint">Email or Google. No password.</p>
      {error ? <p className="mon-pub-auth__error">{error}</p> : null}
    </div>
  );
}
