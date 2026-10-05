import { useCallback, useEffect, useRef, useState } from "react";
import { MEDIA_ACCEPT, mediaLimitHint } from "../core/media-file.js";
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
import { WriteMediaSheet } from "./WriteMediaSheet.js";
import { WriteDoc, type WriteDocHandle } from "./WriteDoc.js";
import { MirosharkPreview, type MirosharkPreviewHandle } from "./MirosharkPreview.js";
import { MirosharkPaySheet } from "./MirosharkPaySheet.js";
import { signMirosharkUsdc, type MirosharkClientPayment } from "../core/miroshark-pay.js";
import { VoiceDrafts } from "./VoiceDrafts.js";
import { ArticleNftMint } from "./ArticleNftMint.js";
import { WriteDraftsPanel } from "./WriteDraftsPanel.js";
import {
  DEFAULT_ARTICLE_PRICE_CENTS,
  readLastPublishedPriceCents,
  writeLastPublishedPriceCents,
} from "../core/article-price.js";
import { PUBLISH_AUTHOR_MAX, publishAuthor } from "../core/publish-author.js";
import { ensurePaywallFold, hasPaywallFold, seedPaywallFold } from "../core/split-post.js";
import { publishPost } from "./publish-post.js";
import { mapWalletSendToEthSend, type Eip1193Provider } from "../core/wallet.js";
import { fetchArticleNftConfig } from "../core/article-nft.js";
import type { Address } from "viem";

type WriteAuth = "privy" | "injected";

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

export function WriteApp({ auth = "privy" }: { auth?: WriteAuth }) {
  const [title, setTitle] = useState("");
  const [priceCents, setPriceCents] = useState(() => {
    if (typeof window === "undefined") return DEFAULT_ARTICLE_PRICE_CENTS;
    return readLastPublishedPriceCents(window.localStorage);
  });
  const [author, setAuthor] = useState("");
  const [suggestedAuthor, setSuggestedAuthor] = useState("");
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
  const [simBusy, setSimBusy] = useState(false);
  const [simNote, setSimNote] = useState("");
  const [paySheet, setPaySheet] = useState<MirosharkClientPayment | null>(null);
  const [payFrom, setPayFrom] = useState("");
  const [payError, setPayError] = useState("");
  const [payBusy, setPayBusy] = useState(false);
  const bodyHandleRef = useRef<WriteDocHandle | null>(null);
  const authorTouched = useRef(new Set<string>());
  const authorSeeded = useRef(new Map<string, string>());
  const draftIdRef = useRef("");
  const titleRef = useRef<HTMLTextAreaElement | null>(null);
  const simRef = useRef<MirosharkPreviewHandle>(null);
  const hasDraft = !isDraftEmpty({ title, body }) || Boolean(reservedSlug);
  const starters = promptsForDay();
  const empty = isDraftEmpty({ title, body });
  const words = wordCount(body);
  const filledDrafts = drafts.filter((d) => !isDraftEmpty(d) || d.id === draftId).length;

  const applyDraft = useCallback((draft: WriteDraft) => {
    setDraftId(draft.id);
    setTitle(draft.title);
    setAuthor(draft.author || "");
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
    (id: string, next: { title: string; body: string; reservedSlug: string; promptId: string; author: string }) => {
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
    const seededBody = seedPaywallFold(current.body);
    if (seededBody !== current.body) {
      current = saveWriteDraft(storage, current.id, { body: seededBody }) || { ...current, body: seededBody };
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
      persist(draftId, { title, body, reservedSlug, promptId, author });
    }, 400);
    return () => window.clearTimeout(t);
  }, [title, body, reservedSlug, promptId, author, draftId, draftReady, publishedSlug, persist]);

  useEffect(() => {
    if (!draftReady || !draftId || publishedSlug) return;
    const flush = () => {
      persist(draftId, { title, body, reservedSlug, promptId, author });
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
  }, [title, body, reservedSlug, promptId, author, draftId, draftReady, publishedSlug, persist]);

  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), 15_000);
    return () => window.clearInterval(t);
  }, []);

  const onReadyChange = useCallback((ready: boolean) => {
    setSignedIn(ready);
  }, []);

  const onDisplayName = useCallback((name: string) => {
    setSuggestedAuthor(name);
  }, []);

  draftIdRef.current = draftId;

  useEffect(() => {
    if (!draftReady || !draftId) return;
    if (authorTouched.current.has(draftId)) return;
    const suggestion = suggestedAuthor.trim().slice(0, PUBLISH_AUTHOR_MAX);
    if (!suggestion) return;
    const targetId = draftId;
    setAuthor((current) => {
      if (draftIdRef.current !== targetId) return current;
      const trimmed = current.trim();
      const seeded = authorSeeded.current.get(targetId);
      if (trimmed && trimmed !== seeded) return current;
      authorSeeded.current.set(targetId, suggestion);
      return suggestion;
    });
  }, [draftReady, draftId, suggestedAuthor]);

  function onNewDraft() {
    if (publishedSlug) return;
    const storage = window.localStorage;
    persist(draftId, { title, body, reservedSlug, promptId, author });
    const active = getWriteDraft(storage, draftId);
    const next = active && isDraftEmpty(active) ? active : createWriteDraft(storage, { author });
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
    persist(draftId, { title, body, reservedSlug, promptId, author });
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
    if (id === draftId) persist(draftId, { title, body, reservedSlug, promptId, author });
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
    persist(draftId, { title, body, reservedSlug, promptId, author });
    const active = getWriteDraft(storage, draftId);
    const target =
      !active || isDraftEmpty(active)
        ? active || createWriteDraft(storage, { author })
        : createWriteDraft(storage, { author });
    const next = saveWriteDraft(storage, target.id, {
      title: prompt.title,
      body: ensurePaywallFold(prompt.seed ? `${prompt.seed}\n\n` : ""),
      reservedSlug: "",
      promptId: prompt.id,
      author,
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

  function onSimResult(json: {
    ok?: boolean;
    code?: string;
    message?: string;
    clientPayment?: MirosharkClientPayment | null;
    run?: { waitUrl?: string | null; shareUrl?: string | null };
  } | null) {
    if (!json || json.run?.waitUrl || json.run?.shareUrl) return;
    if (json.code === "payment_required" && json.clientPayment) {
      setPaySheet(json.clientPayment);
      setPayFrom(window.__monPublisherAddress || "");
      setPayError("");
      setSimNote("");
      return;
    }
    if (json.ok === false) {
      setSimNote(json.message || "Preview did not run. Publish still works.");
    }
  }

  async function onApproveSim() {
    if (!paySheet || payBusy) return;
    const from = window.__monPublisherAddress;
    const provider = window.__monPublisherProvider as Eip1193Provider | undefined;
    if (!from || !provider) {
      setPayError("Sign in, then approve $1 USDC on Base.");
      return;
    }
    setPayBusy(true);
    setPayError("");
    try {
      const payment = await signMirosharkUsdc(provider, from, paySheet);
      const res = await fetch("/api/miroshark/preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title, body, payment }),
      });
      const json = (await res.json()) as {
        message?: string;
        run?: { waitUrl?: string | null; shareUrl?: string | null };
      };
      const destination = json?.run?.waitUrl || json?.run?.shareUrl;
      if (destination) {
        window.location.assign(destination);
        return;
      }
      setPayError(json?.message || "The simulation did not start. Publish still works.");
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Could not approve the payment.";
      setPayError(/reject|denied|cancel/i.test(msg) ? "Approval cancelled. Publish still works." : msg);
    } finally {
      setPayBusy(false);
    }
  }

  async function onSimulate() {
    if (!simRef.current || simBusy || payBusy) return;
    setSimBusy(true);
    setSimNote("");
    try {
      await simRef.current.start();
    } finally {
      setSimBusy(false);
    }
  }

  async function onPublish() {
    setError("");
    if (!title.trim() || !body.trim()) {
      setError("Add a title and the piece.");
      return;
    }
    const name = publishAuthor(author);
    if (!name) {
      setError("Add your name before publishing.");
      return;
    }
    if (!signedIn || !window.__monPublisherAddress || !window.__monPublisherProvider) {
      setError("Sign in to publish.");
      return;
    }
    setBusy(true);
    setStatus("");
    try {
      const { slug } = await publishPost({
        title,
        rawBody: body,
        author: name,
        priceCents,
        publisher: window.__monPublisherAddress as Address,
        provider: window.__monPublisherProvider as Eip1193Provider,
        preferredSlug: reservedSlug,
        onStatus: setStatus,
        onSlugReserved: setReservedSlug,
      });
      writeLastPublishedPriceCents(window.localStorage, priceCents);
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
            className="mon-write__simulate"
            disabled={simBusy || payBusy}
            onClick={() => void onSimulate()}
          >
            {simBusy ? "Starting…" : "Simulate how this lands with MiroShark"}
          </button>
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

      {simNote ? <p className="mon-write__sim-note">{simNote}</p> : null}
      <div className="mon-write__page">
        <div className="mon-write__auth">
          {auth === "privy" ? (
            <PublisherAuth variant="inline" onReadyChange={onReadyChange} onDisplayName={onDisplayName} />
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
        <div className="mon-write__byline">
          <label className="mon-write__byline-label" htmlFor="writeAuthor">
            Author
          </label>
          <input
            id="writeAuthor"
            className="mon-write__byline-input"
            type="text"
            name="author"
            autoComplete="name"
            maxLength={PUBLISH_AUTHOR_MAX}
            placeholder="Your name"
            value={author}
            onChange={(e) => {
              if (draftId) authorTouched.current.add(draftId);
              setConfirmDelete(false);
              setDeleteNote("");
              setAuthor(e.target.value);
            }}
          />
        </div>
        <label className="mon-write__sr" htmlFor="writeBody">
          Body
        </label>
        <div className="mon-write__media-row">
          <label className="mon-write__media-btn" title={mediaLimitHint()}>
            Add a photo, video, or audio
            <input
              type="file"
              accept={MEDIA_ACCEPT}
              className="mon-write__sr"
              onChange={(e) => {
                const files = Array.from(e.target.files || []);
                e.target.value = "";
                if (files.length) bodyHandleRef.current?.insertFiles(files);
              }}
            />
          </label>
          <button type="button" className="mon-write__media-btn" onClick={() => setMediaOpen(true)}>
            Paste a link
          </button>
          {hasPaywallFold(body) ? null : (
            <button type="button" className="mon-write__media-btn" onClick={() => bodyHandleRef.current?.insertPaywall()}>
              Add paywall
            </button>
          )}
          <span className="mon-write__media-hint">
            It shows up in the piece. Drag the paywall to choose what’s free.
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
        <WriteDoc
          value={body}
          priceCents={priceCents}
          onPriceCents={setPriceCents}
          onChange={(next) => {
            setConfirmDelete(false);
            setDeleteNote("");
            setBody(next);
          }}
          onNote={setMediaNote}
          docRef={bodyHandleRef}
        />
        <p className="mon-write__draft">{mediaNote || deleteNote || draftNote}</p>
        <MirosharkPreview ref={simRef} title={title} body={body} onResult={onSimResult} />
        <VoiceDrafts
          title={title}
          body={body}
          reservedSlug={reservedSlug}
          writerId={signedIn ? window.__monPublisherAddress || "" : ""}
        />
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
      {paySheet ? (
        <MirosharkPaySheet
          payment={paySheet}
          from={payFrom}
          busy={payBusy}
          error={payError}
          onApprove={() => void onApproveSim()}
          onClose={() => {
            if (payBusy) return;
            setPaySheet(null);
            setPayError("");
          }}
        />
      ) : null}
    </div>
  );
}
