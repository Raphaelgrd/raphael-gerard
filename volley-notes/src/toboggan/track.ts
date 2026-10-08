// Le toboggan : une suite de tronçons (longueur, virage, pente, largeur, bords).
// La piste est échantillonnée tous les mètres ; la physique travaille en coordonnées de piste
// (s = distance parcourue, u = décalage latéral, h = hauteur au-dessus de la piste).

export type Walls = 'both' | 'left' | 'right' | 'none';

interface Section {
  len: number; // mètres
  turn: number; // degrés au total (positif = vers la droite)
  slope: number; // degrés de pente
  half: number; // demi-largeur en mètres
  walls: Walls;
  jump?: boolean; // tremplin à la fin du tronçon
}

// Le tracé. Les bords sans mur sont ceux où l'on peut pousser les autres dans le vide.
export const SECTIONS: Section[] = [
  { len: 60, turn: 0, slope: 11, half: 6.5, walls: 'both' },
  { len: 80, turn: 70, slope: 13, half: 5.5, walls: 'both' },
  { len: 70, turn: 0, slope: 15, half: 5, walls: 'none' },
  { len: 90, turn: -110, slope: 12, half: 6, walls: 'right' },
  { len: 45, turn: 0, slope: 19, half: 5, walls: 'both', jump: true },
  { len: 60, turn: 0, slope: 10, half: 5, walls: 'none' },
  { len: 100, turn: 140, slope: 12, half: 6.5, walls: 'left' },
  { len: 60, turn: 0, slope: 17, half: 4, walls: 'none' },
  { len: 80, turn: -60, slope: 13, half: 5.5, walls: 'both' },
  { len: 55, turn: 0, slope: 7, half: 7, walls: 'both' },
];

export interface Sample {
  pos: [number, number, number]; // centre de la piste
  tan: [number, number, number]; // sens de la descente
  right: [number, number, number]; // vers la droite de la piste
  up: [number, number, number]; // normale de la piste
  sinSlope: number;
  curv: number; // courbure signée (rad/m, positive = virage à droite)
  half: number;
  wallL: boolean;
  wallR: boolean;
}

export interface Track {
  samples: Sample[];
  length: number;
  finish: number; // s de la ligne d'arrivée
  jumps: number[]; // s des tremplins
  checkpoints: number[]; // s des points de reprise après une chute
}

const rad = (d: number) => (d * Math.PI) / 180;
const BLEND = 14; // mètres de transition entre deux tronçons

export function buildTrack(): Track {
  const total = SECTIONS.reduce((a, s) => a + s.len, 0);
  // Valeurs de chaque tronçon, adoucies aux raccords.
  const starts: number[] = [];
  let acc = 0;
  for (const s of SECTIONS) {
    starts.push(acc);
    acc += s.len;
  }
  const sectionAt = (s: number) => {
    let i = SECTIONS.length - 1;
    while (i > 0 && s < starts[i]) i--;
    return i;
  };
  const smooth = (s: number, get: (sec: Section) => number) => {
    const i = sectionAt(s);
    const cur = get(SECTIONS[i]);
    const into = s - starts[i];
    if (i > 0 && into < BLEND / 2) {
      const prev = get(SECTIONS[i - 1]);
      const t = 0.5 + into / BLEND;
      return prev + (cur - prev) * t * t * (3 - 2 * t);
    }
    const left = SECTIONS[i].len - into;
    if (i < SECTIONS.length - 1 && left < BLEND / 2) {
      const next = get(SECTIONS[i + 1]);
      const t = 0.5 - left / BLEND;
      return cur + (next - cur) * t * t * (3 - 2 * t);
    }
    return cur;
  };

  const samples: Sample[] = [];
  let x = 0,
    y = 0,
    z = 0,
    heading = 0;
  for (let s = 0; s <= total; s++) {
    const i = sectionAt(s);
    const sec = SECTIONS[i];
    const slope = rad(smooth(s, (q) => q.slope));
    const turnRate = rad(smooth(s, (q) => q.turn / q.len)); // rad par mètre
    const half = smooth(s, (q) => q.half);
    const tan: [number, number, number] = [Math.sin(heading) * Math.cos(slope), -Math.sin(slope), -Math.cos(heading) * Math.cos(slope)];
    const right: [number, number, number] = [Math.cos(heading), 0, Math.sin(heading)];
    // up = right × tan
    const up: [number, number, number] = [
      right[1] * tan[2] - right[2] * tan[1],
      right[2] * tan[0] - right[0] * tan[2],
      right[0] * tan[1] - right[1] * tan[0],
    ];
    samples.push({
      pos: [x, y, z],
      tan,
      right,
      up,
      sinSlope: Math.sin(slope),
      curv: turnRate,
      half,
      wallL: sec.walls === 'both' || sec.walls === 'left',
      wallR: sec.walls === 'both' || sec.walls === 'right',
    });
    x += tan[0];
    y += tan[1];
    z += tan[2];
    heading += turnRate;
  }

  const jumps = SECTIONS.map((sec, i) => (sec.jump ? starts[i] + sec.len - 3 : -1)).filter((s) => s > 0);
  const checkpoints = starts.map((s) => s + 2);
  return { samples, length: total, finish: total - 18, jumps, checkpoints };
}

export function sampleAt(track: Track, s: number): Sample {
  const i = Math.max(0, Math.min(track.samples.length - 1, Math.floor(s)));
  return track.samples[i];
}

/** Position dans le monde d'un point de la piste. */
export function worldPos(track: Track, s: number, u: number, h: number): [number, number, number] {
  const i = Math.max(0, Math.min(track.samples.length - 2, Math.floor(s)));
  const f = Math.max(0, Math.min(1, s - i));
  const a = track.samples[i];
  const b = track.samples[i + 1];
  const p = [0, 1, 2].map((k) => a.pos[k] + (b.pos[k] - a.pos[k]) * f + a.right[k] * u + a.up[k] * h);
  return p as [number, number, number];
}
