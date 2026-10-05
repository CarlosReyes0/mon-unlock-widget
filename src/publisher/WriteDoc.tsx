import { useEffect, useImperativeHandle, useLayoutEffect, useRef, useState } from "react";
import { formatUsdFromCents } from "../core/article-price.js";
import { ArticlePriceForm } from "./ArticlePriceForm.js";
import { classifyClientFile, filesFromTransfer, uploadHostedMedia } from "../core/media-file.js";
import { snippetFromPastedText } from "../core/media-url.js";
import {
  contentBlocks,
  explicitFoldIndex,
  insertBlockBefore,
  insertPaywallFold,
  mergeBackward,
  moveBlockBefore,
  newWriteBlockId,
  parseWriteDoc,
  placeFold,
  removeBlock,
  removeFold,
  serializeWriteDoc,
  splitTextBlock,
  updateCaption,
  updateText,
  type PaywallCaret,
  type WriteBlock,
  type WriteMediaBlock,
} from "../core/write-doc.js";

const FOLD_DRAG = "application/x-openpaywall-fold";
const MEDIA_DRAG = "application/x-openpaywall-media";

export type WriteDocHandle = {
  insertSnippet: (snippet: string, note: string) => void;
  insertFiles: (files: File[]) => void;
  insertPaywall: () => void;
  focus: () => void;
};

type FocusRequest = { id: string; cursor: number | null };

export function WriteDoc({
  value,
  onChange,
  onNote,
  docRef,
  priceCents,
  onPriceCents,
}: {
  value: string;
  onChange: (next: string) => void;
  onNote: (note: string) => void;
  docRef: React.Ref<WriteDocHandle>;
  priceCents: number;
  onPriceCents: (cents: number) => void;
}) {
  const [blocks, setBlocks] = useState<WriteBlock[]>(() => parseWriteDoc(value));
  const [dropping, setDropping] = useState(false);
  const [pending, setPending] = useState<{ beforeId: string | null; label: string } | null>(null);
  const serializedRef = useRef(value);
  const blocksRef = useRef(blocks);
  const areasRef = useRef(new Map<string, HTMLTextAreaElement>());
  const focusRef = useRef<FocusRequest | null>(null);
  const anchorRef = useRef<string | null>(null);
  const caretRef = useRef<PaywallCaret | null>(null);
  const dragKindRef = useRef<null | "fold" | "media">(null);
  const dragMediaIdRef = useRef("");
  const [focusTick, setFocusTick] = useState(0);

  useEffect(() => {
    blocksRef.current = blocks;
  }, [blocks]);

  useEffect(() => {
    if (value === serializedRef.current) return;
    serializedRef.current = value;
    setBlocks(parseWriteDoc(value));
  }, [value]);

  useLayoutEffect(() => {
    for (const area of areasRef.current.values()) grow(area);
    const request = focusRef.current;
    if (!request) return;
    const area = areasRef.current.get(request.id);
    if (!area) return;
    area.focus();
    const cursor = request.cursor == null ? area.value.length : request.cursor;
    area.setSelectionRange(cursor, cursor);
    focusRef.current = null;
  }, [blocks, focusTick, pending]);

  function commit(next: WriteBlock[], focus?: FocusRequest) {
    blocksRef.current = next;
    setBlocks(next);
    const serialized = serializeWriteDoc(next);
    serializedRef.current = serialized;
    onChange(serialized);
    if (focus) {
      focusRef.current = focus;
      setFocusTick((n) => n + 1);
    }
  }

  function beforeIdFromFocus(): string | null {
    const active = document.activeElement;
    const id = active instanceof HTMLTextAreaElement ? active.dataset.blockId || "" : "";
    if (id) return nextBlockId(blocksRef.current, id);
    return anchorRef.current;
  }

  function insertMedia(media: WriteMediaBlock, beforeId: string | null, note: string) {
    commit(insertBlockBefore(blocksRef.current, media, beforeId));
    onNote(note);
  }

  function insertSnippet(snippet: string, note: string) {
    const parsed = parseWriteDoc(snippet).find((block) => block.type === "media");
    if (!parsed || parsed.type !== "media") return;
    const media: WriteMediaBlock = { ...parsed, id: newWriteBlockId() };
    insertMedia(media, beforeIdFromFocus(), note);
  }

  async function insertFiles(list: File[], beforeId = beforeIdFromFocus()) {
    const file = list[0];
    if (!file || pending) return;
    const check = classifyClientFile(file);
    if (!check.ok) {
      onNote(check.message);
      return;
    }
    const label = check.kind === "video" ? "Uploading video…" : check.kind === "audio" ? "Uploading audio…" : "Uploading photo…";
    setPending({ beforeId, label });
    try {
      const hosted = await uploadHostedMedia(file, check.contentType, file.name);
      const media: WriteMediaBlock = {
        id: newWriteBlockId(),
        type: "media",
        kind: hosted.kind === "embed" ? "video" : hosted.kind,
        url: hosted.url,
        alt: "",
      };
      const more = list.length > 1 ? " Add the others one at a time." : "";
      const stay = hosted.persistent ? "" : " It may disappear if this server restarts.";
      const name = hosted.kind === "video" ? "Video" : hosted.kind === "audio" ? "Audio" : "Photo";
      insertMedia(media, beforeId, `${name} added.${stay}${more}`);
    } catch (err) {
      const msg = err instanceof Error && err.message ? err.message : "Couldn’t upload that file. Try again.";
      onNote(msg);
    } finally {
      setPending(null);
    }
  }

  useImperativeHandle(
    docRef,
    () => ({
      insertSnippet,
      insertFiles: (files) => {
        void insertFiles(files);
      },
      focus: () => {
        const first = contentBlocks(blocksRef.current).find((block) => block.type === "text");
        if (!first) return;
        focusRef.current = { id: first.id, cursor: null };
        setFocusTick((n) => n + 1);
      },
      insertPaywall: () => {
        const inserted = insertPaywallFold(blocksRef.current, caretRef.current);
        if (inserted.blocks === blocksRef.current) return;
        commit(inserted.blocks, inserted.focusId ? { id: inserted.focusId, cursor: inserted.cursor } : undefined);
      },
    }),
    [pending]
  );

  const content = contentBlocks(blocks);
  const explicitAt = explicitFoldIndex(blocks);
  const empty = serializeWriteDoc(blocks) === "";
  const firstTextId = content.find((block) => block.type === "text")?.id;

  function rememberCaret(id: string, cursor: number) {
    caretRef.current = { id, cursor };
    anchorRef.current = nextBlockId(blocksRef.current, id);
  }

  function onRemoveFold() {
    commit(removeFold(blocksRef.current));
  }

  function onDocDrop(event: React.DragEvent<HTMLDivElement>) {
    setDropping(false);
    const beforeId = dropBeforeId(event);
    const types = Array.from(event.dataTransfer.types || []);
    if (types.includes(FOLD_DRAG) || dragKindRef.current === "fold") {
      event.preventDefault();
      const target = contentIndexOf(blocksRef.current, beforeId);
      if (target != null) commit(placeFold(blocksRef.current, target));
      return;
    }
    const mediaId = event.dataTransfer.getData(MEDIA_DRAG) || dragMediaIdRef.current;
    if (mediaId && (types.includes(MEDIA_DRAG) || dragKindRef.current === "media")) {
      event.preventDefault();
      commit(moveBlockBefore(blocksRef.current, mediaId, beforeId));
      return;
    }
    const files = filesFromTransfer(event.dataTransfer);
    if (files.length) {
      event.preventDefault();
      void insertFiles(files, beforeId);
      return;
    }
    const text = event.dataTransfer.getData("text/uri-list") || event.dataTransfer.getData("text/plain");
    const snippet = snippetFromPastedText(text);
    if (!snippet) return;
    event.preventDefault();
    const parsed = parseWriteDoc(snippet).find((block) => block.type === "media");
    if (!parsed || parsed.type !== "media") return;
    insertMedia({ ...parsed, id: newWriteBlockId() }, beforeId, "Embedded from URL.");
  }

  return (
    <div
      className={`mon-write__doc${dropping ? " is-dropping" : ""}`}
      onDragOver={(event) => {
        const types = Array.from(event.dataTransfer?.types || []);
        const internal = dragKindRef.current;
        if (
          internal ||
          types.includes("Files") ||
          types.includes(FOLD_DRAG) ||
          types.includes(MEDIA_DRAG) ||
          types.includes("text/uri-list")
        ) {
          event.preventDefault();
          if (event.dataTransfer) event.dataTransfer.dropEffect = internal ? "move" : "copy";
        }
        if (types.includes("Files")) setDropping(true);
      }}
      onDragLeave={() => setDropping(false)}
      onDragEnd={() => {
        dragKindRef.current = null;
        dragMediaIdRef.current = "";
      }}
      onDrop={onDocDrop}
    >
      {content.map((block, index) => (
        <div key={block.id} data-before={block.id}>
          {explicitAt === index ? (
            <PaywallChip
              priceCents={priceCents}
              onPriceCents={onPriceCents}
              onRemove={onRemoveFold}
              onDragKind={(kind) => {
                dragKindRef.current = kind;
              }}
            />
          ) : null}
          {pending?.beforeId === block.id ? <PendingFigure label={pending.label} /> : null}
          {block.type === "text" ? (
            <Paragraph
              block={block}
              isBodyField={block.id === firstTextId}
              placeholder={placeholderFor(index, explicitAt, empty, block.id === firstTextId)}
              onCaret={(cursor) => rememberCaret(block.id, cursor)}
              areasRef={areasRef}
              onChange={(text) => commit(updateText(blocksRef.current, block.id, text))}
              onEnter={(at) => {
                const split = splitTextBlock(blocksRef.current, block.id, at);
                commit(split.blocks, { id: split.focusId, cursor: 0 });
              }}
              onMerge={() => {
                const merged = mergeBackward(blocksRef.current, block.id);
                if (!merged) return;
                commit(merged.blocks, { id: merged.focusId, cursor: merged.cursor });
              }}
              onPasteFiles={(files) => {
                void insertFiles(files, nextBlockId(blocksRef.current, block.id));
              }}
              onRemember={() => rememberCaret(block.id, caretRef.current?.id === block.id ? caretRef.current.cursor : block.text.length)}
              onPasteSnippet={(snippet) => {
                const parsed = parseWriteDoc(snippet).find((item) => item.type === "media");
                if (!parsed || parsed.type !== "media") return;
                insertMedia(
                  { ...parsed, id: newWriteBlockId() },
                  nextBlockId(blocksRef.current, block.id),
                  "Embedded from URL."
                );
              }}
            />
          ) : (
            <MediaFigure
              block={block}
              onCaption={(alt) => commit(updateCaption(blocksRef.current, block.id, alt))}
              onRemove={() => commit(removeBlock(blocksRef.current, block.id))}
              onDragKind={(kind) => {
                dragKindRef.current = kind;
                dragMediaIdRef.current = kind === "media" ? block.id : "";
              }}
            />
          )}
        </div>
      ))}
      {pending && pending.beforeId == null ? <PendingFigure label={pending.label} /> : null}
      {explicitAt != null && explicitAt >= content.length ? (
        <PaywallChip
          priceCents={priceCents}
          onPriceCents={onPriceCents}
          onRemove={onRemoveFold}
          onDragKind={(kind) => {
            dragKindRef.current = kind;
          }}
        />
      ) : null}
      <div className="mon-write__doc-end" data-before="" />
    </div>
  );
}

function placeholderFor(index: number, explicitAt: number | null, empty: boolean, isFirst: boolean): string {
  if (explicitAt == null) return empty && isFirst ? "Write, or paste a link" : "";
  if (index < explicitAt) return "Free preview. Readers see this.";
  return "Paid. Readers unlock this.";
}

function nextBlockId(blocks: WriteBlock[], id: string): string | null {
  const index = blocks.findIndex((block) => block.id === id);
  if (index < 0) return null;
  return blocks[index + 1]?.id ?? null;
}

function contentIndexOf(blocks: WriteBlock[], beforeId: string | null): number | null {
  const content = contentBlocks(blocks);
  if (!beforeId) return content.length;
  const index = content.findIndex((block) => block.id === beforeId);
  return index < 0 ? null : index;
}

function dropBeforeId(event: React.DragEvent): string | null {
  const node = event.target instanceof Element ? event.target.closest("[data-before]") : null;
  const id = node?.getAttribute("data-before");
  return id || null;
}

function grow(area: HTMLTextAreaElement) {
  area.style.height = "auto";
  area.style.height = `${area.scrollHeight}px`;
}

function Paragraph({
  block,
  isBodyField,
  placeholder,
  areasRef,
  onChange,
  onEnter,
  onMerge,
  onRemember,
  onCaret,
  onPasteFiles,
  onPasteSnippet,
}: {
  block: { id: string; text: string };
  isBodyField: boolean;
  placeholder: string;
  areasRef: React.MutableRefObject<Map<string, HTMLTextAreaElement>>;
  onChange: (text: string) => void;
  onEnter: (at: number) => void;
  onMerge: () => void;
  onRemember: () => void;
  onCaret: (cursor: number) => void;
  onPasteFiles: (files: File[]) => void;
  onPasteSnippet: (snippet: string) => void;
}) {
  function markCaret(event: React.SyntheticEvent<HTMLTextAreaElement>) {
    onCaret(event.currentTarget.selectionStart ?? event.currentTarget.value.length);
  }

  return (
    <textarea
        id={isBodyField ? "writeBody" : undefined}
      data-block-id={block.id}
      ref={(node) => {
        if (node) areasRef.current.set(block.id, node);
        else areasRef.current.delete(block.id);
      }}
      className="mon-write__para"
      rows={1}
      placeholder={placeholder}
      value={block.text}
      onChange={(event) => {
        grow(event.currentTarget);
        onChange(event.currentTarget.value);
        onCaret(event.currentTarget.selectionStart ?? event.currentTarget.value.length);
      }}
      onFocus={(event) => {
        onRemember();
        markCaret(event);
      }}
      onSelect={markCaret}
      onKeyUp={markCaret}
      onBlur={markCaret}
      onKeyDown={(event) => {
        if (event.nativeEvent.isComposing) return;
        if (event.key === "Enter" && !event.shiftKey) {
          event.preventDefault();
          onEnter(event.currentTarget.selectionStart ?? event.currentTarget.value.length);
        }
        if (
          event.key === "Backspace" &&
          event.currentTarget.selectionStart === 0 &&
          event.currentTarget.selectionEnd === 0
        ) {
          event.preventDefault();
          onMerge();
        }
      }}
      onPaste={(event) => {
        const files = filesFromTransfer(event.clipboardData);
        if (files.length) {
          event.preventDefault();
          onPasteFiles(files);
          return;
        }
        const snippet = snippetFromPastedText(event.clipboardData.getData("text/plain"));
        if (!snippet) return;
        event.preventDefault();
        onPasteSnippet(snippet);
      }}
    />
  );
}

function MediaFigure({
  block,
  onCaption,
  onRemove,
  onDragKind,
}: {
  block: WriteMediaBlock;
  onCaption: (alt: string) => void;
  onRemove: () => void;
  onDragKind: (kind: null | "media") => void;
}) {
  return (
    <figure className="mon-write__figure">
      <div className="mon-write__figure-bar">
        <button
          type="button"
          className="mon-write__grip"
          draggable
          aria-label="Drag to move"
          onDragStart={(event) => {
            event.dataTransfer.setData(MEDIA_DRAG, block.id);
            event.dataTransfer.effectAllowed = "move";
            onDragKind("media");
          }}
          onDragEnd={() => onDragKind(null)}
        >
          Move
        </button>
        <button type="button" className="mon-write__remove" onClick={onRemove}>
          Remove
        </button>
      </div>
      {block.kind === "image" ? <img src={block.url} alt={block.alt || ""} /> : null}
      {block.kind === "video" ? <video src={block.url} controls playsInline preload="metadata" /> : null}
      {block.kind === "audio" ? <audio src={block.url} controls preload="metadata" /> : null}
      {block.kind === "embed" ? (
        <iframe
          src={block.url}
          title="Embedded video"
          loading="lazy"
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
          allowFullScreen
        />
      ) : null}
      {block.kind === "image" ? (
        <input
          className="mon-write__caption"
          value={block.alt}
          placeholder="Add a caption"
          aria-label="Caption"
          onChange={(event) => onCaption(event.currentTarget.value)}
        />
      ) : null}
    </figure>
  );
}

function PendingFigure({ label }: { label: string }) {
  return (
    <div className="mon-write__pending" role="status">
      {label}
    </div>
  );
}

function PaywallChip({
  priceCents,
  onPriceCents,
  onRemove,
  onDragKind,
}: {
  priceCents: number;
  onPriceCents: (cents: number) => void;
  onRemove: () => void;
  onDragKind: (kind: null | "fold") => void;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const priceLabel = formatUsdFromCents(priceCents);

  useEffect(() => {
    if (!open) return;
    function onPointer(event: MouseEvent) {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    }
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div className="mon-write__paywall" ref={rootRef}>
      <div
        className="mon-write__paywall-chip"
        draggable
        role="separator"
        data-paywall="fold"
        aria-label={`Paid below this line. ${priceLabel}. Drag to move.`}
        title="Drag to choose what readers see for free"
        onDragStart={(event) => {
          event.dataTransfer.setData(FOLD_DRAG, "1");
          event.dataTransfer.effectAllowed = "move";
          onDragKind("fold");
        }}
        onDragEnd={() => onDragKind(null)}
      >
        <LockIcon />
        <span>Paid below this line</span>
        <span aria-hidden="true">·</span>
        <button
          type="button"
          className="mon-write__paywall-price"
          aria-expanded={open}
          aria-label={`Edit price, currently ${priceLabel}`}
          onMouseDown={(event) => event.stopPropagation()}
          onDragStart={(event) => {
            event.preventDefault();
            event.stopPropagation();
          }}
          onClick={(event) => {
            event.preventDefault();
            event.stopPropagation();
            setOpen((current) => !current);
          }}
        >
          {priceLabel} ✎
        </button>
      </div>
      {open ? (
        <div className="mon-price-pop" role="dialog" aria-label="Article price">
          <ArticlePriceForm cents={priceCents} onChange={onPriceCents} />
        </div>
      ) : null}
      <button type="button" className="mon-write__paywall-remove" onClick={onRemove}>
        Remove paywall
      </button>
    </div>
  );
}

function LockIcon() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
      <rect x="5" y="11" width="14" height="10" rx="2" fill="none" stroke="currentColor" strokeWidth="1.8" />
      <path d="M8 11V7a4 4 0 0 1 8 0v4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}
