import type { SVGProps } from 'react';

type P = SVGProps<SVGSVGElement>;
const base = (p: P) => ({
  width: 18,
  height: 18,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.8,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  'aria-hidden': true,
  ...p,
});

export const IconUpload = (p: P) => (
  <svg {...base(p)}><path d="M12 16V4M7 9l5-5 5 5" /><path d="M4 16v3a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-3" /></svg>
);
export const IconPen = (p: P) => (
  <svg {...base(p)}><path d="M3 21c3-1 5-4 7-8s3-6 5-6 1 4-1 7-2 5 0 5 3-2 4-3" /><path d="M3 21h18" opacity=".45" /></svg>
);
export const IconStamp = (p: P) => (
  <svg {...base(p)}><path d="M9 3h6l-1 7h-4z" /><path d="M5 14a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v3H5z" /><path d="M5 21h14" /></svg>
);
export const IconDownload = (p: P) => (
  <svg {...base(p)}><path d="M12 4v12M7 11l5 5 5-5" /><path d="M4 20h16" /></svg>
);
export const IconTrash = (p: P) => (
  <svg {...base(p)}><path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3" /></svg>
);
export const IconUndo = (p: P) => (
  <svg {...base(p)}><path d="M9 14 4 9l5-5" /><path d="M4 9h11a5 5 0 0 1 0 10h-3" /></svg>
);
export const IconPlus = (p: P) => (
  <svg {...base(p)}><path d="M12 5v14M5 12h14" /></svg>
);
export const IconX = (p: P) => (
  <svg {...base(p)}><path d="M6 6l12 12M18 6 6 18" /></svg>
);
export const IconCheck = (p: P) => (
  <svg {...base(p)}><path d="m5 12 5 5 9-10" /></svg>
);
export const IconBolt = (p: P) => (
  <svg {...base(p)}><path d="M13 2 4 14h7l-1 8 9-12h-7z" /></svg>
);
export const IconFile = (p: P) => (
  <svg {...base(p)}><path d="M14 3H6a1 1 0 0 0-1 1v16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V8z" /><path d="M14 3v5h5" /></svg>
);
export const IconChevron = (p: P) => (
  <svg {...base(p)}><path d="m6 15 6-6 6 6" /></svg>
);
export const IconTarget = (p: P) => (
  <svg {...base(p)}><rect x="4" y="7" width="16" height="10" rx="1.5" strokeDasharray="3 2.5" /><path d="M8 13h5" /></svg>
);
export const IconReply = (p: P) => (
  <svg {...base(p)}><path d="M10 9 5 13l5 4" /><path d="M5 13h9a5 5 0 0 1 5 5v1" /></svg>
);
export const IconBack = (p: P) => (
  <svg {...base(p)}><path d="m15 6-6 6 6 6" /></svg>
);
