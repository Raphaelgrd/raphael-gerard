import '@fontsource/big-shoulders-display/900';
import '@fontsource/figtree/600';
import '@fontsource/figtree/700';
import './style.css';
import * as THREE from 'three';
import { buildTrack, sampleAt, worldPos, type Track } from './track';
import { collide, driveBot, makeBall, makeBot, stepBall, TUNING, type Ball, type Bot } from './sim';
import { PLAYERS, playerName } from '../shared/players';
import { getMe, setMe } from '../shared/identity';

const DT = 1 / 120;
const track = buildTrack();

/* ---------- scène ---------- */
const canvas = document.getElementById('scene') as HTMLCanvasElement;
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
const scene = new THREE.Scene();
const SKY = 0x9fd6ff;
scene.background = new THREE.Color(SKY);
scene.fog = new THREE.Fog(SKY, 60, 260);
const camera = new THREE.PerspectiveCamera(70, 1, 0.1, 600);
scene.add(new THREE.HemisphereLight(0xffffff, 0x6b8f5e, 1.6));
const sun = new THREE.DirectionalLight(0xffffff, 1.6);
sun.position.set(40, 80, 20);
scene.add(sun);

function resize() {
  const w = window.innerWidth;
  const h = window.innerHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.fov = w < h ? 78 : 62;
  camera.updateProjectionMatrix();
}
window.addEventListener('resize', resize);
resize();

buildWorld(track);

function buildWorld(t: Track) {
  const S = t.samples;
  // Piste : un ruban avec des bandes tous les 10 m, et des bords rouges là où il n'y a pas de mur.
  const pos: number[] = [];
  const col: number[] = [];
  const idx: number[] = [];
  const stripeA = new THREE.Color(0x2c8ad8);
  const stripeB = new THREE.Color(0x3fa0ea);
  const danger = new THREE.Color(0xff5a4e);
  const finish = new THREE.Color(0xffffff);
  const COLS = 6; // points en travers : bord, liseré, centre…, liseré, bord
  const across = [-1, -0.9, -0.5, 0.5, 0.9, 1];
  for (let i = 0; i < S.length; i++) {
    const s = S[i];
    const band = Math.floor(i / 10) % 2 === 0 ? stripeA : stripeB;
    for (let k = 0; k < COLS; k++) {
      const a = across[k] * s.half;
      pos.push(s.pos[0] + s.right[0] * a, s.pos[1] + s.right[1] * a, s.pos[2] + s.right[2] * a);
      const edge = k === 0 || k === COLS - 1 || k === 1 || k === COLS - 2;
      const open = across[k] < 0 ? !s.wallL : !s.wallR;
      let c = band;
      if (edge && open) c = Math.floor(i / 3) % 2 === 0 ? danger : finish;
      if (Math.abs(i - t.finish) < 2) c = (k + Math.floor(i)) % 2 === 0 ? finish : new THREE.Color(0x1b1b1b);
      col.push(c.r, c.g, c.b);
    }
  }
  for (let i = 0; i < S.length - 1; i++) {
    for (let k = 0; k < COLS - 1; k++) {
      const a = i * COLS + k;
      const b = a + COLS;
      idx.push(a, b, a + 1, a + 1, b, b + 1);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  scene.add(new THREE.Mesh(g, new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide })));

  // Dessous de la piste (épaisseur) et murs.
  addSideRibbon(t, -1, (s) => s.wallL, 0.9, 0xf2f2f2);
  addSideRibbon(t, 1, (s) => s.wallR, 0.9, 0xf2f2f2);
  addSideRibbon(t, -1, () => true, -1.2, 0x1d5f99);
  addSideRibbon(t, 1, () => true, -1.2, 0x1d5f99);

  // Arche d'arrivée.
  const f = sampleAt(t, t.finish);
  const archMat = new THREE.MeshLambertMaterial({ color: 0xffc83d });
  for (const side of [-1, 1]) {
    const post = new THREE.Mesh(new THREE.BoxGeometry(0.6, 6, 0.6), archMat);
    const p = worldPos(t, t.finish, side * (f.half + 0.4), 3);
    post.position.set(...p);
    scene.add(post);
  }
  const banner = new THREE.Mesh(new THREE.PlaneGeometry(f.half * 2 + 1.4, 1.6), new THREE.MeshBasicMaterial({ map: textTexture('ARRIVÉE', '#1b1b1b', '#ffc83d', 1024, 160), side: THREE.DoubleSide }));
  banner.position.set(...worldPos(t, t.finish, 0, 6));
  banner.lookAt(new THREE.Vector3(...worldPos(t, t.finish - 10, 0, 6)));
  scene.add(banner);

  // Tremplins.
  for (const j of t.jumps) {
    const s = sampleAt(t, j);
    const ramp = new THREE.Mesh(new THREE.BoxGeometry(s.half * 2 - 0.4, 0.5, 4), new THREE.MeshLambertMaterial({ color: 0xffc83d }));
    ramp.position.set(...worldPos(t, j - 2, 0, 0.2));
    const m = new THREE.Matrix4().makeBasis(new THREE.Vector3(...s.right), new THREE.Vector3(...s.up), new THREE.Vector3(...s.tan).negate());
    ramp.quaternion.setFromRotationMatrix(m);
    ramp.rotateX(0.18);
    scene.add(ramp);
  }

  // Sol très en dessous, et quelques collines pour donner l'échelle.
  const lowest = Math.min(...S.map((s) => s.pos[1]));
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(2000, 2000), new THREE.MeshLambertMaterial({ color: 0x7fbf6a }));
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = lowest - 45;
  scene.add(ground);
  const hillMat = new THREE.MeshLambertMaterial({ color: 0x6aaa5a });
  for (let i = 0; i < 40; i++) {
    const s = S[Math.floor(Math.random() * S.length)];
    const r = 8 + Math.random() * 18;
    const hill = new THREE.Mesh(new THREE.SphereGeometry(r, 12, 8), hillMat);
    const side = Math.random() < 0.5 ? -1 : 1;
    const off = 30 + Math.random() * 90;
    hill.position.set(s.pos[0] + s.right[0] * off * side, lowest - 45, s.pos[2] + s.right[2] * off * side);
    scene.add(hill);
  }
}

function addSideRibbon(t: Track, side: number, has: (s: Track['samples'][number]) => boolean, height: number, color: number) {
  const pos: number[] = [];
  const idx: number[] = [];
  const S = t.samples;
  for (let i = 0; i < S.length; i++) {
    const s = S[i];
    const a = side * s.half;
    const base = [s.pos[0] + s.right[0] * a, s.pos[1] + s.right[1] * a, s.pos[2] + s.right[2] * a];
    pos.push(...base, base[0] + s.up[0] * height, base[1] + s.up[1] * height, base[2] + s.up[2] * height);
  }
  for (let i = 0; i < S.length - 1; i++) {
    if (!has(S[i])) continue;
    const a = i * 2;
    idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  scene.add(new THREE.Mesh(g, new THREE.MeshLambertMaterial({ color, side: THREE.DoubleSide })));
}

function textTexture(text: string, fg: string, bg: string, w = 256, h = 128) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const x = c.getContext('2d')!;
  x.fillStyle = bg;
  x.fillRect(0, 0, w, h);
  x.fillStyle = fg;
  x.font = `900 ${Math.floor(h * 0.62)}px "Big Shoulders Display", Impact, sans-serif`;
  x.textAlign = 'center';
  x.textBaseline = 'middle';
  x.fillText(text, w / 2, h / 2 + h * 0.04);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/* ---------- boules ---------- */
interface Racer {
  ball: Ball;
  bot: Bot | null;
  mesh: THREE.Mesh;
  shadow: THREE.Mesh;
  label: THREE.Sprite;
}

function ballTexture(color: string, short: string) {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 128;
  const x = c.getContext('2d')!;
  x.fillStyle = color;
  x.fillRect(0, 0, 256, 128);
  x.fillStyle = 'rgba(255,255,255,.9)';
  x.fillRect(0, 54, 256, 20);
  x.fillStyle = '#fff';
  x.font = '900 44px "Big Shoulders Display", Impact, sans-serif';
  x.textAlign = 'center';
  x.textBaseline = 'middle';
  x.fillText(short, 64, 34);
  x.fillText(short, 192, 34);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function labelSprite(text: string, color: string) {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 72;
  const x = c.getContext('2d')!;
  x.fillStyle = 'rgba(15,15,25,.72)';
  x.beginPath();
  x.roundRect(4, 8, 248, 56, 28);
  x.fill();
  x.fillStyle = color;
  x.beginPath();
  x.arc(36, 36, 12, 0, Math.PI * 2);
  x.fill();
  x.fillStyle = '#fff';
  x.font = '700 32px Figtree, system-ui, sans-serif';
  x.textBaseline = 'middle';
  x.fillText(text, 60, 38);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true }));
  sp.scale.set(2.8, 0.8, 1);
  sp.renderOrder = 10;
  return sp;
}

let me = getMe() ?? '';
let racers: Racer[] = [];
const shadowGeo = new THREE.CircleGeometry(TUNING.radius * 0.95, 20);
const ballGeo = new THREE.SphereGeometry(TUNING.radius, 28, 18);

function setupRace() {
  for (const r of racers) scene.remove(r.mesh, r.shadow, r.label);
  // Ordre de départ : le joueur derrière, au milieu, pour avoir tout le monde devant lui.
  const others = PLAYERS.filter((p) => p.id !== me).sort(() => Math.random() - 0.5);
  const grid = [...others.slice(0, 3), ...others.slice(3), PLAYERS.find((p) => p.id === me)!];
  const slots: [number, number][] = [[7, -3], [7, 0], [7, 3], [3.5, -2], [3.5, 2], [1, 0]];
  racers = grid.map((p, i) => {
    const ball = makeBall(p.id, slots[i][0], slots[i][1]);
    const mesh = new THREE.Mesh(ballGeo, new THREE.MeshLambertMaterial({ map: ballTexture(p.color, p.short) }));
    const shadow = new THREE.Mesh(shadowGeo, new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.28, depthWrite: false }));
    const label = labelSprite(p.name, p.color);
    label.visible = p.id !== me; // pas d'étiquette sur sa propre boule
    scene.add(mesh, shadow, label);
    return { ball, bot: p.id === me ? null : makeBot(i * 3 + Math.floor(Math.random() * 5)), mesh, shadow, label };
  });
}

const tmpM = new THREE.Matrix4();
const tmpQ = new THREE.Quaternion();
const axisX = new THREE.Vector3(1, 0, 0);
function placeRacer(r: Racer) {
  const b = r.ball;
  if (b.falling > 0) {
    r.mesh.position.set(...b.fallPos);
    r.shadow.visible = false;
  } else {
    const s = sampleAt(track, b.s);
    r.mesh.position.set(...worldPos(track, b.s, b.u, b.h + TUNING.radius));
    tmpM.makeBasis(new THREE.Vector3(...s.right), new THREE.Vector3(...s.up), new THREE.Vector3(...s.tan).negate());
    r.mesh.quaternion.setFromRotationMatrix(tmpM);
    tmpQ.setFromAxisAngle(axisX, -b.spin);
    r.mesh.quaternion.multiply(tmpQ);
    r.shadow.visible = true;
    r.shadow.position.set(...worldPos(track, b.s, b.u, 0.03));
    r.shadow.quaternion.setFromRotationMatrix(tmpM);
    r.shadow.rotateX(-Math.PI / 2);
    (r.shadow.material as THREE.MeshBasicMaterial).opacity = 0.28 / (1 + b.h * 0.6);
  }
  r.mesh.visible = !(b.ghost > 0 && Math.floor(b.ghost * 10) % 2 === 0);
  r.label.position.copy(r.mesh.position).add(new THREE.Vector3(0, 1.5, 0));
}

/* ---------- caméra ---------- */
const camPos = new THREE.Vector3();
const camLook = new THREE.Vector3();
function updateCamera(snap = false) {
  const r = racers.find((x) => x.ball.id === me);
  if (!r) return;
  const b = r.ball;
  let target: THREE.Vector3;
  let look: THREE.Vector3;
  if (b.falling > 0) {
    look = r.mesh.position.clone();
    target = camPos.clone();
  } else {
    const behind = Math.max(0, b.s - 9);
    target = new THREE.Vector3(...worldPos(track, behind, b.u * 0.5, 4.6));
    look = new THREE.Vector3(...worldPos(track, b.s + 10, b.u * 0.6, 0.4));
  }
  if (snap) {
    camPos.copy(target);
    camLook.copy(look);
  } else {
    camPos.lerp(target, 0.12);
    camLook.lerp(look, 0.2);
  }
  camera.position.copy(camPos);
  camera.lookAt(camLook);
}

/* ---------- commandes : un doigt qui glisse ---------- */
const input = { steer: 0, throttle: 0 };
const pad = document.getElementById('pad')!;
const knob = document.getElementById('knob')!;
const RANGE = 70; // pixels pour une commande à fond
let touchId: number | null = null;
let origin = { x: 0, y: 0 };

const zone = document.getElementById('touch')!;
zone.addEventListener('pointerdown', (e) => {
  if (touchId !== null) return;
  touchId = e.pointerId;
  zone.setPointerCapture(e.pointerId);
  origin = { x: e.clientX, y: e.clientY };
  pad.style.left = `${e.clientX}px`;
  pad.style.top = `${e.clientY}px`;
  pad.hidden = false;
  knob.style.transform = 'translate(-50%, -50%)';
});
zone.addEventListener('pointermove', (e) => {
  if (e.pointerId !== touchId) return;
  const dx = Math.max(-RANGE, Math.min(RANGE, e.clientX - origin.x));
  const dy = Math.max(-RANGE, Math.min(RANGE, e.clientY - origin.y));
  input.steer = dx / RANGE;
  input.throttle = -dy / RANGE; // vers le haut = accélérer, vers le bas = freiner
  knob.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`;
});
const release = (e: PointerEvent) => {
  if (e.pointerId !== touchId) return;
  touchId = null;
  input.steer = 0;
  input.throttle = 0;
  pad.hidden = true;
};
zone.addEventListener('pointerup', release);
zone.addEventListener('pointercancel', release);

// Clavier sur ordinateur : flèches ou ZQSD/WASD.
const keys = new Set<string>();
window.addEventListener('keydown', (e) => keys.add(e.key.toLowerCase()));
window.addEventListener('keyup', (e) => keys.delete(e.key.toLowerCase()));
function keyboardInput() {
  const l = keys.has('arrowleft') || keys.has('q') || keys.has('a');
  const r = keys.has('arrowright') || keys.has('d');
  const u = keys.has('arrowup') || keys.has('z') || keys.has('w');
  const d = keys.has('arrowdown') || keys.has('s');
  if (!(l || r || u || d)) return null;
  return { steer: (r ? 1 : 0) - (l ? 1 : 0), throttle: (u ? 1 : 0) - (d ? 1 : 0) };
}

/* ---------- déroulé de la course ---------- */
type Phase = 'menu' | 'countdown' | 'race' | 'done';
let phase: Phase = 'menu';
let raceTime = 0;
let countdown = 0;
let doneTimer = 0;
const hud = {
  rank: document.getElementById('rank')!,
  time: document.getElementById('time')!,
  big: document.getElementById('big')!,
  menu: document.getElementById('menu')!,
  results: document.getElementById('results')!,
  fell: document.getElementById('fell')!,
};
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
const fmt = (t: number) => `${t.toFixed(2)} s`;
const ordinal = (n: number) => (n === 1 ? '1er' : `${n}e`);

function standings() {
  return [...racers].sort((a, b) => {
    const fa = a.ball.finished;
    const fb = b.ball.finished;
    if (fa !== null && fb !== null) return fa - fb;
    if (fa !== null) return -1;
    if (fb !== null) return 1;
    return b.ball.s - a.ball.s;
  });
}

function showMenu() {
  phase = 'menu';
  hud.results.hidden = true;
  hud.menu.hidden = false;
  hud.menu.innerHTML = me
    ? `<h1>Toboggan</h1>
       <p>Descends le toboggan le plus vite possible et pousse les autres dans le vide.</p>
       <ul class="howto">
         <li><b>Glisse le doigt</b> à gauche ou à droite pour tourner</li>
         <li><b>Vers le haut</b> pour accélérer, <b>vers le bas</b> pour freiner</li>
         <li>Les bords <b>rouge et blanc</b> n'ont pas de mur : on peut tomber</li>
       </ul>
       <button class="btn" data-act="go">Jouer en tant que ${esc(playerName(me))}</button>
       <button class="link" data-act="change">Ce n'est pas moi</button>`
    : `<h1>Qui es-tu ?</h1><div class="picks">${PLAYERS.map((p) => `<button class="pick" data-act="pick" data-id="${p.id}" style="--c:${p.color}"><span class="dot"></span>${esc(p.name)}</button>`).join('')}</div>`;
}

function startRace() {
  setupRace();
  raceTime = 0;
  countdown = 3.2;
  doneTimer = 0;
  phase = 'countdown';
  hud.menu.hidden = true;
  hud.results.hidden = true;
  updateCamera(true);
}

function showResults() {
  phase = 'done';
  const list = standings();
  const mine = list.findIndex((r) => r.ball.id === me) + 1;
  hud.results.hidden = false;
  hud.results.innerHTML = `<span class="eyebrow">Course terminée</span>
    <h1>${ordinal(mine)} sur ${list.length}</h1>
    <ol class="podium">${list
      .map((r, i) => {
        const p = PLAYERS.find((x) => x.id === r.ball.id)!;
        return `<li class="${r.ball.id === me ? 'me' : ''}"><span class="pos">${i + 1}</span><span class="dot" style="--c:${p.color}"></span><span class="nm">${esc(p.name)}</span><span class="tm">${r.ball.finished !== null ? fmt(r.ball.finished) : '—'}${r.ball.falls ? ` · ${r.ball.falls} chute${r.ball.falls > 1 ? 's' : ''}` : ''}</span></li>`;
      })
      .join('')}</ol>
    <button class="btn" data-act="go">Rejouer</button>
    <a class="link" href="/">Retour à la Mobut App</a>`;
}

document.getElementById('overlay')!.addEventListener('click', (e) => {
  const b = (e.target as HTMLElement).closest<HTMLElement>('[data-act]');
  if (!b) return;
  if (b.dataset.act === 'go') startRace();
  else if (b.dataset.act === 'change') {
    setMe(null);
    me = '';
    showMenu();
  } else if (b.dataset.act === 'pick') {
    me = b.dataset.id!;
    setMe(me);
    showMenu();
  }
});

function tick(dt: number) {
  if (phase === 'countdown') {
    countdown -= dt;
    const n = Math.ceil(countdown);
    hud.big.textContent = countdown > 0.2 ? String(Math.min(3, n)) : 'GO !';
    hud.big.hidden = false;
    if (countdown <= 0) {
      phase = 'race';
      setTimeout(() => (hud.big.hidden = true), 600);
    }
    return;
  }
  if (phase !== 'race') return;
  raceTime += dt;
  const kb = keyboardInput();
  for (const r of racers) {
    if (r.bot) driveBot(r.bot, r.ball, racers.map((x) => x.ball), track, dt);
    else {
      r.ball.steer = kb ? kb.steer : input.steer;
      r.ball.throttle = kb ? kb.throttle : input.throttle;
    }
    stepBall(r.ball, track, dt, raceTime);
  }
  collide(racers.map((r) => r.ball));

  const mine = racers.find((r) => r.ball.id === me)!.ball;
  if (mine.finished !== null) {
    doneTimer += dt;
    if (doneTimer > 6 || racers.every((r) => r.ball.finished !== null)) showResults();
  } else if (raceTime > 150) showResults();
}

function updateHud() {
  if (phase !== 'race' && phase !== 'countdown') {
    hud.rank.textContent = '';
    hud.time.textContent = '';
    return;
  }
  const list = standings();
  const mine = racers.find((r) => r.ball.id === me)!.ball;
  hud.rank.innerHTML = `${ordinal(list.findIndex((r) => r.ball.id === me) + 1)}<small> / ${list.length}</small>`;
  hud.time.textContent = mine.finished !== null ? `Arrivé : ${fmt(mine.finished)}` : fmt(raceTime);
  hud.fell.hidden = mine.falling <= 0;
}

/* ---------- boucle ---------- */
let last = performance.now();
let acc = 0;
function frame(now: number) {
  const elapsed = Math.min(0.1, (now - last) / 1000);
  last = now;
  acc += elapsed;
  while (acc >= DT) {
    tick(DT);
    acc -= DT;
  }
  for (const r of racers) placeRacer(r);
  if (racers.length) updateCamera();
  else {
    // Menu : la caméra survole le départ.
    const t = now / 4000;
    camera.position.set(...worldPos(track, 0, Math.sin(t) * 8, 9));
    camera.lookAt(new THREE.Vector3(...worldPos(track, 25, 0, 0)));
  }
  updateHud();
  renderer.render(scene, camera);
  requestAnimationFrame(frame);
}

showMenu();
requestAnimationFrame(frame);
