import { useEffect, useImperativeHandle, useRef, useState, type Ref } from 'react';
import type { Asset } from '../types';
import { trimCanvas } from '../lib/assets';

export interface SignaturePadHandle {
  clear: () => void;
  toAsset: () => Asset | null;
}

interface Props {
  color: string;
  ref?: Ref<SignaturePadHandle>;
  onChange?: (empty: boolean) => void;
}

interface Pt {
  x: number;
  y: number;
  t: number;
}

export default function SignaturePad({ color, ref, onChange }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const strokes = useRef<{ color: string; pts: (Pt & { w: number })[] }[]>([]);
  const drawing = useRef(false);
  const [empty, setEmpty] = useState(true);

  const redraw = () => {
    const c = canvasRef.current;
    if (!c) return;
    const ctx = c.getContext('2d')!;
    const dpr = c.width / c.clientWidth;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, c.width, c.height);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    for (const s of strokes.current) {
      ctx.strokeStyle = s.color;
      ctx.fillStyle = s.color;
      const p = s.pts;
      if (p.length === 1) {
        ctx.beginPath();
        ctx.arc(p[0].x, p[0].y, p[0].w / 2, 0, Math.PI * 2);
        ctx.fill();
        continue;
      }
      for (let i = 1; i < p.length; i++) {
        const a = p[i - 1];
        const b = p[i];
        const prevMid = i > 1 ? { x: (p[i - 2].x + a.x) / 2, y: (p[i - 2].y + a.y) / 2 } : a;
        const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
        ctx.lineWidth = (a.w + b.w) / 2;
        ctx.beginPath();
        ctx.moveTo(prevMid.x, prevMid.y);
        ctx.quadraticCurveTo(a.x, a.y, mid.x, mid.y);
        ctx.stroke();
      }
    }
  };

  useEffect(() => {
    const c = canvasRef.current!;
    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 3);
      c.width = Math.round(c.clientWidth * dpr);
      c.height = Math.round(c.clientHeight * dpr);
      redraw();
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(c);
    return () => ro.disconnect();
  }, []);

  const pos = (e: React.PointerEvent): Pt => {
    const r = canvasRef.current!.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top, t: e.timeStamp };
  };

  const width = (prev: Pt | undefined, cur: Pt, pressure: number) => {
    const base = 2.6;
    if (pressure > 0 && pressure !== 0.5) return base * (0.6 + pressure);
    if (!prev) return base;
    const v = Math.hypot(cur.x - prev.x, cur.y - prev.y) / Math.max(1, cur.t - prev.t);
    return Math.max(1.3, Math.min(3.4, base * (1.25 - v * 0.35)));
  };

  const down = (e: React.PointerEvent) => {
    e.preventDefault();
    canvasRef.current!.setPointerCapture(e.pointerId);
    drawing.current = true;
    const p = pos(e);
    strokes.current.push({ color, pts: [{ ...p, w: width(undefined, p, e.pressure) }] });
    redraw();
  };
  const move = (e: React.PointerEvent) => {
    if (!drawing.current) return;
    const s = strokes.current[strokes.current.length - 1];
    const events = e.nativeEvent.getCoalescedEvents?.() ?? [e.nativeEvent];
    const r = canvasRef.current!.getBoundingClientRect();
    for (const ev of events) {
      const p = { x: ev.clientX - r.left, y: ev.clientY - r.top, t: ev.timeStamp };
      const prev = s.pts[s.pts.length - 1];
      if (Math.hypot(p.x - prev.x, p.y - prev.y) < 1.2) continue;
      const w = width(prev, p, ev.pressure);
      s.pts.push({ ...p, w: prev.w * 0.6 + w * 0.4 });
    }
    redraw();
  };
  const up = () => {
    if (!drawing.current) return;
    drawing.current = false;
    if (empty) {
      setEmpty(false);
      onChange?.(false);
    }
  };

  useImperativeHandle(ref, () => ({
    clear: () => {
      strokes.current = [];
      redraw();
      setEmpty(true);
      onChange?.(true);
    },
    toAsset: () => (strokes.current.length ? trimCanvas(canvasRef.current!, 10) : null),
  }));

  return (
    <div className="pad">
      <canvas
        ref={canvasRef}
        className="pad-canvas"
        onPointerDown={down}
        onPointerMove={move}
        onPointerUp={up}
        onPointerCancel={up}
      />
      <div className="pad-line" />
      {empty && <div className="pad-hint">Signez ici</div>}
    </div>
  );
}
