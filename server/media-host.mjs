/**
 * Host photos, audio, and short video for /write.
 *
 * Writers drop or pick a file. We store it and return a public URL the article
 * HTML can use. The paywall still hides that HTML until unlock — same as a
 * pasted image link. Anyone who already has the file URL can open it.
 *
 * Persistent store: Supabase Storage bucket `article-media` when
 * SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are set (created on first upload).
 * Otherwise files go to MEDIA_DIR (local disk; lost on a Railway restart).
 *
 * Each uploader may store MEDIA_UPLOAD_DAILY_LIMIT files per UTC day (default
 * 20). The count is public.rate_limit_counters. If that call fails, the upload
 * is HTTP 503 and the file is not saved.
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { publicOrigin } from "./article-og.mjs";
import { takePersistentRateLimit } from "./rate-limit.mjs";
import { resolveRequestReaderSession } from "./reader-session.mjs";
import { isBlockedPublisher } from "./blocked-publishers.mjs";
import {
  assertRecentWalletSignature,
  buildMediaAuthMessage,
} from "./writer-mutation-auth.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_MEDIA_DIR = path.join(__dirname, "data", "media");

export const MEDIA_BUCKET = "article-media";

export const MEDIA_LIMITS = {
  image: 8 * 1024 * 1024,
  audio: 20 * 1024 * 1024,
  video: 45 * 1024 * 1024,
};

const DEFAULT_MEDIA_DAILY_FILES = 20;
const MEDIA_UPLOAD_BUCKET = "media_upload";

const KINDS = {
  "image/jpeg": { kind: "image", ext: "jpg" },
  "image/png": { kind: "image", ext: "png" },
  "image/webp": { kind: "image", ext: "webp" },
  "image/gif": { kind: "image", ext: "gif" },
  "image/avif": { kind: "image", ext: "avif" },
  "video/mp4": { kind: "video", ext: "mp4" },
  "video/webm": { kind: "video", ext: "webm" },
  "audio/mpeg": { kind: "audio", ext: "mp3" },
  "audio/mp4": { kind: "audio", ext: "m4a" },
  "audio/wav": { kind: "audio", ext: "wav" },
  "audio/ogg": { kind: "audio", ext: "ogg" },
};

const HEIF_BRANDS = new Set(["heic", "heix", "heif", "heim", "heis", "mif1", "msf1"]);
const AUDIO_FTYP = new Set(["m4a ", "m4b ", "mp4a"]);

const EXT_TYPE = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  gif: "image/gif",
  avif: "image/avif",
  mp4: "video/mp4",
  webm: "video/webm",
  mov: "video/mp4",
  mp3: "audio/mpeg",
  m4a: "audio/mp4",
  wav: "audio/wav",
  ogg: "audio/ogg",
};

let bucketReady = null;
let diskOverride = "";

export function mediaUploadDailyLimit(env = process.env) {
  const n = Number(env.MEDIA_UPLOAD_DAILY_LIMIT);
  if (Number.isFinite(n) && n >= 1) return Math.floor(n);
  return DEFAULT_MEDIA_DAILY_FILES;
}

/** Tests keep files on disk while the rate-limit RPC uses Supabase. */
export function useDiskMediaForTests(dir) {
  diskOverride = String(dir || "");
}

export function resetMediaHostForTests() {
  bucketReady = null;
}

function mediaError(code, status, message) {
  const err = new Error(code);
  err.status = status;
  err.publicMessage = message;
  return err;
}

function tooLargeMessage(kind) {
  if (kind === "image") return "That photo is over 8 MB. Try a smaller JPEG.";
  if (kind === "audio") return "That audio is over 20 MB. Export a shorter MP3.";
  return "That video is over 45 MB. Trim it, or paste a YouTube link.";
}

export function mediaBackend() {
  if (diskOverride) return { type: "disk", dir: diskOverride };
  const url = String(process.env.SUPABASE_URL || "").trim().replace(/\/$/, "");
  const key = String(process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim();
  if (url && key) return { type: "supabase", url, key };
  return {
    type: "disk",
    dir: process.env.MEDIA_DIR || DEFAULT_MEDIA_DIR,
  };
}

function normalizeMime(value) {
  return String(value || "")
    .split(";")[0]
    .trim()
    .toLowerCase();
}

function extOf(filename) {
  const base = String(filename || "").split(/[/\\]/).pop() || "";
  const dot = base.lastIndexOf(".");
  if (dot < 0) return "";
  return base.slice(dot + 1).toLowerCase();
}

function ftypBrand(buf) {
  if (buf.length < 12) return "";
  if (buf.toString("ascii", 4, 8) !== "ftyp") return "";
  return buf.toString("ascii", 8, 12);
}

function isMp3Frame(buf) {
  if (buf.length < 4 || buf[0] !== 0xff) return false;
  if ((buf[1] & 0xe0) !== 0xe0) return false;
  const version = (buf[1] >> 3) & 0x03;
  const layer = (buf[1] >> 1) & 0x03;
  if (version === 1 || layer === 0) return false;
  const bitrate = (buf[2] >> 4) & 0x0f;
  if (bitrate === 0 || bitrate === 15) return false;
  return true;
}

/**
 * @returns {{ contentType?: string, reject?: "heic" | "unknown" }}
 */
export function sniffMedia(buf) {
  if (!buf || buf.length < 12) return { reject: "unknown" };
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return { contentType: "image/jpeg" };
  if (buf.subarray(0, 8).toString("hex") === "89504e470d0a1a0a") return { contentType: "image/png" };
  const sig6 = buf.toString("ascii", 0, 6);
  if (sig6 === "GIF87a" || sig6 === "GIF89a") return { contentType: "image/gif" };
  if (buf.toString("ascii", 0, 4) === "RIFF") {
    const four = buf.toString("ascii", 8, 12);
    if (four === "WEBP") return { contentType: "image/webp" };
    if (four === "WAVE") return { contentType: "audio/wav" };
  }
  if (buf.toString("ascii", 0, 4) === "OggS") return { contentType: "audio/ogg" };
  if (buf.toString("ascii", 0, 3) === "ID3") return { contentType: "audio/mpeg" };
  if (isMp3Frame(buf)) return { contentType: "audio/mpeg" };
  if (buf[0] === 0x1a && buf[1] === 0x45 && buf[2] === 0xdf && buf[3] === 0xa3) {
    const head = buf.subarray(0, Math.min(buf.length, 64)).toString("latin1");
    if (head.includes("webm")) return { contentType: "video/webm" };
    return { reject: "unknown" };
  }
  const brand = ftypBrand(buf);
  if (brand) {
    const key = brand.toLowerCase();
    if (HEIF_BRANDS.has(key.trim())) return { reject: "heic" };
    if (key === "avif" || key === "avis") return { contentType: "image/avif" };
    if (AUDIO_FTYP.has(key)) return { contentType: "audio/mp4" };
    return { contentType: "video/mp4" };
  }
  return { reject: "unknown" };
}

export function identifyMedia(buf, hintedMime, filename) {
  if (!buf || buf.length === 0) {
    throw mediaError("empty_file", 400, "That file is empty.");
  }
  const sniffed = sniffMedia(buf);
  if (sniffed.reject === "heic") {
    throw mediaError(
      "heic_not_supported",
      415,
      "This is an iPhone HEIC photo. Share it as a JPEG, or set Camera → Formats → Most Compatible."
    );
  }
  let contentType = sniffed.contentType || "";
  if (contentType === "video/mp4") {
    const hint = normalizeMime(hintedMime);
    const ext = extOf(filename);
    if (hint.startsWith("audio/") || ext === "m4a" || ext === "aac") contentType = "audio/mp4";
  }
  if (!KINDS[contentType]) {
    throw mediaError(
      "unsupported_type",
      415,
      "Use a JPEG, PNG, WebP, GIF, MP4, WebM, MP3, M4A, WAV, or OGG file."
    );
  }
  const meta = KINDS[contentType];
  if (buf.length > MEDIA_LIMITS[meta.kind]) {
    throw mediaError("file_too_large", 413, tooLargeMessage(meta.kind));
  }
  return { contentType, kind: meta.kind, ext: meta.ext };
}

function readBinary(req, limit) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > limit) {
        reject(mediaError("file_too_large", 413, tooLargeMessage("video")));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

function objectName(ext, now) {
  const d = new Date(now);
  const yyyy = String(d.getUTCFullYear());
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  const id = crypto.randomBytes(16).toString("hex");
  return `${yyyy}/${mm}/${id}.${ext}`;
}

async function ensureBucket(backend, fetchImpl) {
  if (!bucketReady) {
    bucketReady = (async () => {
    const res = await fetchImpl(`${backend.url}/storage/v1/bucket`, {
      method: "POST",
      headers: {
        apikey: backend.key,
        Authorization: `Bearer ${backend.key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        id: MEDIA_BUCKET,
        name: MEDIA_BUCKET,
        public: true,
        file_size_limit: MEDIA_LIMITS.video,
        allowed_mime_types: Object.keys(KINDS),
      }),
    });
    if (res.ok) return;
    const text = await res.text();
    if (res.status === 409 || /already exists/i.test(text)) return;
    const err = mediaError("store_failed", 502, "Couldn’t save that file. Try again in a moment.");
    err.detail = text.slice(0, 300);
    throw err;
    })().catch((e) => {
      bucketReady = null;
      throw e;
    });
  }
  return bucketReady;
}

async function putSupabase(buf, identified, backend, fetchImpl, now) {
  await ensureBucket(backend, fetchImpl);
  const objectPath = objectName(identified.ext, now);
  const encoded = objectPath.split("/").map(encodeURIComponent).join("/");
  const res = await fetchImpl(`${backend.url}/storage/v1/object/${MEDIA_BUCKET}/${encoded}`, {
    method: "POST",
    headers: {
      apikey: backend.key,
      Authorization: `Bearer ${backend.key}`,
      "Content-Type": identified.contentType,
      "cache-control": "public, max-age=31536000, immutable",
      "x-upsert": "false",
    },
    body: buf,
  });
  if (!res.ok) {
    const text = await res.text();
    console.error("[media] supabase upload failed", res.status, text.slice(0, 300));
    throw mediaError("store_failed", 502, "Couldn’t save that file. Try again in a moment.");
  }
  return {
    url: `${backend.url}/storage/v1/object/public/${MEDIA_BUCKET}/${encoded}`,
    persistent: true,
    objectPath,
  };
}

async function putDisk(buf, identified, backend, origin, now) {
  const objectPath = objectName(identified.ext, now);
  const parts = objectPath.split("/");
  const full = path.join(backend.dir, ...parts);
  await fs.promises.mkdir(path.dirname(full), { recursive: true });
  await fs.promises.writeFile(full, buf);
  const base = String(origin || "").replace(/\/$/, "");
  return {
    url: `${base}/media/${objectPath}`,
    persistent: false,
    objectPath,
  };
}

export async function storeMedia(buf, { hintedMime, filename, backend, origin, fetchImpl, now }) {
  const identified = identifyMedia(buf, hintedMime, filename);
  const stored =
    backend.type === "supabase"
      ? await putSupabase(buf, identified, backend, fetchImpl, now)
      : await putDisk(buf, identified, backend, origin, now);
  return {
    ok: true,
    url: stored.url,
    kind: identified.kind,
    contentType: identified.contentType,
    bytes: buf.length,
    persistent: stored.persistent,
  };
}

function contentTypeForExt(ext) {
  if (ext === "jpg") return "image/jpeg";
  if (ext === "m4a") return "audio/mp4";
  if (ext === "mp3") return "audio/mpeg";
  return EXT_TYPE[ext] || "application/octet-stream";
}

export function resolveHostedMediaPath(urlPath, dir) {
  const pathOnly = String(urlPath || "").split("?")[0];
  if (!pathOnly.startsWith("/media/")) return null;
  let rest = pathOnly.slice("/media/".length);
  try {
    rest = decodeURIComponent(rest);
  } catch {
    return null;
  }
  if (!rest || rest.includes("..") || rest.includes("\\") || rest.includes("\0")) return null;
  const parts = rest.split("/").filter(Boolean);
  if (parts.length !== 3) return null;
  if (!/^\d{4}$/.test(parts[0]) || !/^(0[1-9]|1[0-2])$/.test(parts[1])) return null;
  if (!/^[a-f0-9]{32}\.(jpg|png|webp|gif|avif|mp4|webm|mp3|m4a|wav|ogg)$/.test(parts[2])) {
    return null;
  }
  const root = path.resolve(dir);
  const full = path.resolve(root, ...parts);
  if (full !== path.join(root, ...parts)) return null;
  return { full, contentType: contentTypeForExt(parts[2].split(".").pop()) };
}

function parseByteRange(rangeHeader, size) {
  if (!rangeHeader || !String(rangeHeader).startsWith("bytes=")) return null;
  const [startStr, endStr] = String(rangeHeader).slice(6).split("-", 2);
  let start = startStr ? Number.parseInt(startStr, 10) : 0;
  let end = endStr ? Number.parseInt(endStr, 10) : size - 1;
  if (!Number.isFinite(start) || start < 0) start = 0;
  if (!Number.isFinite(end) || end >= size) end = size - 1;
  if (start > end || start >= size) return null;
  return { start, end };
}

function headerValue(req, name) {
  const raw = req?.headers?.[name];
  const value = Array.isArray(raw) ? raw[0] : raw;
  return String(value || "").trim();
}

function sendJson(res, status, body) {
  if (res.writableEnded) return;
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers":
      "Content-Type, X-Media-Name, X-Writer-Address, X-Writer-Issued-At, X-Writer-Signature, X-Reader-Session",
  });
  res.end(JSON.stringify(body));
}

/**
 * A signed-in reader session, or a writer signature inside the issuedAt window.
 * Checked before the file is stored.
 */
async function authorizeMediaUpload(req) {
  const address = headerValue(req, "x-writer-address");
  const issuedAt = headerValue(req, "x-writer-issued-at");
  const signature = headerValue(req, "x-writer-signature");
  if (signature || issuedAt || address) {
    const message = buildMediaAuthMessage({ address, issuedAt });
    try {
      await assertRecentWalletSignature({ address, issuedAt, signature, message });
    } catch {
      throw mediaError("unauthorized", 401, "Sign in to upload.");
    }
    const wallet = address.toLowerCase();
    if (isBlockedPublisher(wallet)) throw mediaError("forbidden", 403, "forbidden");
    return wallet;
  }
  let session = null;
  try {
    session = resolveRequestReaderSession(req);
  } catch {
    throw mediaError("unauthorized", 401, "Sign in to upload.");
  }
  if (!session?.address) throw mediaError("unauthorized", 401, "Sign in to upload.");
  if (isBlockedPublisher(session.address)) throw mediaError("forbidden", 403, "forbidden");
  return session.address;
}

function serveDiskFile(req, res, filePath, contentType) {
  fs.stat(filePath, (err, stat) => {
    if (err || !stat.isFile()) {
      res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("Not found");
      return;
    }
    const size = stat.size;
    const range = parseByteRange(req.headers?.range, size);
    const headers = {
      "Content-Type": contentType,
      "Cache-Control": "public, max-age=31536000, immutable",
      "Accept-Ranges": "bytes",
      "Access-Control-Allow-Origin": "*",
    };
    const method = req.method || "GET";
    if (range) {
      const chunk = range.end - range.start + 1;
      res.writeHead(206, {
        ...headers,
        "Content-Range": `bytes ${range.start}-${range.end}/${size}`,
        "Content-Length": chunk,
      });
      if (method === "HEAD") {
        res.end();
        return;
      }
      fs.createReadStream(filePath, { start: range.start, end: range.end }).pipe(res);
      return;
    }
    res.writeHead(200, { ...headers, "Content-Length": size });
    if (method === "HEAD") {
      res.end();
      return;
    }
    fs.createReadStream(filePath).pipe(res);
  });
}

function filenameFromReq(req) {
  const raw = req.headers?.["x-media-name"];
  const name = Array.isArray(raw) ? raw[0] : raw;
  return String(name || "")
    .replace(/[\r\n]/g, "")
    .slice(0, 180);
}

export function mediaStatus() {
  const backend = mediaBackend();
  return {
    ok: true,
    hosting: true,
    persistent: backend.type === "supabase",
    bucket: backend.type === "supabase" ? MEDIA_BUCKET : null,
    limits: MEDIA_LIMITS,
  };
}

/**
 * Production server and Vite dev. Returns true when this request is finished.
 */
export async function tryHandleMediaRequest(req, res) {
  const method = req.method || "GET";
  const pathOnly = String(req.url || "").split("?")[0];
  const isApi = pathOnly === "/api/media" || pathOnly === "/api/media/status";
  const isFile = pathOnly.startsWith("/media/");
  if (!isApi && !isFile) return false;

  if (method === "OPTIONS") {
    sendJson(res, 204, {});
    return true;
  }

  if ((method === "GET" || method === "HEAD") && pathOnly === "/api/media/status") {
    sendJson(res, 200, mediaStatus());
    return true;
  }

  if (isFile && (method === "GET" || method === "HEAD")) {
    const backend = mediaBackend();
    if (backend.type !== "disk") {
      res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("Not found");
      return true;
    }
    const located = resolveHostedMediaPath(pathOnly, backend.dir);
    if (!located) {
      res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("Not found");
      return true;
    }
    serveDiskFile(req, res, located.full, located.contentType);
    return true;
  }

  if (method === "POST" && pathOnly === "/api/media") {
    let uploader = "";
    try {
      uploader = await authorizeMediaUpload(req);
    } catch (e) {
      if (typeof req.resume === "function") req.resume();
      sendJson(res, e?.status || 401, {
        ok: false,
        error: e?.message || "unauthorized",
        message: e?.publicMessage || "Sign in to upload.",
      });
      return true;
    }
    const declared = Number(req.headers?.["content-length"] || 0);
    if (declared > MEDIA_LIMITS.video) {
      if (typeof req.resume === "function") req.resume();
      sendJson(res, 413, {
        ok: false,
        error: "file_too_large",
        message: tooLargeMessage("video"),
      });
      return true;
    }
    try {
      const buf = await readBinary(req, MEDIA_LIMITS.video);
      const hintedMime = req.headers?.["content-type"];
      const filename = filenameFromReq(req);
      identifyMedia(buf, hintedMime, filename);
      let used = 0;
      try {
        used = await takePersistentRateLimit({ bucket: MEDIA_UPLOAD_BUCKET, key: uploader });
      } catch {
        throw mediaError(
          "rate_limit_unavailable",
          503,
          "Uploads are paused. Try again in a moment."
        );
      }
      if (used > mediaUploadDailyLimit()) {
        throw mediaError(
          "rate_limited",
          429,
          "Too many uploads from this account. Wait until tomorrow and try again."
        );
      }
      const stored = await storeMedia(buf, {
        hintedMime,
        filename,
        backend: mediaBackend(),
        origin: publicOrigin(req),
        fetchImpl: globalThis.fetch,
        now: Date.now(),
      });
      sendJson(res, 201, stored);
    } catch (e) {
      const status = e?.status || 500;
      sendJson(res, status, {
        ok: false,
        error: e?.message || "store_failed",
        message: e?.publicMessage || "Couldn’t save that file. Try again in a moment.",
      });
    }
    return true;
  }

  if (isApi || isFile) {
    sendJson(res, 405, { ok: false, error: "method_not_allowed", message: "Method not allowed." });
    return true;
  }
  return false;
}
