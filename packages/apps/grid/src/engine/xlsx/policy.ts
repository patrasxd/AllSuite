import type { CompatibilityCode, XlsxImportPreflight } from './types'

export const XLSX_LIMITS = {
  archiveBytes: 50 * 1024 * 1024,
  totalUncompressedBytes: 200 * 1024 * 1024,
  entryBytes: 32 * 1024 * 1024,
  xmlEntryBytes: 16 * 1024 * 1024,
  entries: 10_000,
  compressionRatio: 200,
  populatedCells: 500_000,
  sheets: 255,
} as const

export function isSupportedXlsxFileName(fileName: string): boolean {
  return fileName.toLowerCase().endsWith('.xlsx')
}

export function createBlockedXlsxPreflight(fileName: string, code: CompatibilityCode): XlsxImportPreflight {
  return {
    report: {
      fileName,
      sheetCount: 0,
      cellCount: 0,
      findings: [{ code, category: 'blocked', count: 1, partNames: [] }],
      canOpen: false,
    },
  }
}
