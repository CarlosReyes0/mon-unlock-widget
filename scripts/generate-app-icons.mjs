/**
 * Home-screen / PWA icons for Open Paywall.
 *
 * A simple newspaper: sheet, masthead bar, three columns of lines.
 * Monad purple. Not a typeset front page, not a Material fold glyph.
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
const INK = "#6E54FF";

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, Math.max(0.4, Math.min(r, w / 2, h / 2)));
}

function drawNewspaper(ctx, size) {
  const w = size * 0.64;
  const h = size * 0.7;
  const x = (size - w) / 2;
  const y = (size - h) / 2;
  const r = size * 0.028;
  const inset = w * 0.1;

  ctx.fillStyle = PAPER;
  roundRect(ctx, x, y, w, h, r);
  ctx.fill();

  ctx.fillStyle = INK;
  const headH = h * 0.11;
  roundRect(ctx, x + inset, y + h * 0.1, w - inset * 2, headH, headH * 0.18);
  ctx.fill();

  const colY = y + h * 0.3;
  const colH = h * 0.54;
  const gutter = w * 0.055;
  const colW = (w - inset * 2 - gutter * 2) / 3;
  const lines = 5;
  const barH = Math.max(1.6, size * 0.018);
  const gap = (colH - barH * lines) / (lines - 1);
  const rags = [
    [1, 1, 0.92, 1, 0.7],
    [1, 0.88, 1, 0.94, 0.62],
    [1, 1, 0.84, 1, 0.75],
  ];
  for (let c = 0; c < 3; c++) {
    const cx = x + inset + c * (colW + gutter);
    for (let i = 0; i < lines; i++) {
      const bw = colW * rags[c][i];
      roundRect(ctx, cx, colY + i * (barH + gap), bw, barH, barH / 2);
      ctx.fill();
    }
  }
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
