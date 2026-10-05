import { useEffect, useRef, useState } from 'react';
import type { Asset, Kind } from '../types';
import SignaturePad, { type SignaturePadHandle } from './SignaturePad';
import { imageFileToAsset } from '../lib/assets';
import { frError } from '../lib/cloud';
import { IconUpload, IconX } from './Icons';

interface Props {
  kind: Kind;
  current: Asset | null;
  onSave: (asset: Asset) => Promise<void> | void;
  onClose: () => void;
}

const INKS = [
  { id: '#141B2D', label: 'Noir' },
  { id: '#1E3FA8', label: 'Bleu' },
];

type Tab = 'import' | 'draw';

export default function AssetModal({ kind, current, onSave, onClose }: Props) {
  const isSig = kind === 'signature';
  const [tab, setTab] = useState<Tab>('import');
  const [ink, setInk] = useState(INKS[0].id);
  const [padEmpty, setPadEmpty] = useState(true);
  const pad = useRef<SignaturePadHandle>(null);

  const [imported, setImported] = useState<Asset | null>(null);
  const [importFile, setImportFile] = useState<File | null>(null);
  const [removeBg, setRemoveBg] = useState(true);
  const fileRef = useRef<HTMLInputElement>(null);

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

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async () => {
    const asset = tab === 'draw' ? pad.current?.toAsset() ?? null : imported;
    if (!asset) return;
    setSaving(true);
    setError(null);
    try {
      await onSave(asset);
    } catch (e) {
      setError(frError(e));
    } finally {
      setSaving(false);
    }
  };

  const canSave = tab === 'draw' ? !padEmpty : !!imported;

  return (
    <div className="modal-backdrop" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" role="dialog" aria-modal="true" aria-label={isSig ? 'Signature' : 'Cachet'}>
        <div className="modal-head">
          <h2>{isSig ? 'Signature' : 'Cachet'}</h2>
          <button className="icon-btn" onClick={onClose} aria-label="Fermer">
            <IconX />
          </button>
        </div>

        {isSig && (
          <div className="tabs" role="tablist">
            {(
              [
                ['import', 'Importer'],
                ['draw', 'Dessiner'],
              ] as const
            ).map(([id, label]) => (
              <button key={id} role="tab" aria-selected={tab === id} className={tab === id ? 'on' : ''} onClick={() => setTab(id)}>
                {label}
              </button>
            ))}
          </div>
        )}

        <div className="modal-body">
          {tab === 'draw' && (
            <>
              <div className="inks">
                {INKS.map((i) => (
                  <button
                    key={i.id}
                    className={`ink ${ink === i.id ? 'on' : ''}`}
                    style={{ ['--ink' as string]: i.id }}
                    onClick={() => setInk(i.id)}
                    aria-label={`Encre ${i.label}`}
                    title={i.label}
                  />
                ))}
                <button className="link" onClick={() => pad.current?.clear()} disabled={padEmpty}>
                  Effacer
                </button>
              </div>
              <SignaturePad ref={pad} color={ink} onChange={setPadEmpty} />
            </>
          )}

          {tab === 'import' && (
            <div className="import">
              <button className="dropzone small" onClick={() => fileRef.current?.click()}>
                {imported ? (
                  <img src={imported.src} alt="Aperçu" className="checker" />
                ) : (
                  <>
                    <IconUpload width={26} height={26} />
                    <span>Choisir une image</span>
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
                Fond transparent
              </label>
            </div>
          )}

          {error && <p className="form-error modal-error">Non enregistré : {error}</p>}

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
          <button className="btn primary" onClick={save} disabled={!canSave || saving}>
            {saving ? 'Enregistrement…' : 'Enregistrer'}
          </button>
        </div>
      </div>
    </div>
  );
}
