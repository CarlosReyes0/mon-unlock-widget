/**
 * Per-article Open Graph share cards (layout B: photo left, title + Unlock right).
 *
 * Generated server-side so Twitterbot / Slackbot / iMessage see a real JPEG
 * without running article page JS. No Supabase image column — cards are derived
 * from listing title / teaser / price and cached on disk.
 *
 * Fonts in og-fonts/ are SIL OFL (DM Sans + Literata). See og-fonts/OFL.txt.
 */
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createCanvas, GlobalFonts, loadImage } from "@napi-rs/canvas";
import {
  OG_IMAGE_HEIGHT,
  OG_IMAGE_WIDTH,
  SITE_NAME,
  plainText,
} from "./article-og.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const FONT_DIR = path.join(__dirname, "og-fonts");
const PHOTO_PATH = path.join(ROOT, "assets", "home-hero.jpg");
const DEFAULT_OG_PATH = path.join(ROOT, "assets", "og-default.jpg");

export const OG_JPEG_QUALITY = 90;
export const DEFAULT_OG_PRICE_LABEL = "$0.50 USDC";

const FONT_LITERATA = "OP Literata";
const FONT_SANS = "OP DM Sans";
const FONT_SANS_MED = "OP DM Sans Medium";
const FONT_SANS_SEMI = "OP DM Sans SemiBold";

const BG = "#f4f3f0";
const INK = "#111827";
const MUTED = "#57534e";
const BRAND = "#6b7280";
const MINT = "#b7ebd4";
const MINT_INK = "#0f766e";
const MINT_LINE = "#9fe8c9";
const LOCK = "#5ec4a0";
const BUTTON = "#111111";

let fontsRegistered = false;
let photoPromise = null;
const inflight = new Map();

function cacheDir() {
  return process.env.OG_CACHE_DIR || path.join(os.tmpdir(), "openpaywall-og");
}

export function isSafeOgSlug(slug) {
  const s = String(slug || "");
  if (!s || s.length > 80) return false;
  if (s.includes("..") || s.includes("/") || s.includes("\\")) return false;
  return /^[a-zA-Z0-9._-]+$/.test(s);
}

/** `/og/{slug}.jpg` → slug, or null if the path is not a card URL. */
export function parseOgImagePath(pathname) {
  const m = String(pathname || "").match(/^\/og\/([^/]+)\.jpe?g$/i);
  if (!m) return null;
  let slug;
  try {
    slug = decodeURIComponent(m[1]);
  } catch {
    return null;
  }
  return isSafeOgSlug(slug) ? slug : null;
}

export function formatOgPriceLabel(article = {}) {
  const assetRaw = String(article.paymentAsset || article.payment_asset || "usdc")
    .trim()
    .toLowerCase();
  const asset = assetRaw === "mon" ? "mon" : "usdc";
  const wei = article.priceWei ?? article.price_wei;
  if (wei != null && String(wei).trim() !== "") {
    try {
      const n = BigInt(wei);
      if (asset === "usdc") {
        if (n >= 0n && n <= 10_000_000_000n) {
          return `$${(Number(n) / 1_000_000).toFixed(2)} USDC`;
        }
      } else {
        const whole = n / 10n ** 18n;
        const frac = n % 10n ** 18n;
        const fracStr = frac.toString().padStart(18, "0").slice(0, 4).replace(/0+$/, "");
        return fracStr ? `${whole}.${fracStr} MON` : `${whole} MON`;
      }
    } catch {
      /* fall through */
    }
  }
  const explicit = String(article.priceLabel || "").trim();
  if (explicit) return explicit;
  return DEFAULT_OG_PRICE_LABEL;
}

export function jpegDimensions(buf) {
  const b = Buffer.isBuffer(buf) ? buf : Buffer.from(buf);
  if (b.length < 10 || b[0] !== 0xff || b[1] !== 0xd8) return null;
  let i = 2;
  while (i + 9 < b.length) {
    if (b[i] !== 0xff) {
      i += 1;
      continue;
    }
    const marker = b[i + 1];
    if (marker === 0xd9 || marker === 0xda) break;
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      i += 2;
      continue;
    }
    const len = b.readUInt16BE(i + 2);
    if (len < 2) return null;
    if (marker === 0xc0 || marker === 0xc1 || marker === 0xc2) {
      return {
        height: b.readUInt16BE(i + 5),
        width: b.readUInt16BE(i + 7),
      };
    }
    i += 2 + len;
  }
  return null;
}

function ensureFonts() {
  if (fontsRegistered) return;
  GlobalFonts.registerFromPath(path.join(FONT_DIR, "Literata-SemiBold.ttf"), FONT_LITERATA);
  GlobalFonts.registerFromPath(path.join(FONT_DIR, "DMSans-Regular.ttf"), FONT_SANS);
  GlobalFonts.registerFromPath(path.join(FONT_DIR, "DMSans-Medium.ttf"), FONT_SANS_MED);
  GlobalFonts.registerFromPath(path.join(FONT_DIR, "DMSans-SemiBold.ttf"), FONT_SANS_SEMI);
  fontsRegistered = true;
}

function loadPhoto() {
  if (!photoPromise) photoPromise = loadImage(PHOTO_PATH);
  return photoPromise;
}

export function defaultOgJpegBuffer() {
  return fs.readFileSync(DEFAULT_OG_PATH);
}

function roundRect(ctx, x, y, w, h, r) {
  const radius = Math.max(0, Math.min(r, w / 2, h / 2));
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, radius);
}

function wrapLines(ctx, text, maxWidth, maxLines) {
  const fits = (s) => ctx.measureText(s).width <= maxWidth;
  const tokens = String(text || "")
    .split(/\s+/)
    .filter(Boolean)
    .flatMap((word) => {
      if (fits(word)) return [word];
      const parts = [];
      let buf = "";
      for (const ch of word) {
        if (fits(buf + ch)) buf += ch;
        else {
          if (buf) parts.push(buf);
          buf = ch;
        }
      }
      if (buf) parts.push(buf);
      return parts;
    });
  if (!tokens.length) return [];

  const lines = [];
  let i = 0;
  while (i < tokens.length && lines.length < maxLines) {
    const lastLine = lines.length === maxLines - 1;
    let line = tokens[i];
    i += 1;
    while (i < tokens.length) {
      const trial = `${line} ${tokens[i]}`;
      if (fits(trial)) {
        line = trial;
        i += 1;
      } else break;
    }
    if (lastLine && i < tokens.length) {
      const rest = `${line} ${tokens.slice(i).join(" ")}`;
      if (fits(rest)) {
        lines.push(rest);
      } else {
        let cut = rest;
        while (cut.length && !fits(`${cut}…`)) cut = cut.slice(0, -1);
        lines.push(`${(cut.trim() || rest.slice(0, 1)).trim()}…`);
      }
      break;
    }
    lines.push(line);
  }
  return lines;
}

function drawCover(ctx, img, dx, dy, dw, dh) {
  const iw = img.width;
  const ih = img.height;
  const scale = Math.max(dw / iw, dh / ih);
  const sw = dw / scale;
  const sh = dh / scale;
  const focusX = 0.62;
  const focusY = 0.52;
  const sx = Math.max(0, Math.min(iw - sw, iw * focusX - sw / 2));
  const sy = Math.max(0, Math.min(ih - sh, ih * focusY - sh / 2));
  ctx.drawImage(img, sx, sy, sw, sh, dx, dy, dw, dh);
}

function drawLock(ctx, x, y, size = 18) {
  ctx.save();
  ctx.strokeStyle = LOCK;
  ctx.fillStyle = LOCK;
  ctx.lineWidth = Math.max(2.4, size * 0.18);
  ctx.lineCap = "round";
  const cx = x + size / 2;
  const shackleR = size * 0.28;
  ctx.beginPath();
  ctx.arc(cx, y + size * 0.38, shackleR, Math.PI, 0, false);
  ctx.stroke();
  const bodyW = size * 0.72;
  const bodyH = size * 0.5;
  roundRect(ctx, cx - bodyW / 2, y + size * 0.4, bodyW, bodyH, 3.5);
  ctx.fill();
  ctx.restore();
}

function articleFingerprint(article) {
  return createHash("sha1")
    .update(
      JSON.stringify({
        t: article?.title || "",
        s: article?.teaser || "",
        p: String(article?.priceWei ?? article?.price_wei ?? ""),
        a: article?.paymentAsset || article?.payment_asset || "",
        l: article?.priceLabel || "",
      })
    )
    .digest("hex")
    .slice(0, 16);
}

/**
 * Layout B: 1200×630 JPEG — rounded brand photo on the left, title + price + Unlock on the right.
 * @param {{ title?: string, teaser?: string, priceLabel?: string, priceWei?: string, paymentAsset?: string }} article
 */
export async function renderOgJpeg(article = {}) {
  ensureFonts();
  const photo = await loadPhoto();
  const title = plainText(article?.title, 90) || SITE_NAME;
  const teaser =
    plainText(article?.teaser, 180) ||
    "Read this article on Open Paywall. One unlock works here and on the publisher’s site.";
  const priceLabel = formatOgPriceLabel(article);

  const W = OG_IMAGE_WIDTH;
  const H = OG_IMAGE_HEIGHT;
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext("2d");
  ctx.textBaseline = "alphabetic";
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";

  ctx.fillStyle = BG;
  ctx.fillRect(0, 0, W, H);

  const bar = ctx.createLinearGradient(0, 0, W, 0);
  bar.addColorStop(0, "#5eead4");
  bar.addColorStop(0.55, "#99f6e4");
  bar.addColorStop(1, "#bbf7d0");
  ctx.fillStyle = bar;
  ctx.fillRect(0, 0, W, 8);

  const pad = 52;
  const photoSize = 510;
  const px = pad;
  const py = Math.round((H - photoSize) / 2) + 2;
  const radius = 36;

  ctx.save();
  ctx.shadowColor = "rgba(15, 23, 42, 0.16)";
  ctx.shadowBlur = 28;
  ctx.shadowOffsetY = 10;
  roundRect(ctx, px, py, photoSize, photoSize, radius);
  ctx.fillStyle = "#d6d3d1";
  ctx.fill();
  ctx.restore();

  ctx.save();
  roundRect(ctx, px, py, photoSize, photoSize, radius);
  ctx.clip();
  drawCover(ctx, photo, px, py, photoSize, photoSize);
  const fade = ctx.createLinearGradient(0, py + photoSize * 0.55, 0, py + photoSize);
  fade.addColorStop(0, "rgba(0,0,0,0)");
  fade.addColorStop(1, "rgba(17, 24, 39, 0.48)");
  ctx.fillStyle = fade;
  ctx.fillRect(px, py, photoSize, photoSize);

  ctx.font = `600 52px "${FONT_LITERATA}"`;
  ctx.fillStyle = "#ffffff";
  const word = "Paywall";
  const wx = px + 36;
  const wy = py + photoSize - 52;
  ctx.fillText(word, wx, wy);
  const underlineW = ctx.measureText(word).width * 0.48;
  ctx.fillStyle = MINT_LINE;
  roundRect(ctx, wx, wy + 14, underlineW, 5, 2);
  ctx.fill();
  ctx.restore();

  const rx = px + photoSize + 48;
  const rw = W - rx - pad;
  let y = py + 18;

  drawLock(ctx, rx, y, 22);
  ctx.font = `500 22px "${FONT_SANS_MED}"`;
  ctx.fillStyle = BRAND;
  ctx.fillText(SITE_NAME, rx + 32, y + 18);
  y += 52;

  ctx.font = `600 20px "${FONT_SANS_SEMI}"`;
  const pillPadX = 18;
  const pillH = 40;
  const pillW = Math.ceil(ctx.measureText(priceLabel).width) + pillPadX * 2;
  roundRect(ctx, rx, y, pillW, pillH, 20);
  ctx.fillStyle = MINT;
  ctx.fill();
  ctx.fillStyle = MINT_INK;
  ctx.fillText(priceLabel, rx + pillPadX, y + 27);
  y += 72;

  let titleSize = 56;
  let titleLines = [];
  let titleLh = 62;
  for (const size of [56, 50, 44, 38, 34]) {
    ctx.font = `600 ${size}px "${FONT_LITERATA}"`;
    titleLines = wrapLines(ctx, title, rw, 3);
    titleLh = Math.round(size * 1.12);
    if (titleLines.length * titleLh <= 186) {
      titleSize = size;
      break;
    }
  }
  ctx.font = `600 ${titleSize}px "${FONT_LITERATA}"`;
  ctx.fillStyle = INK;
  for (const line of titleLines) {
    ctx.fillText(line, rx, y);
    y += titleLh;
  }
  y += 18;

  ctx.font = `400 22px "${FONT_SANS}"`;
  ctx.fillStyle = MUTED;
  const teaserLines = wrapLines(ctx, teaser, rw, 3);
  const teaserLh = 32;
  for (const line of teaserLines) {
    ctx.fillText(line, rx, y);
    y += teaserLh;
  }

  y += 28;
  const btnW = 188;
  const btnH = 56;
  const maxBtnY = H - pad - btnH;
  if (y > maxBtnY) y = maxBtnY;
  roundRect(ctx, rx, y, btnW, btnH, 12);
  ctx.fillStyle = BUTTON;
  ctx.fill();
  ctx.font = `500 20px "${FONT_SANS_MED}"`;
  ctx.fillStyle = "#ffffff";
  ctx.textAlign = "center";
  ctx.fillText("Unlock", rx + btnW / 2, y + 35);
  ctx.textAlign = "left";

  const jpeg = await canvas.encode("jpeg", OG_JPEG_QUALITY);
  return Buffer.from(jpeg);
}

async function writeCache(filePath, buf) {
  await fs.promises.mkdir(path.dirname(filePath), { recursive: true });
  const tmp = `${filePath}.${process.pid}.tmp`;
  await fs.promises.writeFile(tmp, buf);
  await fs.promises.rename(tmp, filePath);
}

export async function renderArticleOgJpeg(slug, article) {
  const safe = isSafeOgSlug(slug) ? slug : "article";
  const fp = articleFingerprint(article);
  const filePath = path.join(cacheDir(), `${safe}-${fp}.jpg`);
  try {
    const cached = await fs.promises.readFile(filePath);
    if (cached[0] === 0xff && cached[1] === 0xd8) return cached;
  } catch {
    /* generate */
  }
  const key = filePath;
  if (inflight.has(key)) return inflight.get(key);
  const pending = renderOgJpeg(article)
    .then(async (buf) => {
      try {
        await writeCache(filePath, buf);
      } catch {
        /* still return the buffer */
      }
      return buf;
    })
    .finally(() => inflight.delete(key));
  inflight.set(key, pending);
  return pending;
}

export function warmupOgCard(slug, article) {
  if (!slug || !article) return;
  renderArticleOgJpeg(slug, article).catch((err) => {
    console.error("[og-card] warmup failed:", err?.message || err);
  });
}

/**
 * Load listing (when available) and return a 1200×630 JPEG.
 * Missing listing or generator failure → bundled default card.
 */
export async function getArticleOgJpeg(slug, { loadArticle } = {}) {
  let article = null;
  if (typeof loadArticle === "function" && slug) {
    try {
      article = await loadArticle(slug);
    } catch {
      article = null;
    }
  }
  if (!article) return defaultOgJpegBuffer();
  try {
    return await renderArticleOgJpeg(slug, article);
  } catch (err) {
    console.error("[og-card] generate failed:", err?.message || err);
    return defaultOgJpegBuffer();
  }
}
