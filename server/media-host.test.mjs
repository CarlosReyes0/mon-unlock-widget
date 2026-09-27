import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { after, test } from "node:test";
import { fileURLToPath } from "node:url";
import {
  identifyMedia,
  MEDIA_LIMITS,
  resetMediaHostForTests,
  resolveHostedMediaPath,
  storeMedia,
  tryHandleMediaRequest,
} from "./media-host.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const MEDIA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "op-media-"));
process.env.MEDIA_DIR = MEDIA_DIR;
process.env.SUPABASE_URL = "";
process.env.SUPABASE_SERVICE_ROLE_KEY = "";

const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64"
);

function ftyp(brand) {
  const buf = Buffer.alloc(16, 0);
  buf.writeUInt32BE(16, 0);
  buf.write("ftyp", 4);
  buf.write(brand, 8);
  return buf;
}

const server = http.createServer((req, res) => {
  tryHandleMediaRequest(req, res).then((handled) => {
    if (!handled && !res.writableEnded) {
      res.writeHead(404);
      res.end("no");
    }
  });
});

await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const address = server.address();
const base = `http://127.0.0.1:${address.port}`;

after(() => {
  server.close();
  fs.rmSync(MEDIA_DIR, { recursive: true, force: true });
});

test("sniffs photos, audio, video, and rejects HEIC and HTML", () => {
  assert.equal(identifyMedia(PNG, "image/png", "dot.png").kind, "image");
  assert.equal(identifyMedia(ftyp("isom"), "video/mp4", "clip.mp4").contentType, "video/mp4");
  assert.equal(identifyMedia(ftyp("qt  "), "video/quicktime", "clip.mov").contentType, "video/mp4");
  assert.equal(identifyMedia(ftyp("M4A "), "audio/mp4", "voice.m4a").kind, "audio");
  const webm = Buffer.alloc(24, 0);
  webm[0] = 0x1a;
  webm[1] = 0x45;
  webm[2] = 0xdf;
  webm[3] = 0xa3;
  webm.write("webm", 8);
  assert.equal(identifyMedia(webm, "video/webm", "a.webm").kind, "video");
  assert.throws(
    () => identifyMedia(ftyp("heic"), "image/heic", "a.heic"),
    (err) => err.message === "heic_not_supported"
  );
  const html = Buffer.from("<!DOCTYPE html><html></html>");
  assert.throws(
    () => identifyMedia(html, "text/html", "page.html"),
    (err) => err.message === "unsupported_type"
  );
});

test("rejects an oversized photo", () => {
  const big = Buffer.alloc(MEDIA_LIMITS.image + 1);
  big[0] = 0xff;
  big[1] = 0xd8;
  big[2] = 0xff;
  big[3] = 0xe0;
  assert.throws(
    () => identifyMedia(big, "image/jpeg", "big.jpg"),
    (err) => err.status === 413 && /8 MB/.test(err.publicMessage)
  );
});

test("refuses media paths that escape the host directory", () => {
  assert.equal(resolveHostedMediaPath("/media/../server/index.mjs", MEDIA_DIR), null);
  assert.equal(resolveHostedMediaPath("/media/2026/09/" + "a".repeat(32) + ".html", MEDIA_DIR), null);
  const id = `${"ab".repeat(16)}.png`;
  const located = resolveHostedMediaPath(`/media/2026/09/${id}`, MEDIA_DIR);
  assert.equal(located?.contentType, "image/png");
  assert.equal(located?.full, path.join(MEDIA_DIR, "2026", "09", id));
});

test("POST /api/media stores a png and serves a byte range", async () => {
  resetMediaHostForTests();
  const res = await fetch(`${base}/api/media`, {
    method: "POST",
    headers: { "Content-Type": "image/png", "X-Media-Name": "dot.png" },
    body: PNG,
  });
  assert.equal(res.status, 201);
  const body = await res.json();
  assert.equal(body.ok, true);
  assert.equal(body.kind, "image");
  assert.equal(body.persistent, false);
  assert.match(body.url, /^http:\/\/127\.0\.0\.1:\d+\/media\/\d{4}\/\d{2}\/[a-f0-9]{32}\.png$/);

  const file = await fetch(body.url);
  assert.equal(file.status, 200);
  assert.equal(file.headers.get("content-type"), "image/png");
  assert.equal(file.headers.get("accept-ranges"), "bytes");
  assert.deepEqual(Buffer.from(await file.arrayBuffer()), PNG);

  const range = await fetch(body.url, { headers: { Range: "bytes=0-2" } });
  assert.equal(range.status, 206);
  assert.deepEqual(Buffer.from(await range.arrayBuffer()), PNG.subarray(0, 3));
});

test("POST /api/media rejects HTML disguised as an image", async () => {
  resetMediaHostForTests();
  const res = await fetch(`${base}/api/media`, {
    method: "POST",
    headers: { "Content-Type": "image/jpeg", "X-Media-Name": "photo.jpg" },
    body: Buffer.from("<!DOCTYPE html><script>alert(1)</script>"),
  });
  assert.equal(res.status, 415);
  const body = await res.json();
  assert.equal(body.error, "unsupported_type");
});

test("GET /api/media/status reports disk hosting without Supabase", async () => {
  const res = await fetch(`${base}/api/media/status`);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.hosting, true);
  assert.equal(body.persistent, false);
  assert.equal(body.bucket, null);
  assert.equal(body.limits.video, MEDIA_LIMITS.video);
});

test("supabase upload returns the public object URL", async () => {
  resetMediaHostForTests();
  const calls = [];
  const fetchImpl = async (url, opts) => {
    calls.push({ url: String(url), method: opts.method });
    if (String(url).endsWith("/bucket")) {
      return { ok: false, status: 409, text: async () => "The resource already exists" };
    }
    return { ok: true, status: 200, text: async () => "{\"Key\":\"article-media/x\"}" };
  };
  const stored = await storeMedia(PNG, {
    hintedMime: "image/png",
    filename: "dot.png",
    backend: { type: "supabase", url: "https://example.supabase.co", key: "service-role" },
    origin: "http://127.0.0.1",
    fetchImpl,
    now: Date.UTC(2026, 8, 27),
    ip: "203.0.113.9",
  });
  assert.equal(stored.persistent, true);
  assert.match(
    stored.url,
    /^https:\/\/example\.supabase\.co\/storage\/v1\/object\/public\/article-media\/2026\/09\/[a-f0-9]{32}\.png$/
  );
  assert.equal(calls[0].method, "POST");
  assert.match(calls[0].url, /\/storage\/v1\/bucket$/);
  assert.match(calls[1].url, /\/storage\/v1\/object\/article-media\/2026\/09\//);
  assert.equal(calls[1].method, "POST");
});

test("server and vite both mount media hosting", () => {
  const index = fs.readFileSync(path.join(ROOT, "server/index.mjs"), "utf8");
  const vite = fs.readFileSync(path.join(ROOT, "vite.config.ts"), "utf8");
  const app = fs.readFileSync(path.join(ROOT, "src/publisher/WriteApp.tsx"), "utf8");
  const doc = fs.readFileSync(path.join(ROOT, "src/publisher/WriteDoc.tsx"), "utf8");
  assert.match(index, /tryHandleMediaRequest/);
  assert.match(vite, /tryHandleMediaRequest/);
  assert.match(app, /Add a photo, video, or audio/);
  assert.match(doc, /uploadHostedMedia/);
  assert.doesNotMatch(app, /We don’t host files yet/);
});
