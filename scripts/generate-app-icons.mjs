/**
 * Home-screen / PWA icons for Open Paywall.
 *
 * iOS "Add to Home Screen" ignores favicon.ico (16×16) and the page <title>.
 * It uses apple-touch-icon (180×180 PNG). Without that file, Safari draws a
 * letter from the title — "A" from "Articles — Open Paywall".
 *
 * Mark: open (unlocked) padlock on Monad primary purple — friendlier than a
 * closed lock, and reads as “open” rather than “blocked.”
 *
 *   node scripts/generate-app-icons.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createCanvas } from "@napi-rs/canvas";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/** Monad primary purple (brand kit). */
export const ICON_BG = "#6E54FF";
export const ICON_FG = "#ffffff";

function roundRect(ctx, x, y, w, h, r) {
  const radius = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, radius);
}

/** Unlocked padlock: shackle swung open, round body, round keyhole. */
function drawOpenLock(ctx, x, y, size) {
  ctx.save();
  ctx.strokeStyle = ICON_FG;
  ctx.fillStyle = ICON_FG;
  ctx.lineWidth = Math.max(2, size * 0.145);
  ctx.lineCap = "round";
  ctx.lineJoin = "round";

  const cx = x + size / 2 - size * 0.04;
  const shackleR = size * 0.27;
  const shackleCx = cx + size * 0.1;
  const shackleCy = y + size * 0.33;
  ctx.beginPath();
  ctx.arc(shackleCx, shackleCy, shackleR, Math.PI * 0.92, Math.PI * 0.08, false);
  ctx.stroke();

  const bodyW = size * 0.78;
  const bodyH = size * 0.54;
  const bx = cx - bodyW / 2;
  const by = y + size * 0.42;
  roundRect(ctx, bx, by, bodyW, bodyH, bodyH * 0.38);
  ctx.fill();

  ctx.fillStyle = ICON_BG;
  ctx.beginPath();
  ctx.arc(cx, by + bodyH * 0.48, Math.max(1.5, size * 0.09), 0, Math.PI * 2);
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
  drawOpenLock(ctx, x, y, lockSize);
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
