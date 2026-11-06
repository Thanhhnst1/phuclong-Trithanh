import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import sharp, { type OverlayOptions } from 'sharp';
import { paths } from '../config.js';
import { assets } from '../db/index.js';
import type { Asset } from '../core/types.js';

export const absPath = (rel: string) => {
  const p = path.resolve(paths.media, rel);
  if (!p.startsWith(path.resolve(paths.media))) throw new Error('Đường dẫn không hợp lệ');
  return p;
};

const MIME: Record<string, string> = {
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif',
  '.mp4': 'video/mp4', '.mov': 'video/quicktime', '.mp3': 'audio/mpeg', '.m4a': 'audio/mp4', '.wav': 'audio/wav',
  '.pdf': 'application/pdf', '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.svg': 'image/svg+xml',
};
export const mimeOf = (file: string) => MIME[path.extname(file).toLowerCase()] ?? 'application/octet-stream';
export const kindOf = (mime: string): Asset['kind'] =>
  mime.startsWith('image/') ? 'image' : mime.startsWith('video/') ? 'video' : mime.startsWith('audio/') ? 'audio' : 'document';

export const ALLOWED_UPLOAD = new Set(Object.keys(MIME).filter((e) => e !== '.svg'));

/** Perceptual difference hash (64-bit, hex) used to detect duplicate images. */
export async function dHash(input: Buffer | string): Promise<string> {
  const raw = await sharp(input).grayscale().resize(9, 8, { fit: 'fill' }).raw().toBuffer();
  let bits = '';
  for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) bits += raw[y * 9 + x] > raw[y * 9 + x + 1] ? '1' : '0';
  return BigInt('0b' + bits).toString(16).padStart(16, '0');
}

export function hamming(a: string, b: string) {
  let x = BigInt('0x' + a) ^ BigInt('0x' + b);
  let n = 0;
  while (x) {
    n += Number(x & 1n);
    x >>= 1n;
  }
  return n;
}

/** Store a buffer as a media file and register it as an asset. */
export async function storeAsset(opts: {
  buffer: Buffer;
  filename: string;
  campaignId: string | null;
  role: Asset['role'];
  source: string;
  license: string;
  label?: string;
  derivedFrom?: string | null;
  meta?: any;
}): Promise<Asset> {
  const ext = path.extname(opts.filename).toLowerCase() || '.bin';
  const dir = opts.campaignId ?? 'library';
  const rel = path.join(dir, `${Date.now().toString(36)}-${crypto.randomBytes(4).toString('hex')}${ext}`);
  fs.mkdirSync(path.dirname(absPath(rel)), { recursive: true });
  fs.writeFileSync(absPath(rel), opts.buffer);
  const mime = mimeOf(rel);
  let width: number | null = null, height: number | null = null, hash: string | null = null;
  if (mime.startsWith('image/')) {
    const m = await sharp(opts.buffer).metadata();
    width = m.width ?? null;
    height = m.height ?? null;
    hash = await dHash(opts.buffer);
  }
  return assets.create({
    campaignId: opts.campaignId, kind: opts.role === 'report' ? 'report' : kindOf(mime), role: opts.role, path: rel, mime,
    width, height, hash, source: opts.source, license: opts.license,
    label: opts.label ?? path.basename(opts.filename, ext), derivedFrom: opts.derivedFrom ?? null, meta: opts.meta ?? {},
  });
}

// ---------------- image editing ----------------

export const FORMATS = {
  square: { w: 1080, h: 1080, label: 'Vuông 1:1' },
  portrait: { w: 1080, h: 1350, label: 'Dọc 4:5' },
  vertical: { w: 1080, h: 1920, label: 'Dọc 9:16' },
  landscape: { w: 1200, h: 630, label: 'Ngang 1.91:1' },
} as const;
export type FormatKey = keyof typeof FORMATS;

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[c]!);

function wrap(text: string, maxChars: number, maxLines: number) {
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let cur = '';
  for (const w of words) {
    if ((cur + ' ' + w).trim().length > maxChars) {
      if (cur) lines.push(cur);
      cur = w;
    } else cur = (cur + ' ' + w).trim();
  }
  if (cur) lines.push(cur);
  if (lines.length > maxLines) {
    lines.length = maxLines;
    lines[maxLines - 1] = lines[maxLines - 1].replace(/.{0,2}$/, '…');
  }
  return lines;
}

export interface PosterOptions {
  format: FormatKey;
  title: string;
  subtitle?: string;
  palette?: { bg1: string; bg2: string; accent: string; text: string };
  logo?: Buffer | null;
}

const DEFAULT_PALETTE = { bg1: '#FFF4E6', bg2: '#FFE0EC', accent: '#E8505B', text: '#2B2D42' };

/**
 * Compose a marketing poster: pastel gradient background, product photo (contain),
 * headline + subtitle text (DejaVu Sans covers Vietnamese) and optional logo.
 */
export async function renderPoster(product: Buffer, o: PosterOptions): Promise<Buffer> {
  const { w, h } = FORMATS[o.format];
  const pal = o.palette ?? DEFAULT_PALETTE;
  const textZone = Math.round(h * (o.format === 'landscape' ? 0.3 : 0.26));
  const pad = Math.round(w * 0.06);
  const titleSize = Math.round(w * (o.format === 'landscape' ? 0.045 : 0.062));
  const subSize = Math.round(titleSize * 0.55);
  const titleLines = wrap(o.title, Math.floor((w - pad * 2) / (titleSize * 0.66)), 2);
  const subLines = o.subtitle ? wrap(o.subtitle, Math.floor((w - pad * 2) / (subSize * 0.62)), 2) : [];

  const bg = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">
    <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${pal.bg1}"/><stop offset="1" stop-color="${pal.bg2}"/></linearGradient></defs>
    <rect width="100%" height="100%" fill="url(#g)"/>
    <circle cx="${w * 0.85}" cy="${h * 0.12}" r="${w * 0.18}" fill="#ffffff" opacity="0.35"/>
    <circle cx="${w * 0.1}" cy="${h * 0.7}" r="${w * 0.12}" fill="#ffffff" opacity="0.3"/>
    <ellipse cx="${w / 2}" cy="${h - textZone - h * 0.03}" rx="${w * 0.33}" ry="${h * 0.025}" fill="#000" opacity="0.08"/>
  </svg>`);

  const areaW = w - pad * 2;
  const areaH = h - textZone - pad * 2;
  const prod = await sharp(product)
    .resize(areaW, areaH, { fit: 'inside', withoutEnlargement: false })
    .png()
    .toBuffer();
  // Remove near-white backgrounds so products sit on the gradient.
  const prodMeta = await sharp(prod).metadata();
  const knocked = await knockOutWhite(prod);

  let y = h - textZone + titleSize;
  const textSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">
    <rect x="0" y="${h - textZone}" width="${w}" height="${textZone}" fill="#ffffff" opacity="0.72"/>
    <rect x="${pad}" y="${h - textZone + 8}" width="${w * 0.12}" height="8" rx="4" fill="${pal.accent}"/>
    ${titleLines.map((l, i) => `<text x="${pad}" y="${y + i * titleSize * 1.15 + 16}" font-family="DejaVu Sans" font-weight="bold" font-size="${titleSize}" fill="${pal.text}">${esc(l)}</text>`).join('')}
    ${subLines.map((l, i) => `<text x="${pad}" y="${y + titleLines.length * titleSize * 1.15 + 16 + i * subSize * 1.3 + subSize * 0.4}" font-family="DejaVu Sans" font-size="${subSize}" fill="${pal.text}" opacity="0.8">${esc(l)}</text>`).join('')}
  </svg>`;

  const layers: OverlayOptions[] = [
    { input: knocked, left: Math.round((w - (prodMeta.width ?? areaW)) / 2), top: Math.round(pad + (areaH - (prodMeta.height ?? areaH)) / 2) },
    { input: Buffer.from(textSvg), left: 0, top: 0 },
  ];
  if (o.logo) {
    const logo = await sharp(o.logo).resize(Math.round(w * 0.16), Math.round(w * 0.16), { fit: 'inside' }).png().toBuffer();
    layers.push({ input: logo, top: pad, left: pad });
  }
  return sharp(bg).composite(layers).jpeg({ quality: 88 }).toBuffer();
}

async function knockOutWhite(png: Buffer): Promise<Buffer> {
  const { data, info } = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  for (let i = 0; i < data.length; i += 4) {
    const r = data[i], g = data[i + 1], b = data[i + 2];
    const min = Math.min(r, g, b);
    if (min > 242) data[i + 3] = 0;
    else if (min > 225) data[i + 3] = Math.round(((242 - min) / 17) * 255);
  }
  return sharp(data, { raw: { width: info.width, height: info.height, channels: 4 } }).png().toBuffer();
}

// ---------------- video ----------------

let ffmpegChecked: boolean | null = null;
export async function hasFfmpeg(): Promise<boolean> {
  if (ffmpegChecked !== null) return ffmpegChecked;
  ffmpegChecked = await new Promise<boolean>((resolve) => {
    const p = spawn(process.env.FFMPEG_PATH ?? 'ffmpeg', ['-version']);
    p.on('error', () => resolve(false));
    p.on('close', (code) => resolve(code === 0));
  });
  return ffmpegChecked;
}

/** Build a 9:16 slideshow MP4 (H.264, AAC silent or provided audio) from poster images. */
export async function makeSlideshow(images: string[], outAbs: string, opts: { secondsPerImage?: number; audio?: string | null; signal?: AbortSignal } = {}) {
  const spi = opts.secondsPerImage ?? 3;
  const n = images.length;
  const args: string[] = ['-y'];
  for (const img of images) args.push('-loop', '1', '-t', String(spi), '-i', img);
  if (opts.audio) args.push('-i', opts.audio);
  else args.push('-f', 'lavfi', '-t', String(spi * n), '-i', 'anullsrc=channel_layout=stereo:sample_rate=44100');
  const fade = 0.5;
  const parts = images.map(
    (_, i) =>
      `[${i}:v]scale=1080:1920:force_original_aspect_ratio=decrease,pad=1080:1920:(ow-iw)/2:(oh-ih)/2:color=white,` +
      `zoompan=z='min(zoom+0.0008,1.06)':d=${spi * 25}:s=1080x1920:fps=25,` +
      `fade=t=in:st=0:d=${fade},fade=t=out:st=${spi - fade}:d=${fade},setsar=1[v${i}]`,
  );
  const filter = `${parts.join(';')};${images.map((_, i) => `[v${i}]`).join('')}concat=n=${n}:v=1:a=0,format=yuv420p[v]`;
  args.push('-filter_complex', filter, '-map', '[v]', '-map', `${n}:a`, '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '23',
    '-c:a', 'aac', '-shortest', '-movflags', '+faststart', outAbs);
  await new Promise<void>((resolve, reject) => {
    const p = spawn(process.env.FFMPEG_PATH ?? 'ffmpeg', args, { stdio: ['ignore', 'ignore', 'pipe'] });
    let err = '';
    p.stderr.on('data', (d) => (err = (err + d).slice(-2000)));
    opts.signal?.addEventListener('abort', () => p.kill('SIGKILL'), { once: true });
    p.on('error', reject);
    p.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`ffmpeg lỗi (${code}): ${err.slice(-400)}`))));
  });
}

// ---------------- news title cards ----------------

export interface CardOptions {
  format: FormatKey;
  title: string;
  category: string;
  /** Real photo supplied by the user (with its source) — shown with a credit line. */
  photo?: Buffer | null;
  credit?: string | null;
  brand?: string | null;
}

/**
 * Facebook-style news card. Without a real photo it is a pure typographic card and
 * carries "Ảnh minh họa" so readers never mistake it for a photo of the event.
 */
export async function renderCard(o: CardOptions): Promise<Buffer> {
  const { w, h } = FORMATS[o.format];
  const pad = Math.round(w * 0.07);
  const size = Math.round(w * (o.format === 'landscape' ? 0.05 : 0.07));
  const lines = wrap(o.title, Math.floor((w - pad * 2) / (size * 0.62)), o.format === 'landscape' ? 3 : 5);
  const small = Math.round(size * 0.42);
  const textH = lines.length * size * 1.18;
  const textTop = o.photo ? h - pad - textH - small * 2.2 : (h - textH) / 2;
  const label = o.photo ? (o.credit ? `Ảnh: ${o.credit}` : '') : 'Ảnh minh họa — không phải ảnh thật của sự kiện';

  let base: ReturnType<typeof sharp>;
  if (o.photo) {
    const photo = await sharp(o.photo).resize(w, h, { fit: 'cover' }).toBuffer();
    const shade = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><defs><linearGradient id="s" x1="0" y1="0" x2="0" y2="1"><stop offset="0.35" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity="0.85"/></linearGradient></defs><rect width="100%" height="100%" fill="url(#s)"/></svg>`);
    base = sharp(await sharp(photo).composite([{ input: shade }]).png().toBuffer());
  } else {
    base = sharp(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">
      <defs><radialGradient id="g" cx="0.3" cy="0.2" r="1.1"><stop offset="0" stop-color="#3b2a6b"/><stop offset="0.6" stop-color="#1a1636"/><stop offset="1" stop-color="#0d0b1e"/></radialGradient></defs>
      <rect width="100%" height="100%" fill="url(#g)"/>
      ${Array.from({ length: 40 }, (_, i) => `<circle cx="${(i * 137) % w}" cy="${(i * 251) % h}" r="${(i % 3) + 1}" fill="#fff" opacity="${0.15 + (i % 5) * 0.08}"/>`).join('')}
      <circle cx="${w * 0.82}" cy="${h * 0.16}" r="${w * 0.16}" fill="#8b7cf6" opacity="0.18"/>
    </svg>`));
  }
  const fg = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">
    <rect x="${pad}" y="${pad}" rx="${small}" width="${o.category.length * small * 0.78 + small * 2}" height="${small * 2}" fill="#f2c94c"/>
    <text x="${pad + small}" y="${pad + small * 1.38}" font-family="DejaVu Sans" font-weight="bold" font-size="${small}" fill="#1a1636">${esc(o.category.toUpperCase())}</text>
    ${lines.map((l, i) => `<text x="${pad}" y="${textTop + size + i * size * 1.18}" font-family="DejaVu Sans" font-weight="bold" font-size="${size}" fill="#ffffff">${esc(l)}</text>`).join('')}
    ${label ? `<text x="${pad}" y="${h - pad * 0.55}" font-family="DejaVu Sans" font-size="${Math.round(small * 0.8)}" fill="#ffffff" opacity="0.75">${esc(label)}</text>` : ''}
    ${o.brand ? `<text x="${w - pad}" y="${pad + small * 1.38}" text-anchor="end" font-family="DejaVu Sans" font-weight="bold" font-size="${small}" fill="#ffffff" opacity="0.9">${esc(o.brand)}</text>` : ''}
  </svg>`);
  return base.composite([{ input: fg }]).jpeg({ quality: 88 }).toBuffer();
}
