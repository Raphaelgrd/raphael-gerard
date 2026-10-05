import { useEffect, useRef, useState } from 'react';
import type { Asset, Kind } from '../types';
import SignaturePad, { type SignaturePadHandle } from './SignaturePad';
import {
  DEFAULT_STAMP,
  SCRIPT_FONTS,
  generateStamp,
  imageFileToAsset,
  typedSignature,
  type StampOptions,
} from '../lib/assets';
import { IconUpload, IconX } from './Icons';

interface Props {
  kind: Kind;
  current: Asset | null;
  onSave: (asset: Asset) => void;
  onClose: () => void;
}

const INKS = [
  { id: '#141B2D', label: 'Noir' },
  { id: '#1E3FA8', label: 'Bleu' },
];

const STAMP_INKS = [
  { id: '#1E3FA8', label: 'Bleu' },
  { id: '#B3261E', label: 'Rouge' },
  { id: '#141B2D', label: 'Noir' },
];

type Tab = 'draw' | 'type' | 'import' | 'generate';

const STAMP_KEY = 'nf-sign.stamp-options';

function loadStampOptions(): StampOptions {
  try {
    const raw = localStorage.getItem(STAMP_KEY);
    return raw ? { ...DEFAULT_STAMP, ...JSON.parse(raw) } : DEFAULT_STAMP;
  } catch {
    return DEFAULT_STAMP;
  }
}

export default function AssetModal({ kind, current, onSave, onClose }: Props) {
  const isSig = kind === 'signature';
  const [tab, setTab] = useState<Tab>('import');
  const [ink, setInk] = useState(isSig ? INKS[0].id : STAMP_INKS[0].id);
  const [padEmpty, setPadEmpty] = useState(true);
  const pad = useRef<SignaturePadHandle>(null);

  const [typed, setTyped] = useState('');
  const [font, setFont] = useState(SCRIPT_FONTS[0].id);

  const [imported, setImported] = useState<Asset | null>(null);
  const [importFile, setImportFile] = useState<File | null>(null);
  const [removeBg, setRemoveBg] = useState(true);
  const fileRef = useRef<HTMLInputElement>(null);

  const [stamp, setStamp] = useState<StampOptions>(loadStampOptions);
  const [stampPreview, setStampPreview] = useState<Asset | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  useEffect(() => {
    if (!importFile) return;
    let alive = true;
    imageFileToAsset(importFile, removeBg).then((a) => alive && setImported(a));
    return () => {
      alive = false;
    };
  }, [importFile, removeBg]);

  useEffect(() => {
    if (tab !== 'generate') return;
    let alive = true;
    document.fonts
      .load('700 64px "Rajdhani"')
      .catch(() => null)
      .then(() => alive && setStampPreview(generateStamp({ ...stamp, color: ink })));
    return () => {
      alive = false;
    };
  }, [tab, stamp, ink]);

  const save = async () => {
    let asset: Asset | null = null;
    if (tab === 'draw') asset = pad.current?.toAsset() ?? null;
    else if (tab === 'type') asset = await typedSignature(typed, font, ink);
    else if (tab === 'import') asset = imported;
    else if (tab === 'generate') {
      asset = stampPreview;
      try {
        localStorage.setItem(STAMP_KEY, JSON.stringify(stamp));
      } catch {
        /* sans stockage */
      }
    }
    if (asset) onSave(asset);
  };

  const canSave =
    (tab === 'draw' && !padEmpty) ||
    (tab === 'type' && typed.trim().length > 0) ||
    (tab === 'import' && !!imported) ||
    (tab === 'generate' && !!stampPreview);

  const tabs: { id: Tab; label: string }[] = isSig
    ? [
        { id: 'import', label: 'Importer' },
        { id: 'draw', label: 'Dessiner' },
        { id: 'type', label: 'Écrire' },
      ]
    : [
        { id: 'import', label: 'Importer' },
        { id: 'generate', label: 'Composer' },
      ];

  const inks = isSig ? INKS : STAMP_INKS;

  return (
    <div className="modal-backdrop" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" role="dialog" aria-modal="true" aria-label={isSig ? 'Ma signature' : 'Mon cachet'}>
        <div className="modal-head">
          <div>
            <div className="eyebrow">{isSig ? 'Signature' : 'Cachet'}</div>
            <h2>{isSig ? 'Votre signature.' : "Le cachet de l'entreprise."}</h2>
          </div>
          <button className="icon-btn" onClick={onClose} aria-label="Fermer">
            <IconX />
          </button>
        </div>

        <div className="tabs" role="tablist">
          {tabs.map((t) => (
            <button key={t.id} role="tab" aria-selected={tab === t.id} className={tab === t.id ? 'on' : ''} onClick={() => setTab(t.id)}>
              {t.label}
            </button>
          ))}
        </div>

        <div className="modal-body">
          {tab !== 'import' && (
            <div className="inks">
              {inks.map((i) => (
                <button
                  key={i.id}
                  className={`ink ${ink === i.id ? 'on' : ''}`}
                  style={{ ['--ink' as string]: i.id }}
                  onClick={() => setInk(i.id)}
                  aria-label={`Encre ${i.label}`}
                  title={i.label}
                />
              ))}
              {tab === 'draw' && (
                <button className="link" onClick={() => pad.current?.clear()} disabled={padEmpty}>
                  Effacer
                </button>
              )}
            </div>
          )}

          {tab === 'draw' && <SignaturePad ref={pad} color={ink} onChange={setPadEmpty} />}

          {tab === 'type' && (
            <div className="typed">
              <input
                className="field"
                placeholder="Prénom Nom"
                value={typed}
                autoFocus
                onChange={(e) => setTyped(e.target.value)}
              />
              <div className="font-list">
                {SCRIPT_FONTS.map((f) => (
                  <button
                    key={f.id}
                    className={`font-opt ${font === f.id ? 'on' : ''}`}
                    onClick={() => setFont(f.id)}
                    style={{ fontFamily: `"${f.id}", cursive`, fontWeight: f.weight, color: ink }}
                  >
                    {typed || 'Prénom Nom'}
                    <span>{f.label}</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {tab === 'import' && (
            <div className="import">
              <button className="dropzone small" onClick={() => fileRef.current?.click()}>
                {imported ? (
                  <img src={imported.src} alt="Aperçu" className="checker" />
                ) : (
                  <>
                    <IconUpload width={28} height={28} />
                    <span>{isSig ? 'Choisir votre signature' : 'Choisir votre tampon'} (PNG, JPG)</span>
                    <small>PNG transparent, ou scan / photo sur fond blanc</small>
                  </>
                )}
              </button>
              <input
                ref={fileRef}
                type="file"
                accept="image/*"
                hidden
                onChange={(e) => e.target.files?.[0] && setImportFile(e.target.files[0])}
              />
              <label className="check">
                <input type="checkbox" checked={removeBg} onChange={(e) => setRemoveBg(e.target.checked)} />
                Rendre le fond blanc transparent
              </label>
            </div>
          )}

          {tab === 'generate' && (
            <div className="stamp-form">
              <div className="seg">
                <button className={stamp.shape === 'round' ? 'on' : ''} onClick={() => setStamp({ ...stamp, shape: 'round' })}>
                  Rond
                </button>
                <button className={stamp.shape === 'rect' ? 'on' : ''} onClick={() => setStamp({ ...stamp, shape: 'rect' })}>
                  Rectangulaire
                </button>
              </div>
              <div className="stamp-grid">
                <div className="stamp-fields">
                  {(
                    [
                      ['line1', 'Raison sociale'],
                      ['line2', 'Ligne 2'],
                      ['line3', 'Adresse'],
                      ['line4', 'SIRET (optionnel)'],
                    ] as const
                  ).map(([k, label]) => (
                    <label key={k} className="lbl">
                      <span>{label}</span>
                      <input className="field" value={stamp[k]} onChange={(e) => setStamp({ ...stamp, [k]: e.target.value })} />
                    </label>
                  ))}
                </div>
                <div className="stamp-preview checker">{stampPreview && <img src={stampPreview.src} alt="Aperçu du cachet" />}</div>
              </div>
            </div>
          )}

          {current && (
            <div className="current">
              <span>Actuel</span>
              <img src={current.src} alt="" />
            </div>
          )}
        </div>

        <div className="modal-foot">
          <button className="btn ghost" onClick={onClose}>
            Annuler
          </button>
          <button className="btn primary" onClick={save} disabled={!canSave}>
            Enregistrer
          </button>
        </div>
      </div>
    </div>
  );
}
