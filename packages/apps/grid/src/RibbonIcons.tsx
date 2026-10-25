import type { ReactNode } from 'react'

// Spreadsheet-specific glyphs use the same 24px, currentColor outline system as AllUI EditorIcon.
function RibbonIcon({ children }: { children: ReactNode }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {children}
    </svg>
  )
}
export function TableIcon() {
  return (
    <RibbonIcon>
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <path d="M3 9h18M9 9v12M15 9v12M3 15h18" />
    </RibbonIcon>
  )
}
export function ChartIcon() {
  return (
    <RibbonIcon>
      <path d="M3 3v18h18M7 17v-5h3v5M13 17V6h3v11M19 17V9h2v8" />
    </RibbonIcon>
  )
}
export function InsertRowIcon() {
  return (
    <RibbonIcon>
      <rect x="3" y="11" width="18" height="10" rx="1" />
      <path d="M3 16h18M9 11v10M15 11v10M12 2v6M9 5h6" />
    </RibbonIcon>
  )
}
export function InsertColumnIcon() {
  return (
    <RibbonIcon>
      <rect x="11" y="3" width="10" height="18" rx="1" />
      <path d="M16 3v18M11 9h10M11 15h10M2 12h6M5 9v6" />
    </RibbonIcon>
  )
}
export function FreezeIcon() {
  return (
    <RibbonIcon>
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <path d="M3 9h18M9 3v18M9 15h12M15 9v12" />
      <path d="M5 5h2v2H5z" />
    </RibbonIcon>
  )
}
export function FunctionIcon() {
  return (
    <RibbonIcon>
      <path d="M14 4c-3-2-5 0-5 3L7 18c-.5 3-2 4-4 2M5 10h8M15 13l6 7M21 13l-6 7" />
    </RibbonIcon>
  )
}

export function SortIcon() {
  return (
    <RibbonIcon>
      <path d="M6 3v18m-3-3 3 3 3-3M13 5h8M13 10h6M13 15h4M13 20h2" />
    </RibbonIcon>
  )
}
export function FilterIcon() {
  return (
    <RibbonIcon>
      <path d="M3 4h18l-7 8v7l-4 2v-9z" />
    </RibbonIcon>
  )
}
export function WrapIcon() {
  return (
    <RibbonIcon>
      <path d="M3 5h18M3 10h13a4 4 0 0 1 0 8h-5m3-3-3 3 3 3M3 15h4M3 20h4" />
    </RibbonIcon>
  )
}
