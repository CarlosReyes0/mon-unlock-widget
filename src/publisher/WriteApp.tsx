import { useCallback, useEffect, useState } from "react";
import { PublisherAuth } from "./PublisherAuth.js";
import { SiteNav } from "./SiteNav.js";
import { publishPost } from "./publish-post.js";
import type { Eip1193Provider } from "../core/wallet.js";
import type { Address } from "viem";

const DRAFT_KEY = "openpaywall-write-draft";

function loadDraft(): { title: string; body: string } {
  try {
    const raw = localStorage.getItem(DRAFT_KEY);
    if (!raw) return { title: "", body: "" };
    const parsed = JSON.parse(raw) as { title?: string; body?: string };
    return { title: String(parsed.title || ""), body: String(parsed.body || "") };
  } catch {
    return { title: "", body: "" };
  }
}

type WriteAuth = "privy" | "injected";

export function WriteApp({ auth = "privy" }: { auth?: WriteAuth }) {
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [signedIn, setSignedIn] = useState(false);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [draftNote, setDraftNote] = useState("");

  useEffect(() => {
    const d = loadDraft();
    setTitle(d.title);
    setBody(d.body);
    requestAnimationFrame(() => {
      const el = document.getElementById("writeTitle") as HTMLTextAreaElement | null;
      if (!el) return;
      el.style.height = "auto";
      el.style.height = `${el.scrollHeight}px`;
    });
  }, []);

  useEffect(() => {
    const t = window.setTimeout(() => {
      try {
        localStorage.setItem(DRAFT_KEY, JSON.stringify({ title, body }));
        if (title.trim() || body.trim()) setDraftNote("Draft saved.");
      } catch {
        /* ignore quota */
      }
    }, 400);
    return () => window.clearTimeout(t);
  }, [title, body]);

  const onReadyChange = useCallback((ready: boolean) => {
    setSignedIn(ready);
  }, []);

  async function connectInjected() {
    setError("");
    const eth = (window as { ethereum?: Eip1193Provider }).ethereum;
    if (!eth) {
      setError("Install MetaMask, or sign in with email on the live site.");
      return;
    }
    try {
      const accounts = (await eth.request({ method: "eth_requestAccounts" })) as string[];
      const addr = accounts?.[0];
      if (!addr) {
        setError("No wallet account.");
        return;
      }
      window.__monPublisherProvider = eth;
      window.__monPublisherAddress = addr;
      window.__monPublisherReady = true;
      setSignedIn(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not connect wallet.");
    }
  }

  async function onPublish() {
    setError("");
    if (!title.trim() || !body.trim()) {
      setError("Add a title and the piece.");
      return;
    }
    if (!signedIn || !window.__monPublisherAddress || !window.__monPublisherProvider) {
      setError("Sign in to publish.");
      return;
    }
    setBusy(true);
    setStatus("Publishing…");
    try {
      const { slug } = await publishPost({
        title,
        rawBody: body,
        author: "Author",
        publisher: window.__monPublisherAddress as Address,
        provider: window.__monPublisherProvider as Eip1193Provider,
        onStatus: setStatus,
      });
      try {
        localStorage.removeItem(DRAFT_KEY);
      } catch {
        /* ignore */
      }
      window.location.assign(`/articles/${encodeURIComponent(slug)}`);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Could not publish.";
      if (!/reject|denied|cancel/i.test(msg)) setError(msg);
      else setError("Publish cancelled.");
      setStatus("");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mon-write">
      <header className="mon-write__bar">
        <SiteNav />
        <button
          type="button"
          className="mon-pub-auth__btn mon-pub-auth__btn--primary mon-write__publish"
          disabled={busy}
          onClick={() => void onPublish()}
        >
          {busy ? "Publishing…" : "Publish"}
        </button>
      </header>

      <div className="mon-write__page">
        <div className="mon-write__auth">
          {auth === "privy" ? (
            <PublisherAuth variant="inline" onReadyChange={onReadyChange} />
          ) : signedIn ? (
            <div className="mon-pub-auth">
              <div className="mon-pub-auth__row">
                <p className="mon-pub-auth__status">Wallet connected. Ready to publish.</p>
                <button
                  type="button"
                  className="mon-pub-auth__btn"
                  onClick={() => {
                    window.__monPublisherProvider = undefined;
                    window.__monPublisherAddress = undefined;
                    window.__monPublisherReady = false;
                    setSignedIn(false);
                    setError("");
                  }}
                >
                  Sign out
                </button>
              </div>
            </div>
          ) : (
            <div className="mon-pub-auth">
              <button type="button" className="mon-pub-auth__btn" onClick={() => void connectInjected()}>
                Connect wallet
              </button>
              <p className="mon-pub-auth__hint">Email / Google needs a Privy app id. Wallet still works.</p>
            </div>
          )}
        </div>
        {error ? <p className="mon-pub-auth__error">{error}</p> : null}
        {status ? <p className="mon-write__status">{status}</p> : null}

        <label className="mon-write__sr" htmlFor="writeTitle">
          Title
        </label>
        <textarea
          id="writeTitle"
          className="mon-write__title"
          rows={1}
          placeholder="Title"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onInput={(e) => {
            const el = e.currentTarget;
            el.style.height = "auto";
            el.style.height = `${el.scrollHeight}px`;
          }}
        />
        <label className="mon-write__sr" htmlFor="writeBody">
          Body
        </label>
        <textarea
          id="writeBody"
          className="mon-write__body"
          placeholder="Write, or paste…"
          value={body}
          onChange={(e) => setBody(e.target.value)}
        />
        <p className="mon-write__draft">{draftNote}</p>
      </div>
    </div>
  );
}
