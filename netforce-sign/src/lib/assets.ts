import type { Asset, Kind } from '../types';
import { loadImage } from './util';

/** `ns` isole les données de chaque compte sur un appareil partagé. */
const KEY = (k: Kind, ns?: string) => (ns ? `nf-sign.${ns}.asset.${k}` : `nf-sign.asset.${k}`);

export function loadAsset(kind: Kind, ns?: string): Asset | null {
  try {
    const raw = localStorage.getItem(KEY(kind, ns));
    return raw ? (JSON.parse(raw) as Asset) : null;
  } catch {
    return null;
  }
}

export function saveAsset(kind: Kind, asset: Asset | null, ns?: string) {
  try {
    if (asset) localStorage.setItem(KEY(kind, ns), JSON.stringify(asset));
    else localStorage.removeItem(KEY(kind, ns));
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
    const max = 1200;
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
