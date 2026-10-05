// Build « legacy » : compatible avec les navigateurs mobiles plus anciens (Safari iOS notamment).
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import type { PDFDocumentProxy, PDFPageProxy } from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/legacy/build/pdf.worker.min.mjs?url';
import { PDFDocument, degrees } from 'pdf-lib';
import type { PageSize, Placement, Zone } from '../types';
import { detectZones, type PxRect, type TextLine } from './detect';
import { dataUrlToBytes, loadImage } from './util';

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

export async function openPdf(bytes: ArrayBuffer): Promise<PDFDocumentProxy> {
  // pdf.js transfère le buffer au worker : on lui donne une copie.
  return pdfjs.getDocument({ data: new Uint8Array(bytes.slice(0)) }).promise;
}

export async function getPageSizes(pdf: PDFDocumentProxy): Promise<PageSize[]> {
  const sizes: PageSize[] = [];
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const vp = page.getViewport({ scale: 1 });
    sizes.push({ width: vp.width, height: vp.height });
  }
  return sizes;
}

export async function renderPage(page: PDFPageProxy, canvas: HTMLCanvasElement, cssWidth: number) {
  const base = page.getViewport({ scale: 1 });
  const dpr = Math.min(window.devicePixelRatio || 1, 3);
  const scale = (cssWidth / base.width) * dpr;
  const vp = page.getViewport({ scale });
  canvas.width = Math.floor(vp.width);
  canvas.height = Math.floor(vp.height);
  const task = page.render({ canvas, viewport: vp });
  await task.promise;
}

interface Item {
  str: string;
  x: number;
  top: number;
  base: number;
  w: number;
  h: number;
}

async function pageLines(page: PDFPageProxy, pageIndex: number): Promise<TextLine[]> {
  const vp = page.getViewport({ scale: 1 });
  const content = await page.getTextContent();
  const items: Item[] = [];
  for (const raw of content.items) {
    if (!('str' in raw) || !raw.str) continue;
    const tx = pdfjs.Util.transform(vp.transform, raw.transform);
    const h = Math.hypot(tx[2], tx[3]) || 10;
    items.push({ str: raw.str, x: tx[4], base: tx[5], top: tx[5] - h, w: raw.width || raw.str.length * h * 0.5, h });
  }
  items.sort((a, b) => a.base - b.base || a.x - b.x);

  const rows: Item[][] = [];
  for (const it of items) {
    const g = rows.find((g) => Math.abs(g[0].base - it.base) < Math.min(g[0].h, it.h) * 0.5);
    if (g) g.push(it);
    else rows.push([it]);
  }
  // Une même ligne peut porter plusieurs colonnes (« Pour X » … « Pour Y ») : on coupe sur les grands écarts.
  const groups: Item[][] = [];
  for (const row of rows) {
    row.sort((a, b) => a.x - b.x);
    let cur: Item[] = [];
    for (const it of row) {
      const prev = cur[cur.length - 1];
      if (prev && it.x - (prev.x + prev.w) > Math.max(it.h, prev.h) * 3) {
        groups.push(cur);
        cur = [];
      }
      cur.push(it);
    }
    if (cur.length) groups.push(cur);
  }

  return groups.map((g) => {
    let text = '';
    const spans: { start: number; end: number; it: Item }[] = [];
    g.forEach((it, i) => {
      if (i > 0) {
        const prev = g[i - 1];
        const gap = it.x - (prev.x + prev.w);
        if (gap > it.h * 0.15 && !text.endsWith(' ') && !it.str.startsWith(' ')) text += ' ';
      }
      spans.push({ start: text.length, end: text.length + it.str.length, it });
      text += it.str;
    });
    const rectOf = (start: number, end: number): PxRect | null => {
      let r: PxRect | null = null;
      for (const s of spans) {
        if (s.end <= start || s.start >= end) continue;
        const len = Math.max(1, s.end - s.start);
        const a = (Math.max(start, s.start) - s.start) / len;
        const b = (Math.min(end, s.end) - s.start) / len;
        const piece = { x: s.it.x + a * s.it.w, y: s.it.top, w: (b - a) * s.it.w, h: s.it.h * 1.2 };
        if (!r) r = piece;
        else {
          const x1 = Math.min(r.x, piece.x);
          const y1 = Math.min(r.y, piece.y);
          const x2 = Math.max(r.x + r.w, piece.x + piece.w);
          const y2 = Math.max(r.y + r.h, piece.y + piece.h);
          r = { x: x1, y: y1, w: x2 - x1, h: y2 - y1 };
        }
      }
      return r;
    };
    return { page: pageIndex, text, rectOf, rightLimit: vp.width };
  });
}

export async function detectPdf(pdf: PDFDocumentProxy): Promise<Zone[]> {
  const lines: TextLine[] = [];
  const sizes: { w: number; h: number }[] = [];
  const fields: { page: number; rect: PxRect; label: string }[] = [];
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const vp = page.getViewport({ scale: 1 });
    sizes.push({ w: vp.width, h: vp.height });
    lines.push(...(await pageLines(page, i - 1)));
    try {
      const annots = await page.getAnnotations();
      for (const a of annots) {
        if (a.fieldType !== 'Sig' || !a.rect) continue;
        const [x1, y1] = vp.convertToViewportPoint(a.rect[0], a.rect[1]);
        const [x2, y2] = vp.convertToViewportPoint(a.rect[2], a.rect[3]);
        fields.push({
          page: i - 1,
          rect: { x: Math.min(x1, x2), y: Math.min(y1, y2), w: Math.abs(x2 - x1), h: Math.abs(y2 - y1) },
          label: a.alternativeText || a.fieldName || 'Champ de signature',
        });
      }
    } catch {
      /* annotations illisibles : on se contente du texte */
    }
  }
  return detectZones(lines, sizes, fields);
}

/** Appose les images dans le PDF d'origine (texte et vecteurs conservés). */
export async function exportPdf(bytes: ArrayBuffer, placements: Placement[]): Promise<Uint8Array> {
  const doc = await PDFDocument.load(bytes, { ignoreEncryption: true });
  const pages = doc.getPages();
  const cache = new Map<string, Awaited<ReturnType<typeof doc.embedPng>>>();

  for (const p of placements) {
    const page = pages[p.page];
    if (!page) continue;
    let img = cache.get(p.src);
    if (!img) {
      img = await doc.embedPng(dataUrlToBytes(p.src));
      cache.set(p.src, img);
    }
    const box = page.getCropBox();
    const rot = (((page.getRotation().angle % 360) + 360) % 360) as 0 | 90 | 180 | 270;
    const sideways = rot === 90 || rot === 270;
    const vw = sideways ? box.height : box.width;
    const vh = sideways ? box.width : box.height;
    const w = p.w * vw;
    const h = p.h * vh;
    // Coin bas-gauche de l'image dans le repère affiché, converti dans le repère PDF.
    const vx = p.x * vw;
    const vy = p.y * vh + h;
    let x: number;
    let y: number;
    switch (rot) {
      case 90:
        x = box.x + vy;
        y = box.y + vx;
        break;
      case 180:
        x = box.x + box.width - vx;
        y = box.y + vy;
        break;
      case 270:
        x = box.x + box.width - vy;
        y = box.y + box.height - vx;
        break;
      default:
        x = box.x + vx;
        y = box.y + box.height - vy;
    }
    page.drawImage(img, { x, y, width: w, height: h, rotate: degrees(rot) });
  }
  return doc.save();
}

/** Rend chaque page signée en image haute définition (utilisé pour l'export Word d'un PDF). */
export async function rasterizePdf(
  pdf: PDFDocumentProxy,
  placements: Placement[],
  scale = 2.2,
): Promise<{ data: Uint8Array; widthPt: number; heightPt: number }[]> {
  const out: { data: Uint8Array; widthPt: number; heightPt: number }[] = [];
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const base = page.getViewport({ scale: 1 });
    const vp = page.getViewport({ scale });
    const canvas = document.createElement('canvas');
    canvas.width = Math.floor(vp.width);
    canvas.height = Math.floor(vp.height);
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    await page.render({ canvas, viewport: vp }).promise;
    for (const p of placements.filter((p) => p.page === i - 1)) {
      const img = await loadImage(p.src);
      ctx.drawImage(img, p.x * canvas.width, p.y * canvas.height, p.w * canvas.width, p.h * canvas.height);
    }
    const blob = await new Promise<Blob>((r) => canvas.toBlob((b) => r(b!), 'image/jpeg', 0.92));
    out.push({ data: new Uint8Array(await blob.arrayBuffer()), widthPt: base.width, heightPt: base.height });
  }
  return out;
}
