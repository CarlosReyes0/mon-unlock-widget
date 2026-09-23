import type { ResumableDraft } from "../core/write-drafts.js";

export function ResumeDraftCard({ resume }: { resume: ResumableDraft | null }) {
  return (
    <>
      {resume ? (
        <div className="mon-write__resume" style={{ marginTop: "1.25rem" }}>
          <p className="mon-write__resume-kicker">Your draft is waiting</p>
          <a href={`/write?draft=${encodeURIComponent(resume.id)}`}>Continue “{resume.label}”</a>
          <p className="mon-write__resume-hint">Saved on this device. A few paragraphs is a post.</p>
        </div>
      ) : (
        <p className="mon-pub-shell__next">
          <a href="/write">Write a post</a>
          <span aria-hidden="true"> · </span>
          <a href="/articles">Articles feed</a>
        </p>
      )}
      {resume ? (
        <p className="mon-pub-shell__next">
          <a href="/write?new=1">Start a new draft</a>
          <span aria-hidden="true"> · </span>
          <a href="/articles">Articles feed</a>
        </p>
      ) : null}
    </>
  );
}
