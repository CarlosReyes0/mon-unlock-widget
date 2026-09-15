import { useEffect, useMemo, useRef, useState } from "react";
import {
  useCreateWallet,
  useLoginWithOAuth,
  useModalStatus,
  usePrivy,
  useWallets,
} from "@privy-io/react-auth";
import { monadMainnet } from "../core/chains.js";
import {
  mapWalletSendToEthSend,
  newestExternalWalletAddress,
  pickPublisherWallet,
  type Eip1193Provider,
} from "../core/wallet.js";

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

const PREFERRED_WALLET_KEY = "mon-publisher-preferred-wallet";

function readPreferredWallet(): string | null {
  try {
    return sessionStorage.getItem(PREFERRED_WALLET_KEY);
  } catch {
    return null;
  }
}

function writePreferredWallet(addr: string | null) {
  try {
    if (addr) sessionStorage.setItem(PREFERRED_WALLET_KEY, addr);
    else sessionStorage.removeItem(PREFERRED_WALLET_KEY);
  } catch {
    /* ignore quota / private mode */
  }
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
  const [signingOut, setSigningOut] = useState(false);
  const [preferredWallet, setPreferredWallet] = useState<string | null>(() => readPreferredWallet());
  const skipWalletCreateRef = useRef(false);
  const seenWalletAddrsRef = useRef<string[]>([]);

  const activeWallet = useMemo(
    () => pickPublisherWallet(wallets, preferredWallet),
    [wallets, preferredWallet]
  );
  const email = user?.email?.address || user?.google?.email || null;
  const wantsEmbeddedWallet = Boolean(user?.email?.address || user?.google);
  const signInBusy = busy || modalOpen || walletSetup;

  function choosePreferredWallet(addr: string | null) {
    setPreferredWallet(addr);
    writePreferredWallet(addr);
  }

  useEffect(() => {
    const added = newestExternalWalletAddress(seenWalletAddrsRef.current, wallets);
    seenWalletAddrsRef.current = wallets.map((w) => w.address);
    if (added) choosePreferredWallet(added);
  }, [wallets]);

  useEffect(() => {
    if (!preferredWallet && activeWallet && activeWallet.walletClientType !== "privy") {
      choosePreferredWallet(activeWallet.address);
    }
  }, [preferredWallet, activeWallet]);

  useEffect(() => {
    let cancelled = false;

    async function syncProvider() {
      if (skipWalletCreateRef.current) return;
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
        try {
          await activeWallet.switchChain(monadMainnet.id);
        } catch {
          /* publish-post will retry wallet_switchEthereumChain */
        }
        const provider = await activeWallet.getEthereumProvider();
        if (cancelled) return;
        const addr = activeWallet.address;
        window.__monPublisherProvider = mapWalletSendToEthSend(provider as Eip1193Provider);
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
    if (!authenticated) {
      skipWalletCreateRef.current = false;
      setSigningOut(false);
      seenWalletAddrsRef.current = [];
    }
  }, [authenticated]);

  // Email/Google sign-in can finish before the embedded wallet is ready — create it explicitly.
  // Do not create an embedded wallet for Connect-wallet logins; that would steal the publisher address.
  useEffect(() => {
    if (
      !ready ||
      !authenticated ||
      activeWallet ||
      skipWalletCreateRef.current ||
      !wantsEmbeddedWallet
    ) {
      setWalletSetup(false);
      return;
    }

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
        setWalletSetup(false);
      }
    })();

    return () => {
      cancelled = true;
      setWalletSetup(false);
    };
  }, [ready, authenticated, activeWallet, createWallet, wantsEmbeddedWallet]);

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

  function clearPublisherSession() {
    if (typeof window === "undefined") return;
    window.__monPublisherProvider = undefined;
    window.__monPublisherAddress = undefined;
    window.__monPublisherReady = false;
    window.dispatchEvent(new CustomEvent("mon-publisher-auth", { detail: null }));
  }

  async function signOut() {
    skipWalletCreateRef.current = true;
    setSigningOut(true);
    setBusy(true);
    setError("");
    setAddress(null);
    choosePreferredWallet(null);
    clearPublisherSession();
    onReadyChange?.(false);
    try {
      await logout();
    } catch (e) {
      skipWalletCreateRef.current = false;
      setSigningOut(false);
      const msg = e instanceof Error ? e.message : "Sign out failed";
      setError(msg);
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

  if (authenticated && !signingOut && !address) {
    return (
      <div className="mon-pub-auth">
        <p className="mon-pub-auth__status">Finishing sign-in…</p>
        {email ? <p className="mon-pub-auth__hint">Signed in as {email}</p> : null}
        {error ? <p className="mon-pub-auth__error">{error}</p> : null}
        <div className="mon-pub-auth__row" style={{ marginTop: "0.75rem" }}>
          {!wantsEmbeddedWallet ? (
            <button type="button" className="mon-pub-auth__btn" disabled={signInBusy} onClick={startWalletLogin}>
              Connect wallet
            </button>
          ) : null}
          <button type="button" className="mon-pub-auth__btn" disabled={busy} onClick={() => void signOut()}>
            Sign out
          </button>
        </div>
      </div>
    );
  }

  if (authenticated && !signingOut && address) {
    return (
      <div className="mon-pub-auth">
        <div className="mon-pub-auth__row">
          <p className="mon-pub-auth__status">
            {variant === "page" ? email || "Signed in" : `Signed in · ${shortAddr(address)}`}
          </p>
          <button type="button" className="mon-pub-auth__btn" disabled={signInBusy} onClick={startWalletLogin}>
            Use a different wallet
          </button>
          <button type="button" className="mon-pub-auth__btn" disabled={busy} onClick={() => void signOut()}>
            Sign out
          </button>
        </div>
        {variant !== "page" ? (
          <p className="mon-pub-auth__hint">
            Publishing from {shortAddr(address)}. Connect the wallet you funded if this is not it.
          </p>
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
          disabled={signInBusy}
          onClick={() => void startEmailLogin()}
        >
          Continue with email
        </button>
        <button
          type="button"
          className="mon-pub-auth__btn"
          disabled={signInBusy}
          onClick={() => void startGoogleLogin()}
        >
          Continue with Google
        </button>
        <button type="button" className="mon-pub-auth__btn" disabled={signInBusy} onClick={startWalletLogin}>
          Connect wallet
        </button>
      </div>
      <p className="mon-pub-auth__hint">Email or Google. No password.</p>
      {error ? <p className="mon-pub-auth__error">{error}</p> : null}
    </div>
  );
}
