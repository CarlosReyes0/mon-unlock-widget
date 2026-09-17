import { useCallback, useEffect, useImperativeHandle, useLayoutEffect, useRef, useState } from "react";
import { locatePaywall } from "../core/split-post.js";
import { snippetFromPastedText } from "../core/media-url.js";
import { PublisherAuth } from "./PublisherAuth.js";
import { SiteNav } from "./SiteNav.js";
import { insertAtTextareaCursor, WriteMediaSheet } from "./WriteMediaSheet.js";
import { MirosharkPreview } from "./MirosharkPreview.js";
import { publishPost } from "./publish-post.js";
import { mapWalletSendToEthSend, type Eip1193Provider } from "../core/wallet.js";
import type { Address } from "viem";

const DRAFT_KEY = "openpaywall-write-draft";

function loadDraft(): { title: string; body: string; reservedSlug: string } {
  try {
    const raw = localStorage.getItem(DRAFT_KEY);
    if (!raw) return { title: "", body: "", reservedSlug: "" };
    const parsed = JSON.parse(raw) as { title?: string; body?: string; reservedSlug?: string };
    return {
      title: String(parsed.title || ""),
      body: String(parsed.body || ""),
      reservedSlug: String(parsed.reservedSlug || ""),
    };
  } catch {
    return { title: "", body: "", reservedSlug: "" };
  }
}

type WriteAuth = "privy" | "injected";

function clipboardHasBinaryMedia(data: DataTransfer | null): boolean {
  if (!data) return false;
  const files = Array.from(data.files || []);
  if (files.some((f) => /^(image|video|audio)\//.test(f.type))) return true;
  return Array.from(data.items || []).some(
    (item) => item.kind === "file" && /^(image|video|audio)\//.test(item.type)
  );
}

export type WriteBodyHandle = {
  insertSnippet: (snippet: string, note: string) => void;
};

const WriteBody = function WriteBody({
  value,
  onChange,
  onMediaNote,
  bodyRef,
}: {
  value: string;
  onChange: (next: string) => void;
  onMediaNote: (note: string) => void;
  bodyRef: React.RefObject<WriteBodyHandle | null>;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const areaRef = useRef<HTMLTextAreaElement>(null);
  const measureRef = useRef<HTMLDivElement>(null);
  const [foldTop, setFoldTop] = useState<number | null>(null);
  const source = value.replace(/\r\n/g, "\n");
  const fold = locatePaywall(source);

  const layout = useCallback(() => {
    const area = areaRef.current;
    if (!area) return;
    area.style.height = "auto";
    area.style.height = `${area.scrollHeight}px`;

    const measure = measureRef.current;
    if (measure) {
      const cs = window.getComputedStyle(area);
      measure.style.width = `${area.clientWidth}px`;
      measure.style.font = cs.font;
      measure.style.fontSize = cs.fontSize;
      measure.style.lineHeight = cs.lineHeight;
      measure.style.letterSpacing = cs.letterSpacing;
      measure.style.padding = cs.padding;
    }
    const anchor = measure?.querySelector("[data-fold-anchor]") as HTMLElement | null;
    if (!fold.hasFold || !anchor) {
      setFoldTop(null);
      return;
    }
    setFoldTop(anchor.offsetTop);
  }, [fold.hasFold, source]);

  useLayoutEffect(() => {
    layout();
  }, [layout]);

  useEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => layout());
    ro.observe(wrap);
    return () => ro.disconnect();
  }, [layout]);

  const insertSnippet = useCallback(
    (snippet: string, note: string) => {
      const area = areaRef.current;
      if (!area) {
        onChange(`${value.replace(/\s+$/, "")}\n${snippet.trim()}\n`);
        onMediaNote(note);
        return;
      }
      const { next, cursor } = insertAtTextareaCursor(area, value, snippet);
      onChange(next);
      onMediaNote(note);
      requestAnimationFrame(() => {
        area.focus();
        area.setSelectionRange(cursor, cursor);
      });
    },
    [onChange, onMediaNote, value]
  );

  useImperativeHandle(bodyRef, () => ({ insertSnippet }), [insertSnippet, bodyRef]);

  function onPaste(e: React.ClipboardEvent<HTMLTextAreaElement>) {
    if (clipboardHasBinaryMedia(e.clipboardData)) {
      e.preventDefault();
      onMediaNote("We don’t host files yet. Paste a public image, audio, or video URL.");
      return;
    }
    const text = e.clipboardData.getData("text/plain");
    const snippet = snippetFromPastedText(text);
    if (!snippet) return;
    e.preventDefault();
    insertSnippet(snippet, "Embedded from URL.");
  }

  function onDrop(e: React.DragEvent<HTMLTextAreaElement>) {
    if (clipboardHasBinaryMedia(e.dataTransfer)) {
      e.preventDefault();
      onMediaNote("We don’t host files yet. Drop a public URL instead.");
      return;
    }
    const text = e.dataTransfer.getData("text/uri-list") || e.dataTransfer.getData("text/plain");
    const snippet = snippetFromPastedText(text);
    if (!snippet) return;
    e.preventDefault();
    insertSnippet(snippet, "Embedded from URL.");
  }

  return (
    <div className="mon-write__body-wrap" ref={wrapRef}>
      <textarea
        id="writeBody"
        ref={areaRef}
        className="mon-write__body"
        placeholder="Write, or paste a photo, audio, or video URL…"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onPaste={onPaste}
        onDragOver={(e) => {
          if (e.dataTransfer?.types.includes("text/uri-list") || e.dataTransfer?.types.includes("Files")) {
            e.preventDefault();
          }
        }}
        onDrop={onDrop}
      />
      {fold.hasFold ? (
        <div className="mon-write__fold-measure" ref={measureRef} aria-hidden="true">
          {source.slice(0, fold.paidStart)}
          <span data-fold-anchor="" />
          {source.slice(fold.paidStart)}
        </div>
      ) : null}
      {fold.hasFold && foldTop != null ? (
        <div className="mon-write__fold" style={{ top: foldTop }}>
          <span>Free above · paid below</span>
        </div>
      ) : null}
    </div>
  );
}

export function WriteApp({ auth = "privy" }: { auth?: WriteAuth }) {
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [reservedSlug, setReservedSlug] = useState("");
  const [draftReady, setDraftReady] = useState(false);
  const [signedIn, setSignedIn] = useState(false);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [draftNote, setDraftNote] = useState("");
  const [mediaNote, setMediaNote] = useState("");
  const [mediaOpen, setMediaOpen] = useState(false);
  const bodyHandleRef = useRef<WriteBodyHandle | null>(null);

  useEffect(() => {
    const d = loadDraft();
    setTitle(d.title);
    setBody(d.body);
    setReservedSlug(d.reservedSlug);
    setDraftReady(true);
    requestAnimationFrame(() => {
      const el = document.getElementById("writeTitle") as HTMLTextAreaElement | null;
      if (!el) return;
      el.style.height = "auto";
      el.style.height = `${el.scrollHeight}px`;
    });
  }, []);

  useEffect(() => {
    if (!draftReady) return;
    const t = window.setTimeout(() => {
      try {
        localStorage.setItem(DRAFT_KEY, JSON.stringify({ title, body, reservedSlug }));
        if (title.trim() || body.trim()) setDraftNote("Draft saved.");
      } catch {
        /* ignore quota */
      }
    }, 400);
    return () => window.clearTimeout(t);
  }, [title, body, reservedSlug, draftReady]);

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
      window.__monPublisherProvider = mapWalletSendToEthSend(eth);
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
        preferredSlug: reservedSlug,
        onStatus: setStatus,
        onSlugReserved: setReservedSlug,
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
        <div className="mon-write__media-row">
          <button
            type="button"
            className="mon-write__media-btn"
            onClick={() => setMediaOpen(true)}
          >
            Add image, audio, or video
          </button>
          <span className="mon-write__media-hint">
            Or paste a public URL. Media above the fold is free.
          </span>
        </div>
        <WriteBody
          value={body}
          onChange={setBody}
          onMediaNote={setMediaNote}
          bodyRef={bodyHandleRef}
        />
        <p className="mon-write__draft">{mediaNote || draftNote}</p>
        <MirosharkPreview title={title} body={body} />
      </div>
      <WriteMediaSheet
        open={mediaOpen}
        onClose={() => setMediaOpen(false)}
        onInsert={(snippet) => {
          bodyHandleRef.current?.insertSnippet(snippet, "Media added.");
        }}
      />
    </div>
  );
}
