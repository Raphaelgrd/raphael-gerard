import '@fontsource/big-shoulders-display/900';
import '@fontsource/figtree/400';
import '@fontsource/figtree/600';
import '@fontsource/figtree/700';
import './style.css';
import { supabase } from '../shared/supabase';
import { PLAYERS, playerName } from '../shared/players';
import { deviceToken, getMe, setMe } from '../shared/identity';

type Rank = 'K' | 'Q' | 'A' | 'J';
interface Seat {
  player: string;
  alive: boolean;
  shots: number;
  cards: number;
  bullet: number | null;
}
interface Reveal {
  caller: string;
  accused: string;
  cards: Rank[];
  tableRank: Rank;
  liar: boolean;
  loser: string;
  died: boolean;
  shots: number;
}
interface Game {
  id: number;
  status: 'play' | 'reveal' | 'ended';
  players: string[];
  round: number;
  tableRank: Rank;
  turn: string | null;
  turnStartedAt: string;
  phaseStartedAt: string;
  lastPlayer: string | null;
  lastCount: number;
  pile: number;
  reveal: Reveal | null;
  winner: string | null;
  aborted: boolean;
  seats: Seat[];
}
interface State {
  now: string;
  lobby: string[];
  wins: Record<string, number>;
  played: number;
  game: Game | null;
}

const TOKEN = deviceToken();
const FORCE_AFTER = 40; // secondes avant de pouvoir jouer à la place d'un absent
const REVEAL_NEXT = 6.5; // secondes avant la manche suivante

const RANK_NAME: Record<Rank, string> = { K: 'Roi', Q: 'Dame', A: 'As', J: 'Joker' };
const RANK_PLURAL: Record<Rank, string> = { K: 'Rois', Q: 'Dames', A: 'As', J: 'Jokers' };
const RANK_MARK: Record<Rank, string> = { K: 'R', Q: 'D', A: 'A', J: '★' };

const S = {
  me: getMe(),
  state: null as State | null,
  stateError: false,
  hand: [] as Rank[],
  handKey: '',
  picked: new Set<number>(),
  selected: null as Set<string> | null,
  seen: new Set<string>(),
  confirmAbort: false,
  busy: false,
  lastSig: '',
  clockSkew: 0, // écart entre l'horloge du serveur et celle du téléphone (ms)
  nextTry: 0, // dernier essai de passage à la manche suivante
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

function toast(msg: string) {
  const el = document.getElementById('toast')!;
  el.textContent = msg;
  el.hidden = false;
  clearTimeout((toast as any).t);
  (toast as any).t = setTimeout(() => (el.hidden = true), 2600);
}

/** Secondes écoulées depuis `iso`, avec l'horloge du serveur. */
function since(iso: string) {
  return (Date.now() + S.clockSkew - new Date(iso).getTime()) / 1000;
}

/* ---------- serveur ---------- */
let channel: ReturnType<NonNullable<typeof supabase>['channel']> | null = null;

async function call(fn: string, args: Record<string, unknown>, quiet = false) {
  if (!supabase) return false;
  S.busy = true;
  render();
  const { error } = await supabase.rpc(fn, { p_token: TOKEN, ...args });
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
  const { data, error } = await supabase.rpc('lb_state');
  if (error) {
    S.stateError = true;
    render();
    return;
  }
  S.stateError = false;
  S.state = data as State;
  S.clockSkew = new Date(S.state.now).getTime() - Date.now();
  const g = S.state.game;
  const seat = g?.seats.find((s) => s.player === S.me);
  if (g && g.status !== 'ended' && seat) {
    const { data: h } = await supabase.rpc('lb_my_hand', { p_token: TOKEN });
    const hand = ((h as { cards?: Rank[] } | null)?.cards ?? []) as Rank[];
    const key = `${g.id}:${g.round}:${hand.join('')}`;
    if (key !== S.handKey) S.picked.clear(); // nouvelle main : on désélectionne
    S.handKey = key;
    S.hand = hand;
  } else {
    S.hand = [];
    S.picked.clear();
  }
  render();
}

async function heartbeat() {
  if (!supabase || !S.me || document.visibilityState !== 'visible') return;
  await supabase.rpc('lb_heartbeat', { p_token: TOKEN, p_player: S.me });
}

/* ---------- rendu ---------- */
const view = document.getElementById('view')!;

function revealStage(g: Game) {
  const t = since(g.phaseStartedAt);
  return t < 1.4 ? 0 : t < 3.2 ? 1 : 2; // 0 : cartes, 1 : détente, 2 : résultat
}

function render(force = false) {
  const st = S.state;
  const g = st?.game;
  const sig = JSON.stringify([
    S.me, S.stateError, S.hand, [...S.picked], [...(S.selected ?? [])], S.confirmAbort, S.busy,
    st && { ...st, now: undefined },
    g && (g.status === 'reveal' || g.status === 'ended') && g.reveal ? revealStage(g) : null,
    g && g.status === 'play' && since(g.turnStartedAt) > FORCE_AFTER,
  ]);
  if (!force && sig === S.lastSig) return;
  S.lastSig = sig;
  view.innerHTML = renderView();
}

function renderView() {
  if (!S.me) return renderWho();
  if (!supabase) return `<section class="panel"><p>Base de données non configurée : renseigne les variables Supabase sur Vercel.</p></section>`;
  if (!S.state) return `<section class="panel"><p class="muted">${S.stateError ? 'Connexion impossible. Vérifie ton réseau.' : 'Connexion au bar…'}</p></section>`;
  const g = S.state.game;
  if (!g || (g.status === 'ended' && !justEnded(g))) return renderLobby();
  return renderGame(g);
}

/** Une partie qui vient de finir reste affichée le temps de voir le dernier coup de feu. */
function justEnded(g: Game) {
  return g.status === 'ended' && !g.aborted && since(g.phaseStartedAt) < 9;
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
  const canStart = chosen.length >= 2 && chosen.includes(S.me!) && !S.busy;
  const g = st.game;

  return `<div class="stack">
    ${g && g.status === 'ended' ? renderLastGame(g) : ''}
    <section class="panel">
      <div class="row between"><h2>Le bar</h2><span class="muted small">${plural(present.length, 'client')} au comptoir</span></div>
      <p class="muted small">Touche un joueur pour l'ajouter ou le retirer de la prochaine partie. De 2 à 6 joueurs.</p>
      <div class="seats-pick">${PLAYERS.map((p) => {
        const on = present.includes(p.id);
        const sel = on && S.selected!.has(p.id);
        return `<button class="seat-pick ${on ? '' : 'away'} ${sel ? 'sel' : ''}" data-act="toggle" data-id="${p.id}" ${on ? '' : 'disabled'}>
          ${face(p.id)}<span class="sname">${esc(p.name)}${p.id === S.me ? ' (toi)' : ''}</span><span class="sstate">${on ? (sel ? 'à table' : 'au comptoir') : 'absent'}</span>
        </button>`;
      }).join('')}</div>
      <button class="btn" data-act="start" ${canStart ? '' : 'disabled'}>S'asseoir à la table${chosen.length >= 2 ? ` · ${chosen.length} joueurs` : ''}</button>
      ${present.length < 2 ? `<p class="muted small">Il faut au moins 2 joueurs : envoie le lien de la Mobut App.</p>` : ''}
    </section>
    ${renderWins()}
    <details class="panel rules"><summary>Les règles</summary>
      <ol>
        <li>Chaque manche, une <b>carte de table</b> est tirée : Roi, Dame ou As. Chacun reçoit 5 cartes.</li>
        <li>À ton tour, pose <b>1 à 3 cartes face cachée</b> en prétendant qu'elles sont toutes de la carte de table. Le <b>Joker</b> compte pour n'importe laquelle.</li>
        <li>Le joueur suivant peut poser à son tour… ou crier <b>« Menteur ! »</b>.</li>
        <li>On retourne les cartes. S'il y avait un mensonge, le menteur tire ; sinon c'est l'accusateur.</li>
        <li>Chaque revolver a <b>6 chambres et 1 balle</b>. À chaque coup, le risque augmente. Le dernier vivant gagne.</li>
      </ol>
    </details>
  </div>`;
}

function renderWins() {
  const st = S.state!;
  if (!st.played) return '';
  const rows = PLAYERS.map((p) => ({ id: p.id, n: st.wins[p.id] ?? 0 })).sort((a, b) => b.n - a.n);
  return `<section class="panel">
    <div class="row between"><h2>Victoires</h2><span class="muted small">${plural(st.played, 'partie')}</span></div>
    <ol class="wins">${rows.map((r, i) => `<li><span class="pos">${i + 1}</span>${face(r.id, 'sm')}<span class="sname">${name(r.id)}</span><b>${r.n}</b></li>`).join('')}</ol>
  </section>`;
}

function renderLastGame(g: Game) {
  if (g.aborted) return `<section class="panel"><p class="muted">La dernière partie a été abandonnée.</p></section>`;
  return `<section class="winner-card">
    <span class="eyebrow">Dernière partie</span>
    <div class="row">${face(g.winner!, 'xl')}<div><span class="muted small">Dernier survivant</span><strong>${name(g.winner)}</strong></div></div>
    <p class="muted small">Les balles étaient dans la chambre : ${g.seats.map((s) => `${name(s.player)} ${s.bullet}`).join(' · ')}</p>
  </section>`;
}

function chambers(shots: number, dead: boolean) {
  return `<span class="chambers" aria-label="${shots} coup${shots > 1 ? 's' : ''} sur 6">${Array.from({ length: 6 }, (_, i) =>
    `<i class="${i < shots ? (dead && i === shots - 1 ? 'bang' : 'shot') : ''}"></i>`).join('')}</span>`;
}

function cardFace(r: Rank, extra = '', style = '') {
  return `<span class="card face-up r-${r} ${extra}" style="${style}"><span class="mark">${RANK_MARK[r]}</span><span class="cname">${RANK_NAME[r]}</span></span>`;
}

function renderGame(g: Game) {
  const seat = g.seats.find((s) => s.player === S.me);
  const myTurn = g.status === 'play' && g.turn === S.me;
  const n = g.seats.length;
  // On place le joueur en bas de la table, les autres dans l'ordre du jeu.
  const myIdx = Math.max(0, g.seats.findIndex((s) => s.player === S.me));
  const ordered = g.seats.map((_, i) => g.seats[(myIdx + i) % n]);

  const table = `<div class="table" style="--n:${n}">
    <div class="felt">
      <div class="table-card">${cardFace(g.tableRank, 'big')}<span class="muted small">Table des ${RANK_PLURAL[g.tableRank]}</span></div>
      <div class="pile">${g.pile ? `<span class="backs">${Array.from({ length: Math.min(g.pile, 8) }, (_, i) => `<span class="card back" style="--k:${i}"></span>`).join('')}</span>` : ''}
        <span class="small">${g.lastPlayer && g.status === 'play' ? `${name(g.lastPlayer)} a posé ${g.lastCount} « ${g.lastCount > 1 ? RANK_PLURAL[g.tableRank] : RANK_NAME[g.tableRank]} »` : g.status === 'play' ? 'Personne n’a encore posé' : ''}</span>
      </div>
    </div>
    ${ordered
      .map((s, i) => {
        const turn = g.status === 'play' && g.turn === s.player;
        return `<div class="seat ${turn ? 'turn' : ''} ${s.alive ? '' : 'dead'} ${s.player === S.me ? 'mine' : ''}" style="--i:${i}">
          ${face(s.player)}
          <span class="sname">${s.player === S.me ? 'Toi' : name(s.player)}</span>
          ${s.alive ? `<span class="ncards">${plural(s.cards, 'carte')}</span>` : '<span class="ncards">mort</span>'}
          ${chambers(s.shots, !s.alive)}
        </div>`;
      })
      .join('')}
  </div>`;

  let status = '';
  if (g.status === 'play') {
    const forceable = seat && !myTurn && since(g.turnStartedAt) > FORCE_AFTER;
    status = myTurn
      ? `<p class="status mine">À toi de jouer${g.lastPlayer ? ` : crois-tu ${name(g.lastPlayer)} ?` : ' : pose tes cartes.'}</p>`
      : `<p class="status">Au tour de <b>${name(g.turn)}</b>…</p>${forceable ? `<button class="btn ghost" data-act="force">${name(g.turn)} ne joue pas : jouer à sa place</button>` : ''}`;
  }

  const handHtml =
    seat && seat.alive && g.status === 'play'
      ? `<section class="hand-zone">
          <div class="hand">${S.hand
            .map((r, i) => `<button class="card face-up r-${r} ${S.picked.has(i) ? 'picked' : ''}" data-act="pick" data-i="${i}" ${myTurn ? '' : 'disabled'}><span class="mark">${RANK_MARK[r]}</span><span class="cname">${RANK_NAME[r]}</span></button>`)
            .join('')}${S.hand.length ? '' : '<p class="muted small">Plus de cartes : tu ne peux plus qu’accuser.</p>'}</div>
          ${
            myTurn
              ? `<div class="actions">
                  <button class="btn" data-act="play" ${S.picked.size >= 1 && S.picked.size <= 3 && !S.busy ? '' : 'disabled'}>Poser ${S.picked.size || ''} ${S.picked.size > 1 ? RANK_PLURAL[g.tableRank] : RANK_NAME[g.tableRank]}</button>
                  ${g.lastPlayer ? `<button class="btn liar" data-act="call" ${S.busy ? 'disabled' : ''}>Menteur !</button>` : ''}
                </div>`
              : ''
          }
        </section>`
      : seat && !seat.alive
        ? `<p class="status">Tu es mort. Regarde la fin de la partie…</p>`
        : !seat
          ? `<p class="status">Partie en cours : tu regardes depuis le comptoir.</p>`
          : '';

  return `<div class="stack">
    <div class="row between"><span class="eyebrow">Manche ${g.round}</span>${seat && g.status !== 'ended' ? (S.confirmAbort ? `<span class="row"><button class="btn danger sm" data-act="abort-yes">Abandonner</button><button class="btn ghost sm" data-act="abort-no">Non</button></span>` : `<button class="link" data-act="abort">Abandonner</button>`) : ''}</div>
    ${table}
    ${status}
    ${handHtml}
    ${(g.status === 'reveal' || g.status === 'ended') && g.reveal ? renderReveal(g) : ''}
  </div>`;
}

function renderReveal(g: Game) {
  const r = g.reveal!;
  const stage = revealStage(g);
  const loserIsMe = r.loser === S.me;
  const verdict = r.liar ? `${name(r.accused)} a menti !` : `${name(r.accused)} disait vrai !`;
  let shot = '';
  if (stage === 1) shot = `<div class="gun spinning">${drum(r.shots - 1)}</div><p class="suspense">${loserIsMe ? 'Tu appuies' : `${name(r.loser)} appuie`} sur la détente…</p>`;
  if (stage === 2)
    shot = r.died
      ? `<div class="bang-flash"></div><div class="gun">${drum(r.shots, true)}</div><p class="result dead">PAN ! ${loserIsMe ? 'Tu es mort.' : `${name(r.loser)} est mort.`}</p>`
      : `<div class="gun">${drum(r.shots)}</div><p class="result alive">Clic. ${loserIsMe ? 'Tu survis' : `${name(r.loser)} survit`} (${r.shots}/6).</p>`;
  const over = g.status === 'ended' && stage === 2;
  return `<div class="reveal-wrap">
    <section class="reveal">
      <span class="eyebrow">${name(r.caller)} accuse ${name(r.accused)}</span>
      <div class="revealed">${r.cards.map((c, i) => cardFace(c, `flip ${c === r.tableRank || c === 'J' ? 'ok' : 'lie'}`, `--d:${i}`)).join('')}</div>
      <p class="verdict ${r.liar ? 'lie' : 'ok'}">${verdict}</p>
      ${shot}
      ${over ? `<p class="winner-line">${face(g.winner!, 'sm')} <b>${name(g.winner)}</b> est le dernier survivant !</p>` : ''}
      ${stage === 2 && !over ? `<p class="muted small">Manche suivante dans un instant…</p>` : ''}
    </section>
  </div>`;
}

/** Barillet vu de face : les chambres déjà tirées sont vides. */
function drum(shots: number, bang = false) {
  const holes = Array.from({ length: 6 }, (_, i) => {
    const a = (i / 6) * Math.PI * 2 - Math.PI / 2;
    const x = 50 + Math.cos(a) * 26;
    const y = 50 + Math.sin(a) * 26;
    const cls = i < shots ? (bang && i === shots - 1 ? 'hole bang' : 'hole fired') : 'hole';
    return `<circle class="${cls}" cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="9"></circle>`;
  }).join('');
  return `<svg viewBox="0 0 100 100" aria-hidden="true"><circle class="cyl" cx="50" cy="50" r="46"></circle>${holes}<circle class="axle" cx="50" cy="50" r="7"></circle></svg>`;
}

/* ---------- événements ---------- */
view.addEventListener('click', async (e) => {
  const b = (e.target as HTMLElement).closest<HTMLElement>('[data-act]');
  if (!b) return;
  const act = b.dataset.act;
  if (act === 'me') {
    S.me = b.dataset.id!;
    setMe(S.me);
    S.selected = null;
    S.seen = new Set();
    await heartbeat();
    await refresh();
    render(true);
  } else if (act === 'toggle') {
    const id = b.dataset.id!;
    if (S.selected!.has(id)) S.selected!.delete(id);
    else S.selected!.add(id);
    render();
  } else if (act === 'start') {
    const present = S.state?.lobby ?? [];
    const players = PLAYERS.filter((p) => present.includes(p.id) && S.selected?.has(p.id)).map((p) => p.id);
    await heartbeat();
    if (await call('lb_start', { p_players: players })) {
      S.selected = null;
      S.seen = new Set();
    }
  } else if (act === 'pick') {
    const i = Number(b.dataset.i);
    if (S.picked.has(i)) S.picked.delete(i);
    else if (S.picked.size < 3) S.picked.add(i);
    else toast('3 cartes maximum');
    render();
  } else if (act === 'play') {
    const cards = [...S.picked];
    if (await call('lb_play', { p_cards: cards })) S.picked.clear();
  } else if (act === 'call') await call('lb_call', {});
  else if (act === 'force') await call('lb_force', {});
  else if (act === 'abort') {
    S.confirmAbort = true;
    render();
  } else if (act === 'abort-no') {
    S.confirmAbort = false;
    render();
  } else if (act === 'abort-yes') {
    S.confirmAbort = false;
    await call('lb_abort', {});
  }
});

/* ---------- démarrage ---------- */
render(true);
if (supabase) {
  channel = supabase.channel('mobut-liars-bar').on('broadcast', { event: 'refresh' }, () => refresh()).subscribe();
  heartbeat().then(refresh);
  setInterval(refresh, 2500);
  setInterval(heartbeat, 10000);
  // Animation de la révélation, et passage automatique à la manche suivante.
  setInterval(() => {
    const g = S.state?.game;
    if (!g) return;
    render();
    const seated = g.seats.some((s) => s.player === S.me);
    if (g.status === 'reveal' && seated && since(g.phaseStartedAt) > REVEAL_NEXT && !S.busy && Date.now() - S.nextTry > 2000) {
      S.nextTry = Date.now();
      call('lb_next_round', {}, true);
    }
  }, 300);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') heartbeat().then(refresh);
  });
}
