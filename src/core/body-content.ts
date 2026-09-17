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

export const ALLOWED_IFRAME_HOSTS = new Set([
  "www.youtube.com",
  "youtube.com",
  "m.youtube.com",
  "youtu.be",
  "www.youtube-nocookie.com",
  "youtube-nocookie.com",
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

function videoIdFromPath(pathname: string, prefix: string): string | null {
  if (!pathname.startsWith(prefix)) return null;
  return pathname.slice(prefix.length).split("/")[0]?.split(/[?#]/)[0] || null;
}

export function youtubeUrlToEmbed(src: string): string | null {
  try {
    const u = new URL(src, "https://example.com");
    const host = u.hostname.toLowerCase().replace(/^www\./, "").replace(/^m\./, "");
    let id: string | null = null;
    const nocookie = host === "youtube-nocookie.com";

    if (host === "youtube.com" || host === "youtube" || nocookie) {
      id =
        videoIdFromPath(u.pathname, "/shorts/") ||
        videoIdFromPath(u.pathname, "/embed/") ||
        (u.pathname.startsWith("/watch") ? u.searchParams.get("v") : null);
    } else if (host === "youtu.be") {
      id = u.pathname.slice(1).split(/[?#]/)[0] || null;
    }

    if (!id) return null;
    const root = nocookie ? "https://www.youtube-nocookie.com" : "https://www.youtube.com";
    return `${root}/embed/${id}`;
  } catch {
    return null;
  }
}

export function vimeoUrlToEmbed(src: string): string | null {
  try {
    const u = new URL(src, "https://example.com");
    const host = u.hostname.toLowerCase().replace(/^www\./, "");
    if (host !== "vimeo.com" && host !== "player.vimeo.com") return null;
    const parts = u.pathname.split("/").filter(Boolean);
    const id = parts.find((p) => /^\d{6,12}$/.test(p));
    if (!id) return null;
    return `https://player.vimeo.com/video/${id}`;
  } catch {
    return null;
  }
}

export function loomUrlToEmbed(src: string): string | null {
  try {
    const u = new URL(src, "https://example.com");
    const host = u.hostname.toLowerCase().replace(/^www\./, "");
    if (host !== "loom.com") return null;
    const parts = u.pathname.split("/").filter(Boolean);
    if ((parts[0] === "share" || parts[0] === "embed") && parts[1]) {
      return `https://www.loom.com/embed/${parts[1]}`;
    }
    return null;
  } catch {
    return null;
  }
}

/** Canonical iframe src for YouTube / Vimeo / Loom share and watch URLs. */
export function trustedEmbedSrc(src: string): string | null {
  return youtubeUrlToEmbed(src) || vimeoUrlToEmbed(src) || loomUrlToEmbed(src);
}

function iframeFromTrustedUrl(doc: Document, src: string): HTMLIFrameElement | null {
  const embed = trustedEmbedSrc(src);
  if (!embed) return null;
  const iframe = doc.createElement("iframe");
  iframe.setAttribute("src", embed);
  iframe.setAttribute(
    "allow",
    "accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
  );
  iframe.setAttribute("allowfullscreen", "");
  iframe.setAttribute("loading", "lazy");
  return iframe;
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

    // If a <video> mistakenly uses a YouTube/Vimeo/Loom watch URL as src,
    // auto-convert it to a working iframe embed so the video actually loads.
    if (name === "src" && tag === "video") {
      const iframe = el.ownerDocument ? iframeFromTrustedUrl(el.ownerDocument, value) : null;
      if (iframe) {
        const parent = el.parentNode;
        if (parent) {
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

    // Writers often paste watch/share URLs into iframe src. Those pages refuse
    // to render in an iframe — rewrite to the provider embed URL when possible.
    const embedSrc = trustedEmbedSrc(src);
    if (embedSrc) {
      el.setAttribute("src", embedSrc);
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

/**
 * Writers often mix HTML media tags with plain paragraphs that use blank lines.
 * HTML collapses those newlines — turn them into <br> so spacing matches the textarea.
 */
function preservePlainTextNewlines(root: Element, doc: Document) {
  const skipParents = new Set(["pre", "code", "script", "style", "textarea"]);
  const textNodes: Text[] = [];

  const visit = (node: Node) => {
    if (node.nodeType === 3 /* TEXT_NODE */) {
      textNodes.push(node as Text);
      return;
    }
    if (node.nodeType !== 1 /* ELEMENT_NODE */) return;
    const tag = (node as Element).tagName.toLowerCase();
    if (skipParents.has(tag)) return;
    for (const child of Array.from(node.childNodes)) visit(child);
  };
  visit(root);

  for (const textNode of textNodes) {
    const value = textNode.nodeValue;
    if (!value || !value.includes("\n")) continue;

    const parts = value.split("\n");
    const frag = doc.createDocumentFragment();
    parts.forEach((part, i) => {
      if (part) frag.appendChild(doc.createTextNode(part));
      if (i < parts.length - 1) frag.appendChild(doc.createElement("br"));
    });
    textNode.parentNode?.replaceChild(frag, textNode);
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

  preservePlainTextNewlines(root, doc);

  return root.innerHTML;
}
