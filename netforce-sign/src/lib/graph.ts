/// <reference types="office-js" />
// Accès à la boîte mail par Microsoft Graph, depuis le volet Outlook.
// Sert de relais quand Outlook ne fournit pas les fonctions nécessaires (Outlook mobile) :
// lecture du contenu des pièces jointes, réponse avec pièces jointes.

import type { IPublicClientApplication } from '@azure/msal-browser';
import type { MailAttachment } from './outlook';

const clientId = import.meta.env.VITE_MS_CLIENT_ID as string | undefined;

/** Relais Graph disponible si l'app est enregistrée chez Microsoft (VITE_MS_CLIENT_ID). */
export const graphConfigured = !!clientId;

const SCOPES = ['Mail.ReadWrite', 'Mail.Send'];
const GRAPH = 'https://graph.microsoft.com/v1.0';
/** Au-delà, Graph impose une session d'envoi par morceaux. */
const SMALL_ATTACHMENT = 3 * 1024 * 1024;

let pca: Promise<IPublicClientApplication> | null = null;

/** Point d'injection pour les tests automatisés (aucun effet en production). */
declare global {
  interface Window {
    __nfGraphToken?: () => Promise<string>;
  }
}

async function accessToken(): Promise<string> {
  if (window.__nfGraphToken) return window.__nfGraphToken();
  if (!clientId) throw new Error('Microsoft Graph non configuré');
  pca ??= import('@azure/msal-browser').then(({ createNestablePublicClientApplication }) =>
    createNestablePublicClientApplication({
      auth: { clientId, authority: 'https://login.microsoftonline.com/common' },
    }),
  );
  const app = await pca;
  try {
    return (await app.acquireTokenSilent({ scopes: SCOPES })).accessToken;
  } catch {
    return (await app.acquireTokenPopup({ scopes: SCOPES })).accessToken;
  }
}

async function graph<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = await accessToken();
  const res = await fetch(path.startsWith('http') ? path : GRAPH + path, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...(init.headers ?? {}) },
  });
  if (!res.ok) {
    let detail = '';
    try {
      detail = (await res.json())?.error?.message ?? '';
    } catch {
      /* corps vide */
    }
    throw new Error(`Graph ${res.status}${detail ? ` : ${detail}` : ''}`);
  }
  return res.status === 202 || res.status === 204 ? (undefined as T) : res.json();
}

/** Identifiant REST du message ouvert (équivalent de mailbox.convertToRestId, disponible sur toutes les plateformes). */
function messageId(): string {
  const id = (Office.context.mailbox.item as Office.MessageRead).itemId;
  return id.replace(/\//g, '-').replace(/\+/g, '_');
}

const enc = encodeURIComponent;

interface GraphAttachment {
  id: string;
  name: string;
  size: number;
  contentBytes?: string;
}

function fromBase64(b64: string): ArrayBuffer {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes.buffer;
}

function toBase64(bytes: Uint8Array): string {
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

/** Contenu d'une pièce jointe du message ouvert, retrouvée par son nom (et sa taille en cas d'homonymes). */
export async function readAttachmentViaGraph(att: MailAttachment): Promise<ArrayBuffer> {
  const mid = messageId();
  const list = await graph<{ value: GraphAttachment[] }>(`/me/messages/${enc(mid)}/attachments?$select=id,name,size`);
  const same = list.value.filter((a) => a.name === att.name);
  const match = same.sort((a, b) => Math.abs(a.size - att.size) - Math.abs(b.size - att.size))[0];
  if (!match) throw new Error(`Pièce jointe introuvable : ${att.name}`);
  const full = await graph<GraphAttachment>(`/me/messages/${enc(mid)}/attachments/${enc(match.id)}`);
  if (!full.contentBytes) throw new Error('Pièce jointe vide');
  return fromBase64(full.contentBytes);
}

async function attach(draftId: string, file: { name: string; bytes: Uint8Array; mime: string }) {
  if (file.bytes.length < SMALL_ATTACHMENT) {
    await graph(`/me/messages/${enc(draftId)}/attachments`, {
      method: 'POST',
      body: JSON.stringify({
        '@odata.type': '#microsoft.graph.fileAttachment',
        name: file.name,
        contentType: file.mime,
        contentBytes: toBase64(file.bytes),
      }),
    });
    return;
  }
  // Gros fichier : session d'envoi, morceaux multiples de 320 Kio.
  const session = await graph<{ uploadUrl: string }>(`/me/messages/${enc(draftId)}/attachments/createUploadSession`, {
    method: 'POST',
    body: JSON.stringify({ AttachmentItem: { attachmentType: 'file', name: file.name, size: file.bytes.length } }),
  });
  const chunk = 320 * 1024 * 10;
  for (let start = 0; start < file.bytes.length; start += chunk) {
    const end = Math.min(start + chunk, file.bytes.length);
    const res = await fetch(session.uploadUrl, {
      method: 'PUT',
      headers: {
        'Content-Range': `bytes ${start}-${end - 1}/${file.bytes.length}`,
        'Content-Type': 'application/octet-stream',
      },
      body: file.bytes.slice(start, end),
    });
    if (!res.ok) throw new Error(`Envoi du fichier interrompu (${res.status})`);
  }
}

/** Répond au message ouvert avec les fichiers signés, puis envoie la réponse. */
export async function replyViaGraph(
  files: { name: string; bytes: Uint8Array; mime: string }[],
  { replyAll, comment }: { replyAll: boolean; comment: string },
): Promise<void> {
  const mid = messageId();
  const draft = await graph<{ id: string }>(`/me/messages/${enc(mid)}/${replyAll ? 'createReplyAll' : 'createReply'}`, {
    method: 'POST',
    body: JSON.stringify({ comment }),
  });
  for (const f of files) await attach(draft.id, f);
  await graph(`/me/messages/${enc(draft.id)}/send`, { method: 'POST' });
}
