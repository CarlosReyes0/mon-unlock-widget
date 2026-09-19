/**
 * Home-screen / PWA icons for Open Paywall.
 *
 * The mark is a typeset book page (leaves in a book) on Monad purple —
 * not a file icon, not a lock, not a wordmark.
 *
 *   node scripts/generate-app-icons.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createCanvas, GlobalFonts } from "@napi-rs/canvas";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const FONT_DIR = path.join(ROOT, "server", "og-fonts");
const FONT_LITERATA = "OP Literata";

/** Monad primary purple (brand kit). */
export const ICON_BG = "#6E54FF";
const PAPER = "#FFFDF8";
const INK = "#6E54FF";
const PAGE_BACK = "#D4C9FF";
const PAGE_MID = "#EDE8FF";

const BODY = [
  "The press still smelled",
  "of solvent at five.",
  "Four pages, same as",
  "Thursday last, and the",
  "town bought them not",
  "because they surprised",
  "anyone, but because",
  "they were theirs.",
];

let fontsRegistered = false;
function ensureFonts() {
  if (fontsRegistered) return;
  GlobalFonts.registerFromPath(path.join(FONT_DIR, "Literata-SemiBold.ttf"), FONT_LITERATA);
  fontsRegistered = true;
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, Math.max(0.5, Math.min(r, w / 2, h / 2)));
}

function drawType(ctx, x, y, maxW, size) {
  ctx.fillStyle = INK;
  if (size < 72) {
    const barH = Math.max(1.4, size * 0.026);
    const gap = barH * 0.72;
    const widths = [1, 0.94, 0.9, 0.86, 0.72, 0.88, 0.8, 0.58];
    let yy = y;
    for (const f of widths) {
      roundRect(ctx, x, yy, maxW * f, barH, barH / 2);
      ctx.fill();
      yy += barH + gap;
    }
    return;
  }
  ensureFonts();
  const px = size * 0.038;
  ctx.font = `600 ${px}px "${FONT_LITERATA}"`;
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
  let yy = y + px;
  const lh = px * 1.34;
  for (const line of BODY) {
    ctx.fillText(line, x, yy, maxW);
    yy += lh;
  }
}

function drawFolio(ctx, cx, y, size) {
  if (size < 72) return;
  ensureFonts();
  const px = size * 0.032;
  ctx.fillStyle = INK;
  ctx.font = `600 ${px}px "${FONT_LITERATA}"`;
  ctx.textAlign = "center";
  ctx.textBaseline = "alphabetic";
  ctx.fillText("12", cx, y);
}

function drawBookPage(ctx, size) {
  const pad = size * 0.175;
  const h = size - pad * 2;
  const w = h * 0.7;
  const r = size * 0.026;
  const peek = size * 0.026;
  const x = (size - (w + peek * 2.4)) / 2;
  const y = pad;

  ctx.fillStyle = PAGE_BACK;
  roundRect(ctx, x + peek * 2.4, y + peek * 0.85, w, h, r);
  ctx.fill();
  ctx.fillStyle = PAGE_MID;
  roundRect(ctx, x + peek * 1.2, y + peek * 0.4, w, h, r);
  ctx.fill();
  ctx.fillStyle = PAPER;
  roundRect(ctx, x, y, w, h, r);
  ctx.fill();

  ctx.save();
  roundRect(ctx, x, y, w, h, r);
  ctx.clip();
  const mx = x + w * 0.16;
  const my = y + h * 0.13;
  drawType(ctx, mx, my, w * 0.7, size);
  drawFolio(ctx, x + w / 2, y + h * 0.91, size);
  ctx.restore();
}

export function renderAppIconPng(size) {
  const canvas = createCanvas(size, size);
  const ctx = canvas.getContext("2d");
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.fillStyle = ICON_BG;
  ctx.fillRect(0, 0, size, size);
  drawBookPage(ctx, size);
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
