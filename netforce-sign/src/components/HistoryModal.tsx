import { useEffect, useState } from 'react';
import { fetchHistory, frError, type LogEntry } from '../lib/cloud';
import { IconX } from './Icons';

interface Props {
  isAdmin: boolean;
  onClose: () => void;
}

const fmt = new Intl.DateTimeFormat('fr-FR', { dateStyle: 'medium', timeStyle: 'short' });

export default function HistoryModal({ isAdmin, onClose }: Props) {
  const [entries, setEntries] = useState<LogEntry[] | null>(null);
  const [names, setNames] = useState<Map<string, string>>(new Map());
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchHistory()
      .then((r) => {
        setEntries(r.entries);
        setNames(r.names);
      })
      .catch((e) => setError(frError(e)));
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="modal-backdrop" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" role="dialog" aria-modal="true" aria-label="Historique">
        <div className="modal-head">
          <div>
            <div className="eyebrow">{isAdmin ? 'Toute l’équipe' : 'Mes documents'}</div>
            <h2>Historique des signatures.</h2>
          </div>
          <button className="icon-btn" onClick={onClose} aria-label="Fermer">
            <IconX />
          </button>
        </div>
        <div className="modal-body">
          {error && <p className="form-error">{error}</p>}
          {!entries && !error && <div className="spinner small" />}
          {entries && entries.length === 0 && <p className="muted">Aucun document signé pour le moment.</p>}
          {entries && entries.length > 0 && (
            <ul className="history">
              {entries.map((e) => (
                <li key={e.id}>
                  <div className="h-main">
                    <span className="h-name" title={e.document_name}>
                      {e.document_name}
                    </span>
                    <span className="h-meta">
                      {fmt.format(new Date(e.created_at))}
                      {isAdmin && e.user_id && <> · {names.get(e.user_id) ?? 'Utilisateur supprimé'}</>}
                    </span>
                  </div>
                  <div className="h-tags">
                    <span className="tag">{e.export_format === 'pdf' ? 'PDF' : 'Word'}</span>
                    {e.signature_count > 0 && <span className="tag">{e.signature_count} sign.</span>}
                    {e.stamp_count > 0 && <span className="tag gold">{e.stamp_count} cachet</span>}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
