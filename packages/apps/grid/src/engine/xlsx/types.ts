import type { OOXMLPreservationState, Workbook } from '../workbook/types'

export type CompatibilityCategory = 'supported' | 'readable-not-editable' | 'preservable-opaque' | 'at-risk' | 'blocked'

export type CompatibilityCode =
  | 'supported-content'
  | 'formula-cache'
  | 'defined-names'
  | 'malformed-formula'
  | 'shared-formula'
  | 'charts'
  | 'pivots'
  | 'drawings'
  | 'images'
  | 'tables'
  | 'validations'
  | 'conditional-formats'
  | 'comments'
  | 'external-references'
  | 'external-targets'
  | 'custom-xml'
  | 'extensions'
  | 'unknown-parts'
  | 'unknown-nodes'
  | 'active-content'
  | 'embedded-objects'
  | 'unsupported-cell-types'
  | 'unsupported-style-details'
  | 'hidden-sheets'
  | 'archive-invalid'
  | 'archive-limit'
  | 'encrypted'
  | 'unsupported-extension'
  | 'unsupported-version'
  | 'malformed-xml'
  | 'unsafe-relationship'
  | 'broken-shared-string'
  | 'invalid-workbook'

export interface CompatibilityFinding {
  code: CompatibilityCode
  category: CompatibilityCategory
  count: number
  partNames: string[]
}

export interface CompatibilityReport {
  fileName: string
  sheetCount: number
  cellCount: number
  findings: CompatibilityFinding[]
  canOpen: boolean
}

export interface XlsxImportPreflight {
  workbook?: Workbook
  report: CompatibilityReport
}

export interface XlsxImportProgress {
  phase: 'inspect' | 'decompress' | 'map'
  percent: number
}

export type XlsxSaveDiffCategory =
  'preserved' | 'intentionally-updated' | 'unsupported-preserved' | 'stale-calculation' | 'at-risk' | 'cannot-preserve'

export type XlsxSaveDiffCode =
  | 'part-preserved'
  | 'part-updated'
  | 'part-removed'
  | 'unsupported-part-preserved'
  | 'unsafe-part-preserved'
  | 'formula-not-recalculated'
  | 'formula-cache-stale'
  | 'output-invalid'
  | 'unsupported-sheet-feature'
  | 'unsupported-style'
  | 'save-as-required'

export interface XlsxSaveDiffEntry {
  category: XlsxSaveDiffCategory
  code: XlsxSaveDiffCode
  partName?: string
  count?: number
}

export interface XlsxSaveReport {
  fileName: string
  entries: XlsxSaveDiffEntry[]
  canSave: boolean
  requiresSaveAs: boolean
  outputBytes?: number
}

export interface XlsxExportResult {
  bytes?: Uint8Array
  report: XlsxSaveReport
  preservation?: Omit<OOXMLPreservationState, 'originalArchiveBytes'>
}

export interface XlsxExportProgress {
  phase: 'inspect' | 'patch' | 'validate'
  percent: number
}

export type XlsxImportErrorCode =
  | 'unsupported-extension'
  | 'legacy-format'
  | 'encrypted'
  | 'archive-invalid'
  | 'archive-limit'
  | 'unsupported-version'
  | 'active-content'
  | 'unsafe-relationship'
  | 'invalid-workbook'
  | 'malformed-xml'
  | 'broken-shared-string'
  | 'worker'

export class XlsxImportError extends Error {
  constructor(
    readonly code: XlsxImportErrorCode,
    message: string,
  ) {
    super(message)
    this.name = 'XlsxImportError'
  }
}
