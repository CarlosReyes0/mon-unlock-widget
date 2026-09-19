/**
 * Home-screen / PWA icons for Open Paywall.
 *
 * A newspaper with no type: a folded sheet on Monad purple.
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
const PAPER = "#FFFDF8";
const CREASE = "rgba(110, 84, 255, 0.28)";
const BACK = "#E4DCFF";

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, Math.max(0.4, Math.min(r, w / 2, h / 2)));
}

function drawNewspaper(ctx, size) {
  const w = size * 0.62;
  const h = size * 0.68;
  const peek = size * 0.032;
  const r = size * 0.03;
  const x = (size - (w + peek)) / 2;
  const y = (size - (h + peek)) / 2;

  ctx.fillStyle = BACK;
  roundRect(ctx, x + peek, y + peek, w, h, r);
  ctx.fill();

  ctx.fillStyle = PAPER;
  roundRect(ctx, x, y, w, h, r);
  ctx.fill();

  const foldY = y + h * 0.5;
  ctx.fillStyle = CREASE;
  ctx.fillRect(x, foldY, w, Math.max(1, size * 0.012));
}

export function renderAppIconPng(size) {
  const canvas = createCanvas(size, size);
  const ctx = canvas.getContext("2d");
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.fillStyle = ICON_BG;
  ctx.fillRect(0, 0, size, size);
  drawNewspaper(ctx, size);
  return canvas.toBuffer("image/png");
}

export const ICON_FILES = [
  { rel: "apple-touch-icon.png", size: 180 },
  { rel: "assets/icon-32.png", size: 32 },
  { rel: "assets/icon-192.png", size: 192 },
  { rel: "assets/icon-512.png", size: 512 },
];

export function writeAppIcons(root = ROOT) {
  const written = [];
  for (const file of ICON_FILES) {
    const out = path.join(root, file.rel);
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, renderAppIconPng(file.size));
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
