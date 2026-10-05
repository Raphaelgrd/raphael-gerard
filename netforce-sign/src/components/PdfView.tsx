import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import type { PageSize } from '../types';
import { renderPage } from '../lib/pdf';

interface Props {
  pdf: PDFDocumentProxy;
  sizes: PageSize[];
  width: number;
  renderOverlay: (page: number) => ReactNode;
}

function PdfPage({ pdf, index, size, width, children }: { pdf: PDFDocumentProxy; index: number; size: PageSize; width: number; children: ReactNode }) {
  const wrap = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const [visible, setVisible] = useState(index < 2);
  const rendered = useRef(0);

  useEffect(() => {
    const io = new IntersectionObserver(([e]) => e.isIntersecting && setVisible(true), { rootMargin: '800px 0px' });
    io.observe(wrap.current!);
    return () => io.disconnect();
  }, []);

  useEffect(() => {
    if (!visible || !width) return;
    if (rendered.current && Math.abs(rendered.current - width) < 8) return;
    let cancelled = false;
    const t = setTimeout(async () => {
      const page = await pdf.getPage(index + 1);
      if (cancelled || !canvas.current) return;
      await renderPage(page, canvas.current, width);
      rendered.current = width;
    }, rendered.current ? 180 : 0);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [visible, width, pdf, index]);

  return (
    <div ref={wrap} className="page pdf-page" style={{ width, height: (width * size.height) / size.width }} data-page={index}>
      <canvas ref={canvas} />
      {children}
      <div className="page-num">{index + 1}</div>
    </div>
  );
}

export default function PdfView({ pdf, sizes, width, renderOverlay }: Props) {
  return (
    <div className="pages">
      {sizes.map((s, i) => (
        <PdfPage key={i} pdf={pdf} index={i} size={s} width={width}>
          {renderOverlay(i)}
        </PdfPage>
      ))}
    </div>
  );
}
