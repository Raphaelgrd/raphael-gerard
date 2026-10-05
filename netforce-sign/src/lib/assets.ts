import type { Asset, Kind } from '../types';
import { loadImage } from './util';

const KEY = (k: Kind) => `nf-sign.asset.${k}`;

export function loadAsset(kind: Kind): Asset | null {
  try {
    const raw = localStorage.getItem(KEY(kind));
    return raw ? (JSON.parse(raw) as Asset) : null;
  } catch {
    return null;
  }
}

export function saveAsset(kind: Kind, asset: Asset | null) {
  try {
    if (asset) localStorage.setItem(KEY(kind), JSON.stringify(asset));
    else localStorage.removeItem(KEY(kind));
  } catch {
    /* stockage indisponible (navigation privée) : l'actif reste en mémoire */
  }
}

/** Recadre sur les pixels non transparents et renvoie un PNG. */
export function trimCanvas(src: HTMLCanvasElement, pad = 8): Asset | null {
  const ctx = src.getContext('2d', { willReadFrequently: true })!;
  const { width, height } = src;
  const data = ctx.getImageData(0, 0, width, height).data;
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (data[(y * width + x) * 4 + 3] > 12) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX < 0) return null;
  minX = Math.max(0, minX - pad);
  minY = Math.max(0, minY - pad);
  maxX = Math.min(width - 1, maxX + pad);
  maxY = Math.min(height - 1, maxY + pad);
  const w = maxX - minX + 1;
  const h = maxY - minY + 1;
  const out = document.createElement('canvas');
  out.width = w;
  out.height = h;
  out.getContext('2d')!.drawImage(src, minX, minY, w, h, 0, 0, w, h);
  return { src: out.toDataURL('image/png'), ratio: w / h };
}

/** Importe une image (scan, photo) et rend le fond clair transparent. */
export async function imageFileToAsset(file: File, removeBackground: boolean): Promise<Asset | null> {
  const url = URL.createObjectURL(file);
  try {
    const img = await loadImage(url);
    const max = 1600;
    const scale = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
    const c = document.createElement('canvas');
    c.width = Math.round(img.naturalWidth * scale);
    c.height = Math.round(img.naturalHeight * scale);
    const ctx = c.getContext('2d', { willReadFrequently: true })!;
    ctx.drawImage(img, 0, 0, c.width, c.height);
    if (removeBackground) {
      const id = ctx.getImageData(0, 0, c.width, c.height);
      const d = id.data;
      for (let i = 0; i < d.length; i += 4) {
        const lum = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
        // Fondu progressif entre 200 et 240 pour éviter un contour crénelé.
        if (lum >= 240) d[i + 3] = 0;
        else if (lum > 200) d[i + 3] = Math.round(d[i + 3] * ((240 - lum) / 40));
      }
      ctx.putImageData(id, 0, 0);
    }
    return trimCanvas(c, 4);
  } finally {
    URL.revokeObjectURL(url);
  }
}

export const SCRIPT_FONTS = [
  { id: 'Great Vibes', label: 'Classique', weight: 400 },
  { id: 'Dancing Script', label: 'Fluide', weight: 600 },
  { id: 'Caveat', label: 'Manuscrite', weight: 600 },
];

export async function typedSignature(text: string, font: string, color: string): Promise<Asset | null> {
  if (!text.trim()) return null;
  const size = 140;
  const weight = SCRIPT_FONTS.find((f) => f.id === font)?.weight ?? 400;
  try {
    await document.fonts.load(`${weight} ${size}px "${font}"`, text);
  } catch {
    /* police indisponible hors ligne : repli sur cursive système */
  }
  const c = document.createElement('canvas');
  const ctx = c.getContext('2d')!;
  ctx.font = `${weight} ${size}px "${font}", cursive`;
  const m = ctx.measureText(text);
  c.width = Math.ceil(m.width + size);
  c.height = Math.ceil(size * 1.8);
  ctx.font = `${weight} ${size}px "${font}", cursive`;
  ctx.fillStyle = color;
  ctx.textBaseline = 'middle';
  ctx.fillText(text, size / 2, c.height / 2);
  return trimCanvas(c, 10);
}

export interface StampOptions {
  shape: 'round' | 'rect';
  color: string;
  line1: string;
  line2: string;
  line3: string;
  line4: string;
}

export const DEFAULT_STAMP: StampOptions = {
  shape: 'round',
  color: '#1E3FA8',
  line1: 'NETFORCE',
  line2: 'SAS NETFORCE–NEXSTUN',
  line3: '34130 MAUGUIO',
  line4: '',
};

function arcText(ctx: CanvasRenderingContext2D, text: string, cx: number, cy: number, r: number, top: boolean) {
  const chars = Array.from(text);
  const widths = chars.map((c) => ctx.measureText(c).width);
  const spacing = ctx.measureText(' ').width * 0.35;
  const total = widths.reduce((a, b) => a + b, 0) + spacing * (chars.length - 1);
  const angleTotal = total / r;
  let angle = top ? -Math.PI / 2 - angleTotal / 2 : Math.PI / 2 + angleTotal / 2;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  chars.forEach((c, i) => {
    const a = widths[i] / r;
    const mid = top ? angle + a / 2 : angle - a / 2;
    ctx.save();
    ctx.translate(cx + r * Math.cos(mid), cy + r * Math.sin(mid));
    ctx.rotate(top ? mid + Math.PI / 2 : mid - Math.PI / 2);
    ctx.fillText(c, 0, 0);
    ctx.restore();
    angle = top ? angle + a + spacing / r : angle - a - spacing / r;
  });
}

export function generateStamp(o: StampOptions): Asset {
  const c = document.createElement('canvas');
  const ctx = c.getContext('2d')!;
  ctx.strokeStyle = o.color;
  ctx.fillStyle = o.color;
  const font = (px: number, weight = 700) => `${weight} ${px}px "Rajdhani", "Arial Narrow", Arial, sans-serif`;

  if (o.shape === 'round') {
    const S = 600;
    c.width = c.height = S;
    ctx.strokeStyle = o.color;
    ctx.fillStyle = o.color;
    const cx = S / 2;
    ctx.lineWidth = 14;
    ctx.beginPath();
    ctx.arc(cx, cx, S / 2 - 12, 0, Math.PI * 2);
    ctx.stroke();
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.arc(cx, cx, S / 2 - 108, 0, Math.PI * 2);
    ctx.stroke();
    ctx.font = font(64);
    arcText(ctx, o.line1.toUpperCase(), cx, cx, S / 2 - 66, true);
    ctx.font = font(48, 600);
    if (o.line3) arcText(ctx, o.line3.toUpperCase(), cx, cx, S / 2 - 66, false);
    // Étoiles de séparation.
    ctx.font = font(40);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('★', 66, cx);
    ctx.fillText('★', S - 66, cx);
    // Centre : texte sur une ou deux lignes, aussi grand que possible.
    const maxW = 300;
    const fit = (lines: string[]) => {
      let size = 52;
      ctx.font = font(size);
      while (lines.some((t) => ctx.measureText(t).width > maxW) && size > 22) {
        size -= 2;
        ctx.font = font(size);
      }
      return size;
    };
    let center = [o.line2, o.line4].filter(Boolean);
    let size = fit(center);
    if (size < 40 && center.length === 1 && center[0].includes(' ')) {
      const words = center[0].split(' ');
      const half = Math.ceil(words.length / 2);
      const split = [words.slice(0, half).join(' '), words.slice(half).join(' ')];
      const splitSize = fit(split);
      if (splitSize > size) {
        center = split;
        size = splitSize;
      }
    }
    ctx.font = font(size);
    const lh = size * 1.1;
    center.forEach((t, i) => ctx.fillText(t, cx, cx + (i - (center.length - 1) / 2) * lh));
  } else {
    const W = 760;
    const H = 360;
    c.width = W;
    c.height = H;
    ctx.strokeStyle = o.color;
    ctx.fillStyle = o.color;
    ctx.lineWidth = 12;
    ctx.strokeRect(10, 10, W - 20, H - 20);
    ctx.lineWidth = 4;
    ctx.strokeRect(30, 30, W - 60, H - 60);
    const rows = [
      { t: o.line1.toUpperCase(), s: 84 },
      { t: o.line2, s: 44 },
      { t: o.line3, s: 40 },
      { t: o.line4, s: 36 },
    ].filter((r) => r.t);
    const totalH = rows.reduce((a, r) => a + r.s * 1.15, 0);
    let y = H / 2 - totalH / 2;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    for (const r of rows) {
      let s = r.s;
      ctx.font = font(s, r === rows[0] ? 700 : 600);
      while (ctx.measureText(r.t).width > W - 100 && s > 16) {
        s -= 2;
        ctx.font = font(s, r === rows[0] ? 700 : 600);
      }
      ctx.fillText(r.t, W / 2, y + (r.s - s) / 2);
      y += r.s * 1.15;
    }
  }

  // Léger grain d'encre pour un rendu réaliste.
  const id = ctx.getImageData(0, 0, c.width, c.height);
  const d = id.data;
  for (let i = 3; i < d.length; i += 4) {
    if (d[i] > 0 && Math.random() < 0.08) d[i] = Math.round(d[i] * 0.55);
  }
  ctx.putImageData(id, 0, 0);
  return { src: c.toDataURL('image/png'), ratio: c.width / c.height };
}
