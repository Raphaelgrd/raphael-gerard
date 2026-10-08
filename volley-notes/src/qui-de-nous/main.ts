import '@fontsource/big-shoulders-display/900';
import '@fontsource/figtree/400';
import '@fontsource/figtree/600';
import '@fontsource/figtree/700';
import './style.css';
import { supabase } from '../shared/supabase';
import { PLAYERS, QUESTIONS, RESULTS_VISIBLE } from './questions';
import { getMe } from '../shared/identity';


interface Answer {
  id: string;
  voter: string;
  question_id: string;
  ranking: string[];
  updated_at: string;
}

const player = (id: string) => PLAYERS.find((p) => p.id === id)!;
const pName = (id: string) => PLAYERS.find((p) => p.id === id)?.name ?? id;
const esc = (s: unknown) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
const ordinal = (n: number) => (n === 1 ? '1er' : `${n}e`);

// Jeton secret de cet appareil : il identifie ses réponses pour pouvoir les modifier.
function deviceToken(): string {
  try {
    let t = localStorage.getItem('qdn-token');
    if (!t) {
      t = crypto.randomUUID();
      localStorage.setItem('qdn-token', t);
    }
    return t;
  } catch {
    return crypto.randomUUID();
  }
}
const TOKEN = deviceToken();

const S = {
  tab: 'play' as 'play' | 'results',
  stage: 'who' as 'who' | 'play' | 'done',
  me: getMe(),
  q: 0,
  picks: [] as string[],
  mine: {} as Record<string, string[]>,
  all: [] as Answer[],
  allState: 'loading' as 'loading' | 'ready' | 'error',
  open: new Set<string>(),
  saving: false,
};

function toast(msg: string) {
  const el = document.getElementById('toast')!;
  el.textContent = msg;
  el.hidden = false;
  clearTimeout((toast as any).t);
  (toast as any).t = setTimeout(() => (el.hidden = true), 2400);
}

function face(id: string, size: 'lg' | 'sm' = 'lg') {
  const p = player(id);
  return `<span class="face ${size}" style="--c:${p.color}" aria-hidden="true">${esc(p.short)}</span>`;
}

/* ---------- rendu ---------- */
const view = document.getElementById('view')!;
function render() {
  document.querySelectorAll<HTMLButtonElement>('#tabs button').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.tab === S.tab)));
  view.innerHTML = S.tab === 'play' ? renderPlay() : renderResults();
}

function configNotice() {
  return supabase ? '' : `<div class="notice">Base de données non configurée : renseigne les variables Supabase sur Vercel.</div>`;
}

function renderPlay() {
  if (S.stage === 'who') {
    return `<section class="panel">
      <h2>Qui es-tu ?</h2>
      <p class="muted small">Pour chaque question, tu classes les 6 du 1er au 6e en touchant leurs têtes dans l'ordre. Tes classements sont visibles par tout le monde.</p>
      ${configNotice()}
      <div class="names">${PLAYERS.map(
        (p) => `<button data-act="pick-me" data-id="${p.id}" aria-pressed="${S.me === p.id}">${face(p.id, 'sm')}<span>${esc(p.name)}</span></button>`,
      ).join('')}</div>
      <button class="btn" data-act="start" ${S.me ? '' : 'disabled'}>C'est parti</button>
    </section>`;
  }
  if (S.stage === 'done') {
    return `<section class="panel center">
      <span class="eyebrow">Toutes les questions faites</span>
      <h2>Merci ${esc(pName(S.me!))}</h2>
      <p class="muted">Tes ${QUESTIONS.length} classements sont enregistrés. Tu peux en refaire un quand tu veux.</p>
      <div class="row">
        <button class="btn" data-act="tab" data-tab="results">${RESULTS_VISIBLE ? 'Voir les résultats' : 'Voir qui a répondu'}</button>
        <button class="btn ghost" data-act="restart">Refaire mes classements</button>
      </div>
    </section>`;
  }

  const q = QUESTIONS[S.q];
  const next = S.picks.length + 1;
  const complete = S.picks.length === PLAYERS.length;
  const n = PLAYERS.length;
  return `<section class="play">
    <div class="qhead">
      <span class="eyebrow">Question ${S.q + 1} sur ${QUESTIONS.length}${S.mine[q.id] ? ' · déjà répondue' : ''}</span>
      <h2 class="question">${esc(q.text)}</h2>
    </div>

    <div class="ring" style="--n:${n}">
      ${PLAYERS.map((p, i) => {
        const rank = S.picks.indexOf(p.id) + 1;
        return `<button class="head ${rank ? 'picked' : ''}" style="--i:${i}; --c:${p.color}" data-act="head" data-id="${p.id}"
          aria-label="${esc(p.name)}${rank ? `, classé ${ordinal(rank)}` : ''}">
          ${face(p.id)}
          ${rank ? `<span class="badge">${rank}</span>` : ''}
          <span class="hname">${esc(p.name)}</span>
        </button>`;
      }).join('')}
      <div class="hub">${
        complete ? `<span class="hub-big">OK</span><span class="hub-small">classement complet</span>` : `<span class="hub-small">touche le</span><span class="hub-big">${ordinal(next)}</span>`
      }</div>
    </div>

    <ol class="podium">${Array.from({ length: n }, (_, i) => {
      const id = S.picks[i];
      return `<li class="${id ? 'filled' : ''}"><span class="pos">${i + 1}</span>${id ? `${face(id, 'sm')}<span class="pn">${esc(pName(id))}</span>` : '<span class="pn muted">…</span>'}</li>`;
    }).join('')}</ol>
    <p class="muted small center">Touche une tête déjà classée pour la retirer.</p>

    <div class="row">
      <button class="btn ghost" data-act="prev">${S.q === 0 ? 'Changer de nom' : 'Précédente'}</button>
      <button class="btn ghost" data-act="clear" ${S.picks.length ? '' : 'disabled'}>Effacer</button>
      <button class="btn grow" data-act="validate" ${complete && !S.saving && supabase ? '' : 'disabled'}>${S.saving ? 'Envoi…' : S.q === QUESTIONS.length - 1 ? 'Valider et finir' : 'Valider'}</button>
    </div>
  </section>`;
}

/** Position moyenne de chaque joueur pour une question (1 = premier). */
function aggregate(answers: Answer[]) {
  return PLAYERS.map((p) => {
    const positions = answers.map((a) => a.ranking.indexOf(p.id) + 1).filter((x) => x > 0);
    const avg = positions.length ? positions.reduce((s, x) => s + x, 0) / positions.length : 99;
    const firsts = positions.filter((x) => x === 1).length;
    return { id: p.id, avg, firsts };
  }).sort((a, b) => a.avg - b.avg || b.firsts - a.firsts);
}

/** Résultats masqués : on montre seulement qui a répondu, et à combien de questions. */
function renderHidden() {
  const count = (id: string) => new Set(S.all.filter((a) => a.voter === id).map((a) => a.question_id)).size;
  return `<section class="panel">
    <span class="eyebrow">Résultats cachés</span>
    <h2>Patience</h2>
    <p class="muted">Les résultats seront dévoilés quand tout le monde aura répondu. En attendant, voici qui a joué.</p>
    <ul class="progress-list">${PLAYERS.map((p) => {
      const n = Math.min(count(p.id), QUESTIONS.length);
      return `<li>${face(p.id, 'sm')}<span class="pn">${esc(p.name)}</span><span class="meter"><b style="width:${(n / QUESTIONS.length) * 100}%; background:${p.color}"></b></span><span class="avg">${n} / ${QUESTIONS.length}</span></li>`;
    }).join('')}</ul>
  </section>`;
}

function renderResults() {
  if (S.allState !== 'ready' && !S.all.length) {
    return `<section class="panel"><h2>Résultats</h2><p class="muted">${
      S.allState === 'loading' ? 'Chargement…' : 'Impossible de charger les résultats. Vérifie ta connexion puis réessaie.'
    }</p>${configNotice()}</section>`;
  }
  if (!RESULTS_VISIBLE) return renderHidden();
  const voters = new Set(S.all.map((a) => a.id)).size;
  return `<section class="results">
    <div><h2>Résultats</h2><p class="muted small">${voters} participant${voters > 1 ? 's' : ''}. Classement par position moyenne : plus elle est basse, plus le groupe le met en tête.</p></div>
    ${QUESTIONS.map((q) => {
      const answers = S.all.filter((a) => a.question_id === q.id);
      if (!answers.length)
        return `<article class="rcard"><h3>${esc(q.text)}</h3><p class="muted small">Pas encore de réponse.</p></article>`;
      const agg = aggregate(answers);
      const top = agg[0];
      return `<article class="rcard">
        <h3>${esc(q.text)}</h3>
        <div class="verdict" style="--c:${player(top.id).color}">${face(top.id)}<div><span class="eyebrow">Verdict du groupe</span><strong>${esc(pName(top.id))}</strong></div></div>
        <ol class="agg">${agg
          .map(
            (x, i) => `<li><span class="pos">${i + 1}</span>${face(x.id, 'sm')}<span class="pn">${esc(pName(x.id))}</span>
            <span class="meter"><b style="width:${Math.max(4, ((PLAYERS.length - x.avg) / (PLAYERS.length - 1)) * 100)}%; background:${player(x.id).color}"></b></span>
            <span class="avg">moy. ${x.avg.toFixed(1)}</span></li>`,
          )
          .join('')}</ol>
        <details data-q="${q.id}" ${S.open.has(q.id) ? 'open' : ''}>
          <summary>Voir le classement de chacun (${answers.length})</summary>
          <ul class="each">${answers
            .map(
              (a) => `<li><span class="who">${esc(pName(a.voter))}</span><span class="line">${a.ranking
                .map((id, i) => `<span class="chip"><b>${i + 1}</b> ${esc(pName(id))}</span>`)
                .join('')}</span></li>`,
            )
            .join('')}</ul>
        </details>
      </article>`;
    }).join('')}
  </section>`;
}

/* ---------- données ---------- */
async function loadMine() {
  if (!supabase) return;
  const { data } = await supabase.rpc('qdn_my_answers', { p_token: TOKEN });
  const rows = (data ?? []) as { voter: string; question_id: string; ranking: string[] }[];
  if (!rows.length) return;
  rows.forEach((r) => (S.mine[r.question_id] = r.ranking));
  S.me = rows[rows.length - 1].voter;
  if (S.stage === 'who') {
    const first = QUESTIONS.findIndex((q) => !S.mine[q.id]);
    if (first === -1) S.stage = 'done';
    else {
      S.stage = 'play';
      goQuestion(first);
    }
  }
}

async function loadAll() {
  if (!supabase) {
    S.allState = 'error';
    return;
  }
  const { data, error } = await supabase.rpc('qdn_all_answers');
  if (error) S.allState = 'error';
  else {
    // Une seule réponse par appareil et par question (déjà garanti par la base).
    S.all = (data ?? []) as Answer[];
    S.allState = 'ready';
  }
}

function goQuestion(i: number) {
  S.q = i;
  S.picks = [...(S.mine[QUESTIONS[i].id] ?? [])];
}

async function validate() {
  if (!supabase || !S.me || S.picks.length !== PLAYERS.length) return;
  const q = QUESTIONS[S.q];
  S.saving = true;
  render();
  const { error } = await supabase.rpc('qdn_submit', { p_token: TOKEN, p_voter: S.me, p_question: q.id, p_ranking: S.picks });
  S.saving = false;
  if (error) {
    toast("L'envoi a échoué. Vérifie ta connexion puis réessaie.");
    render();
    return;
  }
  S.mine[q.id] = [...S.picks];
  if (S.q < QUESTIONS.length - 1) goQuestion(S.q + 1);
  else S.stage = 'done';
  render();
  scrollTo(0, 0);
}

/* ---------- événements ---------- */
function goTab(tab: typeof S.tab) {
  S.tab = tab;
  if (tab === 'results') loadAll().then(() => S.tab === 'results' && render());
  render();
}

document.getElementById('tabs')!.addEventListener('click', (e) => {
  const b = (e.target as HTMLElement).closest<HTMLButtonElement>('button[data-tab]');
  if (b) goTab(b.dataset.tab as typeof S.tab);
});

view.addEventListener(
  'toggle',
  (e) => {
    const d = e.target as HTMLDetailsElement;
    if (!d.dataset?.q) return;
    if (d.open) S.open.add(d.dataset.q);
    else S.open.delete(d.dataset.q);
  },
  true,
);

view.addEventListener('click', (e) => {
  const b = (e.target as HTMLElement).closest<HTMLElement>('[data-act]');
  if (!b) return;
  const act = b.dataset.act;
  if (act === 'pick-me') {
    S.me = b.dataset.id!;
    render();
  } else if (act === 'start') {
    S.stage = 'play';
    const first = QUESTIONS.findIndex((q) => !S.mine[q.id]);
    goQuestion(first === -1 ? 0 : first);
    render();
  } else if (act === 'head') {
    const id = b.dataset.id!;
    const at = S.picks.indexOf(id);
    if (at >= 0) S.picks.splice(at, 1);
    else if (S.picks.length < PLAYERS.length) S.picks.push(id);
    render();
  } else if (act === 'clear') {
    S.picks = [];
    render();
  } else if (act === 'prev') {
    if (S.q === 0) S.stage = 'who';
    else goQuestion(S.q - 1);
    render();
  } else if (act === 'validate') validate();
  else if (act === 'restart') {
    S.stage = 'play';
    goQuestion(0);
    render();
  } else if (act === 'tab') goTab(b.dataset.tab as typeof S.tab);
});

/* ---------- démarrage ---------- */
render();
loadMine().then(() => S.tab === 'play' && render());
