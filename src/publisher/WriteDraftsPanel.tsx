import type { WriteDraft } from "../core/write-drafts.js";
import { draftLabel, formatSavedAt, isDraftEmpty, wordCount } from "../core/write-drafts.js";

export function WriteDraftsPanel({
  open,
  drafts,
  activeId,
  now,
  onClose,
  onSimulate,
  onNew,
  onOpen,
  onDelete,
}: {
  open: boolean;
  drafts: WriteDraft[];
  activeId: string;
  now: number;
  onClose: () => void;
  onSimulate: () => void;
  onNew: () => void;
  onOpen: (id: string) => void;
  onDelete: (id: string) => void;
}) {
  if (!open) return null;
  const rows = drafts.filter((d) => d.id === activeId || !isDraftEmpty(d));

  return (
    <div className="mon-write__drawer-root">
      <button type="button" className="mon-write__drawer-backdrop" aria-label="Close drafts" onClick={onClose} />
      <aside className="mon-write__drawer" role="dialog" aria-modal="true" aria-labelledby="writeDraftsTitle">
        <div className="mon-write__drawer-head">
          <div>
            <p className="mon-write__preview-kicker">On this device</p>
            <h2 id="writeDraftsTitle" className="mon-write__preview-title">
              Drafts
            </h2>
          </div>
          <button type="button" className="mon-write__media-btn" onClick={onClose}>
            Close
          </button>
        </div>
        <p className="mon-write__preview-copy">
          Saved in this browser. Sign-in is only for Publish. Start a second piece without losing the first.
        </p>
        <button type="button" className="mon-write__simulate mon-write__simulate--block" onClick={onSimulate}>
          Simulate how this lands with MiroShark
        </button>
        <button type="button" className="mon-write__media-btn" onClick={onNew}>
          New draft
        </button>
        <ul className="mon-write__drawer-list">
          {rows.map((draft) => {
            const words = wordCount(draft.body);
            const empty = isDraftEmpty(draft);
            return (
              <li key={draft.id}>
                <div className={`mon-write__drawer-item${draft.id === activeId ? " is-active" : ""}`}>
                  <button type="button" className="mon-write__drawer-open" onClick={() => onOpen(draft.id)}>
                    <strong>{draftLabel(draft)}</strong>
                    <span>
                      {empty ? "Empty" : `${words} word${words === 1 ? "" : "s"}`}
                      {` · ${formatSavedAt(draft.updatedAt, now).replace("Saved on this device ", "")}`}
                    </span>
                  </button>
                  <button
                    type="button"
                    className="mon-write__drawer-delete"
                    onClick={() => onDelete(draft.id)}
                    aria-label={`Delete ${draftLabel(draft)}`}
                  >
                    Delete
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      </aside>
    </div>
  );
}
