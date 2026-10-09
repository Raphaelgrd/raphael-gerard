// Tout ce qui touche au son dans le navigateur : décodage, enregistrement au micro, lecture.
import { analyze, SAMPLE_RATE, type Frame } from './audio';

/** Décode un fichier audio et le ramène en mono 16 kHz pour l'analyse. */
export async function decodeMono16k(data: ArrayBuffer): Promise<{ samples: Float32Array; duration: number }> {
  const probe = new OfflineAudioContext(1, 1, 44100);
  const buf = await probe.decodeAudioData(data.slice(0));
  const length = Math.max(1, Math.ceil(buf.duration * SAMPLE_RATE));
  const off = new OfflineAudioContext(1, length, SAMPLE_RATE);
  const src = off.createBufferSource();
  src.buffer = buf;
  src.connect(off.destination);
  src.start();
  const out = await off.startRendering();
  return { samples: out.getChannelData(0), duration: buf.duration };
}

const refCache = new Map<string, Promise<Frame[]>>();

/** Analyse d'un son de référence (mise en cache par adresse). */
export function referenceFrames(url: string): Promise<Frame[]> {
  let p = refCache.get(url);
  if (!p) {
    p = fetch(url)
      .then((r) => {
        if (!r.ok) throw new Error('son introuvable');
        return r.arrayBuffer();
      })
      .then(decodeMono16k)
      .then(({ samples }) => analyze(samples));
    p.catch(() => refCache.delete(url));
    refCache.set(url, p);
  }
  return p;
}

/* ---------- lecture ---------- */
const player = new Audio();
let playingKey: string | null = null;
let onChange: () => void = () => {};
player.addEventListener('ended', () => {
  playingKey = null;
  onChange();
});

export function onPlaybackChange(fn: () => void) {
  onChange = fn;
}
export function isPlaying(key: string) {
  return playingKey === key;
}
export function play(key: string, src: string) {
  if (playingKey === key) {
    player.pause();
    playingKey = null;
    onChange();
    return;
  }
  player.src = src;
  playingKey = key;
  player.play().catch(() => {
    playingKey = null;
    onChange();
  });
  onChange();
}
export function stopPlayback() {
  player.pause();
  playingKey = null;
}

/* ---------- enregistrement ---------- */
export function recordingMime() {
  if (typeof MediaRecorder === 'undefined') return null;
  for (const m of ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus']) {
    if (MediaRecorder.isTypeSupported(m)) return m;
  }
  return '';
}

export const EXT: Record<string, string> = {
  'audio/webm': 'webm',
  'audio/mp4': 'm4a',
  'audio/x-m4a': 'm4a',
  'audio/mpeg': 'mp3',
  'audio/mp3': 'mp3',
  'audio/ogg': 'ogg',
  'audio/wav': 'wav',
  'audio/x-wav': 'wav',
  'audio/wave': 'wav',
  'audio/aac': 'aac',
};

export interface Recording {
  stop: () => void;
  done: Promise<Blob>;
}

/**
 * Enregistre le micro jusqu'à `maxSec` secondes ou jusqu'à `stop()`.
 * `onLevel` reçoit le volume (0..1) environ 30 fois par seconde.
 */
export async function record(maxSec: number, onLevel: (v: number) => void): Promise<Recording> {
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: true },
  });
  const mime = recordingMime();
  const rec = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
  const chunks: Blob[] = [];
  rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);

  const ctx = new AudioContext();
  const analyser = ctx.createAnalyser();
  analyser.fftSize = 512;
  ctx.createMediaStreamSource(stream).connect(analyser);
  const buf = new Float32Array(analyser.fftSize);
  let raf = 0;
  const meter = () => {
    analyser.getFloatTimeDomainData(buf);
    let s = 0;
    for (const v of buf) s += v * v;
    onLevel(Math.min(1, Math.sqrt(s / buf.length) * 4));
    raf = requestAnimationFrame(meter);
  };
  meter();

  const done = new Promise<Blob>((resolve) => {
    rec.onstop = () => {
      cancelAnimationFrame(raf);
      stream.getTracks().forEach((t) => t.stop());
      ctx.close();
      resolve(new Blob(chunks, { type: (rec.mimeType || mime || 'audio/webm').split(';')[0] }));
    };
  });
  rec.start();
  const timer = setTimeout(() => rec.state !== 'inactive' && rec.stop(), maxSec * 1000);
  return {
    stop: () => {
      clearTimeout(timer);
      if (rec.state !== 'inactive') rec.stop();
    },
    done,
  };
}
