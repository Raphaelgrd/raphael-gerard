import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import type { Asset, Kind, LoadedDoc, PageSize, Placement, Zone } from './types';
import { loadAsset, saveAsset } from './lib/assets';
import { baseName, downloadBlob, nextFrame, placementAt, placementFromZone } from './lib/util';
import AssetModal from './components/AssetModal';
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
  IconUpload,
} from './components/Icons';

const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

type Pending = { type: 'zone'; zone: Zone } | { type: 'all' } | { type: 'arm' } | null;

export default function App() {
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
    signature: loadAsset('signature'),
    stamp: loadAsset('stamp'),
  }));
  const [modal, setModal] = useState<{ kind: Kind; pending: Pending } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [viewW, setViewW] = useState(800);

  const fileInput = useRef<HTMLInputElement>(null);
  const viewport = useRef<HTMLDivElement>(null);
  const docxHost = useRef<HTMLDivElement>(null);

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
    const t = setTimeout(() => setToast(null), 3200);
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
      setToast(lower.endsWith('.doc') ? 'Format .doc ancien : enregistrez-le en .docx depuis Word.' : 'Formats acceptés : PDF et Word (.docx).');
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
        const z = await detectPdf(p);
        setZones(z);
        announce(z);
      } catch (e) {
        console.error(e);
        setDoc(null);
        setToast('Impossible de lire ce PDF (protégé ou endommagé).');
      } finally {
        setBusy(null);
      }
    }
    // Word : la détection se fait une fois le rendu terminé (onDocxReady).
  };

  const announce = (z: Zone[]) => {
    const s = z.filter((x) => x.kind === 'signature').length;
    const c = z.filter((x) => x.kind === 'stamp').length;
    if (!z.length) setToast('Aucune zone détectée. Ajoutez votre signature manuellement.');
    else
      setToast(
        [s && `${s} zone${s > 1 ? 's' : ''} de signature`, c && `${c} zone${c > 1 ? 's' : ''} de cachet`]
          .filter(Boolean)
          .join(' · ') + ' détectée' + (z.length > 1 ? 's' : '') + '.',
      );
  };

  const onDocxReady = useCallback(async (secs: HTMLElement[]) => {
    const { detectDocx, measurePages } = await import('./lib/docx');
    setSections(secs);
    setSizes(measurePages(secs));
    const z = detectDocx(secs);
    setZones(z);
    announce(z);
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

  const fillAll = (current = assets) => {
    const todo = zones.filter((z) => !filledZoneIds.has(z.id));
    const missing = (['signature', 'stamp'] as Kind[]).find((k) => !current[k] && todo.some((z) => z.kind === k));
    if (missing) {
      setModal({ kind: missing, pending: { type: 'all' } });
      return;
    }
    if (!todo.length) return;
    snapshot();
    setPlacements((cur) => [...cur, ...todo.map((z) => placementFromZone(z, sizes[z.page], current[z.kind]!))]);
    setSelectedId(null);
    setToast(`${todo.length} élément${todo.length > 1 ? 's' : ''} apposé${todo.length > 1 ? 's' : ''}. Ajustez si besoin.`);
  };

  const onZoneClick = (zone: Zone) => {
    const asset = assets[zone.kind];
    if (!asset) setModal({ kind: zone.kind, pending: { type: 'zone', zone } });
    else placeZone(zone, asset);
  };

  const arm = (kind: Kind) => {
    if (!assets[kind]) {
      setModal({ kind, pending: { type: 'arm' } });
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

  const onSaveAsset = (asset: Asset) => {
    if (!modal) return;
    const kind = modal.kind;
    const nextAssets = { ...assets, [kind]: asset };
    setAssets(nextAssets);
    saveAsset(kind, asset);
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
  const exportAs = async (format: 'pdf' | 'docx') => {
    if (!doc) return;
    setSelectedId(null);
    setArmed(null);
    setSheetOpen(false);
    setBusy(format === 'pdf' ? 'Génération du PDF…' : 'Génération du document Word…');
    document.body.classList.add('nf-exporting');
    await nextFrame();
    try {
      const name = `${baseName(doc.name)}_signe.${format}`;
      if (doc.kind === 'pdf') {
        const lib = await import('./lib/pdf');
        if (format === 'pdf') {
          downloadBlob(await lib.exportPdf(doc.bytes, placements), name, 'application/pdf');
        } else {
          const { docxFromImages } = await import('./lib/docx');
          const pages = await lib.rasterizePdf(pdf!, placements);
          downloadBlob(await docxFromImages(pages), name, DOCX_MIME);
        }
      } else {
        const lib = await import('./lib/docx');
        if (format === 'docx') {
          downloadBlob(await lib.exportDocx(doc.bytes, placements, sections), name, DOCX_MIME);
        } else {
          downloadBlob(await lib.exportPdfFromDocx(sections, docxHost.current!), name, 'application/pdf');
        }
      }
      setToast('Document téléchargé.');
    } catch (e) {
      console.error(e);
      setToast("L'export a échoué. Réessayez ou changez de format.");
    } finally {
      document.body.classList.remove('nf-exporting');
      setBusy(null);
    }
  };

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
          <span>{isSig ? 'Ma signature' : 'Mon cachet'}</span>
          <button className="link" onClick={() => setModal({ kind, pending: null })}>
            {a ? 'Modifier' : 'Créer'}
          </button>
        </div>
        <button className="asset-preview checker" onClick={() => (a ? arm(kind) : setModal({ kind, pending: null }))}>
          {a ? <img src={a.src} alt="" /> : <span>{isSig ? 'Aucune signature' : 'Aucun cachet'}</span>}
        </button>
        {doc && (
          <button className={`btn small ${armed === kind ? 'primary' : 'outline'}`} onClick={() => arm(kind)}>
            <IconPlus width={16} height={16} />
            {armed === kind ? 'Cliquez sur la page…' : isSig ? 'Placer librement' : 'Placer le cachet'}
          </button>
        )}
      </div>
    );
  };

  return (
    <div
      className={`app ${doc ? 'has-doc' : ''}`}
      onDragOver={(e) => {
        e.preventDefault();
        setDragOver(true);
      }}
      onDragLeave={(e) => e.currentTarget === e.target && setDragOver(false)}
      onDrop={onDrop}
    >
      <header className="topbar">
        <div className="brand">
          <span className="logo">NETFORCE</span>
          <span className="badge">SIGN</span>
        </div>
        {doc && (
          <div className="doc-name" title={doc.name}>
            <IconFile width={16} height={16} />
            <span>{doc.name}</span>
          </div>
        )}
        <div className="top-actions">
          {doc && (
            <>
              <button className="icon-btn" onClick={undo} disabled={!history.length} title="Annuler (Ctrl+Z)" aria-label="Annuler">
                <IconUndo />
              </button>
              <button className="btn outline small hide-mobile" onClick={() => fileInput.current?.click()}>
                Changer
              </button>
              <button className="btn primary small hide-mobile" onClick={() => exportAs('pdf')} disabled={!!busy}>
                <IconDownload width={16} height={16} /> PDF
              </button>
              <button className="btn primary small hide-mobile" onClick={() => exportAs('docx')} disabled={!!busy}>
                <IconDownload width={16} height={16} /> Word
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
          <div className="glow" />
          <div className="landing-inner">
            <div className="eyebrow">Signature de documents</div>
            <h1>
              Déposer. Signer.
              <br />
              Transmettre.
            </h1>
            <p className="lead">
              PDF ou Word. Les zones de signature et de cachet sont détectées automatiquement — un clic pour apposer, un geste pour
              ajuster.
            </p>
            <button className={`dropzone ${dragOver ? 'over' : ''}`} onClick={() => fileInput.current?.click()}>
              <IconUpload width={30} height={30} />
              <strong>Choisir un document</strong>
              <span>ou glissez-le ici · PDF, DOCX</span>
            </button>
            <div className="assurances">
              <span>
                <IconCheck width={16} height={16} /> Traitement 100 % local
              </span>
              <span>
                <IconCheck width={16} height={16} /> Aucun envoi sur un serveur
              </span>
              <span>
                <IconCheck width={16} height={16} /> Export PDF et Word
              </span>
            </div>
            <div className="landing-assets">
              {assetCard('signature')}
              {assetCard('stamp')}
            </div>
          </div>
        </main>
      ) : (
        <div className="workspace">
          <div ref={viewport} className={`viewport ${armed ? 'is-armed' : ''}`} onPointerDown={(e) => e.target === e.currentTarget && setSelectedId(null)}>
            {armed && (
              <div className="armed-banner">
                {armed === 'signature' ? 'Touchez la page pour placer votre signature' : 'Touchez la page pour placer le cachet'}
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
                  setToast('Impossible de lire ce document Word.');
                }}
              />
            )}
            {doc.kind === 'docx' && sections.map((s, i) => createPortal(overlay(i), s, `ov-${i}`))}
          </div>

          <aside className={`panel ${sheetOpen ? 'open' : ''}`}>
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
                  Zones détectées <span className="count">{zones.length}</span>
                </h3>
                {zones.length === 0 ? (
                  <p className="muted">Aucune zone trouvée. Utilisez « Placer librement » puis cliquez sur la page.</p>
                ) : (
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
                <p className="muted small">
                  {doc.kind === 'pdf'
                    ? 'PDF : document d’origine conservé, texte sélectionnable. Word : chaque page devient une image fidèle.'
                    : 'Word : document d’origine modifiable, signatures insérées en images. PDF : rendu fidèle des pages.'}
                </p>
                <button className="btn outline small" onClick={() => fileInput.current?.click()}>
                  Ouvrir un autre document
                </button>
              </section>

              <p className="hint">Glissez un élément pour le déplacer, tirez le coin pour le redimensionner. Suppr pour l’effacer, Ctrl+Z pour annuler.</p>
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

      {modal && <AssetModal kind={modal.kind} current={assets[modal.kind]} onSave={onSaveAsset} onClose={() => setModal(null)} />}
    </div>
  );
}
