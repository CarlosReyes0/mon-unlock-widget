import { useCallback, useEffect, useRef, useState } from "react";

const STORAGE_BASE = "openpaywall-voice-samples";

type VoiceStatus = {
  enabled?: boolean;
  message?: string;
  draftsOnly?: boolean;
  autopost?: boolean;
  provider?: string | null;
};

type VoiceDraft = {
  id: string;
  text: string;
};

function writerStorageKey(writerId: string) {
  const id = String(writerId || "")
    .trim()
    .toLowerCase();
  if (/^0x[a-f0-9]{40}$/.test(id)) return `${STORAGE_BASE}:${id}`;
  return STORAGE_BASE;
}

function loadVoice(writerId: string): { samples: string; notes: string; articleUrl: string } {
  try {
    const specific = localStorage.getItem(writerStorageKey(writerId));
    const raw = specific || (writerId ? localStorage.getItem(STORAGE_BASE) : null);
    if (!raw) return { samples: "", notes: "", articleUrl: "" };
    const parsed = JSON.parse(raw) as { samples?: string; notes?: string; articleUrl?: string };
    return {
      samples: String(parsed.samples || ""),
      notes: String(parsed.notes || ""),
      articleUrl: String(parsed.articleUrl || ""),
    };
  } catch {
    return { samples: "", notes: "", articleUrl: "" };
  }
}

function saveVoice(writerId: string, data: { samples: string; notes: string; articleUrl: string }) {
  try {
    localStorage.setItem(writerStorageKey(writerId), JSON.stringify(data));
  } catch {
    /* ignore quota */
  }
}

async function copyText(text: string) {
  const value = String(text || "");
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(value);
    return;
  }
  const area = document.createElement("textarea");
  area.value = value;
  area.setAttribute("readonly", "");
  area.style.position = "fixed";
  area.style.left = "-9999px";
  document.body.appendChild(area);
  area.select();
  document.execCommand("copy");
  document.body.removeChild(area);
}

export function VoiceDrafts({
  title,
  body,
  reservedSlug,
  writerId = "",
}: {
  title: string;
  body: string;
  reservedSlug?: string;
  writerId?: string;
}) {
  const [info, setInfo] = useState<VoiceStatus | null>(null);
  const [samples, setSamples] = useState("");
  const [notes, setNotes] = useState("");
  const [articleUrl, setArticleUrl] = useState("");
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");
  const [error, setError] = useState("");
  const [drafts, setDrafts] = useState<VoiceDraft[]>([]);
  const [replySeed, setReplySeed] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  const suggestedUrl =
    reservedSlug && typeof window !== "undefined"
      ? `${window.location.origin}/articles/${encodeURIComponent(reservedSlug)}`
      : "";

  useEffect(() => {
    let cancelled = false;
    fetch("/api/voice-drafts/status")
      .then((r) => r.json())
      .then((json) => {
        if (!cancelled) setInfo(json);
      })
      .catch(() => {
        if (!cancelled) {
          setInfo({
            enabled: false,
            draftsOnly: true,
            autopost: false,
            message: "Could not load voice-draft status. Publish still works. Nothing posts from here.",
          });
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const loaded = loadVoice(writerId);
    setSamples(loaded.samples);
    setNotes(loaded.notes);
    setArticleUrl(loaded.articleUrl);
    setReady(true);
  }, [writerId]);

  useEffect(() => {
    if (!ready) return;
    const t = window.setTimeout(() => {
      saveVoice(writerId, { samples, notes, articleUrl });
    }, 400);
    return () => window.clearTimeout(t);
  }, [samples, notes, articleUrl, writerId, ready]);

  const onUpload = useCallback(async (files: FileList | null) => {
    if (!files?.length) return;
    const chunks: string[] = [];
    for (const file of Array.from(files)) {
      if (file.size > 80_000) continue;
      try {
        chunks.push((await file.text()).trim());
      } catch {
        /* skip unreadable */
      }
    }
    const extra = chunks.filter(Boolean).join("\n---\n");
    if (!extra) return;
    setSamples((prev) => (prev.trim() ? `${prev.trim()}\n---\n${extra}` : extra));
    setNote("Sample file added. Still drafts only.");
  }, []);

  async function onGenerate() {
    setBusy(true);
    setError("");
    setNote("Drafting in your voice…");
    try {
      const res = await fetch("/api/voice-drafts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          samples,
          notes,
          title,
          body,
          articleUrl: articleUrl.trim() || suggestedUrl,
        }),
      });
      const json = (await res.json()) as {
        ok?: boolean;
        message?: string;
        drafts?: VoiceDraft[];
      };
      if (json?.ok && Array.isArray(json.drafts) && json.drafts.length) {
        setDrafts(
          json.drafts.map((row, i) => ({
            id: String(row.id || i + 1),
            text: String(row.text || ""),
          }))
        );
        setNote("Drafts only — copy what you want. Nothing was posted.");
      } else {
        setDrafts([]);
        setError(json?.message || "Could not draft posts. Nothing was posted.");
        setNote("");
      }
    } catch {
      setDrafts([]);
      setError("Could not draft posts. Publish still works. Nothing was posted.");
      setNote("");
    } finally {
      setBusy(false);
    }
  }

  function updateDraft(id: string, text: string) {
    setDrafts((rows) => rows.map((row) => (row.id === id ? { ...row, text } : row)));
  }

  async function onCopy(text: string, label = "Copied. Still a draft — nothing posted.") {
    try {
      await copyText(text);
      setNote(label);
    } catch {
      setNote("Select the text and copy it yourself. Nothing was posted.");
    }
  }

  async function onReplySeed(text: string) {
    setReplySeed(text);
    await onCopy(text, "Reply seed copied. Paste it yourself — this page never posts.");
  }

  return (
    <section className="mon-write__preview mon-write__voice" aria-label="Voice drafts">
      <p className="mon-write__preview-kicker">Optional · drafts only</p>
      <h2 className="mon-write__preview-title">Draft posts in your voice</h2>
      <p className="mon-write__preview-copy">
        Paste a few of your posts or a voice note. We draft 2–3 X posts for this piece.{" "}
        <strong>Nothing posts from here.</strong> Copy a card, or use it as a reply seed, and send it
        yourself. Autopost is not in this build.
      </p>
      {info?.enabled === false ? (
        <p className="mon-write__preview-copy">{info.message}</p>
      ) : null}

      <label className="mon-write__voice-label" htmlFor="voiceSamples">
        Sample posts
      </label>
      <textarea
        id="voiceSamples"
        className="mon-write__voice-input"
        rows={5}
        placeholder="Paste 2–5 posts that sound like you. Separate with a blank line or ---."
        value={samples}
        onChange={(e) => setSamples(e.target.value)}
      />
      <div className="mon-write__voice-row">
        <button
          type="button"
          className="mon-write__media-btn"
          onClick={() => fileRef.current?.click()}
        >
          Upload samples
        </button>
        <input
          ref={fileRef}
          type="file"
          accept=".txt,.md,text/plain"
          multiple
          hidden
          onChange={(e) => {
            void onUpload(e.target.files);
            e.target.value = "";
          }}
        />
        <span className="mon-write__media-hint">.txt / .md, read in the browser. Not hosted.</span>
      </div>

      <label className="mon-write__voice-label" htmlFor="voiceNotes">
        Voice notes
      </label>
      <textarea
        id="voiceNotes"
        className="mon-write__voice-input"
        rows={3}
        placeholder="Optional: short, dry, no hype, I don’t use hashtags…"
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
      />

      <label className="mon-write__voice-label" htmlFor="voiceArticleUrl">
        Article URL (optional)
      </label>
      <input
        id="voiceArticleUrl"
        className="mon-write__voice-url"
        type="url"
        placeholder={suggestedUrl || "https://…/articles/your-piece"}
        value={articleUrl}
        onChange={(e) => setArticleUrl(e.target.value)}
      />
      <p className="mon-write__media-hint">
        Title and teaser come from the draft above. Add a URL if you already published, or after
        Publish.
      </p>

      <button
        type="button"
        className="mon-write__media-btn"
        disabled={busy}
        onClick={() => void onGenerate()}
      >
        {busy ? "Drafting…" : "Draft 2–3 posts"}
      </button>

      {note ? <p className="mon-write__preview-note">{note}</p> : null}
      {error ? <p className="mon-write__voice-error">{error}</p> : null}

      {replySeed ? (
        <div className="mon-write__voice-card mon-write__voice-card--seed">
          <p className="mon-write__voice-card-kicker">Reply seed</p>
          <textarea
            className="mon-write__voice-input"
            rows={3}
            value={replySeed}
            onChange={(e) => setReplySeed(e.target.value)}
            aria-label="Reply seed"
          />
          <div className="mon-write__voice-actions">
            <button
              type="button"
              className="mon-write__media-btn"
              onClick={() => void onCopy(replySeed, "Reply seed copied. Nothing posted.")}
            >
              Copy
            </button>
          </div>
        </div>
      ) : null}

      {drafts.map((draft, index) => (
        <div className="mon-write__voice-card" key={draft.id}>
          <p className="mon-write__voice-card-kicker">
            Draft {index + 1}
            {draft.text.length > 280 ? ` · ${draft.text.length} chars (X is 280)` : ` · ${draft.text.length} chars`}
          </p>
          <textarea
            className="mon-write__voice-input"
            rows={4}
            value={draft.text}
            onChange={(e) => updateDraft(draft.id, e.target.value)}
            aria-label={`Voice draft ${index + 1}`}
          />
          <div className="mon-write__voice-actions">
            <button
              type="button"
              className="mon-write__media-btn"
              onClick={() => void onCopy(draft.text)}
            >
              Copy
            </button>
            <button
              type="button"
              className="mon-write__media-btn"
              onClick={() => void onReplySeed(draft.text)}
            >
              Use as reply seed
            </button>
          </div>
        </div>
      ))}
    </section>
  );
}
