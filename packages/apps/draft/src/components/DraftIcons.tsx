import type { ReactNode } from 'react'

// Draft-specific commands use the same 24-unit, currentColor line style as AllUI.
const drawings = {
  print: <path d="M6 8V3h12v5M6 17H3V9h18v8h-3M6 14h12v7H6zM17 11h1" />,
  preview: (
    <>
      <path d="M5 3h10l4 4v14H5z" />
      <path d="M8 11h8M8 15h8M8 18h5" />
    </>
  ),
  undo: <path d="m9 5-7 7 7 7M3 12h18" />,
  export: <path d="M12 3v12m-4-4 4 4 4-4M4 15v6h16v-6" />,
  markdown: (
    <>
      <rect x="2" y="4" width="20" height="16" rx="1" />
      <path d="M5 16V8l3 4 3-4v8M17 8v8m-3-3 3 3 3-3" />
    </>
  ),
  html: <path d="m7 7-5 5 5 5m10-10 5 5-5 5M14 4l-4 16" />,
  text: (
    <>
      <path d="M5 3h10l4 4v14H5zM14 3v5h5M8 12h8M8 16h8" />
    </>
  ),
  pdf: (
    <>
      <path d="M6 8V3h12v5M6 17H3V9h18v8h-3M6 14h12v7H6zM17 11h1" />
    </>
  ),
  table: (
    <>
      <rect x="3" y="4" width="18" height="16" rx="1" />
      <path d="M3 9h18M3 14h18M9 4v16M15 4v16" />
    </>
  ),
  rowBefore: (
    <>
      <rect x="3" y="10" width="18" height="10" />
      <path d="M3 15h18M9 10v10M15 10v10M9 5h6M12 2v6" />
    </>
  ),
  rowAfter: (
    <>
      <rect x="3" y="3" width="18" height="10" />
      <path d="M3 8h18M9 3v10M15 3v10M9 19h6M12 16v6" />
    </>
  ),
  rowDelete: (
    <>
      <rect x="3" y="4" width="18" height="16" />
      <path d="M3 9h18M3 15h18M9 12h6" />
    </>
  ),
  columnBefore: (
    <>
      <rect x="10" y="3" width="10" height="18" />
      <path d="M15 3v18M10 9h10M10 15h10M2 12h6M5 9v6" />
    </>
  ),
  columnAfter: (
    <>
      <rect x="3" y="3" width="10" height="18" />
      <path d="M8 3v18M3 9h10M3 15h10M16 12h6M19 9v6" />
    </>
  ),
  columnDelete: (
    <>
      <rect x="3" y="4" width="18" height="16" />
      <path d="M8 4v16M16 4v16M10 12h4" />
    </>
  ),
  merge: (
    <>
      <rect x="3" y="4" width="18" height="16" />
      <path d="M5 12h5m-3-3 3 3-3 3M19 12h-5m3-3-3 3 3 3" />
    </>
  ),
  split: (
    <>
      <rect x="3" y="4" width="18" height="16" />
      <path d="M12 4v16M10 12H5l2-2m-2 2 2 2M14 12h5l-2-2m2 2-2 2" />
    </>
  ),
  header: (
    <>
      <rect x="3" y="4" width="18" height="16" />
      <path d="M3 10h18M9 10v10M15 10v10M6 7h12" />
    </>
  ),
  repeatHeader: (
    <>
      <rect x="3" y="4" width="14" height="16" />
      <path d="M3 9h14M6 6.5h8M19 9l3 3-3 3M22 12h-5" />
    </>
  ),
  alt: (
    <>
      <rect x="3" y="3" width="18" height="18" rx="1" />
      <path d="m6 14 3-7 3 7M7 12h4M15 7h3M16.5 7v7M6 18h12" />
    </>
  ),
  original: (
    <>
      <path d="M8 3H3v5M16 3h5v5M3 16v5h5M21 16v5h-5M8 9l2-1v8M14 9l2-1v8" />
    </>
  ),
  resize: (
    <>
      <path d="M4 9V4h5M15 20h5v-5M4 4l6 6M20 20l-6-6" />
    </>
  ),
  symbols: (
    <>
      <path d="M4 19h6v-3a6 6 0 1 1 4 0v3h6M4 19v-3M20 19v-3" />
    </>
  ),
  emoji: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M8 14a4 4 0 0 0 8 0M8 9h.01M16 9h.01" />
    </>
  ),
  paragraph: (
    <>
      <path d="M14 21V3h5M18 3v18M14 3H9a5 5 0 0 0 0 10h5" />
    </>
  ),
  equation: <path d="M18 4H7l6 8-6 8h11M9 12h7" />,
  pageBreak: (
    <>
      <path d="M5 4h14M5 20h14M8 8l4 4 4-4M12 12v4" />
    </>
  ),
  autoformat: (
    <>
      <path d="m3 20 9-9M9 19l-6-6M16 3v6M13 6h6M19 14v6M16 17h6" />
    </>
  ),
  hyphenation: (
    <>
      <path d="M3 6h10M17 6h4M3 12h18M3 18h7M14 18h7M14 3v6" />
    </>
  ),
  previous: <path d="m15 5-7 7 7 7" />,
  next: <path d="m9 5 7 7-7 7" />,
  down: <path d="m5 9 7 7 7-7" />,
  link: <path d="m10 14 4-4M8 16l-1 1a4 4 0 0 1-6-6l4-4a4 4 0 0 1 6 0M16 8l1-1a4 4 0 0 1 6 6l-4 4a4 4 0 0 1-6 0" />,
  references: (
    <>
      <rect x="5" y="3" width="14" height="18" rx="1" />
      <path d="M9 8h6M9 12h6M9 16h3M2 6h3M2 10h3" />
    </>
  ),
  comments: (
    <>
      <path d="M4 4h16v12H9l-5 4z" />
      <path d="M8 8h8M8 12h5" />
    </>
  ),
  trackChanges: (
    <>
      <path d="M5 3h9l5 5v13H5zM14 3v5h5" />
      <path d="M8 13h8M8 17h5" />
    </>
  ),
  navigation: (
    <>
      <rect x="3" y="4" width="18" height="16" rx="1" />
      <path d="M9 4v16M12 8h6M12 12h6M12 16h4" />
    </>
  ),
} satisfies Record<string, ReactNode>

export function DraftIcon({ name }: { name: keyof typeof drawings }) {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {drawings[name]}
    </svg>
  )
}
