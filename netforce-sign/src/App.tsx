import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import type { Asset, Kind, LoadedDoc, PageSize, Placement, Zone } from './types';
import { loadAsset, saveAsset } from './lib/assets';
import { fetchAssets, frError, logSignature, saveCloudAsset, sha256, updateFullName, type Profile } from './lib/cloud';
import HistoryModal from './components/HistoryModal';
import * as outlook from './lib/outlook';
import { baseName, downloadBlob, nextFrame, placementAt, placementFromZone } from './lib/util';
import AssetModal from './components/AssetModal';
import Brand from './components/Brand';
import PageOverlay from './components/PageOverlay';
import PdfView from './components/PdfView';
import DocxView from './components/DocxView';
import {
  IconBolt,
  IconCheck,
  IconChevron,
  IconDownload,
  IconFile,
  IconPen,
  IconPlus,
  IconStamp,
  IconTarget,
  IconUndo,
  IconReply,
  IconBack,
  IconUpload,
} from './components/Icons';

const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

type Pending = { type: 'zone'; zone: Zone } | { type: 'all' } | { type: 'arm' } | null;

export interface CloudContext {
  profile: Profile;
  onProfileChange: (p: Profile) => void;
  onSignOut: () => void;
}

interface SignedAttachment {
  file: { bytes: Uint8Array; name: string; mime: string };
  zones: Zone[];
  placements: Placement[];
}

const NO_STAMP = 'Cachet non défini (admin)';

export default function App({ cloud, inOutlook = outlook.inOutlookPane }: { cloud: CloudContext | null; inOutlook?: boolean }) {
  const ns = cloud?.profile.id;
  const isAdmin = !cloud || cloud.profile.role === 'admin';
  /** Le cachet est commun à l'entreprise : seuls les administrateurs le modifient. */
  const canEdit = (kind: Kind) => kind === 'signature' || isAdmin;
  const [doc, setDoc] = useState<LoadedDoc | null>(null);
  const [pdf, setPdf] = useState<PDFDocumentProxy | null>(null);
  const [sections, setSections] = useState<HTMLElement[]>([]);
  const [sizes, setSizes] = useState<PageSize[]>([]);
  const [zones, setZones] = useState<Zone[]>([]);
  const [placements, setPlacements] = useState<Placement[]>([]);
  const [history, setHistory] = useState<Placement[][]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [armed, setArmed] = useState<Kind | null>(null);
  const [assets, setAssets] = useState<Record<Kind, Asset | null>>(() => ({
    signature: loadAsset('signature', ns),
    stamp: loadAsset('stamp', ns),
  }));
  const [menuOpen, setMenuOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [mail, setMail] = useState<{ attachments: outlook.MailAttachment[]; canReply: boolean; error?: string } | null>(null);
  const [mailSlow, setMailSlow] = useState(false);
  /** Outlook : pièce jointe ouverte, et documents validés (seuls ceux-ci sont renvoyés). */
  const [current, setCurrent] = useState<outlook.MailAttachment | null>(null);
  const [signedDocs, setSignedDocs] = useState<Record<string, SignedAttachment>>({});
  const restoreRef = useRef<{ zones: Zone[]; placements: Placement[] } | null>(null);
  /** Pièces jointes qu'Outlook n'a pas pu transmettre (mobile) et fichiers choisis à la main pour les remplacer. */
  const [unreadable, setUnreadable] = useState<Record<string, true>>({});
  const manualSources = useRef<Record<string, ArrayBuffer>>({});
  const pickFor = useRef<outlook.MailAttachment | null>(null);
  const attachInput = useRef<HTMLInputElement>(null);
  const [modal, setModal] = useState<{ kind: Kind; pending: Pending } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [viewW, setViewW] = useState(800);

  const fileInput = useRef<HTMLInputElement>(null);
  const viewport = useRef<HTMLDivElement>(null);
  const docxHost = useRef<HTMLDivElement>(null);

  /* ---------- Synchronisation du compte ---------- */
  useEffect(() => {
    if (!cloud) return;
    let alive = true;
    fetchAssets(cloud.profile.id)
      .then((remote) => {
        if (!alive) return;
        // Première connexion sur cet appareil : on envoie la signature déjà créée en local.
        const legacy = loadAsset('signature');
        if (!remote.signature && legacy) {
          remote.signature = legacy;
          saveCloudAsset('signature', legacy).catch(() => null);
        }
        (['signature', 'stamp'] as Kind[]).forEach((k) => saveAsset(k, remote[k], cloud.profile.id));
        setAssets(remote);
      })
      .catch((e) => alive && setToast(`Signature et cachet non chargés : ${frError(e)}`));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cloud?.profile.id]);

  /* ---------- Mise en page ---------- */
  useEffect(() => {
    const el = viewport.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setViewW(Math.min(e.contentRect.width - 24, 900)));
    ro.observe(el);
    return () => ro.disconnect();
  }, [doc]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), toast.length > 60 ? 9000 : 3200);
    return () => clearTimeout(t);
  }, [toast]);

  /* ---------- Historique ---------- */
  const placementsRef = useRef(placements);
  placementsRef.current = placements;

  const snapshot = useCallback(() => {
    setHistory((h) => [...h.slice(-49), placementsRef.current]);
  }, []);

  const undo = useCallback(() => {
    if (!history.length) return;
    setPlacements(history[history.length - 1]);
    setHistory(history.slice(0, -1));
    setSelectedId(null);
  }, [history]);

  /* ---------- Ouverture ---------- */
  const reset = () => {
    setPdf(null);
    setSections([]);
    setSizes([]);
    setZones([]);
    setPlacements([]);
    setHistory([]);
    setSelectedId(null);
    setArmed(null);
  };

  const openFile = async (file: File) => {
    const lower = file.name.toLowerCase();
    const isPdf = file.type === 'application/pdf' || lower.endsWith('.pdf');
    const isDocx = file.type === DOCX_MIME || lower.endsWith('.docx');
    if (!isPdf && !isDocx) {
      setToast(lower.endsWith('.doc') ? 'Enregistrez le fichier en .docx' : 'PDF ou Word uniquement');
      return;
    }
    reset();
    setBusy('Analyse du document…');
    const bytes = await file.arrayBuffer();
    const next: LoadedDoc = { kind: isPdf ? 'pdf' : 'docx', name: file.name, bytes };
    setDoc(next);
    if (isPdf) {
      try {
        const { openPdf, getPageSizes, detectPdf } = await import('./lib/pdf');
        const p = await openPdf(bytes);
        const s = await getPageSizes(p);
        setPdf(p);
        setSizes(s);
        const restore = restoreRef.current;
        restoreRef.current = null;
        if (restore) {
          setZones(restore.zones);
          setPlacements(restore.placements);
        } else {
          const z = await detectPdf(p);
          setZones(z);
          announce(z);
        }
      } catch (e) {
        console.error(e);
        setDoc(null);
        setToast('PDF illisible');
      } finally {
        setBusy(null);
      }
    }
    // Word : la détection se fait une fois le rendu terminé (onDocxReady).
  };

  const announce = (z: Zone[]) => {
    if (!z.length) setToast('Aucune zone détectée');
  };


  const onDocxReady = useCallback(async (secs: HTMLElement[]) => {
    const { detectDocx, measurePages } = await import('./lib/docx');
    setSections(secs);
    setSizes(measurePages(secs));
    const restore = restoreRef.current;
    restoreRef.current = null;
    if (restore) {
      setZones(restore.zones);
      setPlacements(restore.placements);
    } else {
      const z = detectDocx(secs);
      setZones(z);
      announce(z);
    }
    setBusy(null);
  }, []);

  /* ---------- Placement ---------- */
  const filledZoneIds = useMemo(() => new Set(placements.map((p) => p.zoneId).filter(Boolean) as string[]), [placements]);
  const openZones = zones.filter((z) => !filledZoneIds.has(z.id));

  const placeZone = (zone: Zone, asset: Asset) => {
    const size = sizes[zone.page];
    if (!size) return;
    snapshot();
    const p = placementFromZone(zone, size, asset);
    setPlacements((cur) => [...cur, p]);
    setSelectedId(p.id);
  };

  const requestAsset = (kind: Kind, pending: Pending) => {
    if (canEdit(kind)) setModal({ kind, pending });
    else setToast(NO_STAMP);
  };

  const fillAll = (current = assets) => {
    let todo = zones.filter((z) => !filledZoneIds.has(z.id));
    const missing = (['signature', 'stamp'] as Kind[]).find(
      (k) => !current[k] && canEdit(k) && todo.some((z) => z.kind === k),
    );
    if (missing) {
      setModal({ kind: missing, pending: { type: 'all' } });
      return;
    }
    if (todo.some((z) => !current[z.kind])) {
      setToast(NO_STAMP);
      todo = todo.filter((z) => current[z.kind]);
    }
    if (!todo.length) return;
    snapshot();
    setPlacements((cur) => [...cur, ...todo.map((z) => placementFromZone(z, sizes[z.page], current[z.kind]!))]);
    setSelectedId(null);
  };

  const onZoneClick = (zone: Zone) => {
    const asset = assets[zone.kind];
    if (!asset) requestAsset(zone.kind, { type: 'zone', zone });
    else placeZone(zone, asset);
  };

  const arm = (kind: Kind) => {
    if (!assets[kind]) {
      requestAsset(kind, { type: 'arm' });
      return;
    }
    setArmed((a) => (a === kind ? null : kind));
    setSelectedId(null);
    setSheetOpen(false);
  };

  const onPlaceAt = (page: number, fx: number, fy: number) => {
    if (!armed || !assets[armed] || !sizes[page]) return;
    snapshot();
    const p = placementAt(page, fx, fy, sizes[page], assets[armed]!, armed);
    setPlacements((cur) => [...cur, p]);
    setSelectedId(p.id);
    setArmed(null);
  };

  const onChange = useCallback((id: string, patch: Partial<Placement>) => {
    setPlacements((cur) => cur.map((p) => (p.id === id ? { ...p, ...patch } : p)));
  }, []);

  const onDelete = useCallback(
    (id: string) => {
      snapshot();
      setPlacements((cur) => cur.filter((p) => p.id !== id));
      setSelectedId(null);
    },
    [snapshot],
  );

  /** Enregistre l'image ; en mode compte, l'échec en ligne est remonté à la fenêtre (qui reste ouverte). */
  const onSaveAsset = async (asset: Asset) => {
    if (!modal) return;
    const kind = modal.kind;
    if (cloud) await saveCloudAsset(kind, asset);
    const nextAssets = { ...assets, [kind]: asset };
    setAssets(nextAssets);
    saveAsset(kind, asset, ns);
    // Les éléments déjà posés adoptent la nouvelle version.
    setPlacements((cur) =>
      cur.map((p) => {
        if (p.kind !== kind) return p;
        const size = sizes[p.page];
        if (!size) return p;
        const h = (p.w * size.width) / asset.ratio / size.height;
        return { ...p, src: asset.src, ratio: asset.ratio, h };
      }),
    );
    const pending = modal.pending;
    setModal(null);
    if (pending?.type === 'zone') placeZone(pending.zone, asset);
    else if (pending?.type === 'all') setTimeout(() => fillAll(nextAssets), 0);
    else if (pending?.type === 'arm') {
      setArmed(kind);
      setSheetOpen(false);
    }
  };

  /* ---------- Clavier ---------- */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (modal) return;
      const t = e.target as HTMLElement;
      if (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA') return;
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        undo();
      } else if (e.key === 'Escape') {
        setArmed(null);
        setSelectedId(null);
      } else if (selectedId && (e.key === 'Delete' || e.key === 'Backspace')) {
        e.preventDefault();
        onDelete(selectedId);
      } else if (selectedId && e.key.startsWith('Arrow')) {
        e.preventDefault();
        const step = e.shiftKey ? 0.01 : 0.002;
        const p = placements.find((x) => x.id === selectedId);
        if (!p) return;
        const dx = e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0;
        const dy = e.key === 'ArrowUp' ? -step : e.key === 'ArrowDown' ? step : 0;
        onChange(selectedId, { x: p.x + dx, y: p.y + dy * (sizes[p.page] ? sizes[p.page].width / sizes[p.page].height : 1) });
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [modal, selectedId, placements, sizes, undo, onDelete, onChange]);

  /* ---------- Export ---------- */
  /** Produit le document signé (sans le télécharger). */
  const buildSigned = async (format: 'pdf' | 'docx'): Promise<{ bytes: Uint8Array; name: string; mime: string }> => {
    const d = doc!;
    const name = `${baseName(d.name)}_signe.${format}`;
    const mime = format === 'pdf' ? 'application/pdf' : DOCX_MIME;
    const toBytes = async (b: Blob | Uint8Array) => (b instanceof Blob ? new Uint8Array(await b.arrayBuffer()) : b);
    if (d.kind === 'pdf') {
      const lib = await import('./lib/pdf');
      if (format === 'pdf') return { bytes: await lib.exportPdf(d.bytes, placements), name, mime };
      const { docxFromImages } = await import('./lib/docx');
      return { bytes: await toBytes(await docxFromImages(await lib.rasterizePdf(pdf!, placements))), name, mime };
    }
    const lib = await import('./lib/docx');
    if (format === 'docx') return { bytes: await toBytes(await lib.exportDocx(d.bytes, placements, sections)), name, mime };
    return { bytes: await lib.exportPdfFromDocx(sections, docxHost.current!), name, mime };
  };

  const logExport = (format: 'pdf' | 'docx') => {
    if (!cloud || !doc) return;
    const d = doc;
    sha256(d.bytes)
      .then((hash) =>
        logSignature({
          document_name: d.name.slice(0, 300),
          document_kind: d.kind,
          export_format: format,
          document_sha256: hash,
          page_count: sizes.length,
          signature_count: placements.filter((p) => p.kind === 'signature').length,
          stamp_count: placements.filter((p) => p.kind === 'stamp').length,
        }),
      )
      .catch((e) => console.warn('Historique non enregistré', e));
  };

  const runExport = async (format: 'pdf' | 'docx', deliver: (file: { bytes: Uint8Array; name: string; mime: string }) => Promise<void> | void) => {
    if (!doc) return;
    setSelectedId(null);
    setArmed(null);
    setSheetOpen(false);
    setBusy(format === 'pdf' ? 'Génération du PDF…' : 'Génération du document Word…');
    document.body.classList.add('nf-exporting');
    await nextFrame();
    try {
      await deliver(await buildSigned(format));
      logExport(format);
    } catch (e) {
      console.error(e);
      setToast('Échec de l’export');
    } finally {
      document.body.classList.remove('nf-exporting');
      setBusy(null);
    }
  };

  const exportAs = (format: 'pdf' | 'docx') => runExport(format, (f) => downloadBlob(f.bytes, f.name, f.mime));

  /* ---------- Outlook ---------- */
  const openWithBytes = async (a: outlook.MailAttachment, bytes: ArrayBuffer) => {
    const prev = signedDocs[a.id];
    restoreRef.current = prev ? { zones: prev.zones, placements: prev.placements } : null;
    setCurrent(a);
    await openFile(new File([bytes], a.name, { type: a.kind === 'pdf' ? 'application/pdf' : DOCX_MIME }));
  };

  const openAttachment = async (a: outlook.MailAttachment) => {
    const manual = manualSources.current[a.id];
    if (manual) return openWithBytes(a, manual);
    try {
      setBusy('Ouverture…');
      await openWithBytes(a, await outlook.readAttachment(a.id));
    } catch (e) {
      console.error(e);
      restoreRef.current = null;
      setCurrent(null);
      setBusy(null);
      setUnreadable((u) => ({ ...u, [a.id]: true }));
      setToast(`Outlook n’a pas transmis ce fichier — ${(e as Error)?.message ?? e}`);
    }
  };

  /** Plan B mobile : l'utilisateur choisit le fichier enregistré depuis Outlook. */
  const pickManually = (a: outlook.MailAttachment) => {
    pickFor.current = a;
    attachInput.current?.click();
  };

  const onManualFile = async (file: File) => {
    const a = pickFor.current;
    pickFor.current = null;
    if (!a) return;
    const bytes = await file.arrayBuffer();
    manualSources.current[a.id] = bytes;
    setUnreadable(({ [a.id]: _done, ...rest }) => rest);
    await openWithBytes(a, bytes);
  };

  const backToList = () => {
    setDoc(null);
    reset();
    setCurrent(null);
  };

  /** Enregistre l'état du document ouvert : signé s'il porte au moins une signature ou un cachet, sinon retiré de l'envoi. */
  const validateCurrent = async () => {
    if (!current || !doc) return backToList();
    const id = current.id;
    if (!placements.length) {
      setSignedDocs(({ [id]: _drop, ...rest }) => rest);
      return backToList();
    }
    setSelectedId(null);
    setArmed(null);
    setBusy('Validation…');
    document.body.classList.add('nf-exporting');
    await nextFrame();
    try {
      const file = await buildSigned(doc.kind);
      setSignedDocs((cur) => ({ ...cur, [id]: { file, zones, placements } }));
      logExport(doc.kind);
      backToList();
    } catch (e) {
      console.error(e);
      setToast('Échec de la validation');
    } finally {
      document.body.classList.remove('nf-exporting');
      setBusy(null);
    }
  };

  const signedList = (mail?.attachments ?? []).filter((a) => signedDocs[a.id]);

  const replyWithSigned = async (replyAll: boolean) => {
    if (!signedList.length) return;
    try {
      await outlook.replyWithFiles(
        signedList.map((a) => signedDocs[a.id].file),
        replyAll,
      );
    } catch (e) {
      console.error(e);
      setToast('Réponse impossible');
    }
  };

  /** Sans réponse automatique (Outlook mobile) : feuille de partage du système si possible, sinon téléchargement. */
  const shareSigned = async () => {
    const files = signedList.map((a) => signedDocs[a.id].file);
    const shareFiles = files.map((f) => new File([f.bytes as Uint8Array<ArrayBuffer>], f.name, { type: f.mime }));
    try {
      if (navigator.canShare?.({ files: shareFiles })) {
        await navigator.share({ files: shareFiles });
        return;
      }
    } catch (e) {
      if ((e as Error)?.name === 'AbortError') return;
      console.warn('Partage indisponible', e);
    }
    files.forEach((f) => downloadBlob(f.bytes, f.name, f.mime));
  };

  useEffect(() => {
    if (!inOutlook) return;
    let off = () => undefined as void;
    const fail = (e: unknown) =>
      setMail({ attachments: [], canReply: false, error: `${(e as Error)?.message ?? String(e)} (${outlook.describeHost()})` });
    const load = () => {
      try {
        if (!outlook.canReadAttachments()) {
          setMail({ attachments: [], canReply: false, error: `Version d’Outlook trop ancienne (${outlook.describeHost()})` });
          return;
        }
        const attachments = outlook.listAttachments();
        setMail({ attachments, canReply: outlook.canReplyWithFile() });
        return attachments;
      } catch (e) {
        console.error(e);
        fail(e);
      }
    };
    const slow = setTimeout(() => setMailSlow(true), 10000);
    if (typeof Office === 'undefined') {
      fail(new Error('Outlook n’a pas chargé le complément'));
      return () => clearTimeout(slow);
    }
    outlook
      .outlookReady()
      .then((ok) => {
        clearTimeout(slow);
        setMailSlow(false);
        if (!ok) return fail(new Error('Ouvrez ce volet depuis un mail dans Outlook'));
        const first = load();
        if (first?.length === 1) openAttachment(first[0]);
        try {
          off = outlook.onItemChanged(() => {
            backToList();
            setSignedDocs({});
            setUnreadable({});
            manualSources.current = {};
            const next = load();
            if (next?.length === 1) openAttachment(next[0]);
          });
        } catch (e) {
          console.warn('Suivi du message indisponible', e);
        }
      })
      .catch(fail);
    return () => {
      clearTimeout(slow);
      off();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inOutlook]);

  /* ---------- Rendu ---------- */
  const overlay = (page: number) =>
    sizes[page] ? (
      <PageOverlay
        page={page}
        size={sizes[page]}
        zones={zones.filter((z) => z.page === page)}
        placements={placements.filter((p) => p.page === page)}
        assets={assets}
        armed={armed}
        selectedId={selectedId}
        filledZoneIds={filledZoneIds}
        onZoneClick={onZoneClick}
        onPlaceAt={onPlaceAt}
        onSelect={setSelectedId}
        onChange={onChange}
        onBeginEdit={snapshot}
        onDelete={onDelete}
      />
    ) : null;

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const f = e.dataTransfer.files?.[0];
    if (f) openFile(f);
  };

  const scrollToZone = (z: Zone) => {
    document.getElementById(`zone-${z.id}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    setSheetOpen(false);
  };

  const assetCard = (kind: Kind) => {
    const a = assets[kind];
    const isSig = kind === 'signature';
    return (
      <div className="asset-card">
        <div className="asset-head">
          {isSig ? <IconPen /> : <IconStamp />}
          <span>{isSig ? 'Signature' : 'Cachet'}</span>
          {canEdit(kind) ? (
            <button className="link" onClick={() => setModal({ kind, pending: null })}>
              {a ? 'Modifier' : 'Ajouter'}
            </button>
          ) : (
            <span className="asset-note">Équipe</span>
          )}
        </div>
        <button className="asset-preview checker" onClick={() => (a ? arm(kind) : requestAsset(kind, null))}>
          {a ? <img src={a.src} alt="" /> : <IconPlus width={20} height={20} />}
        </button>
        {doc && (
          <button className={`btn small ${armed === kind ? 'primary' : 'outline'}`} onClick={() => arm(kind)}>
            <IconPlus width={16} height={16} />
            {armed === kind ? 'Cliquez sur la page' : 'Placer'}
          </button>
        )}
      </div>
    );
  };

  return (
    <div
      className={`app ${doc ? 'has-doc' : ''} ${inOutlook ? 'outlook' : ''}`}
      onDragOver={(e) => {
        e.preventDefault();
        setDragOver(true);
      }}
      onDragLeave={(e) => e.currentTarget === e.target && setDragOver(false)}
      onDrop={onDrop}
    >
      <header className="topbar">
        {inOutlook && doc ? (
          <button className="ol-back" onClick={validateCurrent} aria-label="Retour aux pièces jointes">
            <IconBack width={18} height={18} /> Documents
          </button>
        ) : (
          <Brand />
        )}
        {doc && !inOutlook && (
          <div className="doc-name" title={doc.name}>
            <IconFile width={16} height={16} />
            <span>{doc.name}</span>
          </div>
        )}
        <div className="top-actions">
          {cloud && (
            <UserMenu
              cloud={cloud}
              open={menuOpen}
              onToggle={() => setMenuOpen((o) => !o)}
              onHistory={() => {
                setMenuOpen(false);
                setHistoryOpen(true);
              }}
            />
          )}
          {doc && (
            <>
              <button className="icon-btn" onClick={undo} disabled={!history.length} title="Annuler (Ctrl+Z)" aria-label="Annuler">
                <IconUndo />
              </button>
            </>
          )}
        </div>
      </header>

      <input
        ref={fileInput}
        type="file"
        accept=".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
        hidden
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) openFile(f);
          e.target.value = '';
        }}
      />

      {!doc ? (
        <main className="landing">
          <div className="landing-inner">
            {inOutlook ? (
              <div className="ol-list">
                <h2 className="ol-title">
                  Pièces jointes {mail && <span className="count">{mail.attachments.length}</span>}
                </h2>
                {!mail && (
                  <div className="ol-wait">
                    <div className="spinner small" />
                    <span>Connexion à Outlook…</span>
                    {mailSlow && (
                      <>
                        <button className="btn outline small" onClick={() => window.location.reload()}>
                          Réessayer
                        </button>
                        <details className="ol-diag" open>
                          <summary>Détails techniques</summary>
                          <ul>
                            {outlook.diagnostics().map((d, i) => (
                              <li key={i}>{d}</li>
                            ))}
                          </ul>
                        </details>
                      </>
                    )}
                  </div>
                )}
                {mail?.error && (
                  <div className="form-error">
                    {mail.error}
                    <button className="link ol-retry" onClick={() => window.location.reload()}>
                      Réessayer
                    </button>
                  </div>
                )}
                {mail && !mail.error && mail.attachments.length === 0 && <p className="muted">Aucun PDF ou Word dans ce mail</p>}
                {mail?.attachments.map((a) => {
                  const done = !!signedDocs[a.id];
                  return (
                    <div key={a.id} className="mail-entry">
                      <button className={`mail-file ${done ? 'done' : ''}`} onClick={() => openAttachment(a)}>
                        <IconFile width={18} height={18} />
                        <span>{a.name}</span>
                        {done ? (
                          <em className="status ok">
                            <IconCheck width={14} height={14} /> Signé
                          </em>
                        ) : (
                          <em className="status">À signer</em>
                        )}
                      </button>
                      {unreadable[a.id] && !done && (
                        <div className="mail-fallback">
                          <span>Enregistrez la pièce jointe depuis Outlook, puis choisissez-la ici.</span>
                          <button className="btn outline small" onClick={() => pickManually(a)}>
                            <IconUpload width={14} height={14} /> Choisir le fichier
                          </button>
                        </div>
                      )}
                    </div>
                  );
                })}
                <input
                  ref={attachInput}
                  type="file"
                  accept=".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                  hidden
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) onManualFile(f);
                    e.target.value = '';
                  }}
                />
              </div>
            ) : (
              <button className={`dropzone ${dragOver ? 'over' : ''}`} onClick={() => fileInput.current?.click()}>
                <IconUpload width={26} height={26} />
                <strong>Ouvrir un document</strong>
                <span>PDF · Word</span>
              </button>
            )}
            <div className="landing-assets">
              {assetCard('signature')}
              {assetCard('stamp')}
            </div>
          </div>
          {inOutlook && mail && mail.attachments.length > 0 && (
            <div className="ol-bar">
              {mail.canReply ? (
                <>
                  <button className="btn primary" onClick={() => replyWithSigned(false)} disabled={!signedList.length}>
                    <IconReply width={16} height={16} /> Répondre{signedList.length ? ` (${signedList.length})` : ''}
                  </button>
                  <button className="btn outline" onClick={() => replyWithSigned(true)} disabled={!signedList.length}>
                    Répondre à tous
                  </button>
                </>
              ) : (
                <button className="btn primary" onClick={shareSigned} disabled={!signedList.length}>
                  <IconDownload width={16} height={16} /> Envoyer les fichiers{signedList.length ? ` (${signedList.length})` : ''}
                </button>
              )}
            </div>
          )}
        </main>
      ) : (
        <div className="workspace">
          <div ref={viewport} className={`viewport ${armed ? 'is-armed' : ''}`} onPointerDown={(e) => e.target === e.currentTarget && setSelectedId(null)}>
            {armed && (
              <div className="armed-banner">
                Cliquez sur la page
                <button className="link" onClick={() => setArmed(null)}>
                  Annuler
                </button>
              </div>
            )}
            {doc.kind === 'pdf' && pdf && <PdfView pdf={pdf} sizes={sizes} width={viewW} renderOverlay={overlay} />}
            {doc.kind === 'docx' && (
              <DocxView
                key={doc.name + doc.bytes.byteLength}
                bytes={doc.bytes}
                width={viewW}
                hostRef={docxHost}
                onReady={onDocxReady}
                onError={(e) => {
                  console.error(e);
                  setBusy(null);
                  setDoc(null);
                  setToast('Document Word illisible');
                }}
              />
            )}
            {doc.kind === 'docx' && sections.map((s, i) => createPortal(overlay(i), s, `ov-${i}`))}
          </div>

          {inOutlook && (
            <div className="ol-bar">
              <button className={`icon-btn ${armed === 'signature' ? 'on' : ''}`} onClick={() => arm('signature')} aria-label="Placer la signature" title="Placer la signature">
                <IconPen />
              </button>
              <button className={`icon-btn ${armed === 'stamp' ? 'on' : ''}`} onClick={() => arm('stamp')} aria-label="Placer le cachet" title="Placer le cachet">
                <IconStamp />
              </button>
              <button className="btn outline" onClick={() => fillAll()} disabled={!openZones.length}>
                <IconBolt width={16} height={16} /> Tout signer{openZones.length ? ` (${openZones.length})` : ''}
              </button>
              <button className="btn primary" onClick={validateCurrent} disabled={!!busy}>
                <IconCheck width={16} height={16} /> Valider
              </button>
            </div>
          )}

          <aside className={`panel ${sheetOpen ? 'open' : ''}`} hidden={inOutlook}>
            <button className="sheet-handle" onClick={() => setSheetOpen((o) => !o)} aria-label="Afficher le panneau">
              <span />
            </button>

            <div className="quick">
              <button className="btn primary" onClick={() => fillAll()} disabled={!openZones.length}>
                <IconBolt width={16} height={16} />
                {openZones.length ? `Tout signer (${openZones.length})` : 'Tout est signé'}
              </button>
              <button className="icon-btn show-mobile" onClick={() => arm('signature')} aria-label="Placer la signature">
                <IconPen />
              </button>
              <button className="icon-btn show-mobile" onClick={() => arm('stamp')} aria-label="Placer le cachet">
                <IconStamp />
              </button>
              <button className="icon-btn show-mobile" onClick={() => setSheetOpen((o) => !o)} aria-label="Plus d'options">
                <IconChevron style={{ transform: sheetOpen ? 'rotate(180deg)' : undefined }} />
              </button>
            </div>

            <div className="panel-body">
              <section>
                <h3>
                  Zones <span className="count">{zones.length}</span>
                </h3>
                {zones.length === 0 ? null : (
                  <ul className="zone-list">
                    {zones.map((z) => {
                      const done = filledZoneIds.has(z.id);
                      return (
                        <li key={z.id}>
                          <button onClick={() => (done ? undefined : scrollToZone(z))} className={done ? 'done' : ''}>
                            {z.kind === 'signature' ? <IconPen width={16} height={16} /> : <IconStamp width={16} height={16} />}
                            <span className="zl-label">{z.source === 'field' ? 'Champ de signature' : z.label}</span>
                            <span className="zl-page">p. {z.page + 1}</span>
                            {done ? <IconCheck width={16} height={16} className="ok" /> : <IconTarget width={16} height={16} />}
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </section>

              <section className="assets">
                {assetCard('signature')}
                {assetCard('stamp')}
              </section>

              <section className="export">
                <h3>Télécharger</h3>
                <div className="export-row">
                  <button className="btn primary" onClick={() => exportAs('pdf')} disabled={!!busy}>
                    <IconDownload width={16} height={16} /> PDF
                  </button>
                  <button className="btn primary" onClick={() => exportAs('docx')} disabled={!!busy}>
                    <IconDownload width={16} height={16} /> Word
                  </button>
                </div>
                <button
                  className="btn outline small"
                  onClick={() => {
                    if (inOutlook) {
                      setDoc(null);
                      reset();
                    } else fileInput.current?.click();
                  }}
                >
                  Autre document
                </button>
              </section>
            </div>
          </aside>
        </div>
      )}

      {dragOver && (
        <div className="drop-veil">
          <IconUpload width={40} height={40} />
          Déposez votre PDF ou Word
        </div>
      )}

      {busy && (
        <div className="busy">
          <div className="spinner" />
          {busy}
        </div>
      )}

      {toast && <div className="toast">{toast}</div>}

      {historyOpen && <HistoryModal isAdmin={!!cloud && cloud.profile.role === 'admin'} onClose={() => setHistoryOpen(false)} />}

      {modal && <AssetModal kind={modal.kind} current={assets[modal.kind]} onSave={onSaveAsset} onClose={() => setModal(null)} />}
    </div>
  );
}

function UserMenu({
  cloud,
  open,
  onToggle,
  onHistory,
}: {
  cloud: CloudContext;
  open: boolean;
  onToggle: () => void;
  onHistory: () => void;
}) {
  const { profile } = cloud;
  const name = profile.full_name || profile.email;
  const initials = name
    .split(/[\s.@_-]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join('');
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(profile.full_name ?? '');

  const saveName = async () => {
    const v = draft.trim();
    if (!v) return;
    try {
      await updateFullName(profile.id, v);
      cloud.onProfileChange({ ...profile, full_name: v });
      setEditing(false);
    } catch {
      /* hors ligne : on garde le formulaire ouvert */
    }
  };

  return (
    <div className="user-menu">
      <button className="avatar" onClick={onToggle} aria-label="Mon compte" aria-expanded={open}>
        {initials}
      </button>
      {open && (
        <>
          <div className="menu-veil" onPointerDown={onToggle} />
          <div className="menu" role="menu">
            <div className="menu-id">
              {editing ? (
                <form
                  className="name-form"
                  onSubmit={(e) => {
                    e.preventDefault();
                    saveName();
                  }}
                >
                  <input className="field" value={draft} autoFocus onChange={(e) => setDraft(e.target.value)} placeholder="Prénom Nom" />
                  <button className="btn primary small">OK</button>
                </form>
              ) : (
                <button className="menu-name" onClick={() => setEditing(true)} title="Modifier mon nom">
                  {name}
                </button>
              )}
              <span className="menu-email">{profile.email}</span>
              {profile.role === 'admin' && <span className="tag">Administrateur</span>}
            </div>
            <button className="menu-item" role="menuitem" onClick={onHistory}>
              {profile.role === 'admin' ? 'Historique de l’équipe' : 'Mon historique'}
            </button>
            <button className="menu-item danger" role="menuitem" onClick={cloud.onSignOut}>
              Se déconnecter
            </button>
          </div>
        </>
      )}
    </div>
  );
}
