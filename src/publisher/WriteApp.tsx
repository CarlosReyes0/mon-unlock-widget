import { useCallback, useEffect, useImperativeHandle, useLayoutEffect, useRef, useState } from "react";
import { locatePaywall } from "../core/split-post.js";
import { snippetFromPastedText } from "../core/media-url.js";
import {
  createWriteDraft,
  deleteWriteDraft,
  formatSavedAt,
  getActiveDraft,
  getWriteDraft,
  isDraftEmpty,
  listWriteDrafts,
  migrateLegacyWriteDraft,
  promptsForDay,
  saveWriteDraft,
  setActiveWriteDraft,
  wordCount,
  writeNudge,
  type WriteDraft,
  type WritePrompt,
} from "../core/write-drafts.js";
import { PublisherAuth } from "./PublisherAuth.js";
import { SiteNav } from "./SiteNav.js";
import { insertAtTextareaCursor, WriteMediaSheet } from "./WriteMediaSheet.js";
import { MirosharkPreview } from "./MirosharkPreview.js";
import { VoiceDrafts } from "./VoiceDrafts.js";
import { ArticleNftMint } from "./ArticleNftMint.js";
import { WriteDraftsPanel } from "./WriteDraftsPanel.js";
import { publishPost } from "./publish-post.js";
import { mapWalletSendToEthSend, type Eip1193Provider } from "../core/wallet.js";
import { fetchArticleNftConfig } from "../core/article-nft.js";
import type { Address } from "viem";

type WriteAuth = "privy" | "injected";

function clipboardHasBinaryMedia(data: DataTransfer | null): boolean {
  if (!data) return false;
  const files = Array.from(data.files || []);
  if (files.some((f) => /^(image|video|audio)\//.test(f.type))) return true;
  return Array.from(data.items || []).some(
    (item) => item.kind === "file" && /^(image|video|audio)\//.test(item.type)
  );
}

function draftQuery(): { draft?: string; newDraft: boolean } {
  if (typeof window === "undefined") return { newDraft: false };
  const q = new URLSearchParams(window.location.search);
  return {
    draft: q.get("draft") || undefined,
    newDraft: q.get("new") === "1",
  };
}

function syncDraftUrl(id: string) {
  if (typeof window === "undefined" || !id) return;
  const url = new URL(window.location.href);
  url.searchParams.set("draft", id);
  url.searchParams.delete("new");
  const next = `${url.pathname}?${url.searchParams.toString()}${url.hash}`;
  window.history.replaceState({}, "", next);
}

export type WriteBodyHandle = {
  insertSnippet: (snippet: string, note: string) => void;
  focus: () => void;
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

  useImperativeHandle(
    bodyRef,
    () => ({
      insertSnippet,
      focus: () => areaRef.current?.focus(),
    }),
    [insertSnippet, bodyRef]
  );

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
        onChange={(e) => onChange(e.currentTarget.value)}
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
};

export function WriteApp({ auth = "privy" }: { auth?: WriteAuth }) {
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [reservedSlug, setReservedSlug] = useState("");
  const [promptId, setPromptId] = useState("");
  const [draftId, setDraftId] = useState("");
  const [drafts, setDrafts] = useState<WriteDraft[]>([]);
  const [draftReady, setDraftReady] = useState(false);
  const [draftsOpen, setDraftsOpen] = useState(false);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [signedIn, setSignedIn] = useState(false);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [mediaNote, setMediaNote] = useState("");
  const [mediaOpen, setMediaOpen] = useState(false);
  const [publishedSlug, setPublishedSlug] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleteNote, setDeleteNote] = useState("");
  const bodyHandleRef = useRef<WriteBodyHandle | null>(null);
  const titleRef = useRef<HTMLTextAreaElement | null>(null);
  const hasDraft = Boolean(title.trim() || body.trim() || reservedSlug);
  const starters = promptsForDay();
  const empty = !title.trim() && !body.trim();
  const words = wordCount(body);
  const filledDrafts = drafts.filter((d) => !isDraftEmpty(d) || d.id === draftId).length;

  const applyDraft = useCallback((draft: WriteDraft) => {
    setDraftId(draft.id);
    setTitle(draft.title);
    setBody(draft.body);
    setReservedSlug(draft.reservedSlug);
    setPromptId(draft.promptId || "");
    setSavedAt(draft.updatedAt);
    setMediaNote("");
    setConfirmDelete(false);
    setDeleteNote("");
    requestAnimationFrame(() => {
      const el = titleRef.current;
      if (!el) return;
      el.style.height = "auto";
      el.style.height = `${el.scrollHeight}px`;
    });
  }, []);

  const persist = useCallback(
    (id: string, next: { title: string; body: string; reservedSlug: string; promptId: string }) => {
      if (!id) return null;
      try {
        const saved = saveWriteDraft(window.localStorage, id, next);
        if (saved) {
          setSavedAt(saved.updatedAt);
          setDrafts(listWriteDrafts(window.localStorage));
        }
        return saved;
      } catch {
        return null;
      }
    },
    []
  );

  useEffect(() => {
    const storage = window.localStorage;
    migrateLegacyWriteDraft(storage);
    const q = draftQuery();
    let current: WriteDraft | null = null;
    if (q.newDraft) {
      const active = getActiveDraft(storage);
      current = active && isDraftEmpty(active) ? active : createWriteDraft(storage);
    } else if (q.draft) {
      current = getWriteDraft(storage, q.draft) || getActiveDraft(storage) || createWriteDraft(storage);
    } else {
      current = getActiveDraft(storage) || createWriteDraft(storage);
    }
    setActiveWriteDraft(storage, current.id);
    applyDraft(current);
    setDrafts(listWriteDrafts(storage));
    syncDraftUrl(current.id);
    setDraftReady(true);
  }, [applyDraft]);

  useEffect(() => {
    if (!draftReady || !draftId || publishedSlug) return;
    const t = window.setTimeout(() => {
      persist(draftId, { title, body, reservedSlug, promptId });
    }, 400);
    return () => window.clearTimeout(t);
  }, [title, body, reservedSlug, promptId, draftId, draftReady, publishedSlug, persist]);

  useEffect(() => {
    if (!draftReady || !draftId || publishedSlug) return;
    const flush = () => {
      persist(draftId, { title, body, reservedSlug, promptId });
    };
    const onVis = () => {
      if (document.visibilityState === "hidden") flush();
    };
    window.addEventListener("pagehide", flush);
    document.addEventListener("visibilitychange", onVis);
    return () => {
      window.removeEventListener("pagehide", flush);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [title, body, reservedSlug, promptId, draftId, draftReady, publishedSlug, persist]);

  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), 15_000);
    return () => window.clearInterval(t);
  }, []);

  const onReadyChange = useCallback((ready: boolean) => {
    setSignedIn(ready);
  }, []);

  function onNewDraft() {
    if (publishedSlug) return;
    const storage = window.localStorage;
    persist(draftId, { title, body, reservedSlug, promptId });
    const active = getWriteDraft(storage, draftId);
    const next = active && isDraftEmpty(active) ? active : createWriteDraft(storage);
    setActiveWriteDraft(storage, next.id);
    applyDraft(next);
    setDrafts(listWriteDrafts(storage));
    setDraftsOpen(false);
    syncDraftUrl(next.id);
    titleRef.current?.focus();
  }

  function onOpenDraft(id: string) {
    if (publishedSlug) return;
    if (id === draftId) {
      setDraftsOpen(false);
      return;
    }
    const storage = window.localStorage;
    persist(draftId, { title, body, reservedSlug, promptId });
    const next = getWriteDraft(storage, id);
    if (!next) return;
    setActiveWriteDraft(storage, next.id);
    applyDraft(next);
    setDrafts(listWriteDrafts(storage));
    setDraftsOpen(false);
    syncDraftUrl(next.id);
  }

  function onDeleteDraft(id: string) {
    if (publishedSlug) return;
    const storage = window.localStorage;
    if (id === draftId) persist(draftId, { title, body, reservedSlug, promptId });
    let next = deleteWriteDraft(storage, id);
    if (!next) next = createWriteDraft(storage);
    setActiveWriteDraft(storage, next.id);
    if (id === draftId || next.id !== draftId) applyDraft(next);
    setDrafts(listWriteDrafts(storage));
    syncDraftUrl(next.id);
  }

  function onDeleteCurrentDraft() {
    if (busy || publishedSlug || !hasDraft) return;
    if (!confirmDelete) {
      setConfirmDelete(true);
      return;
    }
    setConfirmDelete(false);
    onDeleteDraft(draftId);
    setDeleteNote("Draft deleted.");
  }

  function onUsePrompt(prompt: WritePrompt) {
    if (publishedSlug) return;
    const storage = window.localStorage;
    persist(draftId, { title, body, reservedSlug, promptId });
    const active = getWriteDraft(storage, draftId);
    const target = !active || isDraftEmpty(active) ? active || createWriteDraft(storage) : createWriteDraft(storage);
    const next = saveWriteDraft(storage, target.id, {
      title: prompt.title,
      body: prompt.seed ? `${prompt.seed}\n\n` : "",
      reservedSlug: "",
      promptId: prompt.id,
    });
    const applied = next || target;
    setActiveWriteDraft(storage, applied.id);
    applyDraft(applied);
    setDrafts(listWriteDrafts(storage));
    setDraftsOpen(false);
    syncDraftUrl(applied.id);
    requestAnimationFrame(() => bodyHandleRef.current?.focus());
  }

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
        deleteWriteDraft(window.localStorage, draftId);
        setDrafts(listWriteDrafts(window.localStorage));
      } catch {
        /* ignore */
      }
      const nft = await fetchArticleNftConfig().catch(() => null);
      if (nft?.configured) {
        setPublishedSlug(slug);
        setStatus("Published. Optional: mint a writer edition on Monad.");
        return;
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

  const draftNote = empty
    ? "Start anywhere. Saved on this device."
    : `${writeNudge(words)}${savedAt ? ` · ${formatSavedAt(savedAt, now)}` : ""}`;

  return (
    <div className="mon-write">
      <header className="mon-write__bar">
        <SiteNav />
        <div className="mon-write__actions">
          <button
            type="button"
            className="mon-write__drafts-btn"
            onClick={() => setDraftsOpen(true)}
          >
            Drafts{filledDrafts > 1 ? ` (${filledDrafts})` : ""}
          </button>
          <button
            type="button"
            className="mon-pub-auth__btn mon-pub-auth__btn--primary mon-write__publish"
            disabled={busy || Boolean(publishedSlug)}
            onClick={() => void onPublish()}
          >
            {busy ? "Publishing…" : "Publish"}
          </button>
        </div>
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
        {publishedSlug ? (
          <ArticleNftMint
            slug={publishedSlug}
            role="edition"
            provider={window.__monPublisherProvider}
            account={window.__monPublisherAddress}
            skipLabel="View article"
            onSkip={() => {
              window.location.assign(`/articles/${encodeURIComponent(publishedSlug)}`);
            }}
          />
        ) : null}

        <label className="mon-write__sr" htmlFor="writeTitle">
          Title
        </label>
        <textarea
          id="writeTitle"
          ref={titleRef}
          className="mon-write__title"
          rows={1}
          placeholder="Title"
          value={title}
          onChange={(e) => {
            setConfirmDelete(false);
            setDeleteNote("");
            setTitle(e.target.value);
          }}
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
        {empty ? (
          <div className="mon-write__starters">
            <p className="mon-write__starter-copy">Don’t wait for a perfect title. Tap a line and keep going.</p>
            <div className="mon-write__starter-list">
              {starters.map((prompt) => (
                <button
                  key={prompt.id}
                  type="button"
                  className="mon-write__starter"
                  onClick={() => onUsePrompt(prompt)}
                >
                  {prompt.title}
                </button>
              ))}
            </div>
          </div>
        ) : null}
        <WriteBody
          value={body}
          onChange={(next) => {
            setConfirmDelete(false);
            setDeleteNote("");
            setBody(next);
          }}
          onMediaNote={setMediaNote}
          bodyRef={bodyHandleRef}
        />
        <p className="mon-write__draft">{mediaNote || deleteNote || draftNote}</p>
        <VoiceDrafts
          title={title}
          body={body}
          reservedSlug={reservedSlug}
          writerId={signedIn ? window.__monPublisherAddress || "" : ""}
        />
        <MirosharkPreview title={title} body={body} />
        {publishedSlug ? null : (
          <div className="mon-write__delete">
            {confirmDelete ? (
              <div className="mon-write__delete-confirm" role="group" aria-label="Confirm delete draft">
                <p>Delete this draft? This can’t be undone.</p>
                <div className="mon-write__delete-actions">
                  <button type="button" className="mon-write__delete-btn" onClick={onDeleteCurrentDraft}>
                    Delete draft
                  </button>
                  <button
                    type="button"
                    className="mon-write__media-btn"
                    onClick={() => setConfirmDelete(false)}
                  >
                    Keep draft
                  </button>
                </div>
              </div>
            ) : (
              <button
                type="button"
                className="mon-write__delete-btn"
                disabled={busy || !hasDraft}
                onClick={onDeleteCurrentDraft}
              >
                Delete draft
              </button>
            )}
          </div>
        )}
      </div>
      <WriteMediaSheet
        open={mediaOpen}
        onClose={() => setMediaOpen(false)}
        onInsert={(snippet) => {
          bodyHandleRef.current?.insertSnippet(snippet, "Media added.");
        }}
      />
      <WriteDraftsPanel
        open={draftsOpen}
        drafts={drafts}
        activeId={draftId}
        now={now}
        onClose={() => setDraftsOpen(false)}
        onNew={onNewDraft}
        onOpen={onOpenDraft}
        onDelete={onDeleteDraft}
      />
    </div>
  );
}
