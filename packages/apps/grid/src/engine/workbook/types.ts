/** Maximum coordinates supported by Transitional OOXML worksheets. */
export const MAX_ROWS = 1_048_576
export const MAX_COLUMNS = 16_384

export type DateSystem = '1900' | '1904'
export type CalculationStatus = 'fresh' | 'stale' | 'unsupported' | 'error'

export interface CellAddress {
  /** One-based worksheet row. */
  row: number
  /** One-based worksheet column. */
  column: number
  absoluteRow?: boolean
  absoluteColumn?: boolean
}

export interface CellRange {
  start: CellAddress
  end: CellAddress
}

export interface ErrorCellValue {
  kind: 'error'
  code: string
  message?: string
}

export type FormulaResult =
  | { kind: 'blank' }
  | { kind: 'number'; value: number }
  | { kind: 'string'; value: string }
  | { kind: 'boolean'; value: boolean }
  | ErrorCellValue
  | { kind: 'date'; serial: number; numberFormat: string }

/** AST is data only. Parsing, dependency tracking and evaluation belong to a later adapter. */
export type FormulaAstNode =
  | { type: 'error'; code: string }
  | { type: 'literal'; value: string | number | boolean | null }
  | { type: 'reference'; sheetName?: string; address: CellAddress }
  | { type: 'range'; sheetName?: string; range: CellRange }
  | { type: 'unary'; operator: string; operand: FormulaAstNode }
  | { type: 'binary'; operator: string; left: FormulaAstNode; right: FormulaAstNode }
  | { type: 'call'; name: string; arguments: FormulaAstNode[] }

export interface Formula {
  /** Original user-entered text, including a leading equals sign when present. */
  source: string
  /** Locale-independent expression owned by the formula adapter. */
  canonicalExpression: string
  /** Parser-owned syntax tree, absent until a supported parser has supplied it. */
  ast: FormulaAstNode | null
  cachedResult: FormulaResult
  calculationStatus: CalculationStatus
}

export type CellValue =
  | { kind: 'blank' }
  | { kind: 'number'; value: number }
  | { kind: 'string'; value: string }
  | { kind: 'boolean'; value: boolean }
  | ErrorCellValue
  /** Dates remain Excel serials; numberFormat controls later presentation. */
  | { kind: 'date'; serial: number; numberFormat: string }
  | { kind: 'formula'; formula: Formula }

export interface CellStyle {
  numberFormat?: string
  font?: { name?: string; size?: number; bold?: boolean; italic?: boolean; underline?: boolean; color?: string }
  fill?: { color?: string; pattern?: string }
  alignment?: { horizontal?: 'left' | 'center' | 'right'; vertical?: 'top' | 'middle' | 'bottom'; wrapText?: boolean }
  border?: { top?: string; right?: string; bottom?: string; left?: string }
  [extension: string]: unknown
}

export interface Cell {
  value: CellValue
  style?: CellStyle
}

export interface SheetDimensions {
  rowLimit: number
  columnLimit: number
  defaultRowHeight: number
  defaultColumnWidth: number
  /** Bounds of modeled content; null when no cell or merge is present. */
  usedRange: CellRange | null
}

export interface RowMetadata {
  height?: number
  hidden?: boolean
  outlineLevel?: number
  style?: CellStyle
}

export interface ColumnMetadata {
  width?: number
  hidden?: boolean
  outlineLevel?: number
  style?: CellStyle
}

export interface DefinedName {
  name: string
  scopeSheetId?: string
  /** Range target, independent of the name's visibility scope. Legacy local ranges default to their scope. */
  targetSheetId?: string
  /** Simple range names can be modeled directly; expressions remain opaque text. */
  range?: CellRange
  formula?: string
  stale?: boolean
  rangeStatus?: 'safe' | 'unsafe'
}

/** Data supplied by a calculation adapter; the workbook core never evaluates expressions. */
export interface WorkbookCalculationUpdate {
  sheetId: string
  address: string
  calculationStatus: CalculationStatus
  ast?: FormulaAstNode | null
  result?: FormulaResult
}

export interface TableDescriptor {
  id: string
  name: string
  range: CellRange
  columns: Array<{ id: string; name: string; totalsFormula?: string }>
  styleName?: string
  autoFilter?: boolean
  rangeStatus?: 'safe' | 'unsafe'
}

export interface ValidationDescriptor {
  id: string
  range: CellRange
  type: 'any' | 'whole' | 'decimal' | 'list' | 'date' | 'time' | 'textLength' | 'custom'
  operator?: string
  formula1?: string
  formula2?: string
  allowBlank?: boolean
  showErrorMessage?: boolean
  errorTitle?: string
  errorMessage?: string
  rangeStatus?: 'safe' | 'unsafe'
}

export interface ConditionalFormatDescriptor {
  id: string
  range: CellRange
  ruleType: string
  formula?: string
  style?: CellStyle
  priority?: number
  rangeStatus?: 'safe' | 'unsafe'
}

export interface DrawingDescriptor {
  id: string
  range: CellRange
  kind: 'image' | 'chart' | 'shape' | 'unknown'
  sourcePartName?: string
  relationshipId?: string
  preservationStatus: 'safe' | 'unsafe'
  rangeStatus?: 'safe' | 'unsafe'
}

export interface PivotDescriptor {
  id: string
  range: CellRange
  name: string
  cacheId?: number
  sourceRange?: CellRange
  sourceTableName?: string
  refreshRequired?: boolean
  sourcePartName?: string
  preservationStatus: 'safe' | 'unsafe'
  rangeStatus?: 'safe' | 'unsafe'
}

export interface Worksheet {
  id: string
  name: string
  visibility?: 'visible' | 'hidden' | 'veryHidden'
  frozenPane?: {
    xSplit: number
    ySplit: number
    topLeftCell: string
    activePane?: string
    state?: string
  }
  hyperlinks?: Array<{
    range: CellRange
    relationshipId?: string
    target?: string
    targetMode?: 'Internal' | 'External'
    display?: string
    tooltip?: string
    location?: string
  }>
  autoFilter?: { range: CellRange; sourcePartName?: string }
  printSettings?: {
    pageMargins?: Record<string, number>
    pageSetup?: Record<string, string>
    printOptions?: Record<string, string>
    headerFooter?: { oddHeader?: string; oddFooter?: string; evenHeader?: string; evenFooter?: string }
    fitToPage?: boolean
    printArea?: string
    printTitles?: string
  }
  comments?: Array<{
    address: string
    author: string
    text: string
    sourcePartName: string
  }>
  /** Sparse A1-keyed storage. Empty, unformatted cells are never allocated. */
  cells: Map<string, Cell>
  dimensions: SheetDimensions
  merges: CellRange[]
  rowMetadata: Map<number, RowMetadata>
  columnMetadata: Map<number, ColumnMetadata>
  tables: TableDescriptor[]
  validations: ValidationDescriptor[]
  conditionalFormats: ConditionalFormatDescriptor[]
  drawings: DrawingDescriptor[]
  pivots: PivotDescriptor[]
}

export type PreservationImpact =
  'cell-values' | 'cell-styles' | 'cell-addresses' | 'sheet-names' | 'sheet-order' | 'sheet-structure' | 'all'

export interface OOXMLPartPreservationDescriptor {
  partName: string
  contentType?: string
  relationshipIds?: string[]
  compressedSize?: number
  uncompressedSize?: number
  classification?: 'supported' | 'readable-not-editable' | 'preservable-opaque' | 'at-risk' | 'blocked'
  /** Unknown parts default to `all`; adapters may declare narrower known dependencies. */
  dependsOn: PreservationImpact[]
  status: 'safe' | 'unsafe'
  unsafeReasons: string[]
  originalBytes?: Uint8Array
}

export interface OOXMLSheetMapping {
  sheetId: string
  partName: string
  relationshipId: string
  sourceSheetId: string
}

export interface OOXMLPreservationState {
  /** Original archive bytes are held only in memory for the active workbook session. */
  originalArchiveBytes?: Uint8Array
  parts: OOXMLPartPreservationDescriptor[]
  sheetMappings?: OOXMLSheetMapping[]
  inventory?: {
    contentTypes: Array<{ partName: string; contentType: string; isDefault: boolean }>
    relationships: Array<{
      sourcePart: string
      id: string
      type: string
      target: string
      targetMode?: 'Internal' | 'External'
      resolvedTarget?: string
      targetExists: boolean
    }>
  }
}

export interface Workbook {
  name: string
  dateSystem: DateSystem
  sheetsById: Map<string, Worksheet>
  sheetOrder: string[]
  activeSheetId: string
  definedNames: DefinedName[]
  preservation?: OOXMLPreservationState
}

export interface SparseCellRange {
  range: CellRange
  /** Contains only allocated cells, keyed by canonical relative A1 address. */
  cells: Map<string, Cell>
}

export type DirtyRegion =
  | { kind: 'cells'; sheetId: string; range: CellRange }
  | { kind: 'rows'; sheetId: string; startRow: number; endRow: number }
  | { kind: 'columns'; sheetId: string; startColumn: number; endColumn: number }
  | { kind: 'sheet'; sheetId: string }

export interface WorkbookChangeEvent {
  kind: 'change' | 'replace' | 'dirty-state' | 'calculation'
  label?: string
  revision: number
  isDirty: boolean
  dirtyChanged: boolean
  dirtyRegions: DirtyRegion[]
  affectedSheetIds: string[]
  impacts: PreservationImpact[]
}

export interface WorkbookHistoryState {
  canUndo: boolean
  canRedo: boolean
  undoDepth: number
  redoDepth: number
  estimatedBytes: number
}
