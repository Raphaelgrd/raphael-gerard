import '@fontsource/big-shoulders-display/900';
import '@fontsource/figtree/400';
import '@fontsource/figtree/600';
import '@fontsource/figtree/700';
import './style.css';
import { supabase } from '../shared/supabase';
import type { Session } from '@supabase/supabase-js';
import { getMe } from '../shared/identity';

const PLAYERS = [
  { id: 'matias', name: 'Matias' },
  { id: 'raphael1', name: 'Raphaël 1' },
  { id: 'raphael2', name: 'Raphaël 2' },
  { id: 'sofiane', name: 'Sofiane' },
  { id: 'mathieu', name: 'Mathieu' },
  { id: 'paco', name: 'Paco' },
];
const CATS = [
  { id: 'serve', name: 'Service', hint: 'Serve', short: 'Srv' },
  { id: 'set', name: 'Passe', hint: 'Set', short: 'Pas' },
  { id: 'hit', name: 'Attaque', hint: 'Hit', short: 'Att' },
  { id: 'receive', name: 'Réception', hint: 'Receive', short: 'Réc' },
  { id: 'block', name: 'Contre', hint: 'Block', short: 'Ctr' },
  { id: 'defense', name: 'Défense', hint: 'Defense', short: 'Déf' },
];

type Scores = Record<string, Record<string, number>>;
type Notes = Record<string, Record<string, string>>;
interface Ranking {
  voters: number;
  updatedAt: string | null;
  players: Record<string, { overall: number; cats: Record<string, number>; count: number }>;
}
interface Vote {
  /** Identifiant d'affichage : le jeton côté admin, un identifiant public sinon. */
  key: string;
  token?: string;
  voter: string;
  ratings: Scores;
  notes: Notes;
  updated_at: string;
}

interface SelfVote {
  id: string;
  voter: string;
  ratings: Record<string, number>;
  notes: Record<string, string>;
  updated_at: string;
}

const pName = (id: string) => PLAYERS.find((p) => p.id === id)?.name ?? id;
const esc = (s: unknown) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
const fmt = (n: number | null | undefined) => (n == null || isNaN(n) ? '–' : (Math.round(n * 10) / 10).toFixed(1));
const avg = (a: number[]) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : null);
const when = (iso: string) => new Date(iso).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' });

// Jeton secret de cet appareil : il identifie le vote pour pouvoir le modifier.
function deviceToken(): string {
  try {
    let t = localStorage.getItem('volley-token');
    if (!t) {
      t = crypto.randomUUID();
      localStorage.setItem('volley-token', t);
    }
    return t;
  } catch {
    return crypto.randomUUID();
  }
}
const TOKEN = deviceToken();

const S = {
  tab: 'vote' as 'vote' | 'rank' | 'details' | 'self' | 'comments' | 'admin',
  stage: 'who' as 'who' | 'rate' | 'done',
  // Prérempli avec l'identité de la Mobut App (sauf les deux Raphaël, numérotés autrement ici).
  me: ({ matias: 'matias', sofiane: 'sofiane', mathieu: 'mathieu', paco: 'paco' } as Record<string, string>)[getMe() ?? ''] ?? null,
  step: 0,
  scores: {} as Scores,
  notes: {} as Notes,
  openNotes: {} as Record<string, boolean>,
  ranking: null as Ranking | null,
  rankingState: 'loading' as 'loading' | 'ready' | 'error',
  saving: false,
  session: null as Session | null,
  isAdmin: false,
  votes: [] as Vote[],
  publicVotes: [] as Vote[],
  publicState: 'loading' as 'loading' | 'ready' | 'error',
  sel: null as { key: string; target: string } | null,
  // Auto-notes (onglet séparé, hors classement général)
  selfStage: 'who' as 'who' | 'rate' | 'done',
  selfMe: null as string | null,
  selfScores: Object.fromEntries(CATS.map((c) => [c.id, 5])) as Record<string, number>,
  selfNotes: {} as Record<string, string>,
  selfOpenNotes: {} as Record<string, boolean>,
  selfVotes: [] as SelfVote[],
  selfState: 'loading' as 'loading' | 'ready' | 'error',
  selfSaving: false,
  // Rubrique Commentaires
  commentCat: 'all',
  openFiches: new Set<string>(),
  confirmDelete: null as string | null,
  loginError: '',
};

const targets = () => PLAYERS.filter((p) => p.id !== S.me);
function ensure(t: string) {
  if (!S.scores[t]) S.scores[t] = Object.fromEntries(CATS.map((c) => [c.id, 5]));
  if (!S.notes[t]) S.notes[t] = {};
}
function toast(msg: string) {
  const el = document.getElementById('toast')!;
  el.textContent = msg;
  el.hidden = false;
  clearTimeout((toast as any).t);
  (toast as any).t = setTimeout(() => (el.hidden = true), 2600);
}

/* ---------- rendu ---------- */
const view = document.getElementById('view')!;
function render() {
  document
    .querySelectorAll<HTMLButtonElement>('#tabs button')
    .forEach((b) => b.setAttribute('aria-selected', String(b.dataset.tab === S.tab)));
  document.getElementById('tab-admin')!.hidden = !(S.isAdmin || S.tab === 'admin');
  if (S.tab === 'vote') view.innerHTML = renderVote();
  else if (S.tab === 'rank') view.innerHTML = renderRank();
  else if (S.tab === 'details') view.innerHTML = renderPublic();
  else if (S.tab === 'self') view.innerHTML = renderSelf();
  else if (S.tab === 'comments') view.innerHTML = renderComments();
  else view.innerHTML = S.isAdmin ? renderAdmin() : renderLogin();
}

function configNotice() {
  return supabase ? '' : `<div class="notice">Base de données non configurée : renseigne les variables Supabase sur Vercel.</div>`;
}

function renderVote() {
  if (S.stage === 'who') {
    return `<section class="panel">
      <h2>Qui es-tu ?</h2>
      <p class="muted small">Choisis ton nom. Tu noteras ensuite les ${PLAYERS.length - 1} autres joueurs.</p>
      <div class="notice small">Tes notes et tes commentaires seront visibles par tout le monde, avec ton nom, dans l'onglet « Détails ».</div>
      ${configNotice()}
      <div class="names">${PLAYERS.map((p) => `<button data-act="pick" data-id="${p.id}" aria-pressed="${S.me === p.id}">${esc(p.name)}</button>`).join('')}</div>
      <button class="btn" data-act="start" ${S.me ? '' : 'disabled'}>Commencer à noter</button>
    </section>`;
  }
  if (S.stage === 'done') {
    return `<section class="panel">
      <span class="eyebrow">Votes enregistrés</span>
      <h2>Merci ${esc(pName(S.me!))}</h2>
      <p class="muted">Tes notes comptent dans le classement général. Tu peux revenir les modifier quand tu veux depuis ce téléphone.</p>
      <div class="row">
        <button class="btn" data-act="tab" data-tab="rank">Voir le classement</button>
        <button class="btn ghost" data-act="edit">Modifier mes notes</button>
      </div>
    </section>`;
  }
  const ts = targets();
  const t = ts[S.step];
  ensure(t.id);
  const sc = S.scores[t.id];
  const last = S.step === ts.length - 1;
  return `<section class="panel">
    <div class="progress">${ts.map((_, i) => `<span class="${i <= S.step ? 'on' : ''}"></span>`).join('')}</div>
    <div class="player-head">
      <div><span class="eyebrow">Joueur ${S.step + 1} sur ${ts.length} · noté par ${esc(pName(S.me!))}</span><h2>${esc(t.name)}</h2></div>
      <div class="avg" id="avg">${fmt(avg(Object.values(sc)))}<small>/10</small></div>
    </div>
    <div>${CATS.map((c) => {
      const k = `${t.id}:${c.id}`;
      const note = S.notes[t.id][c.id] || '';
      const open = S.openNotes[k] || note;
      return `<div class="cat">
        <div class="cat-top">
          <label class="cat-name" for="r-${c.id}">${c.name}<small>${c.hint}</small></label>
          <div class="score"><span id="v-${c.id}">${sc[c.id]}</span><small>/10</small></div>
        </div>
        <input type="range" id="r-${c.id}" min="0" max="10" step="1" value="${sc[c.id]}" data-cat="${c.id}">
        <div class="ticks" aria-hidden="true">${Array.from({ length: 11 }, (_, i) => `<span>${i}</span>`).join('')}</div>
        ${
          open
            ? `<textarea id="n-${t.id}-${c.id}" data-note="${c.id}" maxlength="500" placeholder="Commentaire sur ${esc(c.name.toLowerCase())} (facultatif)">${esc(note)}</textarea>`
            : `<button class="note-toggle" data-act="note" data-key="${k}">+ Ajouter un commentaire</button>`
        }
      </div>`;
    }).join('')}</div>
    <div class="row">
      <button class="btn ghost" data-act="prev">${S.step === 0 ? 'Changer de nom' : 'Précédent'}</button>
      <button class="btn grow" data-act="${last ? 'submit' : 'next'}" ${last && (S.saving || !supabase) ? 'disabled' : ''}>${
        last ? (S.saving ? 'Envoi…' : 'Envoyer mes notes') : 'Joueur suivant'
      }</button>
    </div>
  </section>`;
}

function renderRank() {
  const r = S.ranking;
  if (!r || !r.voters) {
    const msg =
      S.rankingState === 'loading'
        ? 'Chargement des votes…'
        : S.rankingState === 'error'
          ? "Impossible de charger le classement. Vérifie ta connexion puis réessaie."
          : "Personne n'a encore voté. Le classement s'affiche dès les premières notes envoyées.";
    return `<section class="panel"><h2>Classement général</h2><p class="muted">${msg}</p>${configNotice()}
      ${S.rankingState === 'error' ? `<button class="btn ghost" data-act="reload">Réessayer</button>` : ''}</section>`;
  }
  const rows = PLAYERS.map((p) => ({ ...p, ...(r.players[p.id] ?? { overall: null as number | null, cats: {} as Record<string, number>, count: 0 }) }))
    .filter((p) => p.overall != null)
    .sort((a, b) => b.overall! - a.overall!);
  const extremes = (worst: boolean) =>
    CATS.map((c) => {
      const pick = rows
        .filter((p) => p.cats?.[c.id] != null)
        .sort((a, b) => (worst ? a.cats[c.id] - b.cats[c.id] : b.cats[c.id] - a.cats[c.id]))[0];
      return `<div class="leader${worst ? ' worst' : ''}"><div class="k">${c.name}</div><div class="v">${pick ? esc(pick.name) : '–'} <span class="n">${pick ? fmt(pick.cats[c.id]) : ''}</span></div></div>`;
    }).join('');
  return `<section style="display:flex;flex-direction:column;gap:14px">
    <div><h2>Classement général</h2><p class="muted small">${r.voters} votant${r.voters > 1 ? 's' : ''} · moyenne des six gestes${r.updatedAt ? ` · dernier vote ${when(r.updatedAt)}` : ''}</p></div>
    <ol class="rank-list">${rows
      .map(
        (p, i) => `<li class="rank ${i === 0 ? 'first' : ''}">
      <div class="pos">${i + 1}</div>
      <div style="min-width:0"><div class="who">${esc(p.name)}</div>
        <div class="bars">${CATS.map((c) => `<div class="bar" title="${c.name} ${fmt(p.cats?.[c.id])}"><i><b style="width:${(p.cats?.[c.id] || 0) * 10}%"></b></i><span>${c.short}</span></div>`).join('')}</div>
      </div>
      <div class="val">${fmt(p.overall)}</div>
    </li>`,
      )
      .join('')}</ol>
    <h3>Meilleur par geste</h3>
    <div class="leaders">${extremes(false)}</div>
    <h3>Le plus nul par geste</h3>
    <div class="leaders">${extremes(true)}</div>
  </section>`;
}

function renderSelf() {
  return `<section style="display:flex;flex-direction:column;gap:14px">
    ${renderSelfForm()}
    ${renderSelfRanking()}
  </section>`;
}

function renderSelfForm() {
  if (S.selfStage === 'who') {
    return `<section class="panel">
      <span class="eyebrow">Hors classement général</span>
      <h2>Auto-note</h2>
      <p class="muted small">Note-toi toi-même sur les six gestes. Ça a son propre classement, à part, et c'est visible par tout le monde.</p>
      ${configNotice()}
      <div class="names">${PLAYERS.map((p) => `<button data-act="self-pick" data-id="${p.id}" aria-pressed="${S.selfMe === p.id}">${esc(p.name)}</button>`).join('')}</div>
      <button class="btn" data-act="self-start" ${S.selfMe ? '' : 'disabled'}>Me noter</button>
    </section>`;
  }
  if (S.selfStage === 'done') {
    return `<section class="panel">
      <span class="eyebrow">Auto-note enregistrée</span>
      <h2>${esc(pName(S.selfMe!))} · ${fmt(avg(Object.values(S.selfScores)))}</h2>
      <p class="muted">Ton auto-note est dans le classement ci-dessous. Tu peux la modifier quand tu veux depuis ce téléphone.</p>
      <div class="row"><button class="btn ghost" data-act="self-edit">Modifier mon auto-note</button></div>
    </section>`;
  }
  const sc = S.selfScores;
  return `<section class="panel">
    <div class="player-head">
      <div><span class="eyebrow">Auto-note · à part</span><h2>Et toi, ${esc(pName(S.selfMe!))} ?</h2></div>
      <div class="avg" id="avg">${fmt(avg(Object.values(sc)))}<small>/10</small></div>
    </div>
    <div>${CATS.map((c) => {
      const note = S.selfNotes[c.id] || '';
      const open = S.selfOpenNotes[c.id] || note;
      return `<div class="cat">
        <div class="cat-top">
          <label class="cat-name" for="r-${c.id}">${c.name}<small>${c.hint}</small></label>
          <div class="score"><span id="v-${c.id}">${sc[c.id]}</span><small>/10</small></div>
        </div>
        <input type="range" id="r-${c.id}" min="0" max="10" step="1" value="${sc[c.id]}" data-cat="${c.id}">
        <div class="ticks" aria-hidden="true">${Array.from({ length: 11 }, (_, i) => `<span>${i}</span>`).join('')}</div>
        ${
          open
            ? `<textarea id="n-self-${c.id}" data-note="${c.id}" maxlength="500" placeholder="Commentaire sur ${esc(c.name.toLowerCase())} (facultatif)">${esc(note)}</textarea>`
            : `<button class="note-toggle" data-act="self-note" data-cat="${c.id}">+ Ajouter un commentaire</button>`
        }
      </div>`;
    }).join('')}</div>
    <div class="row">
      <button class="btn ghost" data-act="self-back">Changer de nom</button>
      <button class="btn grow" data-act="self-submit" ${S.selfSaving || !supabase ? 'disabled' : ''}>${S.selfSaving ? 'Envoi…' : 'Enregistrer'}</button>
    </div>
  </section>`;
}

/** Classement des auto-notes, comparé à la moyenne que donnent les autres (classement général). */
function renderSelfRanking() {
  if (S.selfState !== 'ready' && !S.selfVotes.length) {
    return `<p class="muted">${S.selfState === 'loading' ? 'Chargement des auto-notes…' : 'Impossible de charger les auto-notes. Vérifie ta connexion puis réessaie.'}</p>`;
  }
  // Une seule auto-note par joueur : la plus récente (la liste arrive triée par date).
  const latest = new Map<string, SelfVote>();
  S.selfVotes.forEach((v) => latest.set(v.voter, v));
  const rows = [...latest.values()]
    .map((v) => {
      const self = ratingAvg(v.ratings)!;
      const others = S.ranking?.players?.[v.voter]?.overall ?? null;
      return { v, self, others, gap: others == null ? null : self - others };
    })
    .sort((a, b) => b.self - a.self);
  if (!rows.length) {
    return `<div><h2>Classement des auto-notes</h2><p class="muted">Personne ne s'est encore noté.</p></div>`;
  }
  return `<div><h2>Classement des auto-notes</h2><p class="muted small">Comment chacun se note, comparé à la moyenne que lui donnent les autres. Écart rouge : il se surestime.</p></div>
    <ol class="rank-list">${rows
      .map(
        (x, i) => `<li class="rank self-rank ${i === 0 ? 'first' : ''}">
      <div class="pos">${i + 1}</div>
      <div style="min-width:0"><div class="who">${esc(pName(x.v.voter))}</div>
        <div class="small muted">Les autres : ${x.others == null ? '–' : fmt(x.others)}${
          x.gap == null ? '' : ` · <span class="gap ${x.gap > 0 ? 'up' : 'down'}">${x.gap > 0 ? '+' : ''}${fmt(x.gap)}</span>`
        }</div>
        <div class="bars">${CATS.map((c) => `<div class="bar" title="${c.name} ${x.v.ratings[c.id]}"><i><b style="width:${(x.v.ratings[c.id] || 0) * 10}%"></b></i><span>${c.short} ${x.v.ratings[c.id]}</span></div>`).join('')}</div>
      </div>
      <div class="val">${fmt(x.self)}</div>
    </li>`,
      )
      .join('')}</ol>
    <p class="muted small">Ce qu'ils disent d'eux-mêmes est dans la rubrique « Commentaires ».</p>`;
}

/** Rubrique Commentaires : une fiche repliable par joueur, commentaires rangés par geste. */
function renderComments() {
  if (S.publicState !== 'ready' && !S.publicVotes.length) {
    const msg = S.publicState === 'loading' ? 'Chargement des commentaires…' : 'Impossible de charger les commentaires. Vérifie ta connexion puis réessaie.';
    return `<section class="panel"><h2>Commentaires</h2><p class="muted">${msg}</p>${configNotice()}</section>`;
  }
  type Entry = { from: string; score?: number; txt: string };
  const cats = CATS.filter((c) => S.commentCat === 'all' || c.id === S.commentCat);
  // Une seule auto-note par joueur : la plus récente.
  const selfByVoter = new Map<string, SelfVote>();
  S.selfVotes.forEach((v) => selfByVoter.set(v.voter, v));

  const fiches = PLAYERS.map((p) => {
    const groups = cats
      .map((c) => {
        const entries: Entry[] = [];
        S.publicVotes.forEach((v) => {
          const txt = v.notes?.[p.id]?.[c.id];
          if (txt) entries.push({ from: v.voter, score: v.ratings?.[p.id]?.[c.id], txt });
        });
        return { cat: c, entries };
      })
      .filter((g) => g.entries.length);
    const self = selfByVoter.get(p.id);
    const selfEntries = cats
      .filter((c) => self?.notes?.[c.id])
      .map((c) => ({ cat: c, score: self!.ratings[c.id], txt: self!.notes[c.id] }));
    const count = groups.reduce((n, g) => n + g.entries.length, 0) + selfEntries.length;
    return { p, groups, selfEntries, count };
  });
  const total = fiches.reduce((n, f) => n + f.count, 0);

  const filters = [{ id: 'all', name: 'Tous' }, ...CATS]
    .map((c) => `<button class="filter" data-act="comment-cat" data-cat="${c.id}" aria-pressed="${S.commentCat === c.id}">${c.name}</button>`)
    .join('');

  return `<section style="display:flex;flex-direction:column;gap:14px">
    <div><h2>Commentaires</h2><p class="muted small">Ce que chacun a écrit, rangé par joueur noté puis par geste. Touche un nom pour ouvrir sa fiche.</p></div>
    <div class="filters">${filters}</div>
    ${total ? '' : `<p class="muted">Aucun commentaire${S.commentCat === 'all' ? '' : ' sur ce geste'} pour l'instant.</p>`}
    <div class="fiches">${fiches
      .map((f) => {
        if (!f.count) return `<div class="fiche empty"><span class="who">${esc(f.p.name)}</span><span class="muted small">aucun</span></div>`;
        return `<details class="fiche" data-fiche="${f.p.id}" ${S.openFiches.has(f.p.id) ? 'open' : ''}>
          <summary><span class="who">${esc(f.p.name)}</span><span class="count">${f.count} commentaire${f.count > 1 ? 's' : ''}</span></summary>
          <div class="fiche-body">
            ${f.groups
              .map(
                (g) => `<div class="cgroup"><div class="cgroup-title">${g.cat.name}</div>${g.entries
                  .map((e) => `<div class="centry"><div class="meta">${esc(pName(e.from))} · ${e.score ?? '–'}/10</div><p>${esc(e.txt)}</p></div>`)
                  .join('')}</div>`,
              )
              .join('')}
            ${
              f.selfEntries.length
                ? `<div class="cgroup self"><div class="cgroup-title">Auto-note</div>${f.selfEntries
                    .map((e) => `<div class="centry"><div class="meta">${esc(f.p.name)} sur lui-même · ${e.cat.name} ${e.score}/10</div><p>${esc(e.txt)}</p></div>`)
                    .join('')}</div>`
                : ''
            }
          </div>
        </details>`;
      })
      .join('')}</div>
  </section>`;
}

function renderLogin() {
  return `<section class="panel">
    <span class="eyebrow">Accès administrateur</span>
    <h2>Coulisses</h2>
    ${configNotice()}
    ${S.session && !S.isAdmin ? `<div class="notice">Ce compte n'est pas administrateur.</div>` : ''}
    <form id="login" style="display:flex;flex-direction:column;gap:12px">
      <label class="field">E-mail<input id="login-email" type="email" autocomplete="username" required></label>
      <label class="field">Mot de passe<input id="login-password" type="password" autocomplete="current-password" required></label>
      ${S.loginError ? `<p class="small" style="color:var(--bad)">${esc(S.loginError)}</p>` : ''}
      <button class="btn" type="submit" ${supabase ? '' : 'disabled'}>Se connecter</button>
    </form>
  </section>`;
}

const ratingAvg = (r?: Record<string, number>) => (r ? avg(CATS.map((c) => r[c.id]).filter((v) => typeof v === 'number')) : null);

function renderPublic() {
  if (S.publicState !== 'ready' && !S.publicVotes.length) {
    const msg = S.publicState === 'loading' ? 'Chargement des votes…' : 'Impossible de charger les votes. Vérifie ta connexion puis réessaie.';
    return `<section class="panel"><h2>Détail des votes</h2><p class="muted">${msg}</p>${configNotice()}</section>`;
  }
  return renderDetails(S.publicVotes, false);
}

function renderAdmin() {
  return renderDetails(S.votes, true);
}

function renderDetails(votes: Vote[], admin: boolean) {
  const chips = PLAYERS.map((p) => {
    const v = votes.filter((x) => x.voter === p.id);
    return v.length
      ? v.map((x) => `<span class="chip">${esc(p.name)} · ${when(x.updated_at)}</span>`).join('')
      : `<span class="chip missing">${esc(p.name)} n'a pas voté</span>`;
  }).join('');
  const dupes = PLAYERS.filter((p) => votes.filter((v) => v.voter === p.id).length > 1);
  const head = `<tr><th class="rowh">Votant ↓ / Noté →</th>${PLAYERS.map((p) => `<th>${esc(p.name)}</th>`).join('')}${admin ? '<th></th>' : ''}</tr>`;
  const body = votes
    .map(
      (v) => `<tr><th class="rowh">${esc(pName(v.voter))}</th>${PLAYERS.map((p) => {
        if (p.id === v.voter) return `<td class="self">—</td>`;
        const a = ratingAvg(v.ratings?.[p.id]);
        if (a == null) return `<td class="muted">·</td>`;
        const sel = S.sel?.key === v.key && S.sel.target === p.id;
        const hasNote = Object.values(v.notes?.[p.id] ?? {}).some(Boolean);
        return `<td class="cell"><button style="--pct:${Math.round(a * 6)}%" class="${sel ? 'sel' : ''}" data-act="cell" data-key="${esc(v.key)}" data-target="${p.id}">${fmt(a)}${hasNote ? '*' : ''}</button></td>`;
      }).join('')}${
        !admin
          ? ''
          : S.confirmDelete === v.token
          ? `<td><button class="danger" data-act="delete-yes" data-token="${v.token}">Confirmer</button> · <button class="danger" style="color:var(--muted)" data-act="delete-no">Annuler</button></td>`
          : `<td><button class="danger" data-act="delete" data-token="${v.token}">Supprimer</button></td>`
      }</tr>`,
    )
    .join('');

  let detail = `<p class="muted small">Touche une case du tableau pour voir le détail. Une * signale un commentaire.</p>`;
  if (S.sel) {
    const v = votes.find((x) => x.key === S.sel!.key);
    const r = v?.ratings?.[S.sel.target];
    const n = v?.notes?.[S.sel.target] ?? {};
    if (v && r)
      detail = `<div class="panel" style="padding:14px">
      <h3>${esc(pName(v.voter))} → ${esc(pName(S.sel.target))} · ${fmt(ratingAvg(r))}</h3>
      <div class="detail-grid">${CATS.map((c) => `<div><div class="small muted">${c.name}</div><div class="s">${r[c.id] ?? '–'}</div>${n[c.id] ? `<p>« ${esc(n[c.id])} »</p>` : ''}</div>`).join('')}</div>
    </div>`;
  }

  const comments: { from: string; to: string; cat: string; txt: string; score?: number }[] = [];
  votes.forEach((v) =>
    Object.entries(v.notes ?? {}).forEach(([t, cs]) =>
      Object.entries(cs ?? {}).forEach(([c, txt]) => {
        if (txt) comments.push({ from: v.voter, to: t, cat: CATS.find((x) => x.id === c)?.name ?? c, txt, score: v.ratings?.[t]?.[c] });
      }),
    ),
  );

  return `<section style="display:flex;flex-direction:column;gap:14px">
    ${
      admin
        ? `<div class="row"><div class="grow"><span class="eyebrow">Visible par toi seul</span><h2>Coulisses</h2></div>
      <button class="btn ghost" data-act="reload">Actualiser</button>
      <button class="btn ghost" data-act="logout">Déconnexion</button></div>`
        : `<div><h2>Détail des votes</h2><p class="muted small">Toutes les notes, avec qui les a mises.</p></div>`
    }
    <div class="voters">${chips}</div>
    ${admin && dupes.length ? `<div class="notice">Plusieurs votes sous le nom ${dupes.map((p) => esc(p.name)).join(', ')}. Ils comptent tous dans le classement : supprime ceux qui sont en trop.</div>` : ''}
    ${votes.length ? `<div class="scroll"><table><thead>${head}</thead><tbody>${body}</tbody></table></div>${detail}` : `<p class="muted">Aucun vote pour l'instant.</p>`}
    ${
      admin
        ? `<h3>Commentaires par auteur</h3>
    <div class="comments">${
      comments.length
        ? PLAYERS.filter((p) => comments.some((c) => c.from === p.id))
            .map(
              (p) => `<div class="cgroup"><div class="cgroup-title">${esc(p.name)} a écrit</div>${comments
                .filter((c) => c.from === p.id)
                .map((c) => `<div class="comment"><div class="meta">sur ${esc(pName(c.to))} · ${esc(c.cat)} ${c.score ?? ''}/10</div>${esc(c.txt)}</div>`)
                .join('')}</div>`,
            )
            .join('')
        : `<p class="muted small">Aucun commentaire pour l'instant.</p>`
    }</div>`
        : `<p class="muted small">Les commentaires sont dans la rubrique « Commentaires ».</p>`
    }
  </section>`;
}

/* ---------- données ---------- */
async function loadRanking() {
  if (!supabase) {
    S.rankingState = 'ready';
    return;
  }
  const { data, error } = await supabase.rpc('get_ranking');
  if (error) S.rankingState = 'error';
  else {
    S.ranking = data as Ranking;
    S.rankingState = 'ready';
  }
}

async function loadMyVote() {
  if (!supabase) return;
  const { data } = await supabase.rpc('get_my_vote', { p_token: TOKEN });
  if (!data) return;
  const d = data as { voter: string; ratings: Scores; notes: Notes };
  S.me = d.voter;
  Object.entries(d.ratings ?? {}).forEach(([t, r]) => (S.scores[t] = { ...r }));
  Object.entries(d.notes ?? {}).forEach(([t, n]) => (S.notes[t] = { ...n }));
  if (S.stage === 'who') S.stage = 'done';
}

async function loadPublicVotes() {
  if (!supabase) {
    S.publicState = 'error';
    return;
  }
  const { data, error } = await supabase.rpc('get_all_votes');
  if (error) S.publicState = 'error';
  else {
    S.publicVotes = ((data ?? []) as (Vote & { id: string })[]).map((v) => ({ ...v, key: v.id }));
    S.publicState = 'ready';
  }
}

async function loadSelfVotes() {
  if (!supabase) {
    S.selfState = 'error';
    return;
  }
  const { data, error } = await supabase.rpc('get_self_votes');
  if (error) S.selfState = 'error';
  else {
    S.selfVotes = (data ?? []) as SelfVote[];
    S.selfState = 'ready';
  }
}

async function loadMySelfVote() {
  if (!supabase) return;
  const { data } = await supabase.rpc('get_my_self_vote', { p_token: TOKEN });
  if (!data) return;
  const d = data as { voter: string; ratings: Record<string, number>; notes: Record<string, string> };
  S.selfMe = d.voter;
  S.selfScores = { ...d.ratings };
  S.selfNotes = { ...(d.notes ?? {}) };
  if (S.selfStage === 'who') S.selfStage = 'done';
}

async function submitSelf() {
  if (!supabase || !S.selfMe) return;
  S.selfSaving = true;
  render();
  const notes = Object.fromEntries(
    Object.entries(S.selfNotes)
      .map(([k, v]) => [k, v.trim()] as const)
      .filter(([, v]) => v),
  );
  const { error } = await supabase.rpc('submit_self_vote', { p_token: TOKEN, p_voter: S.selfMe, p_ratings: S.selfScores, p_notes: notes });
  S.selfSaving = false;
  if (error) toast("L'envoi a échoué. Vérifie ta connexion puis réessaie.");
  else {
    S.selfStage = 'done';
    toast('Auto-note enregistrée');
    await loadSelfVotes();
  }
  render();
}

async function loadAdmin() {
  if (!supabase || !S.session) {
    S.isAdmin = false;
    return;
  }
  const { data: ok } = await supabase.rpc('is_admin');
  S.isAdmin = ok === true;
  if (!S.isAdmin) return;
  const { data, error } = await supabase.from('votes').select('token, voter, ratings, notes, updated_at').order('updated_at');
  if (error) toast('Impossible de charger les votes.');
  else S.votes = ((data ?? []) as Vote[]).map((v) => ({ ...v, key: v.token! }));
}

async function submit() {
  if (!supabase) return;
  S.saving = true;
  render();
  const ratings: Scores = {};
  const notes: Notes = {};
  targets().forEach((t) => {
    ensure(t.id);
    ratings[t.id] = { ...S.scores[t.id] };
    const n = Object.fromEntries(
      Object.entries(S.notes[t.id])
        .map(([k, v]) => [k, v.trim()] as const)
        .filter(([, v]) => v),
    );
    if (Object.keys(n).length) notes[t.id] = n;
  });
  const { error } = await supabase.rpc('submit_vote', { p_token: TOKEN, p_voter: S.me, p_ratings: ratings, p_notes: notes });
  S.saving = false;
  if (error) {
    toast("L'envoi a échoué. Vérifie ta connexion puis réessaie.");
  } else {
    S.stage = 'done';
    toast('Notes envoyées');
    loadRanking().then(() => !(S.tab === 'vote' && S.stage === 'rate') && render());
    if (S.isAdmin) loadAdmin();
  }
  render();
}

/* ---------- événements ---------- */
function goTab(tab: typeof S.tab) {
  S.tab = tab;
  S.sel = null;
  if (tab === 'rank') loadRanking().then(() => S.tab === 'rank' && render());
  if (tab === 'details') loadPublicVotes().then(() => S.tab === 'details' && render());
  if (tab === 'comments') Promise.all([loadPublicVotes(), loadSelfVotes()]).then(() => S.tab === 'comments' && render());
  if (tab === 'self') {
    // Préremplit le nom avec celui choisi pour voter, s'il y en a un.
    if (!S.selfMe && S.me && S.selfStage === 'who') S.selfMe = S.me;
    Promise.all([loadSelfVotes(), loadRanking()]).then(() => S.tab === 'self' && S.selfStage !== 'rate' && render());
  }
  render();
}

document.getElementById('tabs')!.addEventListener('click', (e) => {
  const b = (e.target as HTMLElement).closest<HTMLButtonElement>('button[data-tab]');
  if (b) goTab(b.dataset.tab as typeof S.tab);
});

view.addEventListener('input', (e) => {
  const el = e.target as HTMLInputElement;
  if (S.tab === 'self') {
    if (el.dataset.cat) {
      S.selfScores[el.dataset.cat] = Number(el.value);
      document.getElementById(`v-${el.dataset.cat}`)!.textContent = el.value;
      document.getElementById('avg')!.innerHTML = `${fmt(avg(Object.values(S.selfScores)))}<small>/10</small>`;
    } else if (el.dataset.note) S.selfNotes[el.dataset.note] = el.value.slice(0, 500);
    return;
  }
  const t = targets()[S.step]?.id;
  if (el.dataset.cat) {
    S.scores[t][el.dataset.cat] = Number(el.value);
    document.getElementById(`v-${el.dataset.cat}`)!.textContent = el.value;
    document.getElementById('avg')!.innerHTML = `${fmt(avg(Object.values(S.scores[t])))}<small>/10</small>`;
  } else if (el.dataset.note) {
    S.notes[t][el.dataset.note] = el.value.slice(0, 500);
  }
});

view.addEventListener(
  'toggle',
  (e) => {
    const d = e.target as HTMLDetailsElement;
    if (!d.dataset?.fiche) return;
    if (d.open) S.openFiches.add(d.dataset.fiche);
    else S.openFiches.delete(d.dataset.fiche);
  },
  true,
);

view.addEventListener('submit', async (e) => {
  e.preventDefault();
  if (!supabase) return;
  const email = (document.getElementById('login-email') as HTMLInputElement).value.trim();
  const password = (document.getElementById('login-password') as HTMLInputElement).value;
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  S.loginError = error ? 'E-mail ou mot de passe incorrect.' : '';
  render();
});

view.addEventListener('click', async (e) => {
  const b = (e.target as HTMLElement).closest<HTMLElement>('[data-act]');
  if (!b) return;
  const act = b.dataset.act;
  if (act === 'pick') {
    S.me = b.dataset.id!;
    render();
  } else if (act === 'start') {
    S.stage = 'rate';
    S.step = 0;
    render();
    scrollTo(0, 0);
  } else if (act === 'next') {
    S.step++;
    render();
    scrollTo(0, 0);
  } else if (act === 'prev') {
    if (S.step === 0) S.stage = 'who';
    else S.step--;
    render();
    scrollTo(0, 0);
  } else if (act === 'note') {
    S.openNotes[b.dataset.key!] = true;
    render();
    const [t, c] = b.dataset.key!.split(':');
    document.getElementById(`n-${t}-${c}`)?.focus();
  } else if (act === 'tab') goTab(b.dataset.tab as typeof S.tab);
  else if (act === 'edit') {
    S.stage = 'rate';
    S.step = 0;
    render();
  } else if (act === 'submit') submit();
  else if (act === 'comment-cat') {
    S.commentCat = b.dataset.cat!;
    render();
  } else if (act === 'self-pick') {
    S.selfMe = b.dataset.id!;
    render();
  } else if (act === 'self-start' || act === 'self-edit') {
    S.selfStage = 'rate';
    render();
    scrollTo(0, 0);
  } else if (act === 'self-back') {
    S.selfStage = 'who';
    render();
  } else if (act === 'self-note') {
    S.selfOpenNotes[b.dataset.cat!] = true;
    render();
    document.getElementById(`n-self-${b.dataset.cat}`)?.focus();
  } else if (act === 'self-submit') submitSelf();
  else if (act === 'reload') {
    await Promise.all([loadRanking(), loadAdmin(), S.tab === 'details' ? loadPublicVotes() : null]);
    render();
  } else if (act === 'cell') {
    S.sel = { key: b.dataset.key!, target: b.dataset.target! };
    render();
  } else if (act === 'delete') {
    S.confirmDelete = b.dataset.token!;
    render();
  } else if (act === 'delete-no') {
    S.confirmDelete = null;
    render();
  } else if (act === 'delete-yes' && supabase) {
    const { error } = await supabase.from('votes').delete().eq('token', b.dataset.token!);
    S.confirmDelete = null;
    if (error) toast('Suppression impossible.');
    else toast('Vote supprimé');
    if (S.sel?.key === b.dataset.token) S.sel = null;
    await Promise.all([loadAdmin(), loadRanking()]);
    render();
  } else if (act === 'logout' && supabase) {
    await supabase.auth.signOut();
  }
});

/* ---------- démarrage ---------- */
// Les coulisses s'ouvrent avec l'adresse du site suivie de #coulisses.
if (location.hash === '#coulisses') S.tab = 'admin';
render();

(async () => {
  if (supabase) {
    supabase.auth.onAuthStateChange((_evt, session) => {
      S.session = session;
      // Différé : supabase-js interdit d'appeler l'API dans ce rappel.
      setTimeout(async () => {
        await loadAdmin();
        if (!S.isAdmin) S.votes = [];
        if (!(S.tab === 'vote' && S.stage === 'rate')) render();
      });
    });
  }
  await Promise.all([loadMyVote(), loadMySelfVote(), loadRanking()]);
  if (!(S.tab === 'vote' && S.stage === 'rate')) render();
})();
