import { sampleAt, worldPos, type Track } from './track';

// Réglages de la physique (unités : mètres, secondes).
export const TUNING = {
  radius: 0.6,
  gravity: 9.8,
  accel: 5.5, // poussée du doigt vers le haut
  brake: 9, // freinage du doigt vers le bas
  drag: 0.012, // résistance de l'air (vitesse max ≈ 24 m/s en accélérant)
  steer: 16, // accélération latérale max
  lateralDamping: 2.5,
  centrifugal: 1.0, // part de la force centrifuge dans les virages
  wallBounce: 0.45,
  restitution: 0.9, // rebond entre boules
  pushKick: 2.2, // élan ajouté à chaque choc pour que les poussées se sentent
  airGravity: 22,
  fallTime: 1.3, // secondes de chute avant de revenir sur la piste
  ghostTime: 1.5, // secondes sans collision après une reprise
  minSpeed: 1,
};

export interface Ball {
  id: string;
  s: number;
  u: number;
  h: number;
  vs: number;
  vu: number;
  vh: number;
  steer: number; // -1..1
  throttle: number; // -1..1
  // chute hors piste : simulée dans le monde, puis reprise au dernier point de passage
  falling: number; // secondes restantes, 0 = sur la piste
  fallPos: [number, number, number];
  fallVel: [number, number, number];
  ghost: number;
  checkpoint: number;
  finished: number | null; // temps d'arrivée
  falls: number;
  spin: number; // angle de roulement (affichage)
  usedJump: Set<number>;
}

export function makeBall(id: string, s: number, u: number): Ball {
  return {
    id, s, u, h: 0, vs: 0, vu: 0, vh: 0, steer: 0, throttle: 0,
    falling: 0, fallPos: [0, 0, 0], fallVel: [0, 0, 0], ghost: 0, checkpoint: 0,
    finished: null, falls: 0, spin: 0, usedJump: new Set(),
  };
}

/** Avance une boule d'un pas de temps. `time` = chrono de la course. */
export function stepBall(b: Ball, track: Track, dt: number, time: number) {
  const T = TUNING;
  if (b.ghost > 0) b.ghost = Math.max(0, b.ghost - dt);

  if (b.falling > 0) {
    b.falling -= dt;
    b.fallVel[1] -= T.airGravity * dt;
    for (let k = 0; k < 3; k++) b.fallPos[k] += b.fallVel[k] * dt;
    if (b.falling <= 0) respawn(b);
    return;
  }

  const smp = sampleAt(track, b.s);
  // Le long de la piste : pente, doigt, frottement.
  let as = T.gravity * smp.sinSlope - T.drag * b.vs * Math.abs(b.vs);
  if (b.finished === null) as += b.throttle > 0 ? T.accel * b.throttle : T.brake * b.throttle;
  else as -= 4; // après l'arrivée, on ralentit doucement
  b.vs = Math.max(T.minSpeed, b.vs + as * dt);

  // En travers : direction, force centrifuge, amortissement.
  const steer = b.finished === null ? b.steer : 0;
  const au = steer * T.steer - smp.curv * b.vs * b.vs * T.centrifugal - b.vu * T.lateralDamping;
  b.vu += au * dt;

  // En l'air (tremplins).
  if (b.h > 0 || b.vh > 0) {
    b.vh -= T.airGravity * dt;
    b.h += b.vh * dt;
    if (b.h <= 0) {
      b.h = 0;
      b.vh = 0;
    }
  }

  b.s += b.vs * dt;
  b.u += b.vu * dt;
  b.spin += (b.vs * dt) / T.radius;

  for (const j of track.jumps) {
    if (!b.usedJump.has(j) && b.s >= j && b.s - b.vs * dt < j && b.h === 0) {
      b.vh = 5 + b.vs * 0.18;
      b.usedJump.add(j);
    }
  }

  // Bords : mur = rebond, pas de mur = chute (seulement au contact de la piste).
  const limit = smp.half - T.radius;
  if (b.u > limit) {
    if (smp.wallR) {
      b.u = limit;
      b.vu = -Math.abs(b.vu) * T.wallBounce;
    } else if (b.h < 0.4 && b.u > smp.half + T.radius * 0.2) startFall(b, track);
  } else if (b.u < -limit) {
    if (smp.wallL) {
      b.u = -limit;
      b.vu = Math.abs(b.vu) * T.wallBounce;
    } else if (b.h < 0.4 && b.u < -smp.half - T.radius * 0.2) startFall(b, track);
  }

  for (const c of track.checkpoints) if (b.s >= c && c > b.checkpoint) b.checkpoint = c;
  if (b.finished === null && b.s >= track.finish) b.finished = time;
  if (b.s > track.length - 2) {
    b.s = track.length - 2;
    b.vs = T.minSpeed;
  }
}

function startFall(b: Ball, track: Track) {
  const smp = sampleAt(track, b.s);
  b.fallPos = worldPos(track, b.s, b.u, b.h + TUNING.radius);
  b.fallVel = [0, 1, 2].map((k) => smp.tan[k] * b.vs + smp.right[k] * b.vu) as [number, number, number];
  b.falling = TUNING.fallTime;
  b.falls++;
}

function respawn(b: Ball) {
  b.falling = 0;
  b.s = b.checkpoint;
  b.u = 0;
  b.h = 0;
  b.vs = 8;
  b.vu = 0;
  b.vh = 0;
  b.ghost = TUNING.ghostTime;
}

/** Chocs entre boules : rebond + petit élan supplémentaire pour que la poussée se sente. */
export function collide(balls: Ball[]) {
  const T = TUNING;
  const minD = T.radius * 2;
  for (let i = 0; i < balls.length; i++) {
    const a = balls[i];
    if (a.falling > 0 || a.ghost > 0) continue;
    for (let j = i + 1; j < balls.length; j++) {
      const b = balls[j];
      if (b.falling > 0 || b.ghost > 0 || Math.abs(a.h - b.h) > minD) continue;
      const ds = b.s - a.s;
      const du = b.u - a.u;
      const d2 = ds * ds + du * du;
      if (d2 >= minD * minD || d2 === 0) continue;
      const d = Math.sqrt(d2);
      const ns = ds / d;
      const nu = du / d;
      // Séparation.
      const overlap = (minD - d) / 2;
      a.s -= ns * overlap;
      a.u -= nu * overlap;
      b.s += ns * overlap;
      b.u += nu * overlap;
      // Vitesse relative le long du choc.
      const rel = (b.vs - a.vs) * ns + (b.vu - a.vu) * nu;
      if (rel > 0) continue;
      const jImp = (-(1 + T.restitution) * rel) / 2 + T.pushKick;
      a.vs -= jImp * ns;
      a.vu -= jImp * nu;
      b.vs += jImp * ns;
      b.vu += jImp * nu;
      a.vs = Math.max(T.minSpeed, a.vs);
      b.vs = Math.max(T.minSpeed, b.vs);
    }
  }
}

/* ---------- boules pilotées par l'ordinateur ---------- */
export interface Bot {
  skill: number; // 0.8 – 1
  aggro: number; // envie de pousser
  lane: number; // trajectoire préférée (-1..1)
  laneTimer: number;
}

export function makeBot(seed: number): Bot {
  return { skill: 0.82 + (seed % 5) * 0.04, aggro: 0.3 + ((seed * 7) % 5) * 0.12, lane: 0, laneTimer: 0 };
}

export function driveBot(bot: Bot, me: Ball, all: Ball[], track: Track, dt: number) {
  if (me.falling > 0 || me.finished !== null) {
    me.steer = 0;
    me.throttle = 0;
    return;
  }
  bot.laneTimer -= dt;
  if (bot.laneTimer <= 0) {
    bot.lane = (Math.random() * 2 - 1) * 0.5;
    bot.laneTimer = 1.5 + Math.random() * 2.5;
  }
  const ahead = sampleAt(track, me.s + 12);
  const here = sampleAt(track, me.s);
  // Vise l'intérieur des virages, reste loin des bords sans mur.
  let target = bot.lane * here.half * 0.6 + Math.sign(ahead.curv) * Math.min(1, Math.abs(ahead.curv) * 40) * ahead.half * 0.35;
  // Pousser un adversaire proche.
  const prey = all.find((o) => o !== me && o.falling === 0 && o.s > me.s && o.s - me.s < 6 && Math.abs(o.u - me.u) < 4);
  if (prey && Math.random() < bot.aggro) target = prey.u + Math.sign(prey.u || 1) * -0.4;
  const margin = 1.6;
  const lim = Math.min(here.half, ahead.half) - margin;
  target = Math.max(-lim, Math.min(lim, target));
  const err = target - me.u;
  me.steer = Math.max(-1, Math.min(1, err * 0.55 - me.vu * 0.35));

  // Vitesse visée : ralentir avant un virage serré.
  const k = Math.max(Math.abs(ahead.curv), Math.abs(here.curv), 1e-4);
  const vmax = Math.sqrt((TUNING.steer * 0.9) / (TUNING.centrifugal * k)) * (0.9 + bot.skill * 0.15);
  me.throttle = me.vs > vmax ? -0.5 : 0.8 + bot.skill * 0.2;
}
