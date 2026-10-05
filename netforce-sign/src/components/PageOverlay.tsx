import { useRef, useState } from 'react';
import type { Asset, FracRect, Kind, PageSize, Placement, Zone } from '../types';
import { fitInZone, placementAt } from '../lib/util';
import { IconTrash } from './Icons';

export interface OverlayProps {
  page: number;
  size: PageSize;
  zones: Zone[];
  placements: Placement[];
  assets: Record<Kind, Asset | null>;
  armed: Kind | null;
  selectedId: string | null;
  filledZoneIds: Set<string>;
  onZoneClick: (zone: Zone) => void;
  onPlaceAt: (page: number, fx: number, fy: number) => void;
  onSelect: (id: string | null) => void;
  onChange: (id: string, patch: Partial<Placement>) => void;
  onBeginEdit: () => void;
  onDelete: (id: string) => void;
}

const pct = (r: FracRect) => ({
  left: `${r.x * 100}%`,
  top: `${r.y * 100}%`,
  width: `${r.w * 100}%`,
  height: `${r.h * 100}%`,
});

export default function PageOverlay(props: OverlayProps) {
  const { page, size, zones, placements, assets, armed, selectedId, filledZoneIds } = props;
  const ref = useRef<HTMLDivElement>(null);
  const [ghost, setGhost] = useState<{ x: number; y: number } | null>(null);
  const drag = useRef<{
    id: string;
    mode: 'move' | 'resize';
    sx: number;
    sy: number;
    start: Placement;
    moved: boolean;
  } | null>(null);

  const frac = (e: { clientX: number; clientY: number }) => {
    const r = ref.current!.getBoundingClientRect();
    return { x: (e.clientX - r.left) / r.width, y: (e.clientY - r.top) / r.height, r };
  };

  const startDrag = (e: React.PointerEvent, p: Placement, mode: 'move' | 'resize') => {
    e.stopPropagation();
    e.preventDefault();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    props.onSelect(p.id);
    drag.current = { id: p.id, mode, sx: e.clientX, sy: e.clientY, start: p, moved: false };
  };

  const moveDrag = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    const r = ref.current!.getBoundingClientRect();
    const dx = (e.clientX - d.sx) / r.width;
    const dy = (e.clientY - d.sy) / r.height;
    if (!d.moved) {
      if (Math.abs(e.clientX - d.sx) + Math.abs(e.clientY - d.sy) < 3) return;
      d.moved = true;
      props.onBeginEdit();
    }
    const s = d.start;
    if (d.mode === 'move') {
      props.onChange(d.id, {
        x: Math.min(Math.max(s.x + dx, -s.w * 0.5), 1 - s.w * 0.5),
        y: Math.min(Math.max(s.y + dy, -s.h * 0.5), 1 - s.h * 0.5),
      });
    } else {
      const minW = 24 / r.width;
      const w = Math.max(minW, Math.min(s.w + dx, 1.2));
      const h = (w * r.width) / s.ratio / r.height;
      props.onChange(d.id, { w, h });
    }
  };

  const endDrag = () => {
    drag.current = null;
  };

  const armedAsset = armed ? assets[armed] : null;
  const ghostRect = ghost && armed && armedAsset ? placementAt(page, ghost.x, ghost.y, size, armedAsset, armed) : null;

  return (
    <div
      ref={ref}
      className={`nf-overlay ${armed ? 'armed' : ''}`}
      onPointerMove={(e) => {
        if (armed && e.pointerType === 'mouse') setGhost(frac(e));
      }}
      onPointerLeave={() => setGhost(null)}
      onPointerDown={(e) => {
        if (e.target === ref.current) {
          if (armed) {
            const { x, y } = frac(e);
            props.onPlaceAt(page, x, y);
            setGhost(null);
          } else props.onSelect(null);
        }
      }}
    >
      {zones.map((z) => {
        if (filledZoneIds.has(z.id)) return null;
        const asset = assets[z.kind];
        return (
          <button
            key={z.id}
            id={`zone-${z.id}`}
            className={`nf-zone ${z.kind}`}
            style={pct(z)}
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.stopPropagation();
              props.onZoneClick(z);
            }}
            title={z.label}
          >
            {asset && <img className="nf-zone-ghost" src={asset.src} alt="" style={pct(relative(z, fitInZone(z, size, asset, z.kind)))} />}
            <span className="nf-zone-chip">{z.kind === 'signature' ? 'Signer ici' : 'Apposer le cachet'}</span>
          </button>
        );
      })}

      {placements.map((p) => (
        <div
          key={p.id}
          className={`nf-placed ${p.kind} ${selectedId === p.id ? 'selected' : ''}`}
          style={pct(p)}
          onPointerDown={(e) => startDrag(e, p, 'move')}
          onPointerMove={moveDrag}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
          tabIndex={0}
          aria-label={p.kind === 'signature' ? 'Signature placée' : 'Cachet placé'}
        >
          <img src={p.src} alt="" draggable={false} />
          {selectedId === p.id && (
            <>
              <button
                className="nf-del"
                aria-label="Supprimer"
                onPointerDown={(e) => e.stopPropagation()}
                onClick={(e) => {
                  e.stopPropagation();
                  props.onDelete(p.id);
                }}
              >
                <IconTrash width={14} height={14} />
              </button>
              <span
                className="nf-handle"
                onPointerDown={(e) => startDrag(e, p, 'resize')}
                onPointerMove={moveDrag}
                onPointerUp={endDrag}
                onPointerCancel={endDrag}
              />
            </>
          )}
        </div>
      ))}

      {ghostRect && armedAsset && <img className="nf-ghost" src={armedAsset.src} alt="" style={pct(ghostRect)} />}
    </div>
  );
}

/** Rectangle `inner` exprimé relativement à `outer` (pour un enfant positionné). */
function relative(outer: FracRect, inner: FracRect): FracRect {
  return {
    x: (inner.x - outer.x) / outer.w,
    y: (inner.y - outer.y) / outer.h,
    w: inner.w / outer.w,
    h: inner.h / outer.h,
  };
}
