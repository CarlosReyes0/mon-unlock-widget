/**
 * Detect and build HTML snippets for images, audio, video, and trusted embeds.
 * Used by /write (paste + Add media). Generator keeps a JS copy for the embed tool.
 */

import { trustedEmbedSrc } from "./body-content.js";

export type MediaKind = "image" | "video" | "audio" | "embed";

export type MediaValidation = {
  status: "ok" | "fixable" | "error" | "checking";
  message: string;
  kind?: MediaKind;
  fixedUrl?: string;
  snippet?: string;
};

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
const AUDIO_EXT = /\.(mp3|wav|ogg|m4a|aac|flac|opus)(\?|#|$)/i;

const IFRAME_HOSTS = new Set([
  "www.youtube.com",
  "youtube.com",
  "m.youtube.com",
  "youtu.be",
  "www.youtube-nocookie.com",
  "youtube-nocookie.com",
  "player.vimeo.com",
  "vimeo.com",
  "www.loom.com",
  "loom.com",
]);

export function normalizeUrl(raw: string): string {
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

export function looksLikeGalleryPage(url: string): boolean {
  const lower = url.toLowerCase();
  return GALLERY_HOST_HINTS.some((hint) => lower.includes(hint));
}

function hostLooksLikeEmbed(url: string): boolean {
  try {
    const host = new URL(url).hostname.toLowerCase();
    return IFRAME_HOSTS.has(host) || IFRAME_HOSTS.has(host.replace(/^www\./, ""));
  } catch {
    return false;
  }
}

/** Kind when the URL itself is evidence (extension or known embed host). */
export function confidentMediaKind(url: string): MediaKind | null {
  if (trustedEmbedSrc(url) || hostLooksLikeEmbed(url)) return "embed";
  if (AUDIO_EXT.test(url)) return "audio";
  if (VIDEO_EXT.test(url)) return "video";
  if (IMAGE_EXT.test(url)) return "image";
  return null;
}

export function detectMediaKind(url: string): MediaKind {
  return confidentMediaKind(url) || "image";
}

function escapeAttr(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

export function buildMediaSnippet(url: string, kind: MediaKind, alt?: string): string {
  const normalized = normalizeUrl(url);
  if (!normalized) return "";

  if (kind === "embed") {
    const embedSrc = trustedEmbedSrc(normalized) || normalized;
    return `\n<iframe src="${embedSrc}" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowfullscreen loading="lazy"></iframe>\n`;
  }

  if (kind === "video") {
    return `\n<video controls playsinline preload="metadata" src="${normalized}"></video>\n`;
  }

  if (kind === "audio") {
    return `\n<audio controls preload="metadata" src="${normalized}"></audio>\n`;
  }

  const safeAlt = escapeAttr(String(alt || "Describe image").trim().slice(0, 140) || "Describe image");
  return `\n<img src="${normalized}" alt="${safeAlt}" loading="lazy" />\n`;
}

/**
 * If the clipboard is a single media URL, return the HTML snippet to insert.
 * Unknown URLs return null so a normal article link is not turned into <img>.
 */
export function snippetFromPastedText(raw: string): string | null {
  const trimmed = String(raw || "").trim();
  if (!trimmed || /\s/.test(trimmed)) return null;
  const url = normalizeUrl(trimmed);
  if (!url) return null;
  const kind = confidentMediaKind(url);
  if (!kind) return null;
  return buildMediaSnippet(url, kind);
}

export function extractMediaUrls(html: string): { type: MediaKind; url: string; tag: string }[] {
  if (!html?.trim() || typeof DOMParser === "undefined") return [];

  const parser = new DOMParser();
  const doc = parser.parseFromString(`<div>${html}</div>`, "text/html");
  const root = doc.body.firstElementChild;
  if (!root) return [];

  const items: { type: MediaKind; url: string; tag: string }[] = [];
  const push = (type: MediaKind, url: string | null, el: Element) => {
    const normalized = normalizeUrl(url || "");
    if (!normalized) return;
    items.push({ type, url: normalized, tag: el.tagName.toLowerCase() });
  };

  root.querySelectorAll("img[src]").forEach((el) => push("image", el.getAttribute("src"), el));
  root.querySelectorAll("video[src]").forEach((el) => push("video", el.getAttribute("src"), el));
  root.querySelectorAll("video source[src]").forEach((el) => push("video", el.getAttribute("src"), el));
  root.querySelectorAll("audio[src]").forEach((el) => push("audio", el.getAttribute("src"), el));
  root.querySelectorAll("audio source[src]").forEach((el) => push("audio", el.getAttribute("src"), el));
  root.querySelectorAll("iframe[src]").forEach((el) => push("embed", el.getAttribute("src"), el));

  return items;
}

function iframeHostAllowed(src: string): boolean {
  try {
    const host = new URL(src).hostname.toLowerCase();
    return IFRAME_HOSTS.has(host);
  } catch {
    return false;
  }
}

function loadWithTimeout(
  start: (finish: (ok: boolean) => void) => void,
  timeoutMs: number
): Promise<boolean> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (ok: boolean) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(ok);
    };
    const timer = setTimeout(() => finish(false), timeoutMs);
    start(finish);
  });
}

function loadImage(url: string, timeoutMs = 12000): Promise<boolean> {
  if (typeof Image === "undefined") return Promise.resolve(true);
  return loadWithTimeout((finish) => {
    const img = new Image();
    img.onload = () => finish(true);
    img.onerror = () => finish(false);
    img.src = url;
  }, timeoutMs);
}

function loadVideo(url: string, timeoutMs = 12000): Promise<boolean> {
  if (typeof document === "undefined") return Promise.resolve(true);
  return loadWithTimeout((finish) => {
    const video = document.createElement("video");
    video.preload = "metadata";
    video.onloadeddata = () => finish(true);
    video.onerror = () => finish(false);
    video.src = url;
  }, timeoutMs);
}

function loadAudio(url: string, timeoutMs = 12000): Promise<boolean> {
  if (typeof document === "undefined") return Promise.resolve(true);
  return loadWithTimeout((finish) => {
    const audio = document.createElement("audio");
    audio.preload = "metadata";
    audio.onloadeddata = () => finish(true);
    audio.onerror = () => finish(false);
    audio.src = url;
  }, timeoutMs);
}

export async function validateMediaUrl(
  rawUrl: string,
  preferredKind: MediaKind | "auto" = "image"
): Promise<MediaValidation> {
  const url = normalizeUrl(rawUrl);
  if (!url) {
    return { status: "error", message: "Enter a valid http(s) URL." };
  }

  const embedSrc = trustedEmbedSrc(url);
  let kind: MediaKind =
    preferredKind === "auto" ? detectMediaKind(url) : preferredKind;

  if (embedSrc) {
    kind = "embed";
  } else if (kind === "embed" && !hostLooksLikeEmbed(url)) {
    const detected = detectMediaKind(url);
    if (detected !== "embed") {
      return {
        status: "fixable",
        message: `This URL looks like ${detected === "audio" ? "audio" : detected === "video" ? "a video file" : "an image"}. Switch to ${detected === "audio" ? "Audio" : detected === "video" ? "Video" : "Image"}.`,
        kind: detected,
        fixedUrl: url,
        snippet: buildMediaSnippet(url, detected),
      };
    }
  }

  if (kind === "embed") {
    const finalUrl = embedSrc || url;
    if (!iframeHostAllowed(finalUrl) && !embedSrc) {
      return {
        status: "error",
        message: "Embed host not allowed. Use YouTube, Vimeo, or Loom.",
      };
    }
    return {
      status: "ok",
      message: "Embed URL looks good.",
      kind: "embed",
      fixedUrl: finalUrl,
      snippet: buildMediaSnippet(finalUrl, "embed"),
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
        message: "This URL looks like a video file. Switch to Video.",
        kind: "video",
        fixedUrl: url,
        snippet: buildMediaSnippet(url, "video"),
      };
    }
    if (AUDIO_EXT.test(url)) {
      return {
        status: "fixable",
        message: "This URL looks like audio. Switch to Audio.",
        kind: "audio",
        fixedUrl: url,
        snippet: buildMediaSnippet(url, "audio"),
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
        message: "This URL looks like an image. Switch to Image.",
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
          "Video didn't load. Use a direct .mp4 or .webm file URL. YouTube links need Embed, not Video.",
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

  if (kind === "audio") {
    const loaded = await loadAudio(url);
    if (!loaded) {
      return {
        status: "error",
        message: "Audio didn't load. Use a direct .mp3, .m4a, or .ogg file URL.",
      };
    }
    return {
      status: "ok",
      message: "Audio loaded successfully.",
      kind: "audio",
      fixedUrl: url,
      snippet: buildMediaSnippet(url, "audio"),
    };
  }

  return { status: "error", message: "Unsupported media type." };
}
