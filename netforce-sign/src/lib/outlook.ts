/// <reference types="office-js" />
// Intégration Outlook : l'app tourne dans le volet du complément (taskpane.html).

import type { DocKind } from '../types';

/** Vrai quand la page est chargée comme volet de complément Outlook. */
export const inOutlookPane = /\/taskpane\.html$/.test(window.location.pathname);

export interface MailAttachment {
  id: string;
  name: string;
  size: number;
  kind: DocKind;
}

const officeLoaded = () => typeof Office !== 'undefined' && !!Office.onReady;

let ready: Promise<boolean> | null = null;

/**
 * Attend l'initialisation d'Office.js. Ne renvoie `false` que si Office.js est absent ou si l'hôte n'est pas Outlook :
 * Outlook mobile peut mettre plusieurs secondes à répondre au premier lancement, on attend donc sans limite.
 */
export function outlookReady(): Promise<boolean> {
  if (!inOutlookPane || !officeLoaded()) return Promise.resolve(false);
  ready ??= new Promise((resolve) => {
    Office.onReady((info) => {
      // Certaines versions mobiles renseignent mal `host` : la présence d'une boîte mail suffit.
      resolve(info.host === Office.HostType.Outlook || !!Office.context?.mailbox);
    });
  });
  return ready;
}

/** Description courte de l'environnement Outlook, affichée en cas de problème. */
export function describeHost(): string {
  try {
    const d = Office.context.diagnostics;
    const sets = ['1.15', '1.8', '1.5'].find((v) => Office.context.requirements.isSetSupported('Mailbox', v)) ?? '< 1.5';
    return `${d?.platform ?? '?'} · ${d?.version ?? '?'} · Mailbox ${sets}`;
  } catch {
    return typeof Office === 'undefined' ? 'Office.js non chargé' : 'Outlook';
  }
}

const mailbox = () => Office.context.mailbox;

function kindOf(name: string, contentType?: string): DocKind | null {
  const n = name.toLowerCase();
  if (n.endsWith('.pdf') || contentType === 'application/pdf') return 'pdf';
  if (n.endsWith('.docx') || contentType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') return 'docx';
  return null;
}

/** Version d'Outlook capable de lire le contenu des pièces jointes. */
export function canReadAttachments() {
  return Office.context.requirements.isSetSupported('Mailbox', '1.8');
}

/** Version d'Outlook capable de joindre un fichier à une réponse (Mailbox 1.15). */
export function canReplyWithFile() {
  return Office.context.requirements.isSetSupported('Mailbox', '1.15');
}

/** Pièces jointes PDF / Word du message ouvert (hors images intégrées). */
export function listAttachments(): MailAttachment[] {
  const item = mailbox()?.item as Office.MessageRead | undefined;
  if (!item?.attachments) return [];
  return item.attachments
    .filter((a) => a.attachmentType === Office.MailboxEnums.AttachmentType.File && !a.isInline)
    .map((a) => ({ id: a.id, name: a.name, size: a.size, kind: kindOf(a.name, a.contentType) }))
    .filter((a): a is MailAttachment => a.kind !== null);
}

export function readAttachment(id: string): Promise<ArrayBuffer> {
  return new Promise((resolve, reject) => {
    const item = mailbox().item as Office.MessageRead;
    item.getAttachmentContentAsync(id, (res) => {
      if (res.status !== Office.AsyncResultStatus.Succeeded) return reject(new Error(res.error?.message ?? 'Pièce jointe illisible'));
      const { content, format } = res.value;
      if (format !== Office.MailboxEnums.AttachmentContentFormat.Base64) return reject(new Error('Format de pièce jointe non pris en charge'));
      const bin = atob(content);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      resolve(bytes.buffer);
    });
  });
}

function toBase64(bytes: Uint8Array): string {
  let bin = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) bin += String.fromCharCode(...bytes.subarray(i, i + chunk));
  return btoa(bin);
}

/** Ouvre une réponse (ou « répondre à tous ») avec les documents signés en pièces jointes. */
export function replyWithFiles(files: { name: string; bytes: Uint8Array }[], replyAll = false): Promise<void> {
  return new Promise((resolve, reject) => {
    const item = mailbox().item as Office.MessageRead;
    const form: Office.ReplyFormData = {
      htmlBody: '',
      attachments: files.map((f) => ({
        type: Office.MailboxEnums.AttachmentType.Base64,
        name: f.name,
        base64file: toBase64(f.bytes),
      })),
    };
    const done = (res: Office.AsyncResult<void>) =>
      res.status === Office.AsyncResultStatus.Succeeded ? resolve() : reject(new Error(res.error?.message ?? 'Réponse impossible'));
    if (replyAll) item.displayReplyAllFormAsync(form, done);
    else item.displayReplyFormAsync(form, done);
  });
}

/** Volet épinglé : prévient quand l'utilisateur ouvre un autre message. */
export function onItemChanged(cb: () => void): () => void {
  const mb = mailbox();
  if (!mb?.addHandlerAsync) return () => undefined;
  mb.addHandlerAsync(Office.EventType.ItemChanged, cb);
  return () => mb.removeHandlerAsync(Office.EventType.ItemChanged);
}
