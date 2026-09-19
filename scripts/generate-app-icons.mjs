/**
 * Home-screen / PWA icons for Open Paywall.
 *
 * The mark is a newspaper front page — nameplate, headline, columns —
 * on Monad purple. Not a Material folded-paper glyph.
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
const INK_DEEP = "#3F2BD4";

const COLUMNS = [
  [
    "The county paper",
    "kept four pages",
    "and the town still",
    "bought them, not",
    "for surprise, but",
    "because they were",
    "theirs to keep.",
    "Thursday, same as",
    "the week before.",
    "The press smelled",
    "of solvent at five.",
    "Maya ran the same",
    "route her father",
    "had, before dawn.",
  ],
  [
    "She held the last",
    "column for names.",
    "A chain offer came",
    "with confidence,",
    "enough to retire,",
    "not enough to",
    "replace the paper.",
    "Unlock once. Read",
    "here and on the",
    "publisher’s site.",
    "Keep the piece.",
    "One payment, two",
    "places to read it.",
    "The gate stays open.",
  ],
  [
    "Pay per article.",
    "No subscription,",
    "no platform cut.",
    "The gate opens",
    "and stays open.",
    "A morning edition",
    "that still fits in",
    "the hand, priced",
    "like a paragraph",
    "worth the tap.",
    "Vol. 12 — today.",
    "Writers list here.",
    "Price on the piece.",
    "Read it through.",
  ],
];

let fontsRegistered = false;
function ensureFonts() {
  if (fontsRegistered) return;
  GlobalFonts.registerFromPath(path.join(FONT_DIR, "Literata-SemiBold.ttf"), FONT_LITERATA);
  fontsRegistered = true;
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, Math.max(0.4, Math.min(r, w / 2, h / 2)));
}

function colBars(ctx, x, y, w, h, size) {
  ctx.fillStyle = INK;
  const barH = Math.max(1.05, size * 0.011);
  const gap = barH * 0.65;
  const pattern = [1, 0.96, 0.9, 1, 0.84, 0.94, 0.72, 1, 0.88, 0.92, 0.8];
  let yy = y;
  let i = 0;
  while (yy + barH < y + h) {
    const f = pattern[i % pattern.length];
    roundRect(ctx, x, yy, w * f, barH, barH / 2);
    ctx.fill();
    yy += barH + gap;
    i++;
  }
}

function colText(ctx, x, y, w, size, lines) {
  ensureFonts();
  const px = size * 0.02;
  ctx.fillStyle = INK;
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
  ctx.font = `600 ${px}px "${FONT_LITERATA}"`;
  let yy = y + px;
  const lh = px * 1.26;
  for (const line of lines) {
    ctx.fillText(line, x, yy, w);
    yy += lh;
  }
}

function drawNewspaper(ctx, size) {
  const w = size * 0.72;
  const h = size * 0.78;
  const x = (size - w) / 2;
  const y = (size - h) / 2;
  const r = size * 0.02;

  ctx.fillStyle = "rgba(28, 12, 80, 0.16)";
  roundRect(ctx, x + size * 0.006, y + size * 0.008, w, h, r);
  ctx.fill();
  ctx.fillStyle = PAPER;
  roundRect(ctx, x, y, w, h, r);
  ctx.fill();

  ctx.save();
  roundRect(ctx, x, y, w, h, r);
  ctx.clip();

  ensureFonts();
  ctx.fillStyle = INK_DEEP;
  ctx.textAlign = "center";
  ctx.textBaseline = "alphabetic";
  const namePx = size * 0.068;
  ctx.font = `600 ${namePx}px "${FONT_LITERATA}"`;
  ctx.fillText("Open Paywall", x + w / 2, y + h * 0.145, w * 0.88);

  const ruleY = y + h * 0.17;
  const ruleX = x + w * 0.08;
  const ruleW = w * 0.84;
  ctx.fillStyle = INK;
  ctx.fillRect(ruleX, ruleY, ruleW, Math.max(1, size * 0.008));
  ctx.fillRect(ruleX, ruleY + size * 0.014, ruleW, Math.max(1, size * 0.004));

  ctx.fillStyle = INK_DEEP;
  ctx.textAlign = "left";
  const headPx = size * 0.042;
  ctx.font = `600 ${headPx}px "${FONT_LITERATA}"`;
  const hx = x + w * 0.08;
  let hy = ruleY + size * 0.055 + headPx;
  ctx.fillText("The county paper that", hx, hy, w * 0.84);
  hy += headPx * 1.12;
  ctx.fillText("wouldn’t sell", hx, hy, w * 0.84);

  const rule2 = hy + size * 0.022;
  ctx.fillStyle = INK;
  ctx.fillRect(ruleX, rule2, ruleW, Math.max(1, size * 0.005));

  const colY = rule2 + size * 0.028;
  const inset = w * 0.08;
  const gutter = w * 0.035;
  const colW = (w - inset * 2 - gutter * 2) / 3;
  const colH = y + h - colY - h * 0.06;
  for (let i = 0; i < 3; i++) {
    const cx = x + inset + i * (colW + gutter);
    if (size >= 120) colText(ctx, cx, colY, colW, size, COLUMNS[i]);
    else colBars(ctx, cx, colY, colW, colH, size);
  }
  ctx.restore();
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
