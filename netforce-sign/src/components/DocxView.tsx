import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react';
import { renderDocx } from '../lib/docx';

interface Props {
  bytes: ArrayBuffer;
  width: number;
  hostRef: RefObject<HTMLDivElement | null>;
  onReady: (sections: HTMLElement[]) => void;
  onError: (e: unknown) => void;
}

export default function DocxView({ bytes, width, hostRef, onReady, onError }: Props) {
  const container = useRef<HTMLDivElement>(null);
  const [natural, setNatural] = useState(0);

  useEffect(() => {
    let alive = true;
    renderDocx(bytes, container.current!)
      .then((sections) => {
        if (!alive) return;
        const widest = Math.max(...sections.map((s) => ((parseFloat(s.style.width) || 595) * 96) / 72));
        setNatural(widest + 2);
        // Attend l'application du zoom avant de mesurer.
        requestAnimationFrame(() => requestAnimationFrame(() => alive && onReady(sections)));
      })
      .catch((e) => alive && onError(e));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bytes]);

  useLayoutEffect(() => {
    if (!hostRef.current || !natural) return;
    hostRef.current.style.zoom = String(Math.min(1.25, width / natural));
  }, [width, natural, hostRef]);

  return (
    <div ref={hostRef} className="docx-host">
      <div ref={container} />
    </div>
  );
}
