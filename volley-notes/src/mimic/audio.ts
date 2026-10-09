// Comparaison d'une imitation avec le son de référence.
//
// Chaque son est découpé en tranches de 20 ms. Pour chaque tranche on mesure :
//  - le volume (en dB, relatif au moment le plus fort) ;
//  - la hauteur de la voix, en demi-tons par rapport à la hauteur moyenne du son
//    (on compare la mélodie, pas le fait d'avoir une voix grave ou aiguë) ;
//  - le côté « bruit / souffle » (taux de passages par zéro).
// Les deux suites sont ensuite alignées dans le temps (DTW) pour tolérer un rythme un peu décalé.
// Fonctions pures : elles tournent aussi bien dans le navigateur que dans les tests.

export const SAMPLE_RATE = 16000;
const FRAME = 640; // 40 ms
const HOP = 320; // 20 ms
const MIN_F0 = 70;
const MAX_F0 = 1000;
const SILENCE_DB = -38; // en dessous (par rapport au max), la tranche est du silence

export interface Frame {
  e: number; // volume 0..1
  st: number; // hauteur en demi-tons relatifs, NaN si pas de voix
  z: number; // bruit 0..1
}

export function analyze(samples: Float32Array, sr = SAMPLE_RATE): Frame[] {
  const frames: { db: number; f0: number; zcr: number }[] = [];
  for (let start = 0; start + FRAME <= samples.length; start += HOP) {
    let sum = 0;
    let zc = 0;
    for (let i = 0; i < FRAME; i++) {
      const v = samples[start + i];
      sum += v * v;
      if (i > 0 && (v >= 0) !== (samples[start + i - 1] >= 0)) zc++;
    }
    const rms = Math.sqrt(sum / FRAME);
    frames.push({ db: 20 * Math.log10(rms + 1e-9), f0: pitch(samples, start, sr), zcr: zc / FRAME });
  }
  if (!frames.length) return [];
  const max = Math.max(...frames.map((f) => f.db));
  if (max < -55) return []; // que du silence
  // On coupe le silence au début et à la fin.
  let a = 0;
  let b = frames.length - 1;
  while (a < b && frames[a].db - max < SILENCE_DB) a++;
  while (b > a && frames[b].db - max < SILENCE_DB) b--;
  const kept = frames.slice(a, b + 1);
  const voiced = kept.filter((f) => f.f0 > 0 && f.db - max > SILENCE_DB).map((f) => 12 * Math.log2(f.f0));
  const ref = voiced.length ? median(voiced) : 0;
  return kept.map((f) => {
    const rel = f.db - max;
    const silent = rel < SILENCE_DB;
    return {
      e: Math.max(0, Math.min(1, (rel + 45) / 45)),
      st: !silent && f.f0 > 0 ? 12 * Math.log2(f.f0) - ref : NaN,
      z: silent ? 0 : Math.max(0, Math.min(1, f.zcr * 4)),
    };
  });
}

/** Hauteur par autocorrélation normalisée ; 0 si la tranche n'est pas voisée. */
function pitch(x: Float32Array, start: number, sr: number) {
  const minLag = Math.floor(sr / MAX_F0);
  const maxLag = Math.min(Math.floor(sr / MIN_F0), FRAME - 1);
  const n = FRAME - maxLag;
  let e0 = 0;
  for (let i = 0; i < n; i++) e0 += x[start + i] * x[start + i];
  if (e0 < 1e-6) return 0;
  let best = 0;
  let bestLag = 0;
  const corr = new Float32Array(maxLag + 2);
  for (let lag = minLag; lag <= maxLag; lag++) {
    let c = 0;
    let e1 = 0;
    for (let i = 0; i < n; i++) {
      const v = x[start + i + lag];
      c += x[start + i] * v;
      e1 += v * v;
    }
    const r = c / Math.sqrt(e0 * e1 + 1e-12);
    corr[lag] = r;
    if (r > best) {
      best = r;
      bestLag = lag;
    }
  }
  if (best < 0.55 || bestLag === 0) return 0;
  // Évite de prendre un multiple de la vraie période : on préfère le plus petit retard presque aussi bon.
  for (let k = 2; k <= 4; k++) {
    const lag = Math.round(bestLag / k);
    if (lag >= minLag && corr[lag] > best * 0.9) bestLag = lag;
  }
  // Interpolation parabolique autour du pic.
  const y0 = corr[bestLag - 1] ?? 0;
  const y1 = corr[bestLag];
  const y2 = corr[bestLag + 1] ?? 0;
  const d = (y0 - y2) / (2 * (y0 - 2 * y1 + y2) || 1);
  return sr / (bestLag + (Math.abs(d) < 1 ? d : 0));
}

function median(v: number[]) {
  const s = [...v].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
}

function frameCost(a: Frame, b: Frame) {
  const de = Math.abs(a.e - b.e);
  const av = !Number.isNaN(a.st);
  const bv = !Number.isNaN(b.st);
  let dp = 0;
  if (av && bv) dp = Math.min(Math.abs(a.st - b.st) / 7, 1);
  else if (av !== bv) dp = 0.55;
  const dz = Math.abs(a.z - b.z);
  return 1.0 * de + 0.9 * dp + 0.6 * dz;
}

/** Distance moyenne le long du meilleur alignement (DTW avec bande). */
function dtw(a: Frame[], b: Frame[]) {
  const n = a.length;
  const m = b.length;
  const band = Math.max(12, Math.ceil(Math.max(n, m) * 0.35));
  const INF = 1e9;
  let prev = new Float64Array(m + 1).fill(INF);
  let prevLen = new Float64Array(m + 1);
  prev[0] = 0;
  for (let i = 1; i <= n; i++) {
    const cur = new Float64Array(m + 1).fill(INF);
    const curLen = new Float64Array(m + 1);
    const center = Math.round((i * m) / n);
    const lo = Math.max(1, center - band);
    const hi = Math.min(m, center + band);
    for (let j = lo; j <= hi; j++) {
      const c = frameCost(a[i - 1], b[j - 1]);
      let best = prev[j - 1];
      let len = prevLen[j - 1];
      if (prev[j] < best) {
        best = prev[j];
        len = prevLen[j];
      }
      if (cur[j - 1] < best) {
        best = cur[j - 1];
        len = curLen[j - 1];
      }
      cur[j] = best + c;
      curLen[j] = len + 1;
    }
    prev = cur;
    prevLen = curLen;
  }
  return prev[m] >= INF ? 1 : prev[m] / Math.max(1, prevLen[m]);
}

/** Note de 0 à 100 de l'imitation `take` par rapport à la référence `ref`. */
export function similarity(ref: Frame[], take: Frame[]) {
  if (ref.length < 3 || take.length < 3) return 0;
  const d = dtw(ref, take);
  // Barème volontairement indulgent : une vraie voix n'est jamais aussi propre que la référence.
  const shape = Math.max(0, Math.min(1, (0.56 - d) / 0.46));
  const ratio = take.length / ref.length;
  const timing = Math.exp(-Math.abs(Math.log(ratio)) * 0.7);
  return Math.round(100 * Math.pow(shape, 0.8) * (0.45 + 0.55 * timing));
}

/** Enveloppe de volume réduite à `n` points, pour dessiner les courbes. */
export function envelope(frames: Frame[], n = 64) {
  if (!frames.length) return new Array(n).fill(0);
  return Array.from({ length: n }, (_, i) => {
    const a = Math.floor((i * frames.length) / n);
    const b = Math.max(a + 1, Math.floor(((i + 1) * frames.length) / n));
    let m = 0;
    for (let k = a; k < b && k < frames.length; k++) m = Math.max(m, frames[k].e);
    return m;
  });
}
