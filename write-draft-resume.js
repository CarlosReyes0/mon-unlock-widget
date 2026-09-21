/**
 * “Continue your draft” on static pages (Articles, Dashboard).
 * Same localStorage keys as src/core/write-drafts.ts.
 *
 * Placeholder: <div id="resume-draft"></div>
 * Then: <script src="/write-draft-resume.js"></script>
 */
(function () {
  const KEY = "openpaywall-write-drafts";
  const LEGACY = "openpaywall-write-draft";

  function hasText(value) {
    return Boolean(String(value || "").trim());
  }

  function labelOf(title, body) {
    const named = String(title || "").trim();
    if (named) return named;
    const first = String(body || "")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    if (!first) return "Untitled";
    return first.length > 48 ? first.slice(0, 47) + "…" : first;
  }

  function peek() {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        const drafts = Array.isArray(parsed.drafts) ? parsed.drafts : [];
        const filled = drafts.filter((d) => d && (hasText(d.title) || hasText(d.body)));
        if (filled.length) {
          const active = filled.find((d) => d.id === parsed.activeId) || filled[0];
          return {
            id: String(active.id || ""),
            label: labelOf(active.title, active.body),
          };
        }
      }
      const legacy = localStorage.getItem(LEGACY);
      if (!legacy) return null;
      const d = JSON.parse(legacy);
      if (!hasText(d.title) && !hasText(d.body)) return null;
      return { id: "", label: labelOf(d.title, d.body) };
    } catch {
      return null;
    }
  }

  function mount() {
    const el = document.getElementById("resume-draft");
    if (!el || el.dataset.rendered === "1") return;
    const draft = peek();
    if (!draft) return;
    el.dataset.rendered = "1";
    el.className = (el.className + " mon-resume-draft").trim();
    const href = draft.id ? "/write?draft=" + encodeURIComponent(draft.id) : "/write";
    const kicker = document.createElement("p");
    kicker.className = "mon-resume-draft__kicker";
    kicker.textContent = "Your draft is waiting";
    const link = document.createElement("a");
    link.href = href;
    link.textContent = "Continue “" + draft.label + "”";
    const hint = document.createElement("p");
    hint.className = "mon-resume-draft__hint";
    hint.textContent = "Saved on this device. A few paragraphs is a post.";
    el.appendChild(kicker);
    el.appendChild(link);
    el.appendChild(hint);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", mount);
  } else {
    mount();
  }
})();
