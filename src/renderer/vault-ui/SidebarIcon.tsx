import type { ReactNode } from 'react';

const sidebarGlyphs = {
  document: <path d="M5 3h9l5 5v13H5V3Zm9 0v5h5M8 12h8M8 16h6" />,
  newDocument: <path d="M14 21H5V3h9l5 5v6M14 3v5h5M19 17v6M16 20h6" />,
  canvas: <path d="M3 4h18v16H3V4Zm0 5h18M9 9v11" />,
  folder: <path d="M3 5h7l3 3h8v12H3V5Z" />,
  openFolder: <path d="M3 20V5h7l3 3h7v4M3 20l3-8h16l-3 8H3Z" />,
  newFolder: <path d="M14 20H3V5h7l3 3h8v6M19 17v6M16 20h6" />,
  refresh: <path d="M20 9V4l-3 3a7 7 0 0 0-12 5M4 15v5l3-3a7 7 0 0 0 12-5M15 9h5M4 15h5" />,
  chevronDown: <path d="m7 9 5 5 5-5" />,
  chevronRight: <path d="m9 7 5 5-5 5" />,
  panelLeft: <path d="M4 5h16v14H4V5Zm5 0v14" />,
  panelRight: <path d="M4 5h16v14H4V5Zm11 0v14" />,
} satisfies Record<string, ReactNode>;

export function SidebarIcon({ kind, size = 14, className }: {
  kind: keyof typeof sidebarGlyphs;
  size?: number;
  className?: string;
}) {
  return <svg className={className} width={size} height={size} viewBox="0 0 24 24" fill="none"
    stroke="currentColor" strokeWidth="1.5" strokeLinecap="square" strokeLinejoin="miter" aria-hidden="true">
    {sidebarGlyphs[kind]}
  </svg>;
}
