/**
 * Home-screen / PWA icons for Open Paywall.
 *
 * iOS "Add to Home Screen" ignores favicon.ico (16×16) and the page <title>.
 * It uses apple-touch-icon (180×180 PNG). Without that file, Safari draws a
 * letter from the title — "A" from "Articles — Open Paywall".
 *
 *   node scripts/generate-app-icons.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createCanvas } from "@napi-rs/canvas";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/** Same mint ink as OG cards (`MINT_INK` in server/og-card.mjs). */
export const ICON_BG = "#0f766e";
export const ICON_LOCK = "#ffffff";

function roundRect(ctx, x, y, w, h, r) {
  const radius = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, radius);
}

function drawLock(ctx, x, y, size) {
  ctx.save();
  ctx.strokeStyle = ICON_LOCK;
  ctx.fillStyle = ICON_LOCK;
  ctx.lineWidth = Math.max(2, size * 0.14);
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  const cx = x + size / 2;
  ctx.beginPath();
  ctx.arc(cx, y + size * 0.36, size * 0.26, Math.PI, 0, false);
  ctx.stroke();
  const bodyW = size * 0.7;
  const bodyH = size * 0.48;
  roundRect(ctx, cx - bodyW / 2, y + size * 0.4, bodyW, bodyH, Math.max(3, size * 0.1));
  ctx.fill();
  ctx.restore();
}

export function renderAppIconPng(size, { padRatio = 0.26 } = {}) {
  const canvas = createCanvas(size, size);
  const ctx = canvas.getContext("2d");
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.fillStyle = ICON_BG;
  ctx.fillRect(0, 0, size, size);
  const lockSize = Math.round(size * (1 - padRatio * 2));
  const x = (size - lockSize) / 2;
  const y = (size - lockSize) / 2 - lockSize * 0.02;
  drawLock(ctx, x, y, lockSize);
  return canvas.toBuffer("image/png");
}

export const ICON_FILES = [
  { rel: "apple-touch-icon.png", size: 180, padRatio: 0.24 },
  { rel: "assets/icon-32.png", size: 32, padRatio: 0.2 },
  { rel: "assets/icon-192.png", size: 192, padRatio: 0.24 },
  { rel: "assets/icon-512.png", size: 512, padRatio: 0.28 },
];

export function writeAppIcons(root = ROOT) {
  const written = [];
  for (const file of ICON_FILES) {
    const out = path.join(root, file.rel);
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, renderAppIconPng(file.size, { padRatio: file.padRatio }));
    written.push(file.rel);
  }
  return written;
}

const isMain =
  Boolean(process.argv[1]) &&
  pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;
if (isMain) {
  for (const rel of writeAppIcons()) {
    console.log("wrote", rel);
  }
}
