/** True when content uses HTML tags (vs plain text with newlines). */
export function looksLikeHtml(body: string): boolean {
  return /<\s*(p|br|div|span|h[1-6]|ul|ol|li|a|strong|em|blockquote|pre|code|table|section|article|img|video|audio|picture|figure|source|iframe)\b/i.test(
    body
  );
}

const ALLOWED_TAGS = new Set([
  "p",
  "br",
  "div",
  "span",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "ul",
  "ol",
  "li",
  "a",
  "strong",
  "em",
  "blockquote",
  "pre",
  "code",
  "table",
  "thead",
  "tbody",
  "tr",
  "th",
  "td",
  "section",
  "article",
  "img",
  "video",
  "audio",
  "picture",
  "figure",
  "figcaption",
  "source",
  "iframe",
]);

const ALLOWED_IFRAME_HOSTS = new Set([
  "www.youtube.com",
  "youtube.com",
  "youtu.be",
  "player.vimeo.com",
  "www.loom.com",
  "loom.com",
]);

const GLOBAL_ALLOWED_ATTRS = new Set(["title", "aria-label"]);

const TAG_ALLOWED_ATTRS: Record<string, Set<string>> = {
  a: new Set(["href", "target", "rel"]),
  img: new Set(["src", "alt", "width", "height", "loading"]),
  video: new Set(["src", "controls", "muted", "loop", "playsinline", "preload", "poster"]),
  audio: new Set(["src", "controls", "preload"]),
  source: new Set(["src", "type"]),
  iframe: new Set(["src", "allow", "allowfullscreen", "loading", "referrerpolicy"]),
};

function isSafeUrl(value: string, allowedProtocols: string[] = ["http:", "https:"]): boolean {
  const trimmed = (value || "").trim();
  if (!trimmed) return false;
  try {
    const url = new URL(trimmed, "https://example.com");
    return allowedProtocols.includes(url.protocol);
  } catch {
    return false;
  }
}

function youtubeUrlToEmbed(src: string): string | null {
  try {
    const u = new URL(src, "https://example.com");
    const host = u.hostname.toLowerCase().replace(/^www\./, "").replace(/^m\./, "");
    let id: string | null = null;

    if (host === "youtube.com" || host === "youtube") {
      if (u.pathname.startsWith("/shorts/")) {
        id = u.pathname.split("/")[2]?.split(/[?#]/)[0] || null;
      } else if (u.pathname.startsWith("/watch")) {
        id = u.searchParams.get("v");
      } else if (u.pathname.startsWith("/embed/")) {
        id = u.pathname.split("/")[2]?.split(/[?#]/)[0] || null;
      }
    } else if (host === "youtu.be") {
      id = u.pathname.slice(1).split(/[?#]/)[0] || null;
    }

    if (id) {
      return `https://www.youtube.com/embed/${id}`;
    }
    return null;
  } catch {
    return null;
  }
}

function sanitizeElement(el: Element) {
  const tag = el.tagName.toLowerCase();

  if (!ALLOWED_TAGS.has(tag)) {
    const parent = el.parentNode;
    if (!parent) return;
    while (el.firstChild) parent.insertBefore(el.firstChild, el);
    parent.removeChild(el);
    return;
  }

  const allowedAttrs = TAG_ALLOWED_ATTRS[tag] ?? new Set<string>();
  for (const attr of Array.from(el.attributes)) {
    const name = attr.name.toLowerCase();
    const value = attr.value.trim();
    if (name.startsWith("on")) {
      el.removeAttribute(attr.name);
      continue;
    }

    if (!GLOBAL_ALLOWED_ATTRS.has(name) && !allowedAttrs.has(name)) {
      el.removeAttribute(attr.name);
      continue;
    }

    if ((name === "href" || name === "src") && !isSafeUrl(value)) {
      el.removeAttribute(attr.name);
      continue;
    }

    // If a <video> mistakenly uses a YouTube watch/shorts URL as src (common),
    // auto-convert it to a working iframe embed so the video actually loads.
    if (name === "src" && tag === "video") {
      const embed = youtubeUrlToEmbed(value);
      if (embed) {
        const parent = el.parentNode;
        if (parent && el.ownerDocument) {
          const iframe = el.ownerDocument.createElement("iframe");
          iframe.setAttribute("src", embed);
          iframe.setAttribute("allow", "accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture");
          iframe.setAttribute("allowfullscreen", "");
          iframe.setAttribute("loading", "lazy");
          // Transfer any explicit size attrs if present
          if (el.hasAttribute("width")) iframe.setAttribute("width", el.getAttribute("width")!);
          if (el.hasAttribute("height")) iframe.setAttribute("height", el.getAttribute("height")!);
          parent.replaceChild(iframe, el);
          sanitizeElement(iframe);
          return;
        }
      }
    }
  }

  if (tag === "a") {
    if (el.getAttribute("target") === "_blank") {
      el.setAttribute("rel", "noopener noreferrer");
    }
  }

  if (tag === "iframe") {
    const src = el.getAttribute("src");
    if (!src) {
      el.remove();
      return;
    }

    // Writers often paste youtube.com/watch?... into iframe src. That page refuses
    // to render in an iframe — rewrite to /embed/VIDEO_ID when possible.
    const youtubeEmbed = youtubeUrlToEmbed(src);
    if (youtubeEmbed) {
      el.setAttribute("src", youtubeEmbed);
      if (!el.hasAttribute("allow")) {
        el.setAttribute(
          "allow",
          "accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
        );
      }
      if (!el.hasAttribute("allowfullscreen")) {
        el.setAttribute("allowfullscreen", "");
      }
      if (!el.hasAttribute("loading")) {
        el.setAttribute("loading", "lazy");
      }
    }

    try {
      const url = new URL(el.getAttribute("src") || src);
      if (!ALLOWED_IFRAME_HOSTS.has(url.hostname.toLowerCase())) {
        el.remove();
        return;
      }
    } catch {
      el.remove();
      return;
    }
  }

  for (const child of Array.from(el.children)) {
    sanitizeElement(child);
  }
}

export function sanitizeRichHtml(rawHtml: string): string {
  if (!rawHtml.trim()) return "";
  if (typeof DOMParser === "undefined") return rawHtml;

  const parser = new DOMParser();
  const doc = parser.parseFromString(`<div>${rawHtml}</div>`, "text/html");
  const root = doc.body.firstElementChild;
  if (!root) return "";

  for (const child of Array.from(root.children)) {
    sanitizeElement(child);
  }

  for (const script of Array.from(root.querySelectorAll("script,style,link,meta,object,embed"))) {
    script.remove();
  }

  return root.innerHTML;
}
