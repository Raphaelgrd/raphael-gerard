import '@fontsource/big-shoulders-display/900';
import '@fontsource/figtree/400';
import '@fontsource/figtree/600';
import '@fontsource/figtree/700';
import './style.css';
import { supabase } from '../shared/supabase';
import { PLAYERS, playerName } from '../shared/players';
import { deviceToken, getMe, setMe } from '../shared/identity';
import { analyze, envelope, similarity, type Frame } from './audio';
import { decodeMono16k, EXT, isPlaying, onPlaybackChange, play, record, recordingMime, referenceFrames, stopPlayback, type Recording } from './sound';

interface Sound {
  id: number;
  title: string;
  path: string;
  duration: number;
  addedBy?: string;
}
interface Take {
  player: string;
  path: string | null;
  score: number | null;
  votes: number | null;
  points: number | null;
}
interface Game {
  id: number;
  status: 'record' | 'vote' | 'results' | 'ended';
  players: string[];
  round: number;
  rounds: number;
  phaseStartedAt: string;
  winner: string | null;
  aborted: boolean;
  sound: Sound | null;
  takes: Take[];
  voters: string[];
  totals: Record<string, number>;
}
interface State {
  now: string;
  lobby: string[];
  wins: Record<string, number>;
  played: number;
  soundCount: number;
  game: Game | null;
}

const TOKEN = deviceToken();
const BUCKET = 'mimic';
const CLOSE_RECORD_AFTER = 60;
const RESULTS_NEXT = 10;
const MAX_SOUND = 15;

type RecState = 'idle' | 'recording' | 'scoring' | 'ready' | 'sending' | 'sent';

const S = {
  me: getMe(),
  tab: 'room' as 'room' | 'library',
  state: null as State | null,
  stateError: false,
  sounds: [] as Sound[],
  selected: null as Set<string> | null,
  seen: new Set<string>(),
  rounds: 5,
  busy: false,
  lastSig: '',
  clockSkew: 0,
  nextTry: 0,
  confirmAbort: false,
  confirmHide: 0,
  // Enregistrement de la manche en cours
  recFor: '', // `${game}:${round}`
  rec: 'idle' as RecState,
  recording: null as Recording | null,
  take: null as { blob: Blob; url: string; frames: Frame[]; score: number } | null,
  refEnv: [] as number[],
  refReady: false,
  refError: false,
  myVote: null as { key: string; target: string } | null,
  // Ajout d'un son à la bibliothèque
  add: { title: '', blob: null as Blob | null, url: '', duration: 0, mime: '', state: 'idle' as 'idle' | 'recording' | 'ready' | 'sending', recording: null as Recording | null },
};

const esc = (s: unknown) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
const player = (id: string) => PLAYERS.find((p) => p.id === id)!;
const name = (id: string | null | undefined) => esc(id ? playerName(id) : '');
const face = (id: string, cls = '') => {
  const p = player(id);
  return p ? `<span class="face ${cls}" style="--c:${p.color}" aria-hidden="true">${esc(p.short)}</span>` : '';
};
const plural = (n: number, w: string) => `${n} ${w}${n > 1 ? 's' : ''}`;
const publicUrl = (path: string) => supabase!.storage.from(BUCKET).getPublicUrl(path).data.publicUrl;
const rand = () => Math.random().toString(36).slice(2, 10);

function toast(msg: string) {
  const el = document.getElementById('toast')!;
  el.textContent = msg;
  el.hidden = false;
  clearTimeout((toast as any).t);
  (toast as any).t = setTimeout(() => (el.hidden = true), 2800);
}
function since(iso: string) {
  return (Date.now() + S.clockSkew - new Date(iso).getTime()) / 1000;
}

/* ---------- serveur ---------- */
let channel: ReturnType<NonNullable<typeof supabase>['channel']> | null = null;

async function call(fn: string, args: Record<string, unknown>, quiet = false) {
  if (!supabase) return false;
  S.busy = true;
  render();
  const { error } = await supabase.rpc(fn, args);
  S.busy = false;
  if (error) {
    if (!quiet) toast(error.message || "Ça n'a pas marché. Réessaie.");
    render(true);
    return false;
  }
  await refresh();
  channel?.send({ type: 'broadcast', event: 'refresh', payload: {} });
  return true;
}

async function refresh() {
  if (!supabase) return;
  const { data, error } = await supabase.rpc('mm_state');
  if (error) {
    S.stateError = true;
    render();
    return;
  }
  S.stateError = false;
  S.state = data as State;
  S.clockSkew = new Date(S.state.now).getTime() - Date.now();
  const g = S.state.game;
  // Nouvelle manche : on repart d'un enregistrement vierge et on prépare la référence.
  if (g && g.status === 'record' && g.sound) {
    const key = `${g.id}:${g.round}`;
    if (key !== S.recFor) {
      S.recFor = key;
      S.recording?.stop();
      S.recording = null;
      if (S.take) URL.revokeObjectURL(S.take.url);
      S.take = null;
      S.rec = g.takes.some((t) => t.player === S.me) ? 'sent' : 'idle';
      prepareReference(g.sound);
    }
  }
  render();
}

async function loadSounds() {
  if (!supabase) return;
  const { data } = await supabase.rpc('mm_sounds_list');
  S.sounds = (data ?? []) as Sound[];
  render(true);
}

function prepareReference(sound: Sound) {
  S.refReady = false;
  S.refError = false;
  S.refEnv = [];
  referenceFrames(publicUrl(sound.path))
    .then((frames) => {
      if (S.state?.game?.sound?.id !== sound.id) return;
      S.refEnv = envelope(frames, 48);
      S.refReady = true;
      render(true);
    })
    .catch(() => {
      S.refError = true;
      render(true);
    });
}

async function heartbeat() {
  if (!supabase || !S.me || document.visibilityState !== 'visible') return;
  await supabase.rpc('mm_heartbeat', { p_token: TOKEN, p_player: S.me });
}

/* ---------- rendu ---------- */
const view = document.getElementById('view')!;
onPlaybackChange(() => render(true));

function render(force = false) {
  const st = S.state;
  const g = st?.game;
  const sig = JSON.stringify([
    S.me, S.tab, S.stateError, S.sounds.length, [...(S.selected ?? [])], S.rounds, S.busy, S.confirmAbort, S.confirmHide,
    S.rec, S.take?.score, S.refReady, S.refError, S.myVote, S.add.state, S.add.duration,
    st && { ...st, now: undefined },
    g && g.status === 'record' && since(g.phaseStartedAt) > CLOSE_RECORD_AFTER,
    g && g.status === 'vote' && since(g.phaseStartedAt) > 45,
  ]);
  if (!force && sig === S.lastSig) return;
  S.lastSig = sig;
  const focusId = (document.activeElement as HTMLElement | null)?.id;
  view.innerHTML = renderView();
  if (focusId) (document.getElementById(focusId) as HTMLInputElement | null)?.focus();
}

function renderView() {
  if (!S.me) return renderWho();
  if (!supabase) return `<section class="panel"><p>Base de données non configurée : renseigne les variables Supabase sur Vercel.</p></section>`;
  if (!S.state) return `<section class="panel"><p class="muted">${S.stateError ? 'Connexion impossible. Vérifie ton réseau.' : 'Connexion…'}</p></section>`;
  const g = S.state.game;
  if (g && g.status !== 'ended') return renderGame(g);
  return `<div class="stack">
    <nav class="tabs"><button data-act="tab" data-tab="room" aria-selected="${S.tab === 'room'}">Salon</button><button data-act="tab" data-tab="library" aria-selected="${S.tab === 'library'}">Sons (${S.state.soundCount})</button></nav>
    ${S.tab === 'room' ? renderLobby() : renderLibrary()}
  </div>`;
}

function renderWho() {
  return `<section class="panel">
    <h2>Qui es-tu ?</h2>
    <p class="muted">Choisis ton nom : il sera retenu pour tous les jeux de la Mobut App.</p>
    <div class="picks">${PLAYERS.map((p) => `<button class="pick" data-act="me" data-id="${p.id}">${face(p.id)}<span>${esc(p.name)}</span></button>`).join('')}</div>
  </section>`;
}

function renderLobby() {
  const st = S.state!;
  const present = st.lobby;
  if (!S.selected) S.selected = new Set();
  for (const id of present) if (!S.seen.has(id)) S.selected.add(id);
  S.seen = new Set(present);
  for (const id of [...S.selected]) if (!present.includes(id)) S.selected.delete(id);
  const chosen = PLAYERS.filter((p) => present.includes(p.id) && S.selected!.has(p.id)).map((p) => p.id);
  const canStart = chosen.length >= 2 && chosen.includes(S.me!) && st.soundCount > 0 && !S.busy;
  const g = st.game;
  return `${g && g.status === 'ended' && !g.aborted ? renderFinal(g) : ''}
    <section class="panel">
      <div class="row between"><h2>Le salon</h2><span class="muted small">${plural(present.length, 'connecté')}</span></div>
      <p class="muted small">Touche un joueur pour l'ajouter ou le retirer de la prochaine partie. De 2 à 6 joueurs.</p>
      <div class="seats">${PLAYERS.map((p) => {
        const on = present.includes(p.id);
        const sel = on && S.selected!.has(p.id);
        return `<button class="seat ${on ? '' : 'away'} ${sel ? 'sel' : ''}" data-act="toggle" data-id="${p.id}" ${on ? '' : 'disabled'}>
          ${face(p.id)}<span class="sname">${esc(p.name)}${p.id === S.me ? ' (toi)' : ''}</span><span class="sstate">${on ? (sel ? 'joue' : 'regarde') : 'absent'}</span></button>`;
      }).join('')}</div>
      <div class="row"><span class="muted small">Manches</span><div class="seg">${[3, 5, 8].map((n) => `<button data-act="rounds" data-n="${n}" aria-pressed="${S.rounds === n}">${n}</button>`).join('')}</div></div>
      ${st.soundCount === 0 ? `<p class="notice">La bibliothèque est vide : ajoute d'abord des sons dans l'onglet « Sons ».</p>` : ''}
      <button class="btn" data-act="start" ${canStart ? '' : 'disabled'}>Lancer la partie${chosen.length >= 2 ? ` à ${chosen.length}` : ''}</button>
    </section>
    ${renderWins()}
    <details class="panel rules"><summary>Les règles</summary><ol>
      <li>Un son est tiré au hasard dans la bibliothèque. Écoute-le autant que tu veux.</li>
      <li>Imite-le au micro. L'app compare ton imitation (rythme, mélodie, volume) et te donne une note sur 100. Tu peux recommencer avant d'envoyer.</li>
      <li>Quand tout le monde a envoyé, on écoute toutes les imitations et chacun vote pour la meilleure (pas la sienne).</li>
      <li>Points : la note de l'app divisée par 10, plus 3 points par vote reçu.</li>
    </ol></details>`;
}

function renderWins() {
  const st = S.state!;
  if (!st.played) return '';
  const rows = PLAYERS.map((p) => ({ id: p.id, n: st.wins[p.id] ?? 0 })).sort((a, b) => b.n - a.n);
  return `<section class="panel"><div class="row between"><h2>Victoires</h2><span class="muted small">${plural(st.played, 'partie')}</span></div>
    <ol class="ranking">${rows.map((r, i) => `<li><span class="pos">${i + 1}</span>${face(r.id, 'sm')}<span class="sname">${name(r.id)}</span><b>${r.n}</b></li>`).join('')}</ol></section>`;
}

function renderFinal(g: Game) {
  const rows = g.players.map((p) => ({ p, pts: g.totals[p] ?? 0 })).sort((a, b) => b.pts - a.pts);
  return `<section class="winner-card">
    <span class="eyebrow">Dernière partie</span>
    <div class="row">${face(g.winner!, 'xl')}<div><span class="muted small">Meilleur imitateur</span><strong>${name(g.winner)}</strong></div></div>
    <ol class="ranking">${rows.map((r, i) => `<li><span class="pos">${i + 1}</span>${face(r.p, 'sm')}<span class="sname">${name(r.p)}</span><b>${r.pts} pts</b></li>`).join('')}</ol>
  </section>`;
}

function renderLibrary() {
  const a = S.add;
  const addForm = `<section class="panel">
    <h2>Ajouter un son</h2>
    <p class="muted small">Un mème, un cri, un bruit… 15 secondes maximum. Enregistre-le au micro (fais-le passer par le haut-parleur d'un autre appareil) ou choisis un fichier audio.</p>
    <label class="field" for="add-title">Titre<input id="add-title" maxlength="60" placeholder="Ex. : le cri de la chèvre" value="${esc(a.title)}"></label>
    <div class="row">
      ${a.state === 'recording' ? `<button class="btn rec on" data-act="add-stop"><span class="dot"></span>Arrêter</button><span class="level"><i id="add-level"></i></span>` : `<button class="btn ghost" data-act="add-rec" ${a.state === 'sending' ? 'disabled' : ''}>Enregistrer au micro</button>
      <label class="btn ghost file">Choisir un fichier<input id="add-file" type="file" accept="audio/*"></label>`}
    </div>
    ${a.blob ? `<div class="row"><button class="btn ghost" data-act="add-play">${isPlaying('add') ? 'Pause' : 'Écouter'}</button><span class="muted small">${a.duration.toFixed(1)} s</span></div>` : ''}
    <button class="btn" data-act="add-save" ${a.blob && a.state === 'ready' ? '' : 'disabled'}>${a.state === 'sending' ? 'Envoi…' : 'Ajouter à la bibliothèque'}</button>
  </section>`;
  const list = S.sounds.length
    ? `<ul class="sounds">${S.sounds
        .map(
          (s) => `<li><button class="play ${isPlaying('lib' + s.id) ? 'on' : ''}" data-act="lib-play" data-id="${s.id}" aria-label="Écouter ${esc(s.title)}"></button>
          <span class="stitle">${esc(s.title)}<small>${s.duration.toFixed(1)} s · ajouté par ${name(s.addedBy)}</small></span>
          ${S.confirmHide === s.id ? `<button class="link danger" data-act="hide-yes" data-id="${s.id}">Retirer</button><button class="link" data-act="hide-no">Non</button>` : `<button class="link" data-act="hide" data-id="${s.id}">Retirer</button>`}</li>`,
        )
        .join('')}</ul>`
    : `<p class="muted">Aucun son pour l'instant.</p>`;
  return `${addForm}<section class="panel"><h2>La bibliothèque</h2>${list}</section>`;
}

function bars(env: number[], cls: string) {
  return `<div class="bars ${cls}">${env.map((v) => `<i style="height:${Math.max(4, v * 100)}%"></i>`).join('')}</div>`;
}

function renderGame(g: Game) {
  const seated = g.players.includes(S.me!);
  const n = g.players.length;
  const sound = g.sound;
  const head = `<div class="row between"><span class="eyebrow">Manche ${g.round} / ${g.rounds}</span>${seated ? (S.confirmAbort ? `<span class="row"><button class="btn danger sm" data-act="abort-yes">Abandonner</button><button class="btn ghost sm" data-act="abort-no">Non</button></span>` : `<button class="link" data-act="abort">Abandonner</button>`) : ''}</div>`;
  const refCard = sound
    ? `<section class="ref">
        <button class="play big ${isPlaying('ref') ? 'on' : ''}" data-act="ref-play" aria-label="Écouter le son"></button>
        <div class="ref-body"><span class="muted small">À imiter</span><strong>${esc(sound.title)}</strong>
          ${S.refReady ? bars(S.refEnv, 'ref-bars') : `<span class="muted small">${S.refError ? 'Le son n’a pas pu être chargé.' : 'Chargement du son…'}</span>`}
        </div>
      </section>`
    : `<section class="panel"><p class="muted">Ce son a été retiré de la bibliothèque.</p></section>`;

  let body = '';
  if (g.status === 'record') {
    const sent = g.takes.map((t) => t.player);
    const waiting = `<p class="muted small center">${sent.length} / ${n} ont envoyé${sent.length ? ` : ${sent.map((p) => name(p)).join(', ')}` : ''}</p>`;
    const canClose = seated && since(g.phaseStartedAt) > CLOSE_RECORD_AFTER && sent.length < n;
    if (!seated) body = `<p class="center muted">Partie en cours : tu regardes.</p>${waiting}`;
    else if (S.rec === 'sent') body = `<section class="panel center"><h2>Envoyé !</h2><p class="muted">On attend les autres…</p></section>${waiting}`;
    else body = renderRecorder() + waiting;
    if (canClose) body += `<button class="btn ghost" data-act="close-record">Passer au vote sans attendre</button>`;
  } else if (g.status === 'vote') {
    const key = `${g.id}:${g.round}`;
    const mine = S.myVote?.key === key ? S.myVote.target : null;
    const canClose = seated && (g.voters.length * 2 >= n || since(g.phaseStartedAt) > 45) && g.voters.length < n;
    body = `<section class="panel"><h2>Vote pour la meilleure</h2>
      <p class="muted small">Écoute chaque imitation, puis vote (pas pour toi). Tu peux changer d'avis jusqu'au dernier vote.</p>
      <ul class="takes">${g.takes
        .map(
          (t) => `<li class="${mine === t.player ? 'sel' : ''}">${face(t.player, 'sm')}<span class="sname">${name(t.player)}</span>
          <button class="play ${isPlaying('take-' + t.player) ? 'on' : ''}" data-act="take-play" data-id="${t.player}" aria-label="Écouter"></button>
          ${seated && t.player !== S.me ? `<button class="btn sm ${mine === t.player ? '' : 'ghost'}" data-act="vote" data-id="${t.player}" ${S.busy ? 'disabled' : ''}>${mine === t.player ? 'Voté' : 'Voter'}</button>` : '<span class="sm-pad"></span>'}</li>`,
        )
        .join('')}</ul>
      <p class="muted small">${g.voters.length} / ${n} ont voté</p>
      ${canClose ? `<button class="btn ghost" data-act="close-vote">Clore le vote</button>` : ''}
    </section>`;
  } else if (g.status === 'results') {
    const rows = [...g.takes].sort((a, b) => (b.points ?? 0) - (a.points ?? 0));
    const totals = g.players.map((p) => ({ p, pts: g.totals[p] ?? 0 })).sort((a, b) => b.pts - a.pts);
    body = `<section class="panel"><h2>Résultats de la manche</h2>
      ${rows.length ? `<ul class="takes results">${rows
        .map(
          (t, i) => `<li>${i === 0 ? '<span class="crown">1</span>' : `<span class="pos">${i + 1}</span>`}${face(t.player, 'sm')}<span class="sname">${name(t.player)}</span>
          <button class="play ${isPlaying('take-' + t.player) ? 'on' : ''}" data-act="take-play" data-id="${t.player}" aria-label="Écouter"></button>
          <span class="detail">${t.score}/100 · ${plural(t.votes ?? 0, 'vote')}</span><b>+${t.points}</b></li>`,
        )
        .join('')}</ul>` : '<p class="muted">Personne n’a envoyé d’imitation.</p>'}
    </section>
    <section class="panel"><h2>Total</h2><ol class="ranking">${totals.map((r, i) => `<li><span class="pos">${i + 1}</span>${face(r.p, 'sm')}<span class="sname">${name(r.p)}</span><b>${r.pts} pts</b></li>`).join('')}</ol>
      ${seated ? `<button class="btn" data-act="next" ${S.busy ? 'disabled' : ''}>${g.round < g.rounds ? 'Manche suivante' : 'Voir le classement final'}</button>` : ''}
    </section>`;
  }
  return `<div class="stack">${head}${refCard}${body}</div>`;
}

function renderRecorder() {
  const t = S.take;
  if (S.rec === 'recording') {
    return `<section class="recorder">
      <button class="rec-btn on" data-act="rec-stop" aria-label="Arrêter"><span></span></button>
      <span class="level"><i id="level"></i></span>
      <p class="muted small">Imite le son… touche pour arrêter.</p>
    </section>`;
  }
  if (S.rec === 'scoring') return `<section class="recorder"><p class="muted">Analyse de ton imitation…</p></section>`;
  if ((S.rec === 'ready' || S.rec === 'sending') && t) {
    return `<section class="recorder">
      <div class="compare">${bars(S.refEnv, 'ref-bars')}${bars(envelope(t.frames, 48), 'take-bars')}</div>
      <div class="score"><span class="num">${t.score}</span><span class="muted">/ 100</span></div>
      <p class="muted small">${t.score >= 80 ? 'Bluffant.' : t.score >= 60 ? 'Pas mal du tout.' : t.score >= 35 ? 'On reconnaît… à peu près.' : 'Hmm. Réessaie ?'}</p>
      <div class="row center">
        <button class="btn ghost" data-act="take-mine">${isPlaying('mine') ? 'Pause' : 'Me réécouter'}</button>
        <button class="btn ghost" data-act="rec-again" ${S.rec === 'sending' ? 'disabled' : ''}>Recommencer</button>
      </div>
      <button class="btn" data-act="send" ${S.rec === 'sending' ? 'disabled' : ''}>${S.rec === 'sending' ? 'Envoi…' : 'Envoyer cette imitation'}</button>
    </section>`;
  }
  const ok = S.refReady && recordingMime() !== null;
  return `<section class="recorder">
    <button class="rec-btn" data-act="rec-start" ${ok ? '' : 'disabled'} aria-label="Enregistrer"><span></span></button>
    <p class="muted small">${recordingMime() === null ? 'Ton navigateur ne permet pas d’enregistrer le micro.' : 'Écoute le son, puis touche le bouton rouge et imite-le.'}</p>
  </section>`;
}

/* ---------- enregistrement d'une imitation ---------- */
async function startTake() {
  const g = S.state?.game;
  if (!g?.sound) return;
  stopPlayback();
  try {
    const maxSec = Math.min(MAX_SOUND, g.sound.duration * 1.6 + 1.5);
    S.recording = await record(maxSec, (v) => {
      const el = document.getElementById('level');
      if (el) el.style.width = `${Math.round(v * 100)}%`;
    });
    S.rec = 'recording';
    render(true);
    const blob = await S.recording.done;
    S.recording = null;
    S.rec = 'scoring';
    render(true);
    const ref = await referenceFrames(publicUrl(g.sound.path));
    const { samples } = await decodeMono16k(await blob.arrayBuffer());
    const frames = analyze(samples);
    if (S.take) URL.revokeObjectURL(S.take.url);
    S.take = { blob, url: URL.createObjectURL(blob), frames, score: similarity(ref, frames) };
    S.rec = 'ready';
  } catch (e) {
    S.recording = null;
    S.rec = 'idle';
    toast((e as Error).name === 'NotAllowedError' ? 'Autorise le micro pour jouer (réglages du navigateur).' : "L'enregistrement n'a pas marché. Réessaie.");
  }
  render(true);
}

async function sendTake() {
  const g = S.state?.game;
  if (!supabase || !g || !S.take) return;
  S.rec = 'sending';
  render(true);
  const type = S.take.blob.type || 'audio/webm';
  const path = `takes/${g.id}/${g.round}-${S.me}-${rand()}.${EXT[type] ?? 'webm'}`;
  const up = await supabase.storage.from(BUCKET).upload(path, S.take.blob, { contentType: type });
  if (up.error) {
    S.rec = 'ready';
    toast("L'envoi du son a échoué. Vérifie ta connexion.");
    render(true);
    return;
  }
  if (await call('mm_submit_take', { p_token: TOKEN, p_round: g.round, p_path: path, p_score: S.take.score })) S.rec = 'sent';
  else S.rec = 'ready';
  render(true);
}

/* ---------- ajout d'un son ---------- */
async function setAddBlob(blob: Blob) {
  const a = S.add;
  try {
    const { duration } = await decodeMono16k(await blob.arrayBuffer());
    if (duration > MAX_SOUND) {
      toast(`Le son dure ${duration.toFixed(0)} s : 15 secondes maximum.`);
      a.state = 'idle';
      render(true);
      return;
    }
    if (a.url) URL.revokeObjectURL(a.url);
    a.blob = blob;
    a.url = URL.createObjectURL(blob);
    a.duration = duration;
    a.mime = blob.type || 'audio/webm';
    a.state = 'ready';
  } catch {
    a.state = 'idle';
    toast('Ce fichier audio ne peut pas être lu.');
  }
  render(true);
}

async function saveSound() {
  const a = S.add;
  if (!supabase || !a.blob) return;
  if (!a.title.trim()) {
    toast('Donne un titre au son.');
    return;
  }
  a.state = 'sending';
  render(true);
  const type = a.mime.split(';')[0];
  const path = `sounds/${Date.now().toString(36)}-${rand()}.${EXT[type] ?? 'webm'}`;
  const up = await supabase.storage.from(BUCKET).upload(path, a.blob, { contentType: type });
  if (up.error) {
    a.state = 'ready';
    toast("L'envoi du son a échoué.");
    render(true);
    return;
  }
  const { error } = await supabase.rpc('mm_add_sound', { p_player: S.me, p_title: a.title, p_path: path, p_duration: a.duration });
  if (error) {
    a.state = 'ready';
    toast(error.message);
    render(true);
    return;
  }
  URL.revokeObjectURL(a.url);
  S.add = { title: '', blob: null, url: '', duration: 0, mime: '', state: 'idle', recording: null };
  toast('Son ajouté');
  await Promise.all([loadSounds(), refresh()]);
}

/* ---------- événements ---------- */
view.addEventListener('input', (e) => {
  const el = e.target as HTMLInputElement;
  if (el.id === 'add-title') S.add.title = el.value;
});
view.addEventListener('change', (e) => {
  const el = e.target as HTMLInputElement;
  if (el.id === 'add-file' && el.files?.[0]) setAddBlob(el.files[0]);
});

view.addEventListener('click', async (e) => {
  const b = (e.target as HTMLElement).closest<HTMLElement>('[data-act]');
  if (!b) return;
  const act = b.dataset.act;
  const g = S.state?.game;
  switch (act) {
    case 'me':
      S.me = b.dataset.id!;
      setMe(S.me);
      await heartbeat();
      await refresh();
      render(true);
      break;
    case 'tab':
      S.tab = b.dataset.tab as typeof S.tab;
      if (S.tab === 'library') loadSounds();
      render(true);
      break;
    case 'toggle': {
      const id = b.dataset.id!;
      if (S.selected!.has(id)) S.selected!.delete(id);
      else S.selected!.add(id);
      render();
      break;
    }
    case 'rounds':
      S.rounds = Number(b.dataset.n);
      render();
      break;
    case 'start': {
      const present = S.state?.lobby ?? [];
      const players = PLAYERS.filter((p) => present.includes(p.id) && S.selected?.has(p.id)).map((p) => p.id);
      await heartbeat();
      if (await call('mm_start', { p_token: TOKEN, p_players: players, p_rounds: S.rounds })) {
        S.selected = null;
        S.seen = new Set();
      }
      break;
    }
    case 'ref-play':
      if (g?.sound) play('ref', publicUrl(g.sound.path));
      break;
    case 'rec-start':
      startTake();
      break;
    case 'rec-stop':
      S.recording?.stop();
      break;
    case 'rec-again':
      stopPlayback();
      S.rec = 'idle';
      startTake();
      break;
    case 'take-mine':
      if (S.take) play('mine', S.take.url);
      break;
    case 'send':
      sendTake();
      break;
    case 'close-record':
      await call('mm_close_record', { p_token: TOKEN });
      break;
    case 'take-play': {
      const t = g?.takes.find((x) => x.player === b.dataset.id);
      if (t?.path) play('take-' + t.player, publicUrl(t.path));
      break;
    }
    case 'vote':
      if (g && (await call('mm_vote', { p_token: TOKEN, p_target: b.dataset.id }))) S.myVote = { key: `${g.id}:${g.round}`, target: b.dataset.id! };
      render(true);
      break;
    case 'close-vote':
      await call('mm_close_vote', { p_token: TOKEN });
      break;
    case 'next':
      await call('mm_next', { p_token: TOKEN });
      break;
    case 'abort':
      S.confirmAbort = true;
      render();
      break;
    case 'abort-no':
      S.confirmAbort = false;
      render();
      break;
    case 'abort-yes':
      S.confirmAbort = false;
      await call('mm_abort', { p_token: TOKEN });
      break;
    case 'lib-play': {
      const s = S.sounds.find((x) => x.id === Number(b.dataset.id));
      if (s) play('lib' + s.id, publicUrl(s.path));
      break;
    }
    case 'hide':
      S.confirmHide = Number(b.dataset.id);
      render();
      break;
    case 'hide-no':
      S.confirmHide = 0;
      render();
      break;
    case 'hide-yes':
      S.confirmHide = 0;
      await supabase?.rpc('mm_hide_sound', { p_id: Number(b.dataset.id) });
      await Promise.all([loadSounds(), refresh()]);
      break;
    case 'add-rec':
      stopPlayback();
      try {
        S.add.recording = await record(MAX_SOUND, (v) => {
          const el = document.getElementById('add-level');
          if (el) el.style.width = `${Math.round(v * 100)}%`;
        });
        S.add.state = 'recording';
        render(true);
        const blob = await S.add.recording.done;
        S.add.recording = null;
        await setAddBlob(blob);
      } catch (err) {
        S.add.state = 'idle';
        toast((err as Error).name === 'NotAllowedError' ? 'Autorise le micro pour enregistrer.' : "L'enregistrement n'a pas marché.");
        render(true);
      }
      break;
    case 'add-stop':
      S.add.recording?.stop();
      break;
    case 'add-play':
      if (S.add.url) play('add', S.add.url);
      break;
    case 'add-save':
      saveSound();
      break;
  }
});

/* ---------- démarrage ---------- */
render(true);
if (supabase) {
  channel = supabase.channel('mobut-mimic').on('broadcast', { event: 'refresh' }, () => refresh()).subscribe();
  heartbeat().then(refresh);
  loadSounds();
  setInterval(refresh, 2500);
  setInterval(heartbeat, 10000);
  setInterval(() => {
    const g = S.state?.game;
    if (!g) return;
    render();
    const seated = g.players.includes(S.me ?? '');
    if (g.status === 'results' && seated && since(g.phaseStartedAt) > RESULTS_NEXT && !S.busy && Date.now() - S.nextTry > 3000) {
      S.nextTry = Date.now();
      call('mm_next', { p_token: TOKEN }, true);
    }
  }, 500);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') heartbeat().then(refresh);
  });
}
