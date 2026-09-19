/**
 * Home-screen / PWA icons for Open Paywall.
 *
 * Just the words, stacked and left-aligned:
 *   Open
 *   Paywall
 * Open is widened (same letter shapes, thicker) so it matches Paywall’s length.
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

function drawPhrase(ctx, size) {
  ensureFonts();
  ctx.fillStyle = ICON_FG;
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";

  const maxW = size * 0.78;
  let px = size * 0.22;
  const font = () => {
    ctx.font = `600 ${px}px "${FONT_LITERATA}"`;
  };
  font();
  while (px > 8 && ctx.measureText("Paywall").width > maxW) {
    px -= 0.5;
    font();
  }

  const payW = ctx.measureText("Paywall").width;
  const openW = Math.max(1, ctx.measureText("Open").width);
  const openScale = payW / openW;
  const cap = ctx.measureText("Hg").actualBoundingBoxAscent || px * 0.78;
  const openDesc = ctx.measureText("Open").actualBoundingBoxDescent || px * 0.22;
  const payDesc = ctx.measureText("Paywall").actualBoundingBoxDescent || px * 0.22;
  const gap = openDesc + px * 0.06;
  const blockH = cap * 2 + gap + payDesc;
  const x0 = (size - payW) / 2;
  let y = (size - blockH) / 2 + cap;

  font();
  ctx.save();
  ctx.translate(x0, y);
  ctx.scale(openScale, 1);
  ctx.fillText("Open", 0, 0);
  ctx.restore();

  y += cap + gap;
  ctx.fillText("Paywall", x0, y);
}

export function renderAppIconPng(size) {
  const canvas = createCanvas(size, size);
  const ctx = canvas.getContext("2d");
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.fillStyle = ICON_BG;
  ctx.fillRect(0, 0, size, size);
  drawPhrase(ctx, size);
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
