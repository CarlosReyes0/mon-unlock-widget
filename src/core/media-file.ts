/**
 * Client checks before POST /api/media. The server sniffs the bytes again.
 * Size numbers match server/media-host.mjs.
 */
import { buildMediaSnippet, type MediaKind } from "./media-url.js";

export const MEDIA_LIMITS = {
  image: 8 * 1024 * 1024,
  audio: 20 * 1024 * 1024,
  video: 45 * 1024 * 1024,
} as const;

export const MEDIA_ACCEPT =
  "image/jpeg,image/png,image/webp,image/gif,image/avif,video/mp4,video/webm,video/quicktime,audio/mpeg,audio/mp4,audio/wav,audio/ogg,.jpg,.jpeg,.png,.webp,.gif,.avif,.mp4,.webm,.mov,.mp3,.m4a,.wav,.ogg";

const BY_EXT: Record<string, { kind: MediaKind; contentType: string }> = {
  jpg: { kind: "image", contentType: "image/jpeg" },
  jpeg: { kind: "image", contentType: "image/jpeg" },
  png: { kind: "image", contentType: "image/png" },
  webp: { kind: "image", contentType: "image/webp" },
  gif: { kind: "image", contentType: "image/gif" },
  avif: { kind: "image", contentType: "image/avif" },
  mp4: { kind: "video", contentType: "video/mp4" },
  webm: { kind: "video", contentType: "video/webm" },
  mov: { kind: "video", contentType: "video/mp4" },
  mp3: { kind: "audio", contentType: "audio/mpeg" },
  m4a: { kind: "audio", contentType: "audio/mp4" },
  wav: { kind: "audio", contentType: "audio/wav" },
  ogg: { kind: "audio", contentType: "audio/ogg" },
};

const BY_MIME: Record<string, { kind: MediaKind; contentType: string }> = {
  "image/jpeg": BY_EXT.jpeg,
  "image/jpg": BY_EXT.jpeg,
  "image/png": BY_EXT.png,
  "image/webp": BY_EXT.webp,
  "image/gif": BY_EXT.gif,
  "image/avif": BY_EXT.avif,
  "video/mp4": BY_EXT.mp4,
  "video/webm": BY_EXT.webm,
  "video/quicktime": BY_EXT.mov,
  "audio/mpeg": BY_EXT.mp3,
  "audio/mp3": BY_EXT.mp3,
  "audio/mp4": BY_EXT.m4a,
  "audio/m4a": BY_EXT.m4a,
  "audio/x-m4a": BY_EXT.m4a,
  "audio/wav": BY_EXT.wav,
  "audio/wave": BY_EXT.wav,
  "audio/x-wav": BY_EXT.wav,
  "audio/ogg": BY_EXT.ogg,
};

export type ClientFileCheck =
  | { ok: true; kind: MediaKind; contentType: string }
  | { ok: false; message: string };

export function mediaLimitHint(): string {
  return "Photos 8 MB, audio 20 MB, video 45 MB.";
}

function fileExt(name: string): string {
  const base = String(name || "").split(/[/\\]/).pop() || "";
  const dot = base.lastIndexOf(".");
  if (dot < 0) return "";
  return base.slice(dot + 1).toLowerCase();
}

function tooLarge(kind: MediaKind): string {
  if (kind === "image") return "That photo is over 8 MB. Try a smaller JPEG.";
  if (kind === "audio") return "That audio is over 20 MB. Export a shorter MP3.";
  return "That video is over 45 MB. Trim it, or paste a YouTube link.";
}

export function classifyClientFile(file: { type?: string; name?: string; size?: number }): ClientFileCheck {
  const size = Number(file?.size || 0);
  if (!size) return { ok: false, message: "That file is empty." };
  const ext = fileExt(file?.name || "");
  const mime = String(file?.type || "")
    .split(";")[0]
    .trim()
    .toLowerCase();
  if (
    mime === "image/heic" ||
    mime === "image/heif" ||
    ext === "heic" ||
    ext === "heif"
  ) {
    return {
      ok: false,
      message:
        "This is an iPhone HEIC photo. Share it as a JPEG, or set Camera → Formats → Most Compatible.",
    };
  }
  const picked = BY_MIME[mime] || BY_EXT[ext];
  if (!picked || picked.kind === "embed") {
    return {
      ok: false,
      message: "Use a JPEG, PNG, WebP, GIF, MP4, WebM, MP3, M4A, WAV, or OGG file.",
    };
  }
  if (size > MEDIA_LIMITS[picked.kind]) return { ok: false, message: tooLarge(picked.kind) };
  return { ok: true, kind: picked.kind, contentType: picked.contentType };
}

export function altFromFilename(name: string): string {
  const base = String(name || "").split(/[/\\]/).pop() || "";
  const stem = base.replace(/\.[^.]+$/, "");
  const words = stem.replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim();
  if (!words || words.length > 80 || /^[\d\s]+$/.test(words)) return "Photo";
  return words;
}

export function filesFromTransfer(data: DataTransfer | null): File[] {
  if (!data) return [];
  const direct = Array.from(data.files || []);
  if (direct.length) return direct;
  const out: File[] = [];
  for (const item of Array.from(data.items || [])) {
    if (item.kind !== "file") continue;
    const file = item.getAsFile();
    if (file) out.push(file);
  }
  return out;
}

export type HostedMedia = {
  url: string;
  kind: MediaKind;
  persistent?: boolean;
  message?: string;
};

export async function uploadHostedMedia(file: Blob, contentType: string, name: string): Promise<HostedMedia> {
  const res = await fetch("/api/media", {
    method: "POST",
    headers: {
      "Content-Type": contentType,
      "X-Media-Name": String(name || "upload").slice(0, 120),
    },
    body: file,
  });
  let data: HostedMedia & { ok?: boolean; message?: string } = { url: "", kind: "image" };
  try {
    data = await res.json();
  } catch {
    data = { url: "", kind: "image" };
  }
  if (!res.ok || !data.url || (data.kind !== "image" && data.kind !== "audio" && data.kind !== "video")) {
    throw new Error(data.message || "Couldn’t upload that file. Try again.");
  }
  return data;
}

export function snippetForHostedFile(url: string, kind: MediaKind, filename: string): string {
  const alt = kind === "image" ? altFromFilename(filename) : undefined;
  return buildMediaSnippet(url, kind, alt);
}
