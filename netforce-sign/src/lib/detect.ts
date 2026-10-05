import type { Kind, Zone } from '../types';
import { uid } from './util';

/** Rectangle en pixels de page (origine en haut à gauche). */
export interface PxRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Une ligne de texte extraite du document, avec un moyen de retrouver la position d'une plage. */
export interface TextLine {
  page: number;
  text: string;
  rectOf: (start: number, end: number) => PxRect | null;
  /** Bord droit disponible pour la ligne (colonne, cellule ou page). */
  rightLimit: number;
}

interface Pattern {
  re: RegExp;
  kind: Kind;
  /** Priorité : un mot-clé explicite l'emporte sur une mention annexe. */
  priority: number;
}

const PATTERNS: Pattern[] = [
  { re: /\b(cachet|tampon|stamp|company seal|seal)\b/g, kind: 'stamp', priority: 3 },
  { re: /\b(signatures?|signataires?|signe(e)?s?|signed|sign here|paraphes?|visa)\b/g, kind: 'signature', priority: 3 },
  { re: /\b(lu et approuve|bon pour accord|read and approved|approved by)\b/g, kind: 'signature', priority: 1 },
];

/** Ligne de pointillés ou de soulignés à compléter. */
const FILLER = /(?:_{3,}|\.{4,}|…{2,}|-{4,})[_.…\-\s]*/;

/** Normalise (minuscules, sans accents) en conservant la correspondance d'index avec le texte original. */
export function normalizeWithMap(s: string): { norm: string; map: number[] } {
  let norm = '';
  const map: number[] = [];
  for (let i = 0; i < s.length; i++) {
    const n = s[i].normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
    for (const c of n) {
      norm += c;
      map.push(i);
    }
  }
  map.push(s.length);
  return { norm, map };
}

interface Hit {
  kind: Kind;
  priority: number;
  start: number;
  end: number;
}

function findHits(norm: string): Hit[] {
  const hits: Hit[] = [];
  for (const p of PATTERNS) {
    p.re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = p.re.exec(norm))) {
      hits.push({ kind: p.kind, priority: p.priority, start: m.index, end: m.index + m[0].length });
    }
  }
  return hits.sort((a, b) => a.start - b.start);
}

/** Écarte les phrases de corps de texte ("à la signature du présent contrat…"). */
function looksLikeLabel(norm: string, hit: Hit): boolean {
  const trimmed = norm.trim();
  if (trimmed.length <= 60) return true;
  const after = norm.slice(hit.end, hit.end + 6);
  if (/^\s*[:_.…]/.test(after)) return true;
  return /_{3,}|\.{4,}|…{2,}/.test(norm);
}

function overlaps(a: PxRect, b: PxRect, pad = 0): boolean {
  return a.x < b.x + b.w + pad && b.x < a.x + a.w + pad && a.y < b.y + b.h + pad && b.y < a.y + a.h + pad;
}

interface Candidate {
  page: number;
  kind: Kind;
  rect: PxRect;
  label: string;
  priority: number;
  source: 'field' | 'text';
}

export function signatureSize(pageW: number) {
  return { w: pageW * 0.3, h: pageW * 0.075 };
}

export function stampSize(pageW: number) {
  return { w: pageW * 0.2, h: pageW * 0.2 };
}

function clampRect(r: PxRect, W: number, H: number): PxRect {
  const w = Math.min(r.w, W * 0.96);
  const h = Math.min(r.h, H * 0.96);
  return {
    w,
    h,
    x: Math.max(W * 0.02, Math.min(r.x, W * 0.98 - w)),
    y: Math.max(H * 0.01, Math.min(r.y, H * 0.99 - h)),
  };
}

/**
 * Transforme des lignes de texte en zones de signature / cachet.
 * `pageSizes` donne la taille en px (même repère que rectOf) de chaque page.
 */
export function detectZones(
  lines: TextLine[],
  pageSizes: { w: number; h: number }[],
  fields: { page: number; rect: PxRect; label: string }[] = [],
): Zone[] {
  const cands: Candidate[] = fields.map((f) => ({
    page: f.page,
    kind: 'signature',
    rect: f.rect,
    label: f.label || 'Champ de signature',
    priority: 5,
    source: 'field',
  }));

  for (const line of lines) {
    const { norm, map } = normalizeWithMap(line.text);
    const hits = findHits(norm).filter((h) => looksLikeLabel(norm, h));
    if (!hits.length) continue;
    const size = pageSizes[line.page];
    if (!size) continue;
    const { w: W, h: H } = size;

    const sigHit = hits.find((h) => h.kind === 'signature');
    const stampHit = hits.find((h) => h.kind === 'stamp');
    const anchorHit = hits[0];
    const last = hits[hits.length - 1];
    const kw = line.rectOf(map[anchorHit.start], map[last.end]);
    if (!kw) continue;
    const label = line.text.trim().replace(/\s+/g, ' ').slice(0, 48);

    // Ligne de pointillés / soulignés juste après le mot-clé → on signe dessus.
    const fill = FILLER.exec(norm.slice(last.end));
    let fillRect: PxRect | null = null;
    if (fill) {
      const fs = last.end + fill.index;
      const fe = fs + fill[0].trimEnd().length;
      fillRect = line.rectOf(map[fs], map[fe]);
    }

    const sig = signatureSize(W);
    const st = stampSize(W);
    let sigRect: PxRect | null = null;

    if (sigHit) {
      if (fillRect && fillRect.w > W * 0.08) {
        const w = Math.max(sig.w * 0.8, Math.min(fillRect.w, W * 0.42));
        const h = Math.min(sig.h, w / 3);
        sigRect = { x: fillRect.x, y: fillRect.y + fillRect.h - h * 0.85, w, h };
      } else {
        sigRect = { x: kw.x, y: kw.y + kw.h + W * 0.008, w: sig.w, h: sig.h };
      }
      sigRect = clampRect(sigRect, W, H);
      cands.push({ page: line.page, kind: 'signature', rect: sigRect, label, priority: sigHit.priority, source: 'text' });
    }

    if (stampHit) {
      let r: PxRect;
      if (sigRect) {
        const right = sigRect.x + sigRect.w + W * 0.03;
        r = right + st.w <= Math.min(line.rightLimit, W * 0.98)
          ? { x: right, y: sigRect.y, w: st.w, h: st.h }
          : { x: sigRect.x, y: sigRect.y + sigRect.h + W * 0.01, w: st.w, h: st.h };
      } else if (fillRect && fillRect.w > W * 0.08) {
        r = { x: fillRect.x, y: fillRect.y + fillRect.h - st.h * 0.7, w: st.w, h: st.h };
      } else {
        r = { x: kw.x, y: kw.y + kw.h + W * 0.008, w: st.w, h: st.h };
      }
      cands.push({ page: line.page, kind: 'stamp', rect: clampRect(r, W, H), label, priority: stampHit.priority, source: 'text' });
    }
  }

  // Dédoublonnage : la meilleure priorité gagne, puis l'ordre de lecture.
  cands.sort((a, b) => b.priority - a.priority);
  const kept: Candidate[] = [];
  for (const c of cands) {
    const pad = (pageSizes[c.page]?.w ?? 600) * 0.01;
    if (kept.some((k) => k.page === c.page && k.kind === c.kind && overlaps(k.rect, c.rect, pad))) continue;
    kept.push(c);
  }
  kept.sort((a, b) => a.page - b.page || a.rect.y - b.rect.y || a.rect.x - b.rect.x);

  return kept.map((c) => {
    const { w: W, h: H } = pageSizes[c.page];
    return {
      id: uid(),
      page: c.page,
      kind: c.kind,
      label: c.label,
      source: c.source,
      x: c.rect.x / W,
      y: c.rect.y / H,
      w: c.rect.w / W,
      h: c.rect.h / H,
    };
  });
}
