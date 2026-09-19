/**
 * Home-screen / PWA icons for Open Paywall.
 *
 * The mark is the product name, stacked, in Literata — not a pictogram.
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
export const ICON_FG = "#ffffff";

let fontsRegistered = false;
function ensureFonts() {
  if (fontsRegistered) return;
  GlobalFonts.registerFromPath(path.join(FONT_DIR, "Literata-SemiBold.ttf"), FONT_LITERATA);
  fontsRegistered = true;
}

function drawWordmark(ctx, size) {
  ensureFonts();
  ctx.fillStyle = ICON_FG;
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
  const lines = ["Open", "Paywall"];
  const pad = size * 0.14;
  const maxW = size - pad * 2;
  let px = size * 0.2;
  const font = () => {
    ctx.font = `600 ${px}px "${FONT_LITERATA}"`;
  };
  font();
  const longest = lines.reduce((a, b) =>
    ctx.measureText(a).width > ctx.measureText(b).width ? a : b
  );
  while (px > 6 && ctx.measureText(longest).width > maxW) {
    px -= 0.5;
    font();
  }
  const cap = ctx.measureText("Hg").actualBoundingBoxAscent || px * 0.78;
  const openDesc = ctx.measureText("Open").actualBoundingBoxDescent || px * 0.22;
  const payDesc = ctx.measureText("Paywall").actualBoundingBoxDescent || px * 0.22;
  // Keep Open's p from sitting on Paywall; include Paywall's y in the vertical box.
  const gap = openDesc + px * 0.1;
  const blockH = cap * lines.length + gap * (lines.length - 1) + payDesc;
  const blockW = Math.max(...lines.map((t) => ctx.measureText(t).width));
  const x0 = (size - blockW) / 2;
  let y = (size - blockH) / 2 + cap;
  for (const line of lines) {
    font();
    ctx.fillText(line, x0, y);
    y += cap + gap;
  }
}

export function renderAppIconPng(size) {
  const canvas = createCanvas(size, size);
  const ctx = canvas.getContext("2d");
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.fillStyle = ICON_BG;
  ctx.fillRect(0, 0, size, size);
  drawWordmark(ctx, size);
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
