import '@fontsource/big-shoulders-display/900';
import '@fontsource/figtree/400';
import '@fontsource/figtree/600';
import '@fontsource/figtree/700';
import './style.css';
import { GAMES } from './games';
import { PLAYERS, playerName } from '../shared/players';
import { getMe, setMe } from '../shared/identity';

// Ancienne adresse des coulisses de Notes Volley (avant la Mobut App).
if (location.hash === '#coulisses') location.replace('/volley/#coulisses');

const esc = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

const who = document.getElementById('who')!;
const menu = document.getElementById('menu')!;

function render() {
  const me = getMe();
  who.hidden = !!me;
  menu.hidden = !me;
  if (!me) {
    document.getElementById('who-list')!.innerHTML = PLAYERS.map(
      (p) => `<button class="pick" data-id="${p.id}" style="--c:${p.color}"><span class="face">${esc(p.short)}</span><span>${esc(p.name)}</span></button>`,
    ).join('');
    return;
  }
  const p = PLAYERS.find((x) => x.id === me)!;
  document.getElementById('hello')!.innerHTML =
    `<span class="face sm" style="--c:${p.color}">${esc(p.short)}</span><span>Salut <b>${esc(playerName(me))}</b></span><button class="link" id="change">Ce n'est pas moi</button>`;
  document.getElementById('games')!.innerHTML =
    GAMES.map(
      (g) => `<li><a class="game" href="${g.href}" style="--c:${g.color}">
      <span class="mark">${esc(g.mark)}</span>
      <span class="gbody"><span class="gname">${esc(g.name)}</span><span class="gtag">${esc(g.tagline)}</span></span>
      <span class="go" aria-hidden="true">→</span>
    </a></li>`,
    ).join('') + `<li class="soon">Prochain jeu bientôt</li>`;
}

document.addEventListener('click', (e) => {
  const t = e.target as HTMLElement;
  const pick = t.closest<HTMLButtonElement>('button.pick');
  if (pick) {
    setMe(pick.dataset.id!);
    render();
  } else if (t.closest('#change')) {
    setMe(null);
    render();
  }
});

render();
