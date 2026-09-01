/**
 * Media URL validation for the embed generator.
 * Checks that image/video/embed links load before inserting into article body.
 */

export const ALLOWED_IFRAME_HOSTS = new Set([
  "www.youtube.com",
  "youtube.com",
  "youtu.be",
  "m.youtube.com",
  "player.vimeo.com",
  "www.loom.com",
  "loom.com",
]);

const GALLERY_HOST_HINTS = [
  "drive.google.com",
  "dropbox.com",
  "postimg.cc",
  "imgur.com/gallery",
  "photos.google.com",
  "icloud.com",
  "facebook.com",
  "instagram.com",
];

const IMAGE_EXT = /\.(avif|gif|jpe?g|png|svg|webp)(\?|#|$)/i;
const VIDEO_EXT = /\.(mp4|webm|mov|m4v|ogv)(\?|#|$)/i;

export function youtubeUrlToEmbed(src) {
  try {
    const u = new URL(src, "https://example.com");
    const host = u.hostname.toLowerCase().replace(/^www\./, "").replace(/^m\./, "");
    let id = null;

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

    if (id) return `https://www.youtube.com/embed/${id}`;
    return null;
  } catch {
    return null;
  }
}

export function normalizeUrl(raw) {
  const trimmed = String(raw || "").trim();
  if (!trimmed) return "";
  try {
    const u = new URL(trimmed);
    if (u.protocol !== "http:" && u.protocol !== "https:") return "";
    return u.toString();
  } catch {
    return "";
  }
}

export function looksLikeGalleryPage(url) {
  const lower = url.toLowerCase();
  return GALLERY_HOST_HINTS.some((hint) => lower.includes(hint));
}

export function detectMediaKind(url) {
  const embed = youtubeUrlToEmbed(url);
  if (embed) return "embed";

  try {
    const u = new URL(url);
    const host = u.hostname.toLowerCase();
    if (ALLOWED_IFRAME_HOSTS.has(host) || ALLOWED_IFRAME_HOSTS.has(host.replace(/^www\./, ""))) {
      if (host.includes("youtube") || host.includes("youtu.be")) return "embed";
      if (host.includes("vimeo") || host.includes("loom")) return "embed";
    }
  } catch {
    /* ignore */
  }

  if (VIDEO_EXT.test(url)) return "video";
  if (IMAGE_EXT.test(url)) return "image";
  return "image";
}

export function buildMediaSnippet(url, kind) {
  const normalized = normalizeUrl(url);
  if (!normalized) return "";

  if (kind === "embed") {
    const embedSrc = youtubeUrlToEmbed(normalized) || normalized;
    return `\n<iframe src="${embedSrc}" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowfullscreen loading="lazy"></iframe>\n`;
  }

  if (kind === "video") {
    return `\n<video controls preload="metadata" src="${normalized}"></video>\n`;
  }

  return `\n<img src="${normalized}" alt="Describe image" loading="lazy" />\n`;
}

export function extractMediaUrls(html) {
  if (!html?.trim() || typeof DOMParser === "undefined") return [];

  const parser = new DOMParser();
  const doc = parser.parseFromString(`<div>${html}</div>`, "text/html");
  const root = doc.body.firstElementChild;
  if (!root) return [];

  const items = [];
  const push = (type, url, el) => {
    const normalized = normalizeUrl(url);
    if (!normalized) return;
    items.push({
      type,
      url: normalized,
      tag: el.tagName.toLowerCase(),
    });
  };

  root.querySelectorAll("img[src]").forEach((el) => push("image", el.getAttribute("src"), el));
  root.querySelectorAll("video[src]").forEach((el) => push("video", el.getAttribute("src"), el));
  root.querySelectorAll("video source[src]").forEach((el) => push("video", el.getAttribute("src"), el));
  root.querySelectorAll("iframe[src]").forEach((el) => push("embed", el.getAttribute("src"), el));

  return items;
}

function iframeHostAllowed(src) {
  try {
    const url = new URL(src);
    const host = url.hostname.toLowerCase();
    return ALLOWED_IFRAME_HOSTS.has(host);
  } catch {
    return false;
  }
}

function loadImage(url, timeoutMs = 12000) {
  return new Promise((resolve) => {
    const img = new Image();
    let settled = false;
    const finish = (ok) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      img.onload = null;
      img.onerror = null;
      resolve(ok);
    };
    const timer = setTimeout(() => finish(false), timeoutMs);
    img.onload = () => finish(true);
    img.onerror = () => finish(false);
    img.src = url;
  });
}

function loadVideo(url, timeoutMs = 12000) {
  return new Promise((resolve) => {
    const video = document.createElement("video");
    video.preload = "metadata";
    let settled = false;
    const finish = (ok) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      video.onloadeddata = null;
      video.onerror = null;
      resolve(ok);
    };
    const timer = setTimeout(() => finish(false), timeoutMs);
    video.onloadeddata = () => finish(true);
    video.onerror = () => finish(false);
    video.src = url;
  });
}

/**
 * @returns {Promise<{status:'ok'|'fixable'|'error', message:string, kind?:string, fixedUrl?:string, snippet?:string}>}
 */
export async function validateMediaUrl(rawUrl, preferredKind = "image") {
  const url = normalizeUrl(rawUrl);
  if (!url) {
    return { status: "error", message: "Enter a valid http(s) URL." };
  }

  const youtubeEmbed = youtubeUrlToEmbed(url);
  let kind = preferredKind;

  if (youtubeEmbed || (preferredKind === "embed" && youtubeUrlToEmbed(url))) {
    kind = "embed";
  } else if (preferredKind === "auto") {
    kind = detectMediaKind(url);
  }

  if (kind === "embed" || youtubeEmbed) {
    const embedSrc = youtubeEmbed || url;
    if (!iframeHostAllowed(embedSrc) && !youtubeEmbed) {
      return {
        status: "error",
        message: "Embed host not allowed. Use YouTube, Vimeo, or Loom embed URLs.",
      };
    }
    const finalUrl = youtubeEmbed || embedSrc;
    return {
      status: "ok",
      message: "Embed URL looks good.",
      kind: "embed",
      fixedUrl: finalUrl,
      snippet: buildMediaSnippet(finalUrl, "embed"),
    };
  }

  if (youtubeEmbed && kind !== "embed") {
    return {
      status: "fixable",
      message: "This is a YouTube link. Use Embed mode (or tap Fix) — it won't work as an image or MP4.",
      kind: "embed",
      fixedUrl: youtubeEmbed,
      snippet: buildMediaSnippet(youtubeEmbed, "embed"),
    };
  }

  if (looksLikeGalleryPage(url)) {
    return {
      status: "error",
      message:
        "This looks like a gallery or share page, not a direct file link. Open the image/video, copy its direct URL (often ends in .jpg or .mp4).",
    };
  }

  if (kind === "image") {
    if (VIDEO_EXT.test(url)) {
      return {
        status: "fixable",
        message: "This URL looks like a video file. Switch to Video mode.",
        kind: "video",
        fixedUrl: url,
        snippet: buildMediaSnippet(url, "video"),
      };
    }

    const loaded = await loadImage(url);
    if (!loaded) {
      return {
        status: "error",
        message:
          "Image didn't load. Use a direct link to the image file (not a web page). Try opening the URL in a new tab — if you see a page instead of just the picture, it's the wrong link.",
      };
    }

    return {
      status: "ok",
      message: "Image loaded successfully.",
      kind: "image",
      fixedUrl: url,
      snippet: buildMediaSnippet(url, "image"),
    };
  }

  if (kind === "video") {
    if (IMAGE_EXT.test(url) && !VIDEO_EXT.test(url)) {
      return {
        status: "fixable",
        message: "This URL looks like an image. Switch to Image mode.",
        kind: "image",
        fixedUrl: url,
        snippet: buildMediaSnippet(url, "image"),
      };
    }

    const loaded = await loadVideo(url);
    if (!loaded) {
      return {
        status: "error",
        message:
          "Video didn't load. Use a direct .mp4 or .webm file URL. YouTube links need Embed mode, not Video.",
      };
    }

    return {
      status: "ok",
      message: "Video loaded successfully.",
      kind: "video",
      fixedUrl: url,
      snippet: buildMediaSnippet(url, "video"),
    };
  }

  return { status: "error", message: "Unsupported media type." };
}

export async function scanBodyMedia(html) {
  const items = extractMediaUrls(html);
  const results = await Promise.all(
    items.map(async (item) => {
      const validation = await validateMediaUrl(item.url, item.type);
      return { ...item, validation };
    })
  );
  return results;
}
