import '@fontsource/big-shoulders-display/900';
import '@fontsource/figtree/400';
import '@fontsource/figtree/600';
import '@fontsource/figtree/700';
import './style.css';
import { GAMES, MEMBERS } from './games';

// Ancienne adresse des coulisses de Notes Volley (avant la Mobut App).
if (location.hash === '#coulisses') location.replace('/volley/#coulisses');

const esc = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

document.getElementById('members')!.innerHTML = MEMBERS.map((m) => `<li>${esc(m)}</li>`).join('');
document.getElementById('games')!.innerHTML =
  GAMES.map(
    (g) => `<li><a class="game" href="${g.href}" style="--c:${g.color}">
      <span class="mark">${esc(g.mark)}</span>
      <span class="gbody"><span class="gname">${esc(g.name)}</span><span class="gtag">${esc(g.tagline)}</span></span>
      <span class="go" aria-hidden="true">→</span>
    </a></li>`,
  ).join('') + `<li class="soon">Prochain jeu bientôt</li>`;
