import type { Asset, FracRect, Kind, PageSize, Placement, Zone } from '../types';

export const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);

export function dataUrlToBytes(dataUrl: string): Uint8Array {
  const b64 = dataUrl.slice(dataUrl.indexOf(',') + 1);
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Image illisible'));
    img.src = src;
  });
}

export function downloadBlob(data: Blob | Uint8Array, filename: string, type: string) {
  const blob = data instanceof Blob ? data : new Blob([data as Uint8Array<ArrayBuffer>], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

export function baseName(name: string) {
  return name.replace(/\.(pdf|docx)$/i, '');
}

/** Insère l'image dans la zone en respectant son ratio. */
export function fitInZone(zone: FracRect, page: PageSize, asset: Asset, kind: Kind): FracRect {
  const zw = zone.w * page.width;
  const zh = zone.h * page.height;
  let w = zw;
  let h = zw / asset.ratio;
  if (h > zh) {
    h = zh;
    w = zh * asset.ratio;
  }
  const zx = zone.x * page.width;
  const zy = zone.y * page.height;
  // Signature : alignée à gauche et posée sur la ligne. Cachet : centré.
  const x = kind === 'signature' ? zx : zx + (zw - w) / 2;
  const y = kind === 'signature' ? zy + (zh - h) : zy + (zh - h) / 2;
  return { x: x / page.width, y: y / page.height, w: w / page.width, h: h / page.height };
}

export function placementFromZone(zone: Zone, page: PageSize, asset: Asset): Placement {
  return {
    id: uid(),
    page: zone.page,
    kind: zone.kind,
    src: asset.src,
    ratio: asset.ratio,
    zoneId: zone.id,
    ...fitInZone(zone, page, asset, zone.kind),
  };
}

/** Taille par défaut d'un élément posé librement, centré sur (cx, cy) en fractions. */
export function placementAt(
  page: number,
  cx: number,
  cy: number,
  size: PageSize,
  asset: Asset,
  kind: Kind,
): Placement {
  const wPx = size.width * (kind === 'signature' ? 0.28 : 0.3);
  let w = wPx;
  let h = wPx / asset.ratio;
  const maxH = size.width * (kind === 'signature' ? 0.1 : 0.2);
  if (h > maxH) {
    h = maxH;
    w = maxH * asset.ratio;
  }
  const fw = w / size.width;
  const fh = h / size.height;
  return {
    id: uid(),
    page,
    kind,
    src: asset.src,
    ratio: asset.ratio,
    x: Math.min(Math.max(cx - fw / 2, 0), 1 - fw),
    y: Math.min(Math.max(cy - fh / 2, 0), 1 - fh),
    w: fw,
    h: fh,
  };
}

export const nextFrame = () => new Promise<void>((r) => requestAnimationFrame(() => r()));
