// Les 6 de la bande en pixel art (32 × 32), dessinés pixel par pixel à partir de leurs traits marquants.
// Chaque personnage est construit couche par couche (corps, tête, yeux, bouche, poils, cheveux, accessoires),
// puis entouré d'un contour sombre. Le résultat est un SVG net à n'importe quelle taille.

const N = 32;
type Grid = (string | null)[][];

const OUTLINE = '#1c1424';

function blank(): Grid {
  return Array.from({ length: N }, () => Array<string | null>(N).fill(null));
}
function px(g: Grid, x: number, y: number, c: string | null) {
  if (x >= 0 && x < N && y >= 0 && y < N) g[y][x] = c;
}
function rect(g: Grid, x0: number, y0: number, x1: number, y1: number, c: string) {
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) px(g, x, y, c);
}
function ellipse(g: Grid, cx: number, cy: number, rx: number, ry: number, c: string) {
  for (let y = 0; y < N; y++)
    for (let x = 0; x < N; x++) {
      const dx = (x + 0.5 - cx) / rx;
      const dy = (y + 0.5 - cy) / ry;
      if (dx * dx + dy * dy <= 1) px(g, x, y, c);
    }
}
/** Dessine un motif : chaque caractère non espace/point est une couleur de `map`. */
function stamp(g: Grid, x0: number, y0: number, rows: string[], map: Record<string, string>) {
  rows.forEach((row, dy) => [...row].forEach((ch, dx) => ch !== '.' && ch !== ' ' && map[ch] && px(g, x0 + dx, y0 + dy, map[ch])));
}
/** Ombre en bas et à droite, reflet en haut à gauche, pour toutes les zones de couleurs `colors`. */
function shade(g: Grid, colors: string[], dark: string, light?: string) {
  const inSet = (x: number, y: number) => colors.includes(g[y]?.[x] ?? '');
  const marks: [number, number, string][] = [];
  for (let y = 0; y < N; y++)
    for (let x = 0; x < N; x++) {
      if (!inSet(x, y)) continue;
      if (!inSet(x + 1, y) || !inSet(x, y + 1)) marks.push([x, y, dark]);
      else if (light && (!inSet(x - 1, y) || !inSet(x, y - 1)) && (x + y) % 2 === 0) marks.push([x, y, light]);
    }
  for (const [x, y, c] of marks) g[y][x] = c;
}

function outline(g: Grid) {
  const out = g.map((r) => [...r]);
  for (let y = 0; y < N; y++)
    for (let x = 0; x < N; x++) {
      if (g[y][x]) continue;
      const near = [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => g[y + dy]?.[x + dx]);
      if (near) out[y][x] = OUTLINE;
    }
  return out;
}

interface Look {
  skin: string;
  skinShade: string;
  skinLight: string;
  blush: string;
  shirt: string;
  shirtShade: string;
  eye: string;
}

/** Base commune : épaules, cou, tête, oreilles, nez. */
function base(l: Look) {
  const g = blank();
  // Buste
  rect(g, 4, 27, 27, 31, l.shirt);
  rect(g, 6, 25, 25, 26, l.shirt);
  rect(g, 4, 30, 27, 31, l.shirtShade);
  // Col, coutures d'épaules et plis
  rect(g, 12, 25, 19, 25, l.shirtShade);
  px(g, 11, 26, l.shirtShade);
  px(g, 20, 26, l.shirtShade);
  rect(g, 8, 27, 8, 29, l.shirtShade);
  rect(g, 23, 27, 23, 29, l.shirtShade);
  px(g, 25, 28, l.shirtShade);
  px(g, 26, 29, l.shirtShade);
  px(g, 6, 29, l.shirtShade);
  // Cou
  rect(g, 13, 21, 18, 25, l.skinShade);
  rect(g, 13, 25, 18, 25, l.skin);
  // Tête, avec le côté droit dans l'ombre
  ellipse(g, 16, 14.5, 7.2, 8.6, l.skin);
  for (let y = 7; y <= 22; y++) for (let x = 21; x <= 23; x++) if (g[y][x] === l.skin && (x >= 22 || y >= 17)) px(g, x, y, l.skinShade);
  // Ombre de la mâchoire et du cou
  for (let x = 11; x <= 20; x++) px(g, x, 22, l.skinShade);
  rect(g, 13, 23, 18, 23, l.skinShade);
  // Joues rosées
  px(g, 11, 18, l.blush);
  px(g, 20, 18, l.blush);
  // Oreilles
  rect(g, 8, 14, 8, 17, l.skin);
  rect(g, 23, 14, 23, 17, l.skinShade);
  px(g, 8, 16, l.skinShade);
  px(g, 23, 15, l.skin);
  // Nez : arête éclairée, narines dans l'ombre
  px(g, 15, 16, l.skinLight);
  px(g, 15, 17, l.skinLight);
  px(g, 16, 17, l.skinShade);
  px(g, 15, 18, l.skinShade);
  px(g, 17, 18, l.skinShade);
  return g;
}

function eyes(g: Grid, l: Look, opts: { closedRight?: boolean; brow?: string } = {}) {
  // Yeux : blanc + iris
  rect(g, 11, 15, 13, 15, '#ffffff');
  px(g, 12, 15, l.eye);
  px(g, 13, 15, l.eye);
  if (opts.closedRight) {
    rect(g, 18, 15, 20, 15, l.skinShade);
    px(g, 18, 16, '#3a2a2a');
    px(g, 19, 15, '#3a2a2a');
    px(g, 20, 15, '#3a2a2a');
  } else {
    rect(g, 18, 15, 20, 15, '#ffffff');
    px(g, 18, 15, l.eye);
    px(g, 19, 15, l.eye);
  }
  const brow = opts.brow ?? '#3b2a20';
  rect(g, 11, 13, 13, 13, brow);
  rect(g, 18, 13, 20, 13, brow);
  // Paupières et reflet dans l'œil
  rect(g, 11, 14, 13, 14, l.skinShade);
  if (!opts.closedRight) rect(g, 18, 14, 20, 14, l.skinShade);

  if (opts.closedRight) {
    // Sourcil levé au-dessus de l'œil fermé
    rect(g, 18, 12, 20, 12, brow);
    rect(g, 18, 13, 20, 13, l.skin);
  }
}

function mouth(g: Grid, kind: 'smile' | 'grin' | 'pout' | 'smirk') {
  const lip = '#b5536a';
  if (kind === 'grin') {
    rect(g, 13, 20, 18, 20, '#5a1e2a');
    rect(g, 14, 20, 17, 20, '#ffffff');
    px(g, 13, 19, '#5a1e2a');
    px(g, 18, 19, '#5a1e2a');
  } else if (kind === 'smile') {
    rect(g, 14, 20, 17, 20, '#5a1e2a');
    px(g, 13, 19, '#5a1e2a');
    px(g, 18, 19, '#5a1e2a');
  } else if (kind === 'pout') {
    rect(g, 14, 20, 17, 20, lip);
    rect(g, 15, 19, 16, 19, lip);
  } else {
    rect(g, 14, 20, 17, 20, '#5a1e2a');
    px(g, 18, 19, '#5a1e2a');
  }
}

function facialHair(g: Grid, color: string, kind: 'goatee' | 'goateeStache' | 'beard') {
  if (kind === 'goatee' || kind === 'goateeStache' || kind === 'beard') {
    rect(g, 14, 21, 17, 23, color);
    rect(g, 15, 24, 16, 24, color);
  }
  if (kind === 'goateeStache' || kind === 'beard') {
    rect(g, 13, 19, 18, 19, color);
    px(g, 13, 20, color);
    px(g, 18, 20, color);
  }
  if (kind === 'beard') {
    for (let y = 17; y <= 22; y++) {
      px(g, 9 + Math.max(0, y - 19), y, color);
      px(g, 22 - Math.max(0, y - 19), y, color);
    }
    rect(g, 11, 21, 20, 22, color);
  }
}

/* ---------- les 6 personnages ---------- */
const BUILDERS: Record<string, () => Grid> = {
  // Raph.G : boucles châtain en bataille, yeux bleus, sourire, t-shirt noir.
  raphg() {
    const l: Look = { skin: '#f2c6a6', skinShade: '#d9a383', skinLight: '#fbdcc4', blush: '#eaa592', shirt: '#24232b', shirtShade: '#17161c', eye: '#3f8fd8' };
    const g = base(l);
    eyes(g, l, { brow: '#6b4a2f' });
    mouth(g, 'smile');
    const H = '#6b4a2f';
    const h = '#93693f';
    stamp(g, 6, 3, [
      '....h.HH.hH.HH.h....',
      '..HHHHHHhHHHHHhHHH..',
      '.HHhHHHHHHHHHHHHHHH.',
      'HHHHHHHhHHHHHhHHHHHH',
      'HHHHhHHHHHHHHHHHHhHH',
      'HHHHHHHH.HHHHH.HHHHH',
      'HHHH.H..........HHHH',
      'HHH..............HHH',
      '.HH..............HH.',
      'HH................HH',
      '.H................H.',
        ], { H, h });
    shade(g, [H, h], '#4e331f', '#a87b4c');
    return g;
  },

  // Paco : cheveux mi-longs décolorés, racines foncées, raie au milieu, grand sourire, t-shirt blanc.
  paco() {
    const l: Look = { skin: '#f0c19d', skinShade: '#d69f7b', skinLight: '#f9d8bd', blush: '#e89f86', shirt: '#f4f4f2', shirtShade: '#d8d8d4', eye: '#7c9a6a' };
    const g = base(l);
    eyes(g, l, { brow: '#7a5a34' });
    mouth(g, 'grin');
    const R = '#7a6040'; // racines
    const B = '#f2e19a'; // blond
    const b = '#d9c272';
    stamp(g, 6, 3, [
      '....RRRRRRRRRRR.....',
      '..RRRRRRR.RRRRRRR...',
      '.RRRRBBBR.RBBBRRRR..',
      'BBBBBBBB...BBBBBBBB.',
      'BBBBBBB.....BBBBBBBB',
      'BBBBBB.......bBBBBBB',
      'BBBB...........BBBBB',
      'BBB.............BBBB',
      'BBB.............BBBB',
      'BBB..............BBB',
      'BbB..............BbB',
      'BBB..............BBB',
      'BbB..............BBb',
      'BB................BB',
      'B..................B',
    ], { R, B, b });
    shade(g, [B, b], '#c9ad5c', '#fff3c4');
    shade(g, [R], '#5a452c');
    // Texte du t-shirt
    rect(g, 13, 28, 18, 28, '#444444');
    return g;
  },

  // Mathieu : chapeau de paille, clin d'œil, moustache et bouc, sweat à capuche vert.
  mathieu() {
    const l: Look = { skin: '#e8b48c', skinShade: '#cb9068', skinLight: '#f4cba8', blush: '#dc957a', shirt: '#38b25a', shirtShade: '#2a8c45', eye: '#5a3b26' };
    const g = base(l);
    eyes(g, l, { closedRight: true, brow: '#2a1c14' });
    mouth(g, 'smirk');
    facialHair(g, '#2a1c14', 'goateeStache');
    // Cheveux qui dépassent sous le chapeau
    rect(g, 8, 10, 9, 14, '#2a1c14');
    rect(g, 22, 10, 23, 13, '#2a1c14');
    // Chapeau de paille : calotte tressée + large bord
    const P = '#e0b265';
    const p = '#b8863c';
    stamp(g, 9, 2, [
      '...PpPpPpPpP...',
      '..PpPpPpPpPpP..',
      '.PpPpPpPpPpPpP.',
      '.pPpPpPpPpPpPp.',
      '.PPPPPPPPPPPPP.',
      '.ppppppppppppp.',
    ], { P, p });
    stamp(g, 3, 8, [
      '..PPPPPPPPPPPPPPPPPPPPPP..',
      'PPpPpPpPpPpPpPpPpPpPpPpPPP',
      '.pppppppppppppppppppppppp.',
    ], { P, p });
    shade(g, [P, p], '#94692c');
    // Capuche et logo
    rect(g, 9, 24, 11, 26, '#2a8c45');
    rect(g, 20, 24, 22, 26, '#2a8c45');
    stamp(g, 13, 28, ['.WWWW.', 'W....W', '.WWWW.'], { W: '#f2f2f2' });
    return g;
  },

  // Raph.S : cheveux très courts, grosses lunettes rondes noires, sourire, t-shirt beige.
  raphs() {
    const l: Look = { skin: '#6e4329', skinShade: '#55321d', skinLight: '#8a5838', blush: '#7a4530', shirt: '#d8c4a0', shirtShade: '#bca784', eye: '#2a1810' };
    const g = base(l);
    eyes(g, l, { brow: '#1a110c' });
    mouth(g, 'smile');
    const H = '#1d1410';
    stamp(g, 9, 5, [
      '...HHHHHHHH...',
      '.HHHHHHHHHHHH.',
      'HHHHHHHHHHHHHH',
      'HHH........HHH',
      'HH..........HH',
    ], { H });
    shade(g, [H], '#0e0a08', '#3a2b24');
    // Lunettes rondes : deux montures noires reliées par un pont
    const G = '#141014';
    for (const x0 of [10, 17]) {
      rect(g, x0 + 1, 13, x0 + 3, 13, G);
      rect(g, x0 + 1, 17, x0 + 3, 17, G);
      rect(g, x0, 14, x0, 16, G);
      rect(g, x0 + 4, 14, x0 + 4, 16, G);
      rect(g, x0 + 1, 14, x0 + 3, 16, '#8a6a5a');
      rect(g, x0 + 1, 15, x0 + 3, 15, '#ffffff');
      rect(g, x0 + 2, 15, x0 + 3, 15, l.eye);
      px(g, x0 + 1, 14, '#9fc0e0'); // reflet
    }
    rect(g, 15, 14, 16, 14, G);
    return g;
  },

  // Sofiane : casquette Spider-Man, barbe et bouc, t-shirt blanc Nike SB, signe rock.
  sofiane() {
    const l: Look = { skin: '#e2ae86', skinShade: '#c48e66', skinLight: '#f0c7a5', blush: '#d6927a', shirt: '#f4f4f2', shirtShade: '#d8d8d4', eye: '#4a2e1c' };
    const g = base(l);
    eyes(g, l, { brow: '#1f150f' });
    mouth(g, 'smirk');
    facialHair(g, '#1f150f', 'beard');
    // Casquette : calotte rouge à toile noire, yeux blancs, visière grise
    const R = '#d42a32';
    const K = '#1d1d22';
    const W = '#f6f6f6';
    stamp(g, 8, 2, [
      '....RRRRRRRR....',
      '..RRKRRRRRRKRR..',
      '.RRRRRKRRKRRRRR.',
      'RRKWWWRRRRWWWKRR',
      'RRWWWWKRRKWWWWRR',
      'RKRWWRRKKRRWWRKR',
      'RRRRKRRRRRRKRRRR',
    ], { R, K, W });
    shade(g, [R], '#9e1820', '#ee5960');
    rect(g, 7, 9, 24, 10, '#3d3d44');
    rect(g, 8, 11, 23, 11, '#2c2c32');
    // Texte « NIKE SB »
    rect(g, 10, 28, 15, 28, '#2a2a2a');
    rect(g, 17, 28, 19, 28, '#2a2a2a');
    // Main qui fait le signe rock (index et auriculaire levés)
    stamp(g, 24, 21, [
      'S..S',
      'S..S',
      'SSSS',
      'SSSS',
      '.SS.',
    ], { S: l.skin });
    return g;
  },

  // Matias : cheveux bruns en bataille avec mèche sur le front, grand sourire, moustache et bouc, sweat gris.
  matias() {
    const l: Look = { skin: '#efbf98', skinShade: '#d39d76', skinLight: '#f9d6b9', blush: '#e5a088', shirt: '#a3abaf', shirtShade: '#868e92', eye: '#4a2c1a' };
    const g = base(l);
    eyes(g, l, { brow: '#2b1a12' });
    mouth(g, 'grin');
    facialHair(g, '#3a2418', 'goateeStache');
    // Le sourire passe devant la moustache
    rect(g, 14, 20, 17, 20, '#ffffff');
    const H = '#2e1c13';
    const h = '#4a2f1f';
    stamp(g, 6, 1, [
      '.........H..........',
      '....HHHhHHHHHH......',
      '..HHHHHHHHHHHHHHH...',
      '.HHHhHHHHHHHhHHHHH..',
      'HHHHHHHHHHHHHHHHHHH.',
      'HHHHHHhHHHHHHHHhHHHH',
      'HHHHHHHHHHHHHHHHHHHH',
      'HHH.HHHHH.HHHHHHHHHH',
      'HHH..HHH...HHH..HHHH',
      'HH....H.....H....HHH',
      'HH................HH',
      'H.................HH',
      'H..................H',
    ], { H, h });
    shade(g, [H, h], '#1c110b', '#5c3c28');
    // Cordons du sweat
    rect(g, 13, 26, 13, 30, '#d8dcde');
    rect(g, 18, 26, 18, 30, '#d8dcde');
    rect(g, 9, 24, 11, 26, '#868e92');
    rect(g, 20, 24, 22, 26, '#868e92');
    return g;
  },
};

const cache = new Map<string, string>();

/** SVG du personnage (chaîne), avec des rectangles fusionnés par ligne. */
export function spriteSvg(id: string): string {
  const build = BUILDERS[id];
  if (!build) return '';
  const g = outline(build());
  let rects = '';
  for (let y = 0; y < N; y++) {
    let x = 0;
    while (x < N) {
      const c = g[y][x];
      if (!c) {
        x++;
        continue;
      }
      let w = 1;
      while (x + w < N && g[y][x + w] === c) w++;
      rects += `<rect x="${x}" y="${y}" width="${w}" height="1" fill="${c}"/>`;
      x += w;
    }
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${N} ${N}" shape-rendering="crispEdges">${rects}</svg>`;
}

/** Adresse data: du personnage, à utiliser comme source d'image. */
export function spriteUrl(id: string): string {
  let u = cache.get(id);
  if (!u) {
    u = `data:image/svg+xml,${encodeURIComponent(spriteSvg(id))}`;
    cache.set(id, u);
  }
  return u;
}

/** Balise <img> du personnage. */
export function sprite(id: string, cls = '', alt = '') {
  return `<img class="sprite ${cls}" src="${spriteUrl(id)}" alt="${alt}" width="32" height="32" draggable="false">`;
}
