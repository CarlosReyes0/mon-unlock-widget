/**
 * Lazy sign-in for Follow on pages that do not load the account app.
 * Reuses the /account Privy email + embedded wallet flow. WalletConnect is the
 * fallback when Privy is not configured or fails to load, and is also one of
 * Privy's login methods ("Connect wallet").
 */
import { Component, useEffect, useRef, useState, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { PrivyProvider, usePrivy, useWallets } from "@privy-io/react-auth";
import { WalletManager, type Eip1193Provider } from "../core/wallet.js";
import { WALLETCONNECT_PROJECT_ID } from "../core/walletconnect.js";
import { PublisherAuth } from "./PublisherAuth.js";
import { publisherPrivyConfig } from "./privy-config.js";
import "./publisher-auth.css";

export type FollowerWallet = {
  address: string;
  provider: Eip1193Provider;
  release: () => void;
};

type AuthDetail = { address?: string } | null;

function privyAppId() {
  return String(import.meta.env.VITE_PRIVY_APP_ID || "").trim();
}

function cancelError() {
  const err = new Error("Sign-in was cancelled.");
  (err as Error & { code: string }).code = "signin_cancelled";
  return err;
}

function noWalletError() {
  const err = new Error("no_wallet");
  (err as Error & { code: string }).code = "no_wallet";
  return err;
}

function publisherProvider() {
  return (window as Window & { __monPublisherProvider?: Eip1193Provider }).__monPublisherProvider;
}

function publisherAddress() {
  return (window as Window & { __monPublisherAddress?: string }).__monPublisherAddress || "";
}

function ensureAuthCss() {
  if (document.querySelector("link[data-opw-auth-css]")) return;
  const link = document.createElement("link");
  link.rel = "stylesheet";
  link.href = "/publisher-auth.css";
  link.dataset.opwAuthCss = "1";
  document.head.appendChild(link);
}

function ensureCss() {
  ensureAuthCss();
  if (document.getElementById("opw-signin-css")) return;
  const style = document.createElement("style");
  style.id = "opw-signin-css";
  style.textContent = `
    .opw-signin {
      position: absolute; inset: 0; z-index: 1;
      display: flex; align-items: flex-end; justify-content: center;
      box-sizing: border-box; pointer-events: auto;
      padding: 0;
      background: rgba(17, 24, 39, 0.45);
      overflow: hidden;
    }
    .opw-signin[hidden] { display: none !important; }
    .opw-signin__card {
      width: 100%; max-width: 24rem; min-width: 0;
      box-sizing: border-box; margin: 0 auto;
      max-height: min(85dvh, 100%); overflow: auto;
      background: #fff; color: #1c1917;
      border-radius: 16px 16px 0 0;
      padding:
        1rem
        max(1rem, env(safe-area-inset-right))
        max(1rem, env(safe-area-inset-bottom))
        max(1rem, env(safe-area-inset-left));
      box-shadow: 0 16px 48px rgba(0, 0, 0, 0.2);
    }
    .opw-signin__title, .opw-signin__copy, .opw-signin__hint {
      overflow-wrap: anywhere; min-width: 0;
    }
    .opw-signin__title { margin: 0 0 0.35rem; font-size: 1.05rem; font-weight: 650; }
    .opw-signin__copy, .opw-signin__hint { margin: 0 0 0.75rem; font-size: 0.85rem; color: #57534e; }
    .opw-signin__error { margin: 0.6rem 0 0; font-size: 0.85rem; color: #b91c1c; }
    .opw-signin__cancel {
      margin-top: 0.75rem; border: 0; background: transparent; color: #57534e;
      font: inherit; font-size: 0.85rem; cursor: pointer; padding: 0.35rem 0;
    }
    .opw-signin .mon-pub-auth__row { display: flex; flex-direction: column; gap: 0.5rem; min-width: 0; }
    .opw-signin .mon-pub-auth__btn {
      appearance: none; display: block; width: 100%; min-width: 0; max-width: 100%; box-sizing: border-box;
      min-height: 2.75rem; border-radius: 9999px; border: 1px solid #e7e5e4;
      background: #fff; color: #1c1917; font: inherit; font-size: 0.9rem;
      font-weight: 600; padding: 0.65rem 1rem; cursor: pointer;
    }
    .opw-signin .mon-pub-auth__btn--primary {
      color: #fff; background: #5b21b6; border-color: transparent;
    }
  `;
  document.head.appendChild(style);
}

class SignInBoundary extends Component<{ children: ReactNode; onError: () => void }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch() {
    this.props.onError();
  }

  render() {
    if (this.state.failed) return null;
    return this.props.children;
  }
}

function SignInDialog({
  usePrivyUi,
  hidden,
  onConnected,
  onCancel,
}: {
  usePrivyUi: boolean;
  hidden: boolean;
  onConnected: (address: string, provider: Eip1193Provider) => void;
  onCancel: () => void;
}) {
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [privyDown, setPrivyDown] = useState(false);
  const onConnectedRef = useRef(onConnected);
  const onCancelRef = useRef(onCancel);
  onConnectedRef.current = onConnected;
  onCancelRef.current = onCancel;

  useEffect(() => {
    function onAuth(event: Event) {
      const detail = (event as CustomEvent<AuthDetail>).detail;
      const address = detail && detail.address;
      const provider = publisherProvider();
      if (!address || !provider) return;
      onConnectedRef.current(address, provider);
    }
    window.addEventListener("mon-publisher-auth", onAuth);
    return () => window.removeEventListener("mon-publisher-auth", onAuth);
  }, []);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") onCancelRef.current();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  async function connectWalletConnect() {
    setBusy(true);
    setError("");
    try {
      const manager = new WalletManager();
      manager.setWalletConnectProjectId(WALLETCONNECT_PROJECT_ID);
      const state = await manager.connect();
      const provider = manager.getProvider();
      if (!state.address || !provider) throw noWalletError();
      onConnectedRef.current(state.address, provider);
    } catch (err) {
      console.error(err);
      const code = err && typeof err === "object" && "code" in err ? String((err as { code?: unknown }).code || "") : "";
      const message = err instanceof Error ? err.message : "";
      const text = `${message} ${code}`;
      if (/reject|cancel|denied|closed/i.test(text)) setError("Sign-in was cancelled.");
      else if (code === "no_wallet" || message === "no_wallet") setError("No wallet found in this browser.");
      else setError(message ? `Sign-in couldn't load: ${message}` : "No wallet found in this browser.");
    } finally {
      setBusy(false);
    }
  }

  const showPrivy = usePrivyUi && !privyDown;

  return (
    <div
      className="opw-signin"
      role="dialog"
      aria-modal="true"
      aria-label="Sign in to follow"
      hidden={hidden}
      onClick={(event) => {
        if (event.target === event.currentTarget) onCancelRef.current();
      }}
    >
      <div className="opw-signin__card">
        <p className="opw-signin__title">Sign in to follow</p>
        <p className="opw-signin__copy">
          Email creates a wallet in this browser. You can also connect a wallet you already have.
        </p>
        {showPrivy ? (
          <SignInBoundary onError={() => setPrivyDown(true)}>
            <PublisherAuth variant="inline" />
          </SignInBoundary>
        ) : (
          <button
            type="button"
            className="mon-pub-auth__btn mon-pub-auth__btn--primary"
            disabled={busy}
            onClick={() => void connectWalletConnect()}
          >
            {busy ? "Waiting for wallet…" : "Connect wallet"}
          </button>
        )}
        {error ? (
          <p className="opw-signin__error" role="alert">
            {error}
          </p>
        ) : null}
        <button type="button" className="opw-signin__cancel" onClick={() => onCancelRef.current()}>
          Cancel
        </button>
      </div>
    </div>
  );
}

function Peek({ onAddress }: { onAddress: (address: string) => void }) {
  const { ready, authenticated } = usePrivy();
  const { wallets } = useWallets();
  const onAddressRef = useRef(onAddress);
  onAddressRef.current = onAddress;

  useEffect(() => {
    if (!ready) return;
    if (!authenticated) {
      onAddressRef.current("");
      return;
    }
    const embedded = wallets.find((wallet) => wallet.address);
    const addr = publisherAddress() || embedded?.address || "";
    if (addr) onAddressRef.current(addr);
  }, [ready, authenticated, wallets]);

  return null;
}

type Mount = { root: Root; host: HTMLElement };

function mountNode(): Mount {
  ensureCss();
  const host = document.createElement("div");
  // Fixed viewport frame so the sheet is sized to the screen, not a wider page.
  host.style.cssText = "position:fixed;inset:0;z-index:40;overflow:hidden;transform:translateZ(0);pointer-events:none";
  document.body.appendChild(host);
  return { root: createRoot(host), host };
}

function unmountNode(node: Mount) {
  node.root.unmount();
  node.host.remove();
}

let inflight: Promise<FollowerWallet> | null = null;

function SignInHost({
  appId,
  onConnected,
  onCancel,
}: {
  appId: string;
  onConnected: (address: string, provider: Eip1193Provider) => void;
  onCancel: () => void;
}) {
  const [hidden, setHidden] = useState(false);
  const dialog = (
    <SignInDialog
      usePrivyUi={Boolean(appId)}
      hidden={hidden}
      onConnected={(address, provider) => {
        setHidden(true);
        onConnected(address, provider);
      }}
      onCancel={onCancel}
    />
  );
  if (!appId) return dialog;
  return (
    <PrivyProvider appId={appId} config={publisherPrivyConfig()}>
      {dialog}
    </PrivyProvider>
  );
}

function openSignIn(): Promise<FollowerWallet> {
  const appId = privyAppId();
  return new Promise((resolve, reject) => {
    const node = mountNode();
    let settled = false;
    let released = false;

    const cleanup = () => {
      if (released) return;
      released = true;
      unmountNode(node);
    };

    const finish = (address: string, provider: Eip1193Provider) => {
      if (settled) return;
      settled = true;
      resolve({
        address,
        provider,
        release() {
          cleanup();
        },
      });
    };

    const cancel = () => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(cancelError());
    };

    node.root.render(<SignInHost appId={appId} onConnected={finish} onCancel={cancel} />);
  });
}

/** Open the account sign-in (or WalletConnect) and keep the provider alive until release(). */
export function connectFollowerWallet(): Promise<FollowerWallet> {
  if (inflight) return inflight;
  inflight = openSignIn()
    .then((session) => ({
      ...session,
      release() {
        try {
          session.release();
        } finally {
          inflight = null;
        }
      },
    }))
    .catch((err) => {
      inflight = null;
      throw err;
    });
  return inflight;
}

/** Read an already signed-in Privy wallet without opening the dialog. */
export function peekFollowerWallet(): Promise<string> {
  const appId = privyAppId();
  if (!appId) return Promise.resolve(publisherAddress().toLowerCase());
  return new Promise((resolve) => {
    const node = mountNode();
    node.host.hidden = true;
    let done = false;
    const finish = (address: string) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      unmountNode(node);
      resolve(String(address || "").toLowerCase());
    };
    const timer = setTimeout(() => finish(""), 7000);
    node.root.render(
      <PrivyProvider appId={appId} config={publisherPrivyConfig()}>
        <Peek onAddress={finish} />
      </PrivyProvider>
    );
  });
}

// App builds drop unused entry exports. Follow loads this file by URL, so the
// API has to stay reachable as a side effect and as a named export.
if (typeof window !== "undefined") {
  (window as Window & {
    OpenPaywallFollowSignIn?: {
      connectFollowerWallet: typeof connectFollowerWallet;
      peekFollowerWallet: typeof peekFollowerWallet;
    };
  }).OpenPaywallFollowSignIn = {
    connectFollowerWallet,
    peekFollowerWallet,
  };
}
