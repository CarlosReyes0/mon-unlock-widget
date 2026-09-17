import { useEffect, useId, useRef, useState } from "react";
import {
  buildMediaSnippet,
  validateMediaUrl,
  type MediaKind,
  type MediaValidation,
} from "../core/media-url.js";

const KINDS: { id: MediaKind; label: string }[] = [
  { id: "image", label: "Image" },
  { id: "video", label: "Video" },
  { id: "audio", label: "Audio" },
  { id: "embed", label: "Embed" },
];

type WriteMediaSheetProps = {
  open: boolean;
  onClose: () => void;
  onInsert: (snippet: string) => void;
};

export function WriteMediaSheet({ open, onClose, onInsert }: WriteMediaSheetProps) {
  const titleId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [kind, setKind] = useState<MediaKind>("image");
  const [url, setUrl] = useState("");
  const [result, setResult] = useState<MediaValidation | null>(null);
  const tokenRef = useRef(0);

  useEffect(() => {
    if (!open) return;
    setKind("image");
    setUrl("");
    setResult({ status: "checking", message: "Paste a link to check it." });
    const t = window.setTimeout(() => inputRef.current?.focus(), 30);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.clearTimeout(t);
      document.body.style.overflow = prevOverflow;
      window.removeEventListener("keydown", onKey);
    };
  }, [open, onClose]);

  useEffect(() => {
    if (!open) return;
    const raw = url.trim();
    const token = ++tokenRef.current;
    if (!raw) {
      setResult({ status: "checking", message: "Paste a link to check it." });
      return;
    }
    setResult({ status: "checking", message: "Checking link…" });
    const timer = window.setTimeout(() => {
      void validateMediaUrl(raw, kind).then((next) => {
        if (token !== tokenRef.current) return;
        setResult(next);
      });
    }, 400);
    return () => window.clearTimeout(timer);
  }, [url, kind, open]);

  if (!open) return null;

  const status = result?.status || "checking";
  const previewUrl = result?.fixedUrl || url.trim();

  function insert() {
    if (!result || result.status !== "ok") return;
    const snippet =
      result.snippet ||
      buildMediaSnippet(result.fixedUrl || url.trim(), result.kind || kind);
    if (!snippet.trim()) return;
    onInsert(snippet);
    onClose();
  }

  function applyFix() {
    if (!result || result.status !== "fixable") return;
    if (result.kind) setKind(result.kind);
    if (result.fixedUrl) setUrl(result.fixedUrl);
    setResult({ ...result, status: "ok", message: "Fixed — ready to insert." });
  }

  return (
    <div
      className="mon-write-sheet-backdrop"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="mon-write-sheet" role="dialog" aria-modal="true" aria-labelledby={titleId}>
        <div className="mon-write-sheet__handle" aria-hidden="true" />
        <h3 id={titleId}>Add image, audio, or video</h3>
        <div className="mon-write-sheet__body">
          <div className="mon-write-sheet__tabs" role="tablist" aria-label="Media type">
            {KINDS.map((k) => (
              <button
                key={k.id}
                type="button"
                role="tab"
                aria-selected={kind === k.id}
                onClick={() => setKind(k.id)}
              >
                {k.label}
              </button>
            ))}
          </div>
          <label className="mon-write-sheet__label" htmlFor="writeMediaUrl">
            URL
          </label>
          <input
            id="writeMediaUrl"
            ref={inputRef}
            type="url"
            inputMode="url"
            autoCapitalize="off"
            autoComplete="off"
            spellCheck={false}
            placeholder="https://…"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                insert();
              }
            }}
          />
          <div className={`mon-write-sheet__status mon-write-sheet__status--${status}`}>
            {result?.message || "Checking link…"}
          </div>
          <div className="mon-write-sheet__preview">
            {status === "ok" && previewUrl && kindPreview(result?.kind || kind, previewUrl)}
            {status !== "ok" ? (
              <div className="mon-write-sheet__placeholder">
                {status === "error"
                  ? "Fix the URL above to see a preview."
                  : "Preview appears when the link works."}
              </div>
            ) : null}
          </div>
          <p className="mon-write-sheet__hint">
            Direct file links for photos, MP4, and MP3. YouTube, Vimeo, and Loom for embeds.
            Media above the fold is free to readers.
          </p>
        </div>
        <div className="mon-write-sheet__actions">
          <button type="button" className="mon-pub-auth__btn" onClick={onClose}>
            Cancel
          </button>
          {status === "fixable" ? (
            <button type="button" className="mon-pub-auth__btn" onClick={applyFix}>
              Fix
            </button>
          ) : null}
          <button
            type="button"
            className="mon-pub-auth__btn mon-pub-auth__btn--primary"
            disabled={status !== "ok"}
            onClick={insert}
          >
            Insert
          </button>
        </div>
      </div>
    </div>
  );
}

function kindPreview(kind: MediaKind, url: string) {
  if (kind === "embed") {
    return (
      <iframe
        src={url}
        title="Embed preview"
        loading="lazy"
        allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
        allowFullScreen
      />
    );
  }
  if (kind === "video") {
    return <video src={url} controls preload="metadata" playsInline />;
  }
  if (kind === "audio") {
    return <audio src={url} controls preload="metadata" />;
  }
  return <img src={url} alt="Preview" />;
}

export function insertAtTextareaCursor(
  area: HTMLTextAreaElement,
  value: string,
  snippet: string
): { next: string; cursor: number } {
  const start = area.selectionStart ?? value.length;
  const end = area.selectionEnd ?? value.length;
  const before = value.slice(0, start);
  const after = value.slice(end);
  const lead = before.length > 0 && !before.endsWith("\n") ? "\n" : "";
  const insert = `${lead}${snippet.trim()}\n`;
  return { next: before + insert + after, cursor: (before + insert).length };
}
