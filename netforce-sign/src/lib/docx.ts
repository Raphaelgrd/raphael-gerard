import { renderAsync } from 'docx-preview';
import JSZip from 'jszip';
import html2canvas from 'html2canvas';
import { PDFDocument } from 'pdf-lib';
import {
  Document,
  HorizontalPositionRelativeFrom,
  ImageRun,
  Packer,
  Paragraph,
  VerticalPositionRelativeFrom,
} from 'docx';
import type { PageSize, Placement, Zone } from '../types';
import { detectZones, type PxRect, type TextLine } from './detect';
import { dataUrlToBytes, nextFrame } from './util';

const NS = {
  w: 'http://schemas.openxmlformats.org/wordprocessingml/2006/main',
  wp: 'http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing',
  a: 'http://schemas.openxmlformats.org/drawingml/2006/main',
  pic: 'http://schemas.openxmlformats.org/drawingml/2006/picture',
  r: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships',
  rel: 'http://schemas.openxmlformats.org/package/2006/relationships',
  ct: 'http://schemas.openxmlformats.org/package/2006/content-types',
  mc: 'http://schemas.openxmlformats.org/markup-compatibility/2006',
};

export async function renderDocx(bytes: ArrayBuffer, container: HTMLElement): Promise<HTMLElement[]> {
  container.innerHTML = '';
  await renderAsync(bytes.slice(0), container, undefined, {
    className: 'docx',
    inWrapper: true,
    breakPages: true,
    ignoreLastRenderedPageBreak: false,
    experimental: true,
    useBase64URL: true,
    renderComments: false,
    renderChanges: false,
  });
  // Laisse les polices et images se charger avant toute mesure.
  await document.fonts?.ready;
  await Promise.all(
    Array.from(container.querySelectorAll('img')).map((img) =>
      img.complete ? null : new Promise((r) => ((img.onload = r), (img.onerror = r))),
    ),
  );
  return Array.from(container.querySelectorAll<HTMLElement>('section.docx'));
}

export function measurePages(sections: HTMLElement[]): PageSize[] {
  return sections.map((s) => {
    const r = s.getBoundingClientRect();
    return { width: r.width, height: r.height };
  });
}

/** Largeur / hauteur de page en points, lues sur le rendu (issues du w:pgSz). */
function pagePt(section: HTMLElement) {
  const w = parseFloat(section.style.width) || 595.3;
  const h = parseFloat(section.style.minHeight) || w * 1.414;
  return { w, h };
}

function textNodes(el: Element): Text[] {
  const out: Text[] = [];
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  let n: Node | null;
  while ((n = walker.nextNode())) out.push(n as Text);
  return out;
}

function isChrome(el: Element) {
  return !!el.closest('header, footer, .nf-overlay');
}

export function detectDocx(sections: HTMLElement[]): Zone[] {
  const lines: TextLine[] = [];
  const sizes = sections.map((s, page) => {
    const sr = s.getBoundingClientRect();
    for (const p of Array.from(s.querySelectorAll('p'))) {
      if (p.closest('.nf-overlay')) continue;
      const nodes = textNodes(p);
      const text = nodes.map((n) => n.data).join('');
      if (!text.trim()) continue;
      const cell = p.closest('td');
      const limitEl = (cell ?? p) as HTMLElement;
      const rectOf = (start: number, end: number): PxRect | null => {
        const range = document.createRange();
        let pos = 0;
        let started = false;
        for (const n of nodes) {
          const len = n.data.length;
          if (!started && start <= pos + len) {
            range.setStart(n, Math.max(0, start - pos));
            started = true;
          }
          if (started && end <= pos + len) {
            range.setEnd(n, Math.max(0, end - pos));
            break;
          }
          pos += len;
        }
        if (!started) return null;
        const r = range.getBoundingClientRect();
        if (!r.width && !r.height) return null;
        return { x: r.left - sr.left, y: r.top - sr.top, w: r.width, h: r.height };
      };
      lines.push({ page, text, rectOf, rightLimit: limitEl.getBoundingClientRect().right - sr.left });
    }
    return { w: sr.width, h: sr.height };
  });
  return detectZones(lines, sizes);
}

/* ------------------------------------------------------------------ */
/* Export Word : on insère des images ancrées dans le document.xml.     */
/* ------------------------------------------------------------------ */

const squash = (s: string) => s.replace(/\s+/g, '');

function bodyParagraphs(doc: XMLDocument): Element[] {
  const body = doc.getElementsByTagNameNS(NS.w, 'body')[0];
  if (!body) return [];
  return Array.from(body.getElementsByTagNameNS(NS.w, 'p')).filter((p) => {
    for (let a = p.parentElement; a && a !== body; a = a.parentElement) {
      if (a.localName === 'txbxContent' || (a.namespaceURI === NS.mc && a.localName === 'Fallback')) return false;
    }
    return true;
  });
}

function xmlText(p: Element) {
  return Array.from(p.getElementsByTagNameNS(NS.w, 't'))
    .map((t) => t.textContent ?? '')
    .join('');
}

/** Associe chaque <p> rendu à son paragraphe w:p (les sauts de page peuvent couper un paragraphe en deux). */
function alignParagraphs(domPs: HTMLElement[], xmlPs: Element[]): Map<HTMLElement, { index: number; continuation: boolean }> {
  const xmlTexts = xmlPs.map((p) => squash(xmlText(p)));
  const map = new Map<HTMLElement, { index: number; continuation: boolean }>();
  let j = 0;
  let prev = -1;
  for (const p of domPs) {
    const t = squash(p.textContent ?? '');
    let found = -1;
    for (let k = j; k < Math.min(xmlTexts.length, j + 40); k++) {
      const x = xmlTexts[k];
      if (t === x || (t && x.includes(t)) || (!t && !x)) {
        found = k;
        break;
      }
    }
    if (found < 0) found = Math.min(j, xmlTexts.length - 1);
    if (found < 0) continue;
    map.set(p, { index: found, continuation: found === prev });
    prev = found;
    // Un paragraphe plus long que le fragment rendu peut se poursuivre sur la page suivante.
    j = t && xmlTexts[found].length > t.length ? found : found + 1;
  }
  return map;
}

const EMU_PER_PT = 12700;

function anchorXml(opts: {
  rid: string;
  id: number;
  hRel: 'page' | 'column';
  x: number;
  y: number;
  cx: number;
  cy: number;
  name: string;
}) {
  const { rid, id, hRel, x, y, cx, cy, name } = opts;
  return `<w:r xmlns:w="${NS.w}" xmlns:wp="${NS.wp}" xmlns:a="${NS.a}" xmlns:pic="${NS.pic}" xmlns:r="${NS.r}"><w:drawing><wp:anchor distT="0" distB="0" distL="0" distR="0" simplePos="0" relativeHeight="${251660000 + id}" behindDoc="0" locked="0" layoutInCell="1" allowOverlap="1"><wp:simplePos x="0" y="0"/><wp:positionH relativeFrom="${hRel}"><wp:posOffset>${x}</wp:posOffset></wp:positionH><wp:positionV relativeFrom="paragraph"><wp:posOffset>${y}</wp:posOffset></wp:positionV><wp:extent cx="${cx}" cy="${cy}"/><wp:effectExtent l="0" t="0" r="0" b="0"/><wp:wrapNone/><wp:docPr id="${id}" name="${name}"/><wp:cNvGraphicFramePr><a:graphicFrameLocks noChangeAspect="1"/></wp:cNvGraphicFramePr><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic><pic:nvPicPr><pic:cNvPr id="${id}" name="${name}.png"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="${rid}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:anchor></w:drawing></w:r>`;
}

export async function exportDocx(bytes: ArrayBuffer, placements: Placement[], sections: HTMLElement[]): Promise<Blob> {
  const zip = await JSZip.loadAsync(bytes);
  const docPath = 'word/document.xml';
  const relsPath = 'word/_rels/document.xml.rels';
  const parser = new DOMParser();
  const ser = new XMLSerializer();
  const doc = parser.parseFromString(await zip.file(docPath)!.async('string'), 'application/xml');
  const rels = parser.parseFromString(
    (await zip.file(relsPath)?.async('string')) ??
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="${NS.rel}"/>`,
    'application/xml',
  );

  const xmlPs = bodyParagraphs(doc);
  const domPs = sections.flatMap((s) =>
    Array.from(s.querySelectorAll<HTMLElement>('p')).filter((p) => !isChrome(p)),
  );
  const align = alignParagraphs(domPs, xmlPs);
  const usedRelIds = new Set(Array.from(rels.documentElement.children).map((r) => r.getAttribute('Id')));
  const mediaBySrc = new Map<string, string>();
  let counter = 0;

  for (const pl of placements) {
    const section = sections[pl.page];
    if (!section) continue;
    const sr = section.getBoundingClientRect();
    const pt = pagePt(section);
    const ptPerPx = pt.w / sr.width;
    const top = sr.top + pl.y * sr.height;
    const left = sr.left + pl.x * sr.width;

    // Paragraphe d'ancrage : le dernier au-dessus de l'image sur la même page, hors tableaux si possible.
    const candidates = Array.from(section.querySelectorAll<HTMLElement>('p'))
      .filter((p) => !isChrome(p) && align.has(p) && !align.get(p)!.continuation)
      .map((p) => ({ p, r: p.getBoundingClientRect(), inCell: !!p.closest('td') }));
    if (!candidates.length) continue;
    const pick = (list: typeof candidates) => {
      const above = list.filter((c) => c.r.top <= top);
      return above.length ? above[above.length - 1] : list[0];
    };
    const free = candidates.filter((c) => !c.inCell);
    const chosen = free.length ? pick(free) : pick(candidates);
    const xmlP = xmlPs[align.get(chosen.p)!.index];
    if (!xmlP) continue;

    let hRel: 'page' | 'column' = 'page';
    let originLeft = sr.left;
    if (chosen.inCell) {
      hRel = 'column';
      originLeft = (chosen.p.closest('td') as HTMLElement).getBoundingClientRect().left;
    }

    let rid = mediaBySrc.get(pl.src);
    if (!rid) {
      counter++;
      let n = counter;
      while (usedRelIds.has(`rIdNfSign${n}`)) n++;
      rid = `rIdNfSign${n}`;
      usedRelIds.add(rid);
      const file = `media/netforce_sign_${n}.png`;
      zip.file(`word/${file}`, dataUrlToBytes(pl.src));
      const rel = rels.createElementNS(NS.rel, 'Relationship');
      rel.setAttribute('Id', rid);
      rel.setAttribute('Type', 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/image');
      rel.setAttribute('Target', file);
      rels.documentElement.appendChild(rel);
      mediaBySrc.set(pl.src, rid);
    }

    const id = 7300 + placements.indexOf(pl);
    const runXml = anchorXml({
      rid,
      id,
      hRel,
      x: Math.round((left - originLeft) * ptPerPx * EMU_PER_PT),
      y: Math.round((top - chosen.r.top) * ptPerPx * EMU_PER_PT),
      cx: Math.round(pl.w * sr.width * ptPerPx * EMU_PER_PT),
      cy: Math.round(pl.h * sr.height * ptPerPx * EMU_PER_PT),
      name: pl.kind === 'signature' ? `Signature ${id}` : `Cachet ${id}`,
    });
    const run = parser.parseFromString(runXml, 'application/xml').documentElement;
    xmlP.appendChild(doc.importNode(run, true));
  }

  // Type de contenu PNG.
  const ctFile = zip.file('[Content_Types].xml');
  if (ctFile) {
    const ct = parser.parseFromString(await ctFile.async('string'), 'application/xml');
    const hasPng = Array.from(ct.getElementsByTagNameNS(NS.ct, 'Default')).some(
      (d) => d.getAttribute('Extension')?.toLowerCase() === 'png',
    );
    if (!hasPng) {
      const d = ct.createElementNS(NS.ct, 'Default');
      d.setAttribute('Extension', 'png');
      d.setAttribute('ContentType', 'image/png');
      ct.documentElement.insertBefore(d, ct.documentElement.firstChild);
      zip.file('[Content_Types].xml', ser.serializeToString(ct));
    }
  }

  zip.file(docPath, ser.serializeToString(doc));
  zip.file(relsPath, ser.serializeToString(rels));
  return zip.generateAsync({
    type: 'blob',
    mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    compression: 'DEFLATE',
  });
}

/* ------------------------------------------------------------------ */
/* Export PDF d'un Word : capture haute définition de chaque page.       */
/* ------------------------------------------------------------------ */

export async function exportPdfFromDocx(sections: HTMLElement[], zoomHost: HTMLElement): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  const prevZoom = zoomHost.style.zoom;
  zoomHost.style.zoom = '1';
  await nextFrame();
  await nextFrame();
  try {
    for (const section of sections) {
      const pt = pagePt(section);
      const canvas = await html2canvas(section, {
        scale: 2,
        backgroundColor: '#ffffff',
        useCORS: true,
        logging: false,
      });
      const pageHpx = canvas.width * (pt.h / pt.w);
      const slices = Math.max(1, Math.round(canvas.height / pageHpx - 0.02) || 1);
      for (let i = 0; i < slices; i++) {
        const slice = document.createElement('canvas');
        slice.width = canvas.width;
        slice.height = Math.ceil(pageHpx);
        const ctx = slice.getContext('2d')!;
        ctx.fillStyle = '#fff';
        ctx.fillRect(0, 0, slice.width, slice.height);
        ctx.drawImage(canvas, 0, -i * pageHpx);
        const blob = await new Promise<Blob>((r) => slice.toBlob((b) => r(b!), 'image/jpeg', 0.92));
        const img = await pdf.embedJpg(await blob.arrayBuffer());
        const page = pdf.addPage([pt.w, pt.h]);
        page.drawImage(img, { x: 0, y: 0, width: pt.w, height: pt.h });
      }
    }
  } finally {
    zoomHost.style.zoom = prevZoom;
  }
  return pdf.save();
}

/** Construit un .docx dont chaque page est l'image d'une page signée (export Word d'un PDF). */
export async function docxFromImages(pages: { data: Uint8Array; widthPt: number; heightPt: number }[]): Promise<Blob> {
  const doc = new Document({
    creator: 'Netforce Sign',
    sections: pages.map((pg) => ({
      properties: {
        page: {
          size: { width: Math.round(pg.widthPt * 20), height: Math.round(pg.heightPt * 20) },
          margin: { top: 0, right: 0, bottom: 0, left: 0, header: 0, footer: 0 },
        },
      },
      children: [
        new Paragraph({
          spacing: { before: 0, after: 0, line: 20, lineRule: 'exact' },
          children: [
            new ImageRun({
              type: 'jpg',
              data: pg.data,
              transformation: { width: (pg.widthPt * 96) / 72, height: (pg.heightPt * 96) / 72 },
              floating: {
                horizontalPosition: { relative: HorizontalPositionRelativeFrom.PAGE, offset: 0 },
                verticalPosition: { relative: VerticalPositionRelativeFrom.PAGE, offset: 0 },
                behindDocument: true,
              },
            }),
          ],
        }),
      ],
    })),
  });
  return Packer.toBlob(doc);
}
