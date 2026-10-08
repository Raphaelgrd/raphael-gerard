import '@fontsource/big-shoulders-display/900';
import '@fontsource/figtree/400';
import '@fontsource/figtree/600';
import '@fontsource/figtree/700';
import './style.css';
import { supabase } from '../shared/supabase';
import { PLAYERS, playerName } from '../shared/players';
import { deviceToken, getMe, setMe } from '../shared/identity';

interface Game {
  id: number;
  status: 'clues' | 'vote' | 'guess' | 'ended';
  category: string;
  players: string[];
  rounds: number;
  turn: number;
  current: string | null;
  turnStartedAt: string;
  phaseStartedAt: string;
  createdBy: string;
  clues: { player: string; round: number; text: string }[];
  voters: string[];
  votes: { voter: string; target: string }[] | null;
  accused: string | null;
  caught: boolean | null;
  imposter: string | null;
  word: string | null;
  guess: string | null;
  stolen: boolean | null;
  winner: 'civils' | 'imposteur' | null;
  aborted: boolean;
}
interface State {
  now: string;
  lobby: string[];
  scores: Record<string, number>;
  played: number;
  game: Game | null;
}
interface Card {
  gameId: number;
  player: string;
  imposter: boolean;
  category: string;
  word: string | null;
}

const TOKEN = deviceToken();
const SKIP_AFTER = 45; // secondes avant de pouvoir passer le tour d'un absent
const GUESS_TIME = 60; // secondes laissées à l'imposteur démasqué

const S = {
  me: getMe(),
  state: null as State | null,
  stateError: false,
  card: null as Card | null,
  cardFor: 0, // partie pour laquelle la carte a été demandée
  myVote: null as { gameId: number; target: string } | null,
  showCard: false,
  selected: null as Set<string> | null, // joueurs choisis pour la prochaine partie
  seen: new Set<string>(), // joueurs déjà vus dans le salon
  rounds: 2,
  draft: '',
  guessDraft: '',
  confirmAbort: false,
  busy: false,
  lastSig: '',
};

const esc = (s: unknown) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
const player = (id: string) => PLAYERS.find((p) => p.id === id)!;
const face = (id: string, cls = '') => {
  const p = player(id);
  return p ? `<span class="face ${cls}" style="--c:${p.color}" aria-hidden="true">${esc(p.short)}</span>` : '';
};
const name = (id: string | null) => esc(id ? playerName(id) : '');

function toast(msg: string) {
  const el = document.getElementById('toast')!;
  el.textContent = msg;
  el.hidden = false;
  clearTimeout((toast as any).t);
  (toast as any).t = setTimeout(() => (el.hidden = true), 2600);
}

/** Secondes écoulées depuis `iso`, mesurées avec l'horloge du serveur. */
function since(iso: string) {
  if (!S.state) return 0;
  return (new Date(S.state.now).getTime() - new Date(iso).getTime()) / 1000;
}

/* ---------- serveur ---------- */
let channel: ReturnType<NonNullable<typeof supabase>['channel']> | null = null;

async function call(fn: string, args: Record<string, unknown>) {
  if (!supabase) return false;
  S.busy = true;
  const { error } = await supabase.rpc(fn, { p_token: TOKEN, ...args });
  S.busy = false;
  if (error) {
    // Les messages des fonctions SQL sont écrits pour les joueurs.
    toast(error.message || "Ça n'a pas marché. Réessaie.");
    render(true);
    return false;
  }
  await refresh();
  // Prévient les autres téléphones de recharger tout de suite.
  channel?.send({ type: 'broadcast', event: 'refresh', payload: {} });
  return true;
}

async function refresh() {
  if (!supabase) return;
  const { data, error } = await supabase.rpc('imp_state');
  if (error) {
    S.stateError = true;
    render();
    return;
  }
  S.stateError = false;
  const prevGame = S.state?.game?.id;
  S.state = data as State;
  const g = S.state.game;
  if (g && g.status !== 'ended' && g.id !== S.cardFor) {
    if (g.id !== prevGame) S.showCard = false;
    const { data: card } = await supabase.rpc('imp_my_card', { p_token: TOKEN });
    S.card = (card as Card) ?? null;
    S.cardFor = g.id;
  }
  if (!g || g.status === 'ended') {
    S.card = null;
    S.cardFor = 0;
  }
  render();
}

async function heartbeat() {
  if (!supabase || !S.me || document.visibilityState !== 'visible') return;
  await supabase.rpc('imp_heartbeat', { p_token: TOKEN, p_player: S.me });
}

/* ---------- rendu ---------- */
const view = document.getElementById('view')!;

/** Ne redessine que si quelque chose a changé, pour ne pas perdre la saisie en cours. */
function render(force = false) {
  const st = S.state;
  const g = st?.game;
  const sig = JSON.stringify([
    S.me, S.stateError, S.showCard, S.card, S.myVote, [...(S.selected ?? [])], S.rounds, S.confirmAbort, S.busy,
    st && { ...st, now: undefined }, g && g.status === 'clues' && since(g.turnStartedAt) > SKIP_AFTER,
    g && g.status === 'guess' && since(g.phaseStartedAt) > GUESS_TIME,
  ]);
  if (!force && sig === S.lastSig) return;
  S.lastSig = sig;

  const focused = document.activeElement as HTMLInputElement | null;
  const focusId = focused?.id;
  view.innerHTML = renderView();
  if (focusId) {
    const el = document.getElementById(focusId) as HTMLInputElement | null;
    if (el) {
      el.focus();
      if (el.value) el.setSelectionRange(el.value.length, el.value.length);
    }
  }
}

function renderView() {
  if (!S.me) return renderWho();
  if (!supabase) return `<section class="panel"><p>Base de données non configurée : renseigne les variables Supabase sur Vercel.</p></section>`;
  if (!S.state) return `<section class="panel"><p class="muted">${S.stateError ? 'Connexion impossible. Vérifie ton réseau.' : 'Connexion au salon…'}</p></section>`;
  const g = S.state.game;
  if (!g || g.status === 'ended') return renderLobby();
  return renderGame(g);
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
  // Ceux qui arrivent dans le salon sont ajoutés d'office ; ceux qui partent sont retirés.
  for (const id of present) if (!S.seen.has(id)) S.selected.add(id);
  S.seen = new Set(present);
  for (const id of [...S.selected]) if (!present.includes(id)) S.selected.delete(id);
  const chosen = PLAYERS.filter((p) => present.includes(p.id) && S.selected!.has(p.id)).map((p) => p.id);
  const canStart = chosen.length >= 3 && chosen.includes(S.me!) && !S.busy;
  const g = st.game;

  return `<div class="stack">
    ${g && g.status === 'ended' ? renderReveal(g) : ''}
    <section class="panel">
      <div class="row between"><h2>Le salon</h2><span class="muted small">${present.length} connecté${present.length > 1 ? 's' : ''}</span></div>
      <p class="muted small">Touche un joueur pour le retirer ou l'ajouter à la prochaine partie. Il faut être au moins 3.</p>
      <div class="seats">${PLAYERS.map((p) => {
        const on = present.includes(p.id);
        const sel = on && S.selected!.has(p.id);
        return `<button class="seat ${on ? '' : 'away'} ${sel ? 'sel' : ''}" data-act="toggle" data-id="${p.id}" ${on ? '' : 'disabled'}>
          ${face(p.id)}<span class="sname">${esc(p.name)}${p.id === S.me ? ' (toi)' : ''}</span><span class="sstate">${on ? (sel ? 'joue' : 'regarde') : 'absent'}</span>
        </button>`;
      }).join('')}</div>
      <div class="row">
        <span class="muted small">Tours d'indices</span>
        <div class="seg">${[1, 2, 3].map((n) => `<button data-act="rounds" data-n="${n}" aria-pressed="${S.rounds === n}">${n}</button>`).join('')}</div>
      </div>
      <button class="btn" data-act="start" ${canStart ? '' : 'disabled'}>Lancer la partie${chosen.length >= 3 ? ` à ${chosen.length}` : ''}</button>
      ${present.length < 3 ? `<p class="muted small">En attente d'autres joueurs : envoie-leur le lien de la Mobut App.</p>` : ''}
    </section>
    ${renderScores()}
    <details class="panel rules"><summary>Les règles</summary>
      <ol>
        <li>Tout le monde reçoit le même mot secret, sauf l'imposteur, qui ne connaît que la catégorie.</li>
        <li>Chacun son tour, donne un indice en un mot : assez précis pour prouver que tu connais le mot, assez flou pour ne pas le donner à l'imposteur.</li>
        <li>Puis tout le monde vote pour celui qu'il soupçonne. En cas d'égalité, l'imposteur s'en sort.</li>
        <li>Démasqué, l'imposteur a encore une chance : s'il devine le mot, il gagne quand même.</li>
        <li>Points : l'imposteur gagne 2 points, chaque civil gagne 1 point quand l'imposteur perd.</li>
      </ol>
    </details>
  </div>`;
}

function renderScores() {
  const st = S.state!;
  if (!st.played) return '';
  const rows = PLAYERS.map((p) => ({ id: p.id, pts: st.scores[p.id] ?? 0 })).sort((a, b) => b.pts - a.pts);
  return `<section class="panel">
    <div class="row between"><h2>Scores</h2><span class="muted small">${st.played} partie${st.played > 1 ? 's' : ''}</span></div>
    <ol class="scores">${rows.map((r, i) => `<li><span class="pos">${i + 1}</span>${face(r.id, 'sm')}<span class="sname">${name(r.id)}</span><b>${r.pts}</b></li>`).join('')}</ol>
  </section>`;
}

function renderReveal(g: Game) {
  if (g.aborted) return `<section class="panel"><p class="muted">La dernière partie a été abandonnée. Elle ne compte pas.</p></section>`;
  const tally = new Map<string, number>();
  (g.votes ?? []).forEach((v) => tally.set(v.target, (tally.get(v.target) ?? 0) + 1));
  const civilsWin = g.winner === 'civils';
  let verdict: string;
  if (!g.caught) verdict = g.accused ? `Le groupe a accusé ${name(g.accused)}, qui était innocent.` : 'Égalité au vote : personne n’a été accusé.';
  else if (g.stolen) verdict = `Démasqué, mais il a deviné le mot (« ${esc(g.guess)} »).`;
  else verdict = `Démasqué${g.guess ? `, et il a proposé « ${esc(g.guess)} »` : ''}.`;
  return `<section class="reveal ${civilsWin ? 'civils' : 'imp'}">
    <span class="eyebrow">Dernière partie · ${civilsWin ? 'les civils gagnent' : "l'imposteur gagne"}</span>
    <div class="reveal-main">${face(g.imposter!, 'xl')}<div><span class="muted small">L'imposteur était</span><strong>${name(g.imposter)}</strong></div></div>
    <p>${verdict}</p>
    <p class="word-line">Le mot : <b>${esc(g.word)}</b> <span class="muted">(${esc(g.category)})</span></p>
    <ul class="tally">${g.players.map((id) => `<li>${face(id, 'sm')}<span>${name(id)}</span><b>${tally.get(id) ?? 0} vote${(tally.get(id) ?? 0) > 1 ? 's' : ''}</b></li>`).join('')}</ul>
    ${renderClues(g)}
  </section>`;
}

function renderClues(g: Game) {
  if (!g.clues.length) return '';
  const rounds = Array.from({ length: g.rounds }, (_, i) => i + 1).filter((r) => g.clues.some((c) => c.round === r));
  return `<div class="clues">${rounds
    .map(
      (r) => `<div class="cround">${g.rounds > 1 ? `<span class="muted small">Tour ${r}</span>` : ''}<ul>${g.clues
        .filter((c) => c.round === r)
        .map((c) => `<li>${face(c.player, 'sm')}<span class="sname">${name(c.player)}</span><span class="clue">${esc(c.text)}</span></li>`)
        .join('')}</ul></div>`,
    )
    .join('')}</div>`;
}

function renderCard() {
  const c = S.card;
  if (!c) return '';
  return `<button class="card ${S.showCard ? 'open' : ''} ${S.showCard && c.imposter ? 'imp' : ''}" data-act="card">
    ${
      S.showCard
        ? c.imposter
          ? `<span class="card-label">Tu es</span><span class="card-word">l'imposteur</span><span class="card-sub">Catégorie : ${esc(c.category)}. Fonds-toi dans la masse.</span>`
          : `<span class="card-label">Ton mot</span><span class="card-word">${esc(c.word)}</span><span class="card-sub">Catégorie : ${esc(c.category)}</span>`
        : `<span class="card-label">Ton rôle</span><span class="card-word">Touche pour voir</span><span class="card-sub">Cache ton écran aux autres</span>`
    }
  </button>`;
}

function renderGame(g: Game) {
  const seated = g.players.includes(S.me!);
  const n = g.players.length;
  const totalTurns = n * g.rounds;
  let phase = '';

  if (g.status === 'clues') {
    const mine = g.current === S.me;
    const canSkip = since(g.turnStartedAt) > SKIP_AFTER;
    phase = `<section class="panel">
      <div class="row between"><h2>Indices</h2><span class="muted small">${Math.min(g.turn + 1, totalTurns)} / ${totalTurns}</span></div>
      <ol class="order">${g.players.map((id) => `<li class="${id === g.current ? 'now' : ''}">${face(id, 'sm')}<span>${name(id)}</span></li>`).join('')}</ol>
      ${renderClues(g)}
      ${
        mine
          ? `<form class="send" data-form="clue">
              <label for="clue" class="muted small">À toi : ton indice en un mot</label>
              <div class="row"><input id="clue" maxlength="30" autocomplete="off" value="${esc(S.draft)}" placeholder="Ton indice"><button class="btn" ${S.busy ? 'disabled' : ''}>Envoyer</button></div>
            </form>`
          : `<p class="waiting">C'est au tour de <b>${name(g.current)}</b>.</p>
             ${seated && canSkip ? `<button class="btn ghost" data-act="skip">${name(g.current)} ne répond pas : passer son tour</button>` : ''}`
      }
    </section>`;
  } else if (g.status === 'vote') {
    // Le serveur ne dit pas pour qui on a voté avant la fin : on le retient ici.
    const myVote = S.myVote?.gameId === g.id ? S.myVote.target : null;
    const iVoted = g.voters.includes(S.me!);
    const canClose = seated && g.voters.length * 2 >= n && g.voters.length < n;
    phase = `<section class="panel">
      <h2>Qui est l'imposteur ?</h2>
      ${renderClues(g)}
      ${
        seated
          ? `<p class="muted small">${iVoted ? 'Vote enregistré. Tu peux encore changer tant que tout le monde n’a pas voté.' : 'Touche le joueur que tu soupçonnes.'}</p>
             <div class="suspects">${g.players
               .filter((id) => id !== S.me)
               .map((id) => `<button class="suspect ${myVote === id ? 'sel' : ''}" data-act="vote" data-id="${id}" ${S.busy ? 'disabled' : ''}>${face(id)}<span>${name(id)}</span></button>`)
               .join('')}</div>`
          : ''
      }
      <p class="muted small">${g.voters.length} / ${n} ont voté${g.voters.length ? ` : ${g.voters.map((v) => name(v)).join(', ')}` : ''}</p>
      ${canClose ? `<button class="btn ghost" data-act="close-vote">Clore le vote sans attendre</button>` : ''}
    </section>`;
  } else if (g.status === 'guess') {
    const isImp = g.imposter === S.me;
    const canEnd = seated && !isImp && since(g.phaseStartedAt) > GUESS_TIME;
    phase = `<section class="panel">
      <div class="reveal-main">${face(g.imposter!, 'xl')}<div><span class="muted small">Démasqué</span><strong>${name(g.imposter)}</strong></div></div>
      ${
        isImp
          ? `<form class="send" data-form="guess">
              <label for="guess">Dernière chance : devine le mot (catégorie ${esc(g.category)})</label>
              <div class="row"><input id="guess" maxlength="40" autocomplete="off" value="${esc(S.guessDraft)}" placeholder="Le mot"><button class="btn" ${S.busy ? 'disabled' : ''}>Valider</button></div>
            </form>`
          : `<p class="waiting">${name(g.imposter)} tente de deviner le mot…</p>
             ${canEnd ? `<button class="btn ghost" data-act="end-guess">Il ne répond pas : terminer</button>` : ''}`
      }
      ${renderClues(g)}
    </section>`;
  }

  return `<div class="stack">
    ${seated ? renderCard() : `<section class="panel"><p class="muted">Partie en cours entre ${g.players.map((p) => name(p)).join(', ')}. Tu regardes : attends la fin pour rejoindre la suivante.</p></section>`}
    ${phase}
    ${
      seated
        ? S.confirmAbort
          ? `<div class="row"><span class="muted small">Abandonner la partie pour tout le monde ?</span><button class="btn danger" data-act="abort-yes">Abandonner</button><button class="btn ghost" data-act="abort-no">Non</button></div>`
          : `<button class="link" data-act="abort">Abandonner la partie</button>`
        : ''
    }
  </div>`;
}

/* ---------- événements ---------- */
view.addEventListener('input', (e) => {
  const el = e.target as HTMLInputElement;
  if (el.id === 'clue') S.draft = el.value;
  if (el.id === 'guess') S.guessDraft = el.value;
});

view.addEventListener('submit', async (e) => {
  e.preventDefault();
  const form = (e.target as HTMLElement).closest('form')!;
  if (form.dataset.form === 'clue') {
    if (!S.draft.trim()) return;
    if (await call('imp_clue', { p_text: S.draft })) S.draft = '';
  } else if (form.dataset.form === 'guess') {
    if (!S.guessDraft.trim()) return;
    if (await call('imp_guess', { p_guess: S.guessDraft })) S.guessDraft = '';
  }
});

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
  } else if (act === 'rounds') {
    S.rounds = Number(b.dataset.n);
    render();
  } else if (act === 'start') {
    const present = S.state?.lobby ?? [];
    const players = PLAYERS.filter((p) => present.includes(p.id) && S.selected?.has(p.id)).map((p) => p.id);
    await heartbeat();
    if (await call('imp_start', { p_players: players, p_rounds: S.rounds })) {
      // Pour la partie suivante, tout le salon est de nouveau sélectionné.
      S.selected = null;
      S.seen = new Set();
    }
  } else if (act === 'card') {
    S.showCard = !S.showCard;
    render();
  } else if (act === 'skip') await call('imp_skip_turn', {});
  else if (act === 'vote') {
    const gameId = S.state?.game?.id ?? 0;
    if (await call('imp_vote', { p_target: b.dataset.id })) {
      S.myVote = { gameId, target: b.dataset.id! };
      toast(`Vote pour ${playerName(b.dataset.id!)} enregistré`);
      render(true);
    }
  } else if (act === 'close-vote') await call('imp_close_vote', {});
  else if (act === 'end-guess') await call('imp_end_guess', {});
  else if (act === 'abort') {
    S.confirmAbort = true;
    render();
  } else if (act === 'abort-no') {
    S.confirmAbort = false;
    render();
  } else if (act === 'abort-yes') {
    S.confirmAbort = false;
    await call('imp_abort', {});
  }
});

/* ---------- démarrage ---------- */
render(true);
if (supabase) {
  // Les autres téléphones préviennent après chaque action ; le relevé régulier rattrape un message perdu.
  channel = supabase.channel('mobut-imposteur').on('broadcast', { event: 'refresh' }, () => refresh()).subscribe();
  heartbeat().then(refresh);
  setInterval(refresh, 2500);
  setInterval(heartbeat, 10000);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') heartbeat().then(refresh);
  });
}
