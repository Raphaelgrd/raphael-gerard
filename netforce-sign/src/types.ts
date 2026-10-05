export type Kind = 'signature' | 'stamp';

/** Rectangle exprimé en fractions de la page (x, w relatifs à la largeur ; y, h à la hauteur). */
export interface FracRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Zone extends FracRect {
  id: string;
  page: number;
  kind: Kind;
  label: string;
  /** "field" = champ de signature PDF natif, "text" = détecté par mots-clés. */
  source: 'field' | 'text';
}

export interface Placement extends FracRect {
  id: string;
  page: number;
  kind: Kind;
  src: string;
  /** Rapport largeur / hauteur de l'image. */
  ratio: number;
  zoneId?: string;
}

export interface Asset {
  src: string;
  ratio: number;
}

export interface PageSize {
  /** Largeur et hauteur de référence (pt pour PDF, px pour Word) — sert au ratio. */
  width: number;
  height: number;
}

export type DocKind = 'pdf' | 'docx';

export interface LoadedDoc {
  kind: DocKind;
  name: string;
  bytes: ArrayBuffer;
}
