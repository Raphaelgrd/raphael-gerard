import { PLAYERS } from './players';

// Qui utilise ce téléphone : choisi une fois dans la Mobut App, repris par tous les jeux.
const KEY = 'mobut-me';

export function getMe(): string | null {
  try {
    const id = localStorage.getItem(KEY);
    return id && PLAYERS.some((p) => p.id === id) ? id : null;
  } catch {
    return null;
  }
}

export function setMe(id: string | null) {
  try {
    if (id) localStorage.setItem(KEY, id);
    else localStorage.removeItem(KEY);
  } catch {
    /* navigation privée : l'identité ne sera pas retenue */
  }
}

/** Jeton secret de cet appareil pour les jeux en ligne (jamais affiché ni partagé). */
export function deviceToken(key = 'mobut-token'): string {
  try {
    let t = localStorage.getItem(key);
    if (!t) {
      t = crypto.randomUUID();
      localStorage.setItem(key, t);
    }
    return t;
  } catch {
    return crypto.randomUUID();
  }
}
