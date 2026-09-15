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

export function WriteApp() {
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
          <PublisherAuth variant="inline" onReadyChange={onReadyChange} />
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
