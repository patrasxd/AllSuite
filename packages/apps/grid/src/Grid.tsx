import { ChartObject } from './ChartObject'
import { ChartDialog, CHART_COPY, chartErrorMessage } from './Chart'
import { ChartError } from './engine/workbook/chart'
import { ChartIcon } from './RibbonIcons'
import { editWorkbookRows, editWorkbookColumns, prepareFormulaPasteInWorker } from './engine/formulas/row-structure'
import { copyFormulas, formulaCopyText, pasteFormulaBlock, type FormulaCopy } from './engine/editing/formula-clipboard'
import {
  memo,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type FocusEvent,
  type CSSProperties,
  type ChangeEvent,
  type FormEvent,
  type KeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent,
  type RefObject,
} from 'react'
import { defaultRangeExtractor, useVirtualizer } from '@tanstack/react-virtual'
import { createPortal } from 'react-dom'
import {
  Button,
  CopyIcon,
  CheckIcon,
  PasteIcon,
  UploadIcon,
  DownloadIcon,
  EraserIcon,
  ButtonTooltipProvider,
  Dialog,
  FilePlusIcon,
  FolderOpenIcon,
  FullBleedLayout,
  IconButton,
  Input,
  SearchIcon,
  SaveAsIcon,
  SaveIcon,
  Select,
  Text,
  TextArea,
  ThemeContext,
  ControlsBar,
  ToolbarGroup,
  WorkspaceStatusBar,
  WorkspaceStatusItem,
  WorkspaceSheetTabs,
} from '@all/ui'
import type { AppComponentProps } from './types'
import { GRID_COPY } from './i18n'
import { DELIMITED_COPY } from './delimited-copy'
import { DelimitedPreview } from './DelimitedPreview'
import { SortDialog, SORT_COPY } from './SortDialog'
import { FilterDialog, FILTER_COPY } from './FilterDialog'
import { TableDialog, TABLE_COPY } from './TableDialog'
import { filteredRows, isRowHidden, visibleRow } from './engine/workbook/filter'
import { frozenAxes } from './engine/workbook/freeze'
import { frozenAxisPosition, frozenAxisClip, includeFrozenIndex } from './engine/viewport/freeze'
import { sortedRangeCells } from './engine/workbook/sort'
import type { CellRange } from './engine/workbook'
import { decodeDelimitedFile, DELIMITED_MAX_BYTES, exportDelimitedSheet } from './engine/editing/delimited'
import type { Delimiter } from './engine/editing/clipboard'
import { getGridButtonTooltip, getGridSheetTabTooltip } from './button-tooltips'
import {
  AddressError,
  cellAddressKey,
  columnNumberToName,
  formatCellAddress,
  formatRangeAddress,
  parseCellAddress,
  parseRangeAddress,
} from './engine/workbook/address'
import {
  WorkbookSession,
  createWorkbook,
  type Cell,
  type CellAddress,
  type CellStyle,
  type WorkbookSaveCheckpoint,
} from './engine/workbook'
import { FormulaCalculationClient } from './engine/formulas/worker-client'
import { formatCellDisplay, getCellEditText, getCellEntryText, inferCellValue } from './engine/editing/cell-input'
import {
  copyValues,
  parseValuesTsv,
  pasteValues,
  valuesToTsv,
  verifiedClipboardCopy,
  type ValueBlock,
} from './engine/editing/clipboard'
import {
  adjustDecimalPlaces,
  isDateNumberFormat,
  NUMBER_FORMAT_PRESETS,
  type NumberFormatKey,
} from './engine/editing/number-format'
import { getFormulaFunctionHelp } from './engine/formulas/locale'
import { createBlockedXlsxPreflight, isSupportedXlsxFileName, XLSX_LIMITS } from './engine/xlsx/policy'
import { startXlsxImport, type XlsxImportTask } from './engine/xlsx/worker-client'
import { startXlsxExport, type XlsxExportTask } from './engine/xlsx/export-worker-client'
import type {
  CompatibilityCategory,
  XlsxExportProgress,
  XlsxExportResult,
  XlsxImportPreflight,
  XlsxImportProgress,
  XlsxSaveDiffCategory,
} from './engine/xlsx/types'
import {
  createSelection,
  isSelected,
  moveSelection,
  moveToEdge,
  selectCell,
  selectRange,
  selectionEdges,
  type GridSelection,
} from './engine/viewport/selection'
import {
  growViewport,
  INITIAL_VIEWPORT_COLUMNS,
  INITIAL_VIEWPORT_ROWS,
  VIEWPORT_GROW_BUFFER,
  type ViewportSize,
} from './engine/viewport/viewport'
import {
  EditorActionCluster,
  EditorHeaderContent,
  EditorNavigation,
  type EditorActions,
} from '../../../ui/src/EditorChrome'
import { RibbonMenuButton as CommandMenu } from '../../../ui/src/RibbonMenuButton'
import {
  TableIcon,
  InsertRowIcon,
  InsertColumnIcon,
  FreezeIcon,
  FunctionIcon,
  SortIcon,
  FilterIcon,
  WrapIcon,
} from './RibbonIcons'
import './grid.css'
import './ribbon.css'

const MOBILE_COMMANDS_QUERY = '(max-width: 599px), (max-width: 899px) and (max-height: 499px)'
function useMobileCommands(restoreMenuFocus = false) {
  const [mobile, setMobile] = useState(() => window.matchMedia?.(MOBILE_COMMANDS_QUERY).matches ?? false)
  useEffect(() => {
    const media = window.matchMedia?.(MOBILE_COMMANDS_QUERY)
    if (!media) return
    // CSS can hide the focused node before the media change event arrives.
    // Remember focus entry so the handoff also works in that browser ordering.
    let menuHadFocus = false
    const rememberFocus = (event: Event) => {
      menuHadFocus = event.target instanceof Element && Boolean(event.target.closest('.allsuite-ribbon-menu__items'))
    }
    const update = () => {
      const menuFocused =
        restoreMenuFocus && (menuHadFocus || document.activeElement?.closest('.allsuite-ribbon-menu__items'))
      menuHadFocus = false
      setMobile(media.matches)
      if (menuFocused) {
        // The responsive ribbon replaces its controls. Keep keyboard users at
        // the selected tab when their focused disclosure is removed.
        requestAnimationFrame(() => {
          if (document.activeElement === document.body)
            document.querySelector<HTMLElement>('.grid-command-navigation [aria-selected="true"]')?.focus()
        })
      }
    }
    if (restoreMenuFocus) document.addEventListener('focusin', rememberFocus)
    media.addEventListener('change', update)
    return () => {
      document.removeEventListener('focusin', rememberFocus)
      media.removeEventListener('change', update)
    }
  }, [restoreMenuFocus])
  return mobile
}

const ROW_HEADER_WIDTH = 48
const DEFAULT_ROW_HEIGHT = 32
const DEFAULT_COLUMN_WIDTH = 112
const MIN_ROW_HEIGHT = 24
const MAX_ROW_HEIGHT = 160
const MIN_COLUMN_WIDTH = 56
const MAX_COLUMN_WIDTH = 480
const MAX_FILL_CELLS = 10_000
const VALUES_CLIPBOARD_TYPE = 'web application/x-allsuite-grid-values-token'
const SAVE_PROGRESS_DISPLAY_DELAY_MS = 300
const IMPORT_CATEGORY_ORDER: CompatibilityCategory[] = [
  'supported',
  'readable-not-editable',
  'preservable-opaque',
  'at-risk',
  'blocked',
]
const SAVE_CATEGORY_ORDER: XlsxSaveDiffCategory[] = [
  'cannot-preserve',
  'at-risk',
  'stale-calculation',
  'unsupported-preserved',
  'intentionally-updated',
  'preserved',
]

function DecimalPlacesIcon({ direction, separator }: { direction: 'increase' | 'decrease'; separator: '.' | ',' }) {
  const arrow = direction === 'increase' ? 'M22 9h7m0 0-3-3m3 3-3 3' : 'M29 9h-7m0 0 3-3m-3 3 3 3'

  return (
    <svg className="grid-decimal-icon" viewBox="0 0 30 18" aria-hidden="true" focusable="false">
      <text x="0" y="13" fill="currentColor" fontFamily="var(--all-font-mono, monospace)" fontSize="9">
        {`0${separator}0`}
      </text>
      <path
        d={arrow}
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.5"
      />
    </svg>
  )
}

type ResizeAxis = 'row' | 'column'
interface ResizeDrag {
  axis: ResizeAxis
  index: number
  pointerStart: number
  initialSize: number
  size: number
}

interface EditDraft {
  sheetId: string
  address: CellAddress
  text: string
  initialText: string
  origin: 'cell' | 'formula-bar'
}

interface ContextMenuState {
  x: number
  y: number
  selection: GridSelection
  sheetId: string
  targetType: 'cell' | 'row' | 'column'
  row: number
  column: number
  rowCount: number
  columnCount: number
}

interface CellEditorProps {
  value: string
  rows: number
  label: string
  inputRef: RefObject<HTMLTextAreaElement>
  onChange: (value: string) => void
  onKeyDown: (event: KeyboardEvent<HTMLTextAreaElement>) => void
  onBlur: (event: FocusEvent<HTMLTextAreaElement>) => void
}

interface SavePickerHandle {
  name: string
  getFile?: () => Promise<File>
  createWritable: () => Promise<FilePickerWritable>
  isSameEntry?: (other: SavePickerHandle) => Promise<boolean>
}

interface FilePickerHandle extends SavePickerHandle {
  getFile: () => Promise<File>
}

interface FilePickerWritable {
  write: (data: Blob) => Promise<void>
  close: () => Promise<void>
  abort?: () => Promise<void>
}

interface FilePickerWindow extends Window {
  showOpenFilePicker?: (options: {
    multiple: false
    types: Array<{ description: string; accept: Record<string, string[]> }>
  }) => Promise<FilePickerHandle[]>
  showSaveFilePicker?: (options: {
    suggestedName: string
    types: Array<{ description: string; accept: Record<string, string[]> }>
  }) => Promise<SavePickerHandle>
}

function styleForCell(
  cell: Cell | undefined,
): Pick<
  CSSProperties,
  | 'backgroundColor'
  | 'color'
  | 'fontFamily'
  | 'fontSize'
  | 'fontWeight'
  | 'fontStyle'
  | 'textAlign'
  | 'textDecoration'
  | 'whiteSpace'
  | 'alignItems'
  | 'justifyContent'
> {
  const style = cell?.style
  return {
    ...(style?.fill?.color ? { backgroundColor: style.fill.color } : {}),
    ...(style?.font?.color ? { color: style.font.color } : {}),
    ...(style?.font?.name ? { fontFamily: style.font.name } : {}),
    ...(style?.font?.size ? { fontSize: `${style.font.size * (4 / 3)}px` } : {}),
    ...(style?.font?.bold ? { fontWeight: 700 } : {}),
    ...(style?.font?.italic ? { fontStyle: 'italic' as const } : {}),
    ...(style?.font?.underline ? { textDecoration: 'underline' as const } : {}),
    ...(style?.alignment?.horizontal ? { textAlign: style.alignment.horizontal } : {}),
    ...(style?.alignment?.horizontal
      ? {
          justifyContent:
            style.alignment.horizontal === 'left'
              ? 'flex-start'
              : style.alignment.horizontal === 'right'
                ? 'flex-end'
                : 'center',
        }
      : {}),
    ...(style?.alignment?.wrapText ? { whiteSpace: 'pre-wrap' as const } : {}),
    ...(style?.alignment?.vertical
      ? {
          alignItems:
            style.alignment.vertical === 'top'
              ? 'flex-start'
              : style.alignment.vertical === 'bottom'
                ? 'flex-end'
                : 'center',
        }
      : {}),
  }
}

interface GridCellProps {
  onFilter?: () => void
  filterLabel?: string
  tableRole?: 'header' | 'band' | 'body'
  address: string
  row: number
  column: number
  value: string
  selected: boolean
  rangeEdges: string
  active: boolean
  backgroundColor?: string
  color?: string
  fontFamily?: CSSProperties['fontFamily']
  fontSize?: CSSProperties['fontSize']
  fontWeight?: CSSProperties['fontWeight']
  fontStyle?: CSSProperties['fontStyle']
  textAlign?: CSSProperties['textAlign']
  textDecoration?: CSSProperties['textDecoration']
  whiteSpace?: CSSProperties['whiteSpace']
  alignItems?: CSSProperties['alignItems']
  justifyContent?: CSSProperties['justifyContent']
  emptyLabel: string
  editor?: CellEditorProps
}

const GridCell = memo(function GridCell({
  onFilter,
  filterLabel,
  tableRole,
  address,
  row,
  column,
  value,
  selected,
  rangeEdges,
  active,
  backgroundColor,
  color,
  fontFamily,
  fontSize,
  fontWeight,
  fontStyle,
  textAlign,
  textDecoration,
  whiteSpace,
  alignItems,
  justifyContent,
  emptyLabel,
  editor,
}: GridCellProps) {
  return (
    <div
      className={`grid-cell${selected ? ' grid-cell--selected' : ''}${active ? ' grid-cell--active' : ''}${value.includes('\n') ? ' grid-cell--multiline' : ''}${editor ? ' grid-cell--editing' : ''}`}
      role="gridcell"
      data-table-role={tableRole}
      aria-label={`${address}, ${value || emptyLabel}`}
      aria-colindex={column + 1}
      aria-selected={selected}
      data-range-edges={rangeEdges || undefined}
      data-cell-row={row}
      data-cell-column={column}
      data-cell-address={address}
      id={active ? `grid-cell-${address}` : undefined}
      style={{
        backgroundColor,
        color,
        fontFamily,
        fontSize,
        fontWeight,
        fontStyle,
        textAlign,
        textDecoration,
        whiteSpace,
        alignItems,
        justifyContent,
      }}
    >
      {editor ? (
        <textarea
          ref={editor.inputRef}
          className="grid-cell-editor"
          aria-label={editor.label}
          aria-multiline="true"
          rows={editor.rows}
          value={editor.value}
          onChange={(event) => editor.onChange(event.currentTarget.value)}
          onKeyDown={editor.onKeyDown}
          onBlur={editor.onBlur}
          autoCapitalize="off"
          autoComplete="off"
          inputMode="text"
          spellCheck={false}
        />
      ) : (
        value
      )}
      {onFilter && !editor && (
        <Button
          className="grid-table-filter"
          variant="secondary"
          size="sm"
          aria-label={filterLabel}
          onPointerDown={(event) => event.stopPropagation()}
          onDoubleClick={(event) => event.stopPropagation()}
          onClick={(event) => {
            event.stopPropagation()
            onFilter()
          }}
        >
          <svg viewBox="0 0 20 20" aria-hidden="true">
            <path d="m5 8 5 5 5-5" fill="none" stroke="currentColor" strokeWidth="1.5" />
          </svg>
        </Button>
      )}
    </div>
  )
})

function addressAt(row: number, column: number): CellAddress {
  return { row, column }
}

function visibleContains<T extends { index: number }>(items: T[], index: number): boolean {
  return items.some((item) => item.index === index)
}

function getSelectionAddresses(selection: GridSelection, limit = 10_000): string[] | null {
  const addresses = new Set<string>()
  for (const range of selection.ranges) {
    const area = (range.end.row - range.start.row + 1) * (range.end.column - range.start.column + 1)
    if (area + addresses.size > limit) return null
    for (let row = range.start.row; row <= range.end.row; row += 1) {
      for (let column = range.start.column; column <= range.end.column; column += 1) {
        addresses.add(formatCellAddress({ row, column }))
        if (addresses.size > limit) return null
      }
    }
  }
  return [...addresses]
}

function getSelectedCellCount(ranges: GridSelection['ranges']): number {
  const events = ranges.flatMap((range, id) => [
    { row: range.start.row, id, start: range.start.column, end: range.end.column, active: true },
    { row: range.end.row + 1, id, start: range.start.column, end: range.end.column, active: false },
  ])
  events.sort((left, right) => left.row - right.row)

  const activeRanges = new Map<number, { start: number; end: number }>()
  let selectedCellCount = 0
  let previousRow = events[0]?.row ?? 0
  let index = 0

  while (index < events.length) {
    const row = events[index].row
    if (row > previousRow && activeRanges.size > 0) {
      const intervals = [...activeRanges.values()].sort((left, right) => left.start - right.start)
      let selectedColumns = 0
      let lastColumn = 0
      for (const interval of intervals) {
        if (interval.start > lastColumn) {
          selectedColumns += interval.end - interval.start + 1
          lastColumn = interval.end
        } else if (interval.end > lastColumn) {
          selectedColumns += interval.end - lastColumn
          lastColumn = interval.end
        }
      }
      selectedCellCount += (row - previousRow) * selectedColumns
    }

    while (index < events.length && events[index].row === row) {
      const event = events[index]
      if (event.active) activeRanges.set(event.id, { start: event.start, end: event.end })
      else activeRanges.delete(event.id)
      index += 1
    }
    previousRow = row
  }

  return selectedCellCount
}

function getSelectionSummary(selection: GridSelection, cells: ReadonlyMap<string, Cell>) {
  const numbers: number[] = []
  for (const [address, cell] of cells) {
    if (!isSelected(selection, parseCellAddress(address))) continue
    const value = cell.value.kind === 'formula' ? cell.value.formula.cachedResult : cell.value
    const number = value.kind === 'number' ? value.value : value.kind === 'date' ? value.serial : null
    if (number !== null && Number.isFinite(number)) numbers.push(number)
  }

  numbers.sort((left, right) => left - right)
  if (numbers.length === 0) {
    return { cells: getSelectedCellCount(selection.ranges), sum: null, average: null, median: null }
  }

  const sum = numbers.reduce((total, number) => total + number, 0)
  const middle = Math.floor(numbers.length / 2)
  const median = numbers.length % 2 === 0 ? (numbers[middle - 1] + numbers[middle]) / 2 : numbers[middle]
  return {
    cells: getSelectedCellCount(selection.ranges),
    sum,
    average: sum / numbers.length,
    median,
  }
}

export function Grid({ locale, isEink = false, setIsDirty, setHeader }: AppComponentProps) {
  const copy = GRID_COPY[locale]
  const delimitedCopy = DELIMITED_COPY[locale]
  const theme = useContext(ThemeContext)
  const [session] = useState(() => new WorkbookSession(createWorkbook({ firstSheetName: 'Sheet1' })))
  const [activeSheetId, setActiveSheetId] = useState(session.workbook.activeSheetId)
  const [selection, setSelection] = useState<GridSelection>(() => createSelection({ row: 1, column: 1 }))
  const [nameBoxValue, setNameBoxValue] = useState('A1')
  const [viewportSize, setViewportSize] = useState<ViewportSize>({
    rows: INITIAL_VIEWPORT_ROWS,
    columns: INITIAL_VIEWPORT_COLUMNS,
  })
  const [sheetRenameId, setSheetRenameId] = useState<string | null>(null)
  const [sheetRenameName, setSheetRenameName] = useState('')
  const [sheetRenameError, setSheetRenameError] = useState<string>()
  const [formulaFunctionsOpen, setFormulaFunctionsOpen] = useState(false)
  const [formulaFunctionSearch, setFormulaFunctionSearch] = useState('')
  const [zoom, setZoom] = useState(100)
  const [editDraft, setEditDraftState] = useState<EditDraft | null>(null)
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null)
  const [commandTab, setCommandTab] = useState<'home' | 'data' | 'insert' | 'view' | 'table'>('home')
  const [mobileMore, setMobileMore] = useState(false)
  const mobileMoreTrigger = useRef<HTMLButtonElement>(null)
  const appElement = useRef<HTMLDivElement>(null)
  const mobileMoreOpen = useRef(false)
  const mobileMoreBack = useRef(false)
  mobileMoreOpen.current = mobileMore
  const [headerActions, setHeaderActions] = useState<HTMLSpanElement | null>(null)
  const closeMobileMore = useCallback(() => {
    setMobileMore(false)
    requestAnimationFrame(() => mobileMoreTrigger.current?.focus())
  }, [])
  useEffect(() => {
    if (window.history.state?.gridRibbonMore) {
      const state = { ...window.history.state }
      delete state.gridRibbonMore
      window.history.replaceState(state, '')
    }
    // Register on mount, before a dirty workbook activates the shell exit guard.
    // Window-target listeners run in registration order, including capture listeners.
    const back = (event: PopStateEvent) => {
      if (!mobileMoreOpen.current && !mobileMoreBack.current) return
      event.stopImmediatePropagation()
      mobileMoreBack.current = false
      if (mobileMoreOpen.current) closeMobileMore()
    }
    window.addEventListener('popstate', back, true)
    return () => window.removeEventListener('popstate', back, true)
  }, [closeMobileMore])
  useEffect(() => {
    if (!mobileMore) return
    // A same-URL UI entry lets phone Back dismiss More before the shell's dirty exit guard.
    window.history.pushState({ ...window.history.state, gridRibbonMore: true }, '')
    const key = (event: globalThis.KeyboardEvent) => {
      if (event.key !== 'Escape' || (event.target as Element)?.closest('.allsuite-ribbon-menu__items, [role="dialog"]'))
        return
      event.preventDefault()
      event.stopImmediatePropagation()
      closeMobileMore()
    }
    const outside = (event: globalThis.PointerEvent) => {
      const target = event.target as Element
      // Shell navigation owns its route transition; do not race it with a UI-history back.
      if (
        target?.closest('.grid-app') &&
        !target.closest('.grid-command-panel, .grid-mobile-dock, .allsuite-ribbon-menu__items')
      )
        setMobileMore(false)
    }
    document.addEventListener('keydown', key)
    document.addEventListener('pointerdown', outside)
    const frame = requestAnimationFrame(() =>
      document.querySelector<HTMLButtonElement>('.grid-command-panel:not([hidden]) .grid-more-heading button')?.focus(),
    )
    return () => {
      cancelAnimationFrame(frame)
      document.removeEventListener('keydown', key)
      document.removeEventListener('pointerdown', outside)
      if (window.history.state?.gridRibbonMore) {
        mobileMoreBack.current = true
        window.history.back()
      }
    }
  }, [mobileMore, closeMobileMore])
  const mobileCommands = useMobileCommands(true)
  useLayoutEffect(() => {
    const viewport = window.visualViewport
    const element = appElement.current
    if (!mobileCommands || !viewport || !element) return
    const fit = () => {
      if (viewport.scale !== 1) return
      const available = Math.max(0, viewport.height + viewport.offsetTop - element.getBoundingClientRect().top)
      element.style.setProperty('--grid-visible-height', `${available}px`)
    }
    fit()
    viewport.addEventListener('resize', fit)
    viewport.addEventListener('scroll', fit)
    return () => {
      viewport.removeEventListener('resize', fit)
      viewport.removeEventListener('scroll', fit)
      element.style.removeProperty('--grid-visible-height')
    }
  }, [mobileCommands])
  useEffect(() => {
    if (!mobileCommands) setMobileMore(false)
  }, [mobileCommands])
  const [filterColumn, setFilterColumn] = useState<number | undefined>()
  const [notice, setNotice] = useState('')
  const [pendingImport, setPendingImport] = useState<XlsxImportPreflight | null>(null)
  const [pendingDelimited, setPendingDelimited] = useState<{ name: string; text: string } | null>(null)
  const [sortRange, setSortRange] = useState<CellRange | null>(null)
  const [filterRange, setFilterRange] = useState<CellRange | null>(null)
  const [chartDialog, setChartDialog] = useState<{ range: CellRange; editing: boolean } | null>(null)
  const [tableRange, setTableRange] = useState<CellRange | null>(null)
  const [delimitedExport, setDelimitedExport] = useState(false)
  const [exportDelimiter, setExportDelimiter] = useState<Delimiter>(',')
  const [importProgress, setImportProgress] = useState<XlsxImportProgress | null>(null)
  const [pendingSave, setPendingSave] = useState<XlsxExportResult | null>(null)
  const [exportProgress, setExportProgress] = useState<XlsxExportProgress | null>(null)
  const [exportProgressVisible, setExportProgressVisible] = useState(false)
  const [saving, setSaving] = useState(false)
  const [revision, setRevision] = useState(0)
  const [coarsePointer, setCoarsePointer] = useState(false)
  const [rangeDragMode, setRangeDragMode] = useState(false)
  const [resizePreview, setResizePreview] = useState<ResizeDrag | null>(null)
  const editDraftRef = useRef<EditDraft | null>(null)
  const draftCursor = useRef<{ input: HTMLTextAreaElement; offset: number } | null>(null)
  const lastTouchCell = useRef<{ address: CellAddress; time: number } | null>(null)
  const resizeDrag = useRef<ResizeDrag | null>(null)
  const draggingSelection = useRef(false)
  const scrollElement = useRef<HTMLDivElement | null>(null)
  const gridElement = useRef<HTMLDivElement | null>(null)
  const formulaInputElement = useRef<HTMLTextAreaElement | null>(null)
  const valuesClipboard = useRef<{
    token: string
    text: string
    values: ValueBlock
    formulas?: FormulaCopy
    workbook: typeof session.workbook
  } | null>(null)
  const clipboardBusy = useRef(false)
  const clipboardContext = useRef({ selection, activeSheetId })
  clipboardContext.current = { selection, activeSheetId }
  const formulaFunctionCursor = useRef<number | null>(null)
  const cellEditorElement = useRef<HTMLTextAreaElement | null>(null)
  const contextMenuElement = useRef<HTMLDivElement | null>(null)
  const preflightDialogElement = useRef<HTMLDivElement | null>(null)
  const saveDialogElement = useRef<HTMLDivElement | null>(null)
  const fileInputElement = useRef<HTMLInputElement | null>(null)
  const importTaskRef = useRef<XlsxImportTask | null>(null)
  const exportTaskRef = useRef<XlsxExportTask | null>(null)
  const exportProgressTimerRef = useRef<number | null>(null)
  const saveCheckpointRef = useRef<WorkbookSaveCheckpoint | null>(null)
  const currentSaveHandleRef = useRef<SavePickerHandle | null>(null)
  const importedSourceRef = useRef<{ name: string; handle: FilePickerHandle | null } | null>(null)
  const pendingOpenHandleRef = useRef<FilePickerHandle | null>(null)
  const pendingSaveAsHandleRef = useRef<SavePickerHandle | null>(null)
  const currentFileNameRef = useRef('Book1.xlsx')
  const saveShortcutHandlerRef = useRef<((forceSaveAs?: boolean) => Promise<void>) | null>(null)
  const openRequestId = useRef(0)
  const appTheme = isEink ? (theme?.isDark ? 'e-ink-dark' : 'e-ink-light') : theme?.theme
  const columnHeaderHeight = coarsePointer ? 44 : 36
  const defaultRowHeight = coarsePointer || mobileCommands ? 44 : DEFAULT_ROW_HEIGHT
  const zoomScale = zoom / 100
  const sheet =
    session.workbook.sheetsById.get(activeSheetId) ?? session.workbook.sheetsById.get(session.workbook.activeSheetId)!
  const activeAddress = formatCellAddress(selection.active)
  const selectedRange = formatRangeAddress(selection.ranges[selection.ranges.length - 1])
  const activeCell = session.getCell(activeSheetId, selection.active)
  // Workbook edits mutate the sparse cell map in place, so revision must invalidate this memo.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const selectionSummary = useMemo(() => getSelectionSummary(selection, sheet.cells), [selection, sheet, revision])
  const selectionCountFormatter = useMemo(
    () => new Intl.NumberFormat(locale === 'pl' ? 'pl-PL' : 'en-US', { maximumFractionDigits: 0 }),
    [locale],
  )
  const selectionNumberFormatter = useMemo(
    () => new Intl.NumberFormat(locale === 'pl' ? 'pl-PL' : 'en-US', { maximumSignificantDigits: 12 }),
    [locale],
  )
  const currentEditDraft =
    editDraft?.sheetId === activeSheetId &&
    editDraft.address.row === selection.active.row &&
    editDraft.address.column === selection.active.column
      ? editDraft
      : null
  const formulaBarValue = currentEditDraft?.text ?? getCellEntryText(activeCell, locale, session.workbook.dateSystem)
  const activeCellText = currentEditDraft?.text ?? formatCellDisplay(activeCell, locale, session.workbook.dateSystem)
  const draftIsDirty = Boolean(editDraft && editDraft.text !== editDraft.initialText)
  const dirty = session.isDirty || draftIsDirty
  const workbookName = currentFileNameRef.current
  useEffect(() => {
    setHeader?.(
      <EditorHeaderContent filename={workbookName} dirty={dirty} locale={locale} actionsRef={setHeaderActions} />,
    )
    return () => setHeader?.(null)
  }, [setHeader, workbookName, dirty, locale])

  useEffect(
    () =>
      session.subscribe((event) => {
        if (event.kind === 'replace') valuesClipboard.current = null
        setRevision((current) => current + 1)
      }),
    [session],
  )

  // Reconcile before paint so a deferred selection effect cannot overwrite freshly typed range text.
  useLayoutEffect(() => setNameBoxValue(selectedRange), [selectedRange])

  useEffect(() => setNotice(''), [locale])

  useEffect(() => {
    const calculation = new FormulaCalculationClient(session)
    return () => calculation.dispose()
  }, [session])

  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return
    const query = window.matchMedia('(pointer: coarse)')
    const update = () => setCoarsePointer(query.matches)
    update()
    query.addEventListener?.('change', update)
    return () => query.removeEventListener?.('change', update)
  }, [])

  useEffect(() => {
    setIsDirty?.(session.isDirty || draftIsDirty)
  }, [session, revision, draftIsDirty, setIsDirty])

  useEffect(() => () => setIsDirty?.(false), [setIsDirty])

  useEffect(
    () => () => {
      openRequestId.current += 1
      importTaskRef.current?.cancel()
      importTaskRef.current = null
      exportTaskRef.current?.cancel()
      exportTaskRef.current = null
      saveCheckpointRef.current = null
      if (exportProgressTimerRef.current !== null) window.clearTimeout(exportProgressTimerRef.current)
    },
    [],
  )

  const getRowHeight = useCallback(
    (zeroBasedRow: number) => {
      if (isRowHidden(sheet, zeroBasedRow + 1)) return 0
      if (resizePreview?.axis === 'row' && resizePreview.index === zeroBasedRow + 1) return resizePreview.size
      const customHeight = sheet.rowMetadata.get(zeroBasedRow + 1)?.height
      return customHeight
        ? Math.max(MIN_ROW_HEIGHT, Math.min(MAX_ROW_HEIGHT, customHeight * (4 / 3)))
        : defaultRowHeight
    },
    [defaultRowHeight, resizePreview, sheet],
  )

  const getColumnWidth = useCallback(
    (zeroBasedColumn: number) => {
      if (resizePreview?.axis === 'column' && resizePreview.index === zeroBasedColumn + 1) return resizePreview.size
      const customWidth = sheet.columnMetadata.get(zeroBasedColumn + 1)?.width
      return customWidth
        ? Math.max(MIN_COLUMN_WIDTH, Math.min(MAX_COLUMN_WIDTH, customWidth * 7 + 5))
        : DEFAULT_COLUMN_WIDTH
    },
    [resizePreview, sheet],
  )

  const getScaledRowHeight = useCallback(
    (zeroBasedRow: number) => getRowHeight(zeroBasedRow) * zoomScale,
    [getRowHeight, zoomScale],
  )
  const getScaledColumnWidth = useCallback(
    (zeroBasedColumn: number) => getColumnWidth(zeroBasedColumn) * zoomScale,
    [getColumnWidth, zoomScale],
  )

  const ensureViewport = useCallback((row: number, column: number) => {
    setViewportSize((current) => {
      const next = growViewport(current, row, column)
      return next.rows === current.rows && next.columns === current.columns ? current : next
    })
  }, [])

  const frozen = frozenAxes(sheet)
  const frozenHeight = frozen.rows ? getScaledRowHeight(0) : 0
  const frozenWidth = frozen.columns ? getScaledColumnWidth(0) : 0
  const rowRangeExtractor = useCallback(
    (range: Parameters<typeof defaultRangeExtractor>[0]) =>
      includeFrozenIndex(defaultRangeExtractor(range), frozen.rows),
    [frozen.rows],
  )
  const columnRangeExtractor = useCallback(
    (range: Parameters<typeof defaultRangeExtractor>[0]) =>
      includeFrozenIndex(defaultRangeExtractor(range), frozen.columns),
    [frozen.columns],
  )
  const rowVirtualizer = useVirtualizer({
    count: viewportSize.rows,
    getScrollElement: () => scrollElement.current,
    estimateSize: getScaledRowHeight,
    overscan: 6,
    rangeExtractor: rowRangeExtractor,
    scrollPaddingStart: frozenHeight,
    scrollPaddingEnd: columnHeaderHeight * zoomScale,
    initialRect: { width: 960, height: 480 },
  })
  const columnVirtualizer = useVirtualizer({
    count: viewportSize.columns,
    getScrollElement: () => scrollElement.current,
    estimateSize: getScaledColumnWidth,
    horizontal: true,
    overscan: 4,
    rangeExtractor: columnRangeExtractor,
    scrollPaddingStart: frozenWidth,
    scrollPaddingEnd: ROW_HEADER_WIDTH * zoomScale,
    initialRect: { width: 960, height: 480 },
  })
  const virtualRows = rowVirtualizer.getVirtualItems().filter((row) => !isRowHidden(sheet, row.index + 1))
  const virtualColumns = columnVirtualizer.getVirtualItems()

  useLayoutEffect(() => {
    rowVirtualizer.measure()
    columnVirtualizer.measure()
  }, [
    getScaledRowHeight,
    getScaledColumnWidth,
    sheet.rowMetadata,
    sheet.columnMetadata,
    rowVirtualizer,
    columnVirtualizer,
  ])

  useEffect(() => {
    const scroll = scrollElement.current
    if (!scroll || scroll.clientHeight === 0 || scroll.clientWidth === 0) return
    const lastRow = virtualRows.at(-1)?.index ?? 0
    const lastColumn = virtualColumns.at(-1)?.index ?? 0
    const nearBottom =
      scroll.scrollTop + scroll.clientHeight >= scroll.scrollHeight - getRowHeight(lastRow) * VIEWPORT_GROW_BUFFER
    const nearRight =
      scroll.scrollLeft + scroll.clientWidth >= scroll.scrollWidth - getColumnWidth(lastColumn) * VIEWPORT_GROW_BUFFER
    ensureViewport(nearBottom ? lastRow + 1 : 1, nearRight ? lastColumn + 1 : 1)
  }, [virtualRows, virtualColumns, ensureViewport, getRowHeight, getColumnWidth])

  useEffect(() => {
    ensureViewport(selection.active.row, selection.active.column)
  }, [selection.active, ensureViewport])

  useLayoutEffect(() => {
    if (isRowHidden(sheet, selection.active.row)) {
      setSelection(createSelection({ ...selection.active, row: visibleRow(sheet, selection.active.row, 1) }))
    }
  }, [sheet, sheet.rowMetadata, selection.active])

  const revealedCell = useRef('')
  useEffect(() => {
    // Growing the scroll window must not snap back to an unchanged active cell.
    // A navigation beyond the current window waits for ensureViewport to extend it.
    const target = `${activeSheetId}:${selection.active.row}:${selection.active.column}`
    if (
      revealedCell.current === target ||
      selection.active.row > viewportSize.rows ||
      selection.active.column > viewportSize.columns
    )
      return
    revealedCell.current = target
    if (!(frozen.rows && selection.active.row === 1))
      rowVirtualizer.scrollToIndex(selection.active.row - 1, { align: 'auto' })
    if (!(frozen.columns && selection.active.column === 1))
      columnVirtualizer.scrollToIndex(selection.active.column - 1, { align: 'auto' })
  }, [
    selection.active.row,
    selection.active.column,
    viewportSize.rows,
    viewportSize.columns,
    rowVirtualizer,
    columnVirtualizer,
    frozen.rows,
    frozen.columns,
    activeSheetId,
  ])

  const updateEditDraft = (next: EditDraft | null) => {
    editDraftRef.current = next
    setEditDraftState(next)
  }

  const makeEditDraft = (
    origin: EditDraft['origin'],
    text?: string,
    address = selection.active,
    sheetId = activeSheetId,
  ): EditDraft => {
    const current = editDraftRef.current
    const sameTarget =
      current?.sheetId === sheetId && current.address.row === address.row && current.address.column === address.column
    const initialText = sameTarget
      ? current.initialText
      : getCellEditText(session.getCell(sheetId, address), locale, session.workbook.dateSystem)
    return {
      sheetId,
      address: { ...address },
      initialText,
      text: text ?? (sameTarget ? current.text : initialText),
      origin,
    }
  }

  const commitEdit = (fillSelection = false): boolean => {
    const current = editDraftRef.current
    if (!current) return true
    if (!fillSelection && current.text === current.initialText) {
      updateEditDraft(null)
      return true
    }
    const value =
      current.text === current.initialText
        ? (session.getCell(current.sheetId, current.address)?.value ?? { kind: 'blank' as const })
        : inferCellValue(current.text, locale, session.workbook.dateSystem)
    try {
      if (fillSelection) {
        const ranges =
          current.sheetId === activeSheetId && selection.ranges.length > 0
            ? selection.ranges
            : [{ start: current.address, end: current.address }]
        const addresses = new Set<string>()
        for (const range of ranges) {
          for (let row = range.start.row; row <= range.end.row; row += 1) {
            for (let column = range.start.column; column <= range.end.column; column += 1) {
              addresses.add(formatCellAddress({ row, column }))
              if (addresses.size > MAX_FILL_CELLS) {
                setNotice(copy.fillSelectionLimit)
                return false
              }
            }
          }
        }
        session.setCells(
          current.sheetId,
          [...addresses].map((address) => ({ address, value })),
        )
      } else {
        session.setCell(current.sheetId, current.address, value)
      }
    } catch {
      setNotice(copy.editFailed)
      return false
    }
    updateEditDraft(null)
    setNotice(copy.editCommitted)
    return true
  }

  const applySelectedStyles = (update: (style: CellStyle) => CellStyle | null) => {
    const addresses = getSelectionAddresses(selection)
    if (!addresses) {
      setNotice(copy.formatSelectionLimit)
      return
    }
    try {
      session.formatCells(
        activeSheetId,
        addresses.map((address) => {
          const current = session.getCell(activeSheetId, address)?.style ?? {}
          const next = update(structuredClone(current))
          return { address, style: next && Object.keys(next).length > 0 ? next : null }
        }),
      )
    } catch {
      setNotice(copy.formatFailed)
    }
  }

  const setSelectedNumberFormat = (key: NumberFormatKey) => {
    const format = NUMBER_FORMAT_PRESETS[key]
    applySelectedStyles((style) => {
      if (format) style.numberFormat = format
      else delete style.numberFormat
      return style
    })
  }

  const updateSelectedFont = (update: (font: NonNullable<CellStyle['font']>) => NonNullable<CellStyle['font']>) => {
    applySelectedStyles((style) => {
      style.font = update(style.font ?? {})
      return style
    })
  }

  const toggleSelectedFont = (key: 'bold' | 'italic' | 'underline') => {
    const next = !activeCell?.style?.font?.[key]
    updateSelectedFont((font) => ({ ...font, [key]: next }))
  }

  const setSelectedTextColor = (color: string) => {
    updateSelectedFont((font) => ({ ...font, color }))
  }

  const setSelectedFontFamily = (name: string) => {
    updateSelectedFont((font) => {
      if (name) font.name = name
      else delete font.name
      return font
    })
  }

  const setSelectedFontSize = (size: string) => {
    const parsed = Number(size)
    updateSelectedFont((font) => {
      if (Number.isFinite(parsed) && parsed > 0) font.size = parsed
      else delete font.size
      return font
    })
  }

  const setSelectedFillColor = (color: string) => {
    applySelectedStyles((style) => {
      style.fill = { ...style.fill, color, pattern: 'solid' }
      return style
    })
  }

  const toggleSelectedWrap = () => {
    const next = !activeCell?.style?.alignment?.wrapText
    applySelectedStyles((style) => {
      style.alignment = { ...style.alignment, wrapText: next }
      return style
    })
  }

  const setSelectedAlignment = (horizontal: NonNullable<CellStyle['alignment']>['horizontal']) => {
    if (!horizontal) return
    applySelectedStyles((style) => {
      style.alignment = { ...style.alignment, horizontal }
      return style
    })
  }

  const clearSelectedFormats = () => applySelectedStyles(() => null)

  const adjustSelectedDecimals = (delta: -1 | 1) => {
    if (isDateNumberFormat(activeCell?.style?.numberFormat)) return
    applySelectedStyles((style) => {
      if (!isDateNumberFormat(style.numberFormat)) style.numberFormat = adjustDecimalPlaces(style.numberFormat, delta)
      return style
    })
  }

  const insertFormulaFunction = (name: string) => {
    const input = formulaInputElement.current
    const current = editDraftRef.current
    const base =
      current?.sheetId === activeSheetId &&
      current.address.row === selection.active.row &&
      current.address.column === selection.active.column
        ? current.text
        : getCellEditText(activeCell, locale, session.workbook.dateSystem)
    const hasFormula = base.startsWith('=')
    const formula = hasFormula ? base : '='
    const cursor = hasFormula ? (formulaFunctionCursor.current ?? input?.selectionStart ?? formula.length) : 1
    const insertAt = Math.max(1, Math.min(cursor, formula.length))
    const text = `${formula.slice(0, insertAt)}${name}(${formula.slice(insertAt)}`
    formulaFunctionCursor.current = null
    beginEdit('formula-bar', text)
    requestAnimationFrame(() => {
      formulaInputElement.current?.focus()
      formulaInputElement.current?.setSelectionRange(insertAt + name.length + 1, insertAt + name.length + 1)
    })
  }

  const openFormulaFunctionDialog = () => {
    setFormulaFunctionSearch('')
    setFormulaFunctionsOpen(true)
  }

  const closeFormulaFunctionDialog = () => {
    const current = editDraftRef.current
    const shouldRestoreFormulaFocus =
      current?.sheetId === activeSheetId &&
      current.address.row === selection.active.row &&
      current.address.column === selection.active.column
    const cursor = formulaFunctionCursor.current
    setFormulaFunctionsOpen(false)
    setFormulaFunctionSearch('')
    formulaFunctionCursor.current = null
    if (shouldRestoreFormulaFocus) {
      requestAnimationFrame(() => {
        const input = formulaInputElement.current
        if (!input) return
        input.focus()
        if (cursor !== null) input.setSelectionRange(cursor, cursor)
      })
    }
  }

  const chooseFormulaFunction = (name: string) => {
    setFormulaFunctionsOpen(false)
    setFormulaFunctionSearch('')
    insertFormulaFunction(name)
  }

  const cancelEdit = () => {
    updateEditDraft(null)
    setNotice(copy.editCanceled)
  }

  const beginEdit = (origin: EditDraft['origin'], text?: string, address = selection.active) => {
    updateEditDraft(makeEditDraft(origin, text, address))
  }

  const updateSelection = (next: GridSelection) => {
    if (isRowHidden(sheet, next.active.row)) {
      const row = visibleRow(sheet, next.active.row, next.active.row < selection.active.row ? -1 : 1)
      next = selectCell(
        next,
        { ...next.active, row },
        { extend: next.ranges.some((r) => r.start.row !== r.end.row || r.start.column !== r.end.column) },
      )
    }
    const current = editDraftRef.current
    const targetChanged =
      current &&
      (current.sheetId !== activeSheetId ||
        current.address.row !== next.active.row ||
        current.address.column !== next.active.column)
    if (targetChanged && !commitEdit()) return
    setSelection(next)
    ensureViewport(next.active.row, next.active.column)
    setNotice('')
  }

  const handleNameBoxKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key !== 'Enter') return
    event.preventDefault()
    try {
      const range = parseRangeAddress(nameBoxValue)
      updateSelection({ anchor: range.start, active: range.end, ranges: [range] })
      focusGrid()
    } catch (error) {
      if (!(error instanceof AddressError)) throw error
      setNameBoxValue(selectedRange)
      setNotice(copy.invalidAddress)
    }
  }

  const focusGrid = useCallback(() => {
    gridElement.current?.focus({ preventScroll: true })
  }, [])

  useEffect(() => {
    if (editDraft?.origin !== 'cell') return
    cellEditorElement.current?.focus({ preventScroll: true })
    const end = editDraftRef.current?.text.length ?? 0
    cellEditorElement.current?.setSelectionRange(end, end)
  }, [editDraft?.origin])

  useLayoutEffect(() => {
    const cursor = draftCursor.current
    draftCursor.current = null
    if (cursor && document.activeElement === cursor.input) cursor.input.setSelectionRange(cursor.offset, cursor.offset)
  }, [editDraft])

  useEffect(() => {
    if (!contextMenu) return
    contextMenuElement.current?.querySelector<HTMLButtonElement>('[role="menuitem"]:not(:disabled)')?.focus()
  }, [contextMenu])

  useEffect(() => {
    if (pendingImport) preflightDialogElement.current?.focus({ preventScroll: true })
  }, [pendingImport])

  useEffect(() => {
    if (pendingSave) saveDialogElement.current?.focus({ preventScroll: true })
  }, [pendingSave])

  useLayoutEffect(() => {
    const menu = contextMenuElement.current
    const canvas = scrollElement.current?.getBoundingClientRect()
    const origin = menu?.closest('.grid-app')?.getBoundingClientRect()
    if (!contextMenu || !menu || !canvas || !origin) return
    // Keep every action inside the canvas stacking area, above the sheet footer.
    const top = Math.max(8, canvas.top + 8)
    const bottom = Math.min(window.innerHeight - 8, canvas.bottom - 8)
    menu.style.maxHeight = `${Math.max(44, bottom - top)}px`
    const bounds = menu.getBoundingClientRect()
    // Layout containment makes the app the fixed-position containing block.
    // Pointer/canvas coordinates are viewport coordinates; remove that origin.
    menu.style.top = `${Math.max(top, Math.min(contextMenu.y, bottom - bounds.height)) - origin.top}px`
    menu.style.left = `${Math.max(canvas.left + 8, Math.min(contextMenu.x, canvas.right - bounds.width - 8)) - origin.left}px`
  }, [contextMenu])

  const openContextMenuAt = (x: number, y: number, eventTarget?: HTMLElement | null) => {
    if (editDraftRef.current && !commitEdit()) return
    const target = eventTarget ?? (document.elementFromPoint?.(x, y) as HTMLElement | null)
    const cell = target?.closest<HTMLElement>('[data-cell-address]')
    const rowHeader = target?.closest<HTMLElement>('[data-row-header]')
    const columnHeader = target?.closest<HTMLElement>('[data-column-header]')
    let next = selection
    let targetType: ContextMenuState['targetType'] = 'cell'

    if (rowHeader) {
      targetType = 'row'
      const row = Number(rowHeader.dataset.rowHeader)
      const alreadySelected = selection.ranges.some(
        (range) => row >= range.start.row && row <= range.end.row && range.start.column === 1,
      )
      if (!alreadySelected) next = selectRange(selection, `A${row}:${columnNumberToName(viewportSize.columns)}${row}`)
    } else if (columnHeader) {
      targetType = 'column'
      const column = Number(columnHeader.dataset.columnHeader)
      const alreadySelected = selection.ranges.some(
        (range) => column >= range.start.column && column <= range.end.column && range.start.row === 1,
      )
      if (!alreadySelected) {
        const label = columnNumberToName(column)
        next = selectRange(selection, `${label}1:${label}${viewportSize.rows}`)
      }
    } else if (cell) {
      const address = parseCellAddress(cell.dataset.cellAddress!)
      if (!isSelected(selection, address)) next = selectCell(selection, address)
    }

    if (next !== selection) updateSelection(next)
    const range = next.ranges[0] ?? { start: next.active, end: next.active }
    const row = rowHeader ? Number(rowHeader.dataset.rowHeader) : next.active.row
    const column = columnHeader ? Number(columnHeader.dataset.columnHeader) : next.active.column
    setContextMenu({
      x: Math.max(8, Math.min(x, window.innerWidth - 260)),
      y: Math.max(8, Math.min(y, window.innerHeight - 360)),
      selection: next,
      sheetId: activeSheetId,
      targetType,
      row,
      column,
      rowCount: targetType === 'row' ? range.end.row - range.start.row + 1 : 1,
      columnCount: targetType === 'column' ? range.end.column - range.start.column + 1 : 1,
    })
  }

  const handleContextMenuKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault()
      closeContextMenu(true)
      return
    }
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return
    const items = [
      ...(contextMenuElement.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]:not(:disabled)') ?? []),
    ]
    const activeIndex = items.indexOf(document.activeElement as HTMLButtonElement)
    if (items.length === 0) return
    event.preventDefault()
    const delta = event.key === 'ArrowDown' ? 1 : -1
    items[(activeIndex + delta + items.length) % items.length]?.focus()
  }

  const clearSelectionContents = (targetSelection = selection, sheetId = activeSheetId) => {
    const values = new Map<string, { address: string; value: { kind: 'blank' } }>()
    for (const range of targetSelection.ranges) {
      for (const [address] of session.getRange(sheetId, range).cells) {
        values.set(address, { address, value: { kind: 'blank' } })
      }
    }
    if (values.size) session.setCells(sheetId, [...values.values()])
    setNotice(values.size ? copy.contentsCleared : copy.nothingToClear)
  }

  const performUndo = () => {
    if (editDraftRef.current && !commitEdit()) return
    setNotice(session.undo() ? copy.undoDone : copy.nothingToUndo)
    focusGrid()
  }

  const performRedo = () => {
    if (editDraftRef.current && !commitEdit()) return
    setNotice(session.redo() ? copy.redoDone : copy.nothingToRedo)
    focusGrid()
  }

  const changeDraftText = (text: string, origin: EditDraft['origin']) => {
    updateEditDraft(makeEditDraft(origin, text))
  }

  const insertDraftNewline = (event: KeyboardEvent<HTMLTextAreaElement>, origin: EditDraft['origin']) => {
    event.preventDefault()
    const input = event.currentTarget
    const start = input.selectionStart
    const end = input.selectionEnd
    draftCursor.current = { input, offset: start + 1 }
    changeDraftText(`${input.value.slice(0, start)}\n${input.value.slice(end)}`, origin)
  }

  const closeContextMenu = (restoreFocus = false) => {
    setContextMenu(null)
    if (restoreFocus) focusGrid()
  }

  const advanceAfterTab = (backward: boolean) => {
    const next = { ...selection.active }
    next.column += backward ? -1 : 1
    if (next.column > viewportSize.columns) {
      next.column = 1
      next.row = Math.min(viewportSize.rows, next.row + 1)
    } else if (next.column < 1) {
      next.column = viewportSize.columns
      next.row = Math.max(1, next.row - 1)
    }
    updateSelection(selectCell(selection, next))
  }

  const performValuesClipboard = async (mode: 'copy' | 'paste', formulaMode = false) => {
    if (clipboardBusy.current || editDraftRef.current) return
    clipboardBusy.current = true
    const checkpoint = session.createSaveCheckpoint()
    const initial = clipboardContext.current
    setContextMenu(null)
    try {
      if (initial.selection.ranges.length !== 1) throw new Error('Disjoint selection')
      if (mode === 'copy') {
        valuesClipboard.current = null
        const formulas = formulaMode
          ? copyFormulas(session, initial.activeSheetId, initial.selection.ranges)
          : undefined
        const values = formulaMode ? [] : copyValues(session, initial.activeSheetId, initial.selection.ranges)
        const text = formulas ? formulaCopyText(formulas) : valuesToTsv(values)
        const token =
          typeof ClipboardItem !== 'undefined' &&
          ClipboardItem.supports?.(VALUES_CLIPBOARD_TYPE) &&
          typeof navigator.clipboard.write === 'function' &&
          typeof navigator.clipboard.read === 'function'
            ? crypto.randomUUID()
            : null
        if (formulaMode && !token) throw new Error('Verified clipboard transport unavailable')
        if (token) {
          await navigator.clipboard.write([
            new ClipboardItem({
              'text/plain': new Blob([text], { type: 'text/plain' }),
              [VALUES_CLIPBOARD_TYPE]: new Blob([token], { type: 'application/x-allsuite-grid-values-token' }),
            }),
          ])
        } else await navigator.clipboard.writeText(text)
        if (session.workbook !== checkpoint.workbook) throw new Error('Workbook replaced')
        if (token) valuesClipboard.current = { token, text, values, formulas, workbook: checkpoint.workbook }
        setNotice(formulaMode ? copy.formulasCopied : copy.valuesCopied)
      } else {
        let text: string
        let token: string | null = null
        if (typeof navigator.clipboard.read === 'function') {
          // Both representations must come from one clipboard read/item, never a text-only match.
          const [item] = await navigator.clipboard.read()
          if (!item?.types.includes('text/plain')) throw new Error('Missing clipboard text')
          text = await (await item.getType('text/plain')).text()
          if (item.types.includes(VALUES_CLIPBOARD_TYPE))
            token = await (await item.getType(VALUES_CLIPBOARD_TYPE)).text()
        } else text = await navigator.clipboard.readText()
        const current = session.createSaveCheckpoint()
        if (
          current.workbook !== checkpoint.workbook ||
          current.token !== checkpoint.token ||
          clipboardContext.current.selection !== initial.selection ||
          clipboardContext.current.activeSheetId !== initial.activeSheetId ||
          editDraftRef.current
        )
          throw new Error('Target changed')
        const internal = valuesClipboard.current
        // Windows clipboard normalizes LF to CRLF, including quoted multiline fields.
        const verified = verifiedClipboardCopy(internal, token, text, session.workbook)
        let range
        const start = initial.selection.ranges[0].start
        if (formulaMode) {
          if (!verified || !internal?.formulas) throw new Error('Unverified formula clipboard')
          const revision = session.currentRevision
          const rows = await prepareFormulaPasteInWorker(
            session.workbook,
            initial.activeSheetId,
            start,
            internal.formulas,
          )
          if (
            session.workbook !== checkpoint.workbook ||
            session.currentRevision !== revision ||
            clipboardContext.current.selection !== initial.selection ||
            clipboardContext.current.activeSheetId !== initial.activeSheetId ||
            editDraftRef.current
          )
            throw new Error('Target changed during formula preflight')
          range = pasteFormulaBlock(session, initial.activeSheetId, start, rows)
        } else {
          const values = verified && !internal?.formulas ? internal!.values : parseValuesTsv(text)
          range = pasteValues(session, initial.activeSheetId, start, values)
        }
        updateSelection(selectRange(initial.selection, formatRangeAddress(range)))
        setNotice(formulaMode ? copy.formulasPasted : copy.valuesPasted)
      }
    } catch {
      setNotice(copy.clipboardRefused)
    } finally {
      clipboardBusy.current = false
      if (!editDraftRef.current && session.workbook === checkpoint.workbook) focusGrid()
    }
  }

  const handleGridKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    // Nested resize sliders and editors keep their own keyboard and Tab behavior.
    if (event.target !== event.currentTarget) return
    if (event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229) return
    if (event.key === 'Escape' && editDraftRef.current) {
      event.preventDefault()
      cancelEdit()
      return
    }
    if (event.key === 'Escape') {
      event.preventDefault()
      document.getElementById(`grid-command-${commandTab}`)?.focus()
      return
    }
    if (event.key === 'Enter' && (event.ctrlKey || event.metaKey) && editDraftRef.current) {
      event.preventDefault()
      if (commitEdit(true)) focusGrid()
      return
    }
    const extend = event.shiftKey
    const meta = event.ctrlKey || event.metaKey
    if (meta && ['c', 'v'].includes(event.key.toLowerCase())) {
      event.preventDefault()
      void performValuesClipboard(event.key.toLowerCase() === 'c' ? 'copy' : 'paste', event.altKey && event.shiftKey)
      return
    }
    const bounds = { rows: viewportSize.rows, columns: viewportSize.columns }
    const moves: Record<string, [number, number]> = {
      ArrowUp: [-1, 0],
      ArrowDown: [1, 0],
      ArrowLeft: [0, -1],
      ArrowRight: [0, 1],
    }

    if (meta && event.key.toLowerCase() === 'z') {
      event.preventDefault()
      if (event.shiftKey) performRedo()
      else performUndo()
      return
    }
    if (meta && event.key.toLowerCase() === 'y') {
      event.preventDefault()
      performRedo()
      return
    }
    if (event.key === 'Delete' || event.key === 'Backspace') {
      event.preventDefault()
      clearSelectionContents()
      return
    }
    if (event.key === 'ContextMenu' || (event.key === 'F10' && event.shiftKey)) {
      event.preventDefault()
      const cell = gridElement.current?.querySelector<HTMLElement>(`[data-cell-address="${activeAddress}"]`)
      const bounds = cell?.getBoundingClientRect()
      openContextMenuAt(bounds?.left ?? 8, bounds?.bottom ?? 8, cell)
      return
    }

    if (moves[event.key]) {
      event.preventDefault()
      updateSelection(moveSelection(selection, ...moves[event.key], bounds, extend))
      return
    }
    if (event.key === 'Tab') {
      event.preventDefault()
      advanceAfterTab(event.shiftKey)
      return
    }
    if (event.key === 'Enter') {
      event.preventDefault()
      updateSelection(moveSelection(selection, event.shiftKey ? -1 : 1, 0, bounds))
      return
    }
    if (event.key === 'Home' || event.key === 'End') {
      event.preventDefault()
      if (meta) {
        if (event.key === 'Home') updateSelection(selectCell(selection, { row: 1, column: 1 }, { extend }))
        else {
          const usedRange = sheet.dimensions.usedRange
          updateSelection(selectCell(selection, usedRange?.end ?? { row: 1, column: 1 }, { extend }))
        }
      } else updateSelection(moveToEdge(selection, 'column', event.key === 'Home' ? 'start' : 'end', bounds, extend))
      return
    }
    if (event.key === 'PageUp' || event.key === 'PageDown') {
      event.preventDefault()
      const pageRows = Math.max(1, Math.floor((scrollElement.current?.clientHeight || 480) / defaultRowHeight))
      updateSelection(moveSelection(selection, event.key === 'PageUp' ? -pageRows : pageRows, 0, bounds, extend))
      return
    }
    if (event.key === 'F2') {
      event.preventDefault()
      beginEdit('cell')
      return
    }
    if (event.key.length === 1 && !meta && !event.altKey) {
      event.preventDefault()
      beginEdit('cell', event.key)
    }
  }

  const handleCellEditorKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    event.stopPropagation()
    if (event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229) return
    const current = editDraftRef.current
    const unchangedDraft = current && current.text === current.initialText
    if ((event.ctrlKey || event.metaKey) && unchangedDraft && event.key.toLowerCase() === 'z') {
      event.preventDefault()
      if (event.shiftKey) performRedo()
      else performUndo()
      return
    }
    if ((event.ctrlKey || event.metaKey) && unchangedDraft && event.key.toLowerCase() === 'y') {
      event.preventDefault()
      performRedo()
      return
    }
    if (event.key === 'Enter' && event.altKey) {
      insertDraftNewline(event, 'cell')
      return
    }
    if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
      event.preventDefault()
      if (commitEdit(true)) focusGrid()
      return
    }
    if (event.key === 'Enter') {
      event.preventDefault()
      if (commitEdit()) {
        updateSelection(moveSelection(selection, event.shiftKey ? -1 : 1, 0, viewportSize))
        focusGrid()
      }
      return
    }
    if (event.key === 'Escape') {
      event.preventDefault()
      cancelEdit()
      focusGrid()
      return
    }
    if (event.key === 'Tab') {
      event.preventDefault()
      if (commitEdit()) {
        advanceAfterTab(event.shiftKey)
        focusGrid()
      }
    }
  }

  const handleFormulaKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229) return
    if (event.key === 'F2') {
      event.preventDefault()
      beginEdit('cell')
      return
    }
    const current = editDraftRef.current
    const unchangedDraft = !current || current.text === current.initialText
    if ((event.ctrlKey || event.metaKey) && unchangedDraft && event.key.toLowerCase() === 'z') {
      event.preventDefault()
      if (event.shiftKey) performRedo()
      else performUndo()
      return
    }
    if ((event.ctrlKey || event.metaKey) && unchangedDraft && event.key.toLowerCase() === 'y') {
      event.preventDefault()
      performRedo()
      return
    }
    if (event.key === 'Enter' && event.altKey) {
      insertDraftNewline(event, 'formula-bar')
      return
    }
    if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
      event.preventDefault()
      if (commitEdit(true)) focusGrid()
      return
    }
    if (event.key === 'Enter') {
      event.preventDefault()
      if (commitEdit()) {
        updateSelection(moveSelection(selection, event.shiftKey ? -1 : 1, 0, viewportSize))
        focusGrid()
      }
      return
    }
    if (event.key === 'Escape') {
      event.preventDefault()
      cancelEdit()
      focusGrid()
      return
    }
    if (event.key === 'Tab') {
      event.preventDefault()
      if (commitEdit()) {
        advanceAfterTab(event.shiftKey)
        focusGrid()
      }
    }
  }

  const handleCellEditorBlur = (event: FocusEvent<HTMLTextAreaElement>) => {
    const current = editDraftRef.current
    if (!current) return
    if (event.relatedTarget === formulaInputElement.current) {
      updateEditDraft({ ...current, origin: 'formula-bar' })
      return
    }
    if (shouldPreserveDraftForOpen(event.relatedTarget)) return
    commitEdit()
  }

  const handleFormulaBarFocus = () => {
    const current = editDraftRef.current
    if (
      current &&
      current.sheetId === activeSheetId &&
      current.address.row === selection.active.row &&
      current.address.column === selection.active.column
    ) {
      updateEditDraft({ ...current, origin: 'formula-bar' })
      return
    }
    beginEdit('formula-bar', getCellEditText(activeCell, locale, session.workbook.dateSystem))
  }

  const handleFormulaBarBlur = (event: FocusEvent<HTMLTextAreaElement>) => {
    if (event.relatedTarget instanceof HTMLElement && event.relatedTarget.closest('.grid-formula-functions-trigger')) {
      formulaFunctionCursor.current = event.currentTarget.selectionStart
    }
    const current = editDraftRef.current
    if (!current) return
    // The grid will commit if selection changes; returning to the same cell keeps one draft.
    if (event.relatedTarget === gridElement.current) return
    if (event.relatedTarget === cellEditorElement.current) {
      updateEditDraft({ ...current, origin: 'cell' })
      return
    }
    if (shouldPreserveDraftForOpen(event.relatedTarget)) return
    commitEdit()
  }

  const shouldPreserveDraftForOpen = (target: EventTarget | null): boolean => {
    if (pendingImport || pendingDelimited || importProgress || sortRange || filterRange || tableRange || chartDialog)
      return true
    return (
      target instanceof HTMLElement &&
      (target.hasAttribute('data-grid-open') ||
        target.closest('.grid-file-menu, .allsuite-editor-header-actions') !== null ||
        target.closest('.allsuite-ribbon-menu__items')?.getAttribute('aria-label') === copy.fileTab ||
        target.closest('.grid-file-input, .grid-formula-functions-trigger, .grid-formula-functions-dialog') !== null)
    )
  }

  const handleGridDoubleClick = (event: ReactMouseEvent<HTMLDivElement>) => {
    const cell = (event.target as HTMLElement).closest<HTMLElement>('[data-cell-address]')
    if (!cell) return
    event.preventDefault()
    const address = parseCellAddress(cell.dataset.cellAddress!)
    if (address.row !== selection.active.row || address.column !== selection.active.column) {
      updateSelection(selectCell(selection, address))
    }
    beginEdit('cell', undefined, address)
  }

  const handleGridContextMenu = (event: ReactMouseEvent<HTMLDivElement>) => {
    event.preventDefault()
    openContextMenuAt(event.clientX, event.clientY, event.target as HTMLElement)
  }

  const runContextMenuAction = async (
    action: 'clear' | 'insert-row' | 'delete-row' | 'insert-column' | 'delete-column',
  ) => {
    const menu = contextMenu
    if (!menu || (editDraftRef.current && !commitEdit())) return
    try {
      if (action === 'clear') clearSelectionContents(menu.selection, menu.sheetId)
      if (action === 'insert-row')
        await editWorkbookRows(
          session,
          menu.sheetId,
          menu.targetType === 'row' ? menu.selection.ranges[0].start.row : menu.row,
          menu.rowCount,
        )
      if (action === 'delete-row')
        await editWorkbookRows(
          session,
          menu.sheetId,
          menu.targetType === 'row' ? menu.selection.ranges[0].start.row : menu.row,
          menu.rowCount,
          false,
        )
      if (action === 'insert-column')
        await editWorkbookColumns(
          session,
          menu.sheetId,
          menu.targetType === 'column' ? menu.selection.ranges[0].start.column : menu.column,
          menu.columnCount,
        )
      if (action === 'delete-column')
        await editWorkbookColumns(
          session,
          menu.sheetId,
          menu.targetType === 'column' ? menu.selection.ranges[0].start.column : menu.column,
          menu.columnCount,
          false,
        )
      if (action !== 'clear') {
        rowVirtualizer.measure()
        columnVirtualizer.measure()
        setNotice(copy.structureChanged)
      }
      closeContextMenu(true)
    } catch {
      setNotice(copy.structureFailed)
    }
  }

  const startResize = (event: PointerEvent<HTMLDivElement>, axis: ResizeAxis, index: number, size: number) => {
    event.stopPropagation()
    if (event.pointerType !== 'touch') event.preventDefault()
    const pointerStart = axis === 'column' ? event.clientX : event.clientY
    const drag = { axis, index, pointerStart, initialSize: size, size }
    resizeDrag.current = drag
    setResizePreview(drag)
    if (event.currentTarget.setPointerCapture && event.pointerId >= 0)
      event.currentTarget.setPointerCapture(event.pointerId)
  }

  const handleResizePointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const current = resizeDrag.current
    if (!current) return
    const currentPointer = current.axis === 'column' ? event.clientX : event.clientY
    const limit = current.axis === 'column' ? [MIN_COLUMN_WIDTH, MAX_COLUMN_WIDTH] : [MIN_ROW_HEIGHT, MAX_ROW_HEIGHT]
    const size = Math.max(
      limit[0],
      Math.min(limit[1], current.initialSize + (currentPointer - current.pointerStart) / zoomScale),
    )
    const updated = { ...current, size }
    resizeDrag.current = updated
    setResizePreview(updated)
  }

  const commitResize = (axis: ResizeAxis, index: number, size: number) => {
    if (axis === 'column')
      session.setColumnMetadata(activeSheetId, index, {
        ...sheet.columnMetadata.get(index),
        width: Math.max(1, (size - 5) / 7),
      })
    else session.setRowMetadata(activeSheetId, index, { ...sheet.rowMetadata.get(index), height: size * 0.75 })
    rowVirtualizer.measure()
    columnVirtualizer.measure()
  }

  const finishResize = () => {
    const current = resizeDrag.current
    if (!current) return
    commitResize(current.axis, current.index, current.size)
    resizeDrag.current = null
    setResizePreview(null)
  }

  const handlePointerDown = (event: PointerEvent<HTMLDivElement>) => {
    const target = event.target as HTMLElement
    if (contextMenu && !target.closest('[role="menu"]')) closeContextMenu()
    if (event.button === 2) return
    if (target.closest('.grid-cell-editor')) return
    const resizeHandle = target.closest<HTMLElement>('[data-resize-axis]')
    if (resizeHandle) {
      const axis = resizeHandle.dataset.resizeAxis as ResizeAxis
      const index = Number(resizeHandle.dataset.resizeIndex)
      const size = axis === 'column' ? getColumnWidth(index - 1) : getRowHeight(index - 1)
      startResize(event, axis, index, size)
      return
    }

    const cell = target.closest<HTMLElement>('[data-cell-address]')
    if (cell) {
      const address = parseCellAddress(cell.dataset.cellAddress!)
      focusGrid()
      if (event.pointerType === 'touch') {
        const now = Date.now()
        const previous = lastTouchCell.current
        const doubleTap =
          previous &&
          previous.address.row === address.row &&
          previous.address.column === address.column &&
          now - previous.time <= 900
        lastTouchCell.current = doubleTap ? null : { address, time: now }
        if (doubleTap) {
          event.preventDefault()
          updateSelection(selectCell(selection, address))
          beginEdit('cell', undefined, address)
          return
        }
      } else lastTouchCell.current = null
      const touchRangeDrag = event.pointerType === 'touch' && rangeDragMode
      if (event.pointerType !== 'touch' || touchRangeDrag) event.preventDefault()
      updateSelection(
        selectCell(selection, address, { extend: event.shiftKey, toggle: event.ctrlKey || event.metaKey }),
      )
      draggingSelection.current =
        (event.pointerType !== 'touch' || touchRangeDrag) && !event.shiftKey && !event.ctrlKey && !event.metaKey
      if (draggingSelection.current && cell.setPointerCapture && event.pointerId >= 0)
        cell.setPointerCapture(event.pointerId)
      return
    }

    const rowHeader = target.closest<HTMLElement>('[data-row-header]')
    if (rowHeader) {
      const row = Number(rowHeader.dataset.rowHeader)
      updateSelection(selectRange(selection, `A${row}:${columnNumberToName(viewportSize.columns)}${row}`))
      focusGrid()
      return
    }
    const columnHeader = target.closest<HTMLElement>('[data-column-header]')
    if (columnHeader) {
      const column = Number(columnHeader.dataset.columnHeader)
      const label = columnNumberToName(column)
      updateSelection(selectRange(selection, `${label}1:${label}${viewportSize.rows}`))
      focusGrid()
      return
    }
    if (target.closest('[data-select-all]')) {
      updateSelection(selectRange(selection, `A1:${columnNumberToName(viewportSize.columns)}${viewportSize.rows}`))
      focusGrid()
    }
  }

  const handlePointerMove = (event: PointerEvent<HTMLDivElement>) => {
    if (resizeDrag.current) {
      handleResizePointerMove(event)
      return
    }
    if (!draggingSelection.current || (event.pointerType === 'touch' && !rangeDragMode)) return
    const pointTarget = document.elementFromPoint?.(event.clientX, event.clientY)
    const cell = (pointTarget ?? (event.target as HTMLElement)).closest<HTMLElement>('[data-cell-address]')
    if (!cell) return
    const address = parseCellAddress(cell.dataset.cellAddress!)
    updateSelection(selectCell(selection, address, { extend: true }))
  }

  const handlePointerOver = (event: PointerEvent<HTMLDivElement>) => {
    if (!draggingSelection.current || (event.pointerType === 'touch' && !rangeDragMode)) return
    const cell = (event.target as HTMLElement).closest<HTMLElement>('[data-cell-address]')
    if (!cell) return
    const address = parseCellAddress(cell.dataset.cellAddress!)
    if (address.row === selection.active.row && address.column === selection.active.column) return
    updateSelection(selectCell(selection, address, { extend: true }))
  }

  const handlePointerUp = () => {
    if (resizeDrag.current) finishResize()
    draggingSelection.current = false
  }

  const cancelPointerGesture = () => {
    draggingSelection.current = false
    resizeDrag.current = null
    setResizePreview(null)
  }

  const handleResizeKeyDown = (
    event: KeyboardEvent<HTMLDivElement>,
    axis: ResizeAxis,
    index: number,
    currentSize: number,
  ) => {
    const keyDelta =
      axis === 'column'
        ? event.key === 'ArrowLeft'
          ? -8
          : event.key === 'ArrowRight'
            ? 8
            : 0
        : event.key === 'ArrowUp'
          ? 4
          : event.key === 'ArrowDown'
            ? -4
            : 0
    if (!keyDelta) return
    event.preventDefault()
    event.stopPropagation()
    const min = axis === 'column' ? MIN_COLUMN_WIDTH : MIN_ROW_HEIGHT
    const max = axis === 'column' ? MAX_COLUMN_WIDTH : MAX_ROW_HEIGHT
    commitResize(axis, index, Math.max(min, Math.min(max, currentSize + keyDelta)))
  }

  const switchSheet = (sheetId: string) => {
    if (!commitEdit()) return
    session.activateSheet(sheetId)
    setActiveSheetId(sheetId)
    const next = createSelection({ row: 1, column: 1 })
    setSelection(next)
    setViewportSize({ rows: INITIAL_VIEWPORT_ROWS, columns: INITIAL_VIEWPORT_COLUMNS })
    if (scrollElement.current) scrollElement.current.scrollTo({ top: 0, left: 0 })
    focusGrid()
  }

  const addSheet = () => {
    if (!commitEdit()) return
    const name = `Sheet${session.workbook.sheetOrder.length + 1}`
    try {
      const sheetId = session.createSheet(name)
      setActiveSheetId(sheetId)
      setSelection(createSelection({ row: 1, column: 1 }))
      setNotice(copy.sheetAdded)
      focusGrid()
    } catch {
      setNotice(copy.sheetAddFailed)
    }
  }

  const openSheetRename = (sheetId: string) => {
    if (!commitEdit()) return
    const sheet = session.workbook.sheetsById.get(sheetId)
    if (!sheet) return
    setSheetRenameId(sheetId)
    setSheetRenameName(sheet.name)
    setSheetRenameError(undefined)
  }

  const closeSheetRename = () => {
    setSheetRenameId(null)
    setSheetRenameError(undefined)
  }

  const submitSheetRename = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!sheetRenameId) return
    const sheet = session.workbook.sheetsById.get(sheetRenameId)
    if (!sheet) {
      closeSheetRename()
      return
    }
    if (sheetRenameName === sheet.name) {
      closeSheetRename()
      return
    }
    try {
      if (!session.renameSheet(sheetRenameId, sheetRenameName)) {
        setSheetRenameError(copy.invalidSheetName)
        return
      }
      setNotice(copy.sheetRenamed)
      closeSheetRename()
    } catch {
      setSheetRenameError(copy.invalidSheetName)
    }
  }

  const createNewWorkbook = () => {
    const pending = editDraftRef.current
    const hasUnsavedChanges = session.isDirty || Boolean(pending && pending.text !== pending.initialText)
    if (hasUnsavedChanges && !window.confirm(copy.confirmNew)) return
    invalidateSave()
    openRequestId.current += 1
    importTaskRef.current?.cancel()
    importTaskRef.current = null
    setPendingImport(null)
    setPendingDelimited(null)
    setImportProgress(null)
    const workbook = createWorkbook({ firstSheetName: 'Sheet1' })
    session.replaceWorkbook(workbook)
    currentSaveHandleRef.current = null
    importedSourceRef.current = null
    pendingOpenHandleRef.current = null
    currentFileNameRef.current = 'Book1.xlsx'
    updateEditDraft(null)
    closeContextMenu()
    setActiveSheetId(workbook.activeSheetId)
    setSelection(createSelection({ row: 1, column: 1 }))
    setViewportSize({ rows: INITIAL_VIEWPORT_ROWS, columns: INITIAL_VIEWPORT_COLUMNS })
    if (scrollElement.current) scrollElement.current.scrollTo({ top: 0, left: 0 })
    setNotice(copy.newCreated)
    focusGrid()
  }

  const restoreEditFocus = useCallback(() => {
    const current = editDraftRef.current
    if (!current) {
      focusGrid()
      return
    }
    window.setTimeout(() => {
      if (current.origin === 'cell') cellEditorElement.current?.focus({ preventScroll: true })
      else formulaInputElement.current?.focus({ preventScroll: true })
    }, 0)
  }, [focusGrid])

  const importWorkbookFile = async (file: File, selectedHandle: FilePickerHandle | null = null) => {
    pendingOpenHandleRef.current = selectedHandle
    const requestId = ++openRequestId.current
    importTaskRef.current?.cancel()
    importTaskRef.current = null
    setPendingImport(null)
    setPendingDelimited(null)
    setImportProgress(null)
    if (/\.(csv|tsv)$/i.test(file.name)) {
      pendingOpenHandleRef.current = null
      try {
        if (file.size > DELIMITED_MAX_BYTES) throw new Error('File too large')
        const text = decodeDelimitedFile(new Uint8Array(await file.arrayBuffer()))
        if (requestId !== openRequestId.current) return
        setPendingDelimited({ name: file.name, text })
      } catch {
        if (requestId === openRequestId.current) setNotice(delimitedCopy.invalid)
      }
      return
    }
    if (!isSupportedXlsxFileName(file.name)) {
      pendingOpenHandleRef.current = null
      setNotice(copy.openUnsupported)
      restoreEditFocus()
      return
    }
    if (file.size > XLSX_LIMITS.archiveBytes) {
      pendingOpenHandleRef.current = null
      setPendingImport(createBlockedXlsxPreflight(file.name, 'archive-limit'))
      setNotice(copy.openTooLarge)
      return
    }

    setImportProgress({ phase: 'inspect', percent: 0 })
    setNotice(copy.importingWorkbook)
    try {
      const buffer = await file.arrayBuffer()
      if (requestId !== openRequestId.current) return
      const task = startXlsxImport(file.name, buffer, (progress) => {
        if (requestId === openRequestId.current) setImportProgress(progress)
      })
      importTaskRef.current = task
      const preflight = await task.promise
      if (requestId !== openRequestId.current) return
      setPendingImport(preflight)
      setNotice(preflight.report.canOpen ? copy.openPreflightHelp : copy.openBlocked)
    } catch {
      if (requestId === openRequestId.current) {
        pendingOpenHandleRef.current = null
        setNotice(copy.openFailed)
      }
    } finally {
      if (requestId === openRequestId.current) {
        importTaskRef.current = null
        setImportProgress(null)
      }
    }
  }

  const cancelWorkbookImport = () => {
    openRequestId.current += 1
    importTaskRef.current?.cancel()
    importTaskRef.current = null
    pendingOpenHandleRef.current = null
    setImportProgress(null)
    setNotice(copy.importCancelled)
    restoreEditFocus()
  }

  const requestWorkbookOpen = async () => {
    const pickerRequestId = ++openRequestId.current
    importTaskRef.current?.cancel()
    importTaskRef.current = null
    pendingOpenHandleRef.current = null
    setImportProgress(null)
    setPendingImport(null)
    setPendingDelimited(null)
    const pickerWindow = window as FilePickerWindow
    if (window.isSecureContext && typeof pickerWindow.showOpenFilePicker === 'function') {
      let file: File | undefined
      let selectedHandle: FilePickerHandle | null = null
      try {
        const handles = await pickerWindow.showOpenFilePicker({
          multiple: false,
          types: [
            {
              description: 'XLSX workbook',
              accept: { 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': ['.xlsx'] },
            },
            { description: 'CSV/TSV (UTF-8)', accept: { 'text/csv': ['.csv'], 'text/tab-separated-values': ['.tsv'] } },
          ],
        })
        selectedHandle = handles[0] ?? null
        file = await selectedHandle?.getFile()
        if (pickerRequestId !== openRequestId.current) return
      } catch (error) {
        if (pickerRequestId !== openRequestId.current) return
        if (error instanceof DOMException && error.name === 'AbortError') {
          pendingOpenHandleRef.current = null
          restoreEditFocus()
          return
        }
        pendingOpenHandleRef.current = null
        fileInputElement.current?.click()
        return
      }
      if (file) await importWorkbookFile(file, selectedHandle)
      return
    }
    fileInputElement.current?.click()
  }

  const cancelPreflight = useCallback(() => {
    setPendingImport(null)
    pendingOpenHandleRef.current = null
    setNotice(copy.importCancelled)
    restoreEditFocus()
  }, [copy.importCancelled, restoreEditFocus])

  const cancelDelimited = () => {
    setPendingDelimited(null)
    setNotice(copy.importCancelled)
    restoreEditFocus()
  }

  const acceptDelimited = (workbook: ReturnType<typeof createWorkbook>) => {
    const edit = editDraftRef.current
    if ((session.isDirty || Boolean(edit && edit.text !== edit.initialText)) && !window.confirm(copy.confirmOpen))
      return
    invalidateSave()
    openRequestId.current += 1
    session.replaceWorkbook(workbook, { markDirty: true })
    currentSaveHandleRef.current = null
    importedSourceRef.current = null
    pendingOpenHandleRef.current = null
    currentFileNameRef.current = 'Book1.xlsx'
    updateEditDraft(null)
    closeContextMenu()
    setActiveSheetId(workbook.activeSheetId)
    setSelection(createSelection({ row: 1, column: 1 }))
    setViewportSize({ rows: INITIAL_VIEWPORT_ROWS, columns: INITIAL_VIEWPORT_COLUMNS })
    if (scrollElement.current) scrollElement.current.scrollTo({ top: 0, left: 0 })
    setPendingDelimited(null)
    setNotice(delimitedCopy.ready)
    focusGrid()
  }

  const downloadDelimited = () => {
    if (!commitEdit()) return
    let url: string | null = null
    let link: HTMLAnchorElement | null = null
    try {
      const bytes = exportDelimitedSheet(session, activeSheetId, exportDelimiter)
      const extension = exportDelimiter === '\t' ? 'tsv' : 'csv'
      url = URL.createObjectURL(
        new Blob([bytes.slice().buffer as ArrayBuffer], {
          type: extension === 'tsv' ? 'text/tab-separated-values;charset=utf-8' : 'text/csv;charset=utf-8',
        }),
      )
      link = document.createElement('a')
      link.href = url
      link.download = `Sheet.${extension}`
      document.body.appendChild(link)
      link.click()
      setDelimitedExport(false)
      setNotice(delimitedCopy.exported)
    } catch {
      setNotice(delimitedCopy.invalid)
    } finally {
      link?.remove()
      if (url) window.setTimeout(() => URL.revokeObjectURL(url!), 0)
    }
  }

  const acceptPreflight = () => {
    const result = pendingImport
    if (!result?.report.canOpen || !result.workbook) return
    const edit = editDraftRef.current
    const hasUnsavedChanges = session.isDirty || Boolean(edit && edit.text !== edit.initialText)
    if (hasUnsavedChanges && !window.confirm(copy.confirmOpen)) {
      setPendingImport(null)
      pendingOpenHandleRef.current = null
      setNotice(copy.importCancelled)
      restoreEditFocus()
      return
    }
    invalidateSave()
    const workbook = result.workbook
    session.replaceWorkbook(workbook)
    currentSaveHandleRef.current = pendingOpenHandleRef.current
    importedSourceRef.current = { name: result.report.fileName, handle: pendingOpenHandleRef.current }
    pendingOpenHandleRef.current = null
    currentFileNameRef.current = result.report.fileName || 'Book1.xlsx'
    updateEditDraft(null)
    closeContextMenu()
    setActiveSheetId(workbook.activeSheetId)
    setSelection(createSelection({ row: 1, column: 1 }))
    setViewportSize({ rows: INITIAL_VIEWPORT_ROWS, columns: INITIAL_VIEWPORT_COLUMNS })
    if (scrollElement.current) scrollElement.current.scrollTo({ top: 0, left: 0 })
    setPendingImport(null)
    setNotice(copy.workbookOpened)
    focusGrid()
  }

  useEffect(() => {
    if (!pendingImport) return
    const handleDialogKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      cancelPreflight()
    }
    document.addEventListener('keydown', handleDialogKeyDown)
    return () => document.removeEventListener('keydown', handleDialogKeyDown)
  }, [pendingImport, cancelPreflight])

  useEffect(() => {
    if (!pendingSave) return
    const handleDialogKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      saveCheckpointRef.current = null
      setPendingSave(null)
      pendingSaveAsHandleRef.current = null
      setNotice(copy.saveCancelled)
    }
    document.addEventListener('keydown', handleDialogKeyDown)
    return () => document.removeEventListener('keydown', handleDialogKeyDown)
  }, [pendingSave, copy.saveCancelled])

  const handleFileInputChange = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.currentTarget.files?.[0]
    event.currentTarget.value = ''
    if (file) void importWorkbookFile(file, null)
  }

  const ensureXlsxName = (name: string) => (name.toLowerCase().endsWith('.xlsx') ? name : `${name}.xlsx`)
  const saveAsSuggestedName = () => {
    const name = ensureXlsxName(currentFileNameRef.current)
    if (!session.workbook.preservation?.originalArchiveBytes) return name
    const base = name.slice(0, -5)
    const suffix = copy.saveCopySuffix
    const previousSuffix = suffix.trim().toLocaleLowerCase('en-US')
    const nextBase = base.toLocaleLowerCase('en-US').endsWith(previousSuffix) ? `${base} 2` : `${base}${suffix}`
    return `${nextBase}.xlsx`
  }

  const clearExportProgress = () => {
    if (exportProgressTimerRef.current !== null) {
      window.clearTimeout(exportProgressTimerRef.current)
      exportProgressTimerRef.current = null
    }
    setExportProgressVisible(false)
    setExportProgress(null)
  }

  const startExportProgress = () => {
    clearExportProgress()
    setExportProgress({ phase: 'inspect', percent: 0 })
    exportProgressTimerRef.current = window.setTimeout(() => {
      exportProgressTimerRef.current = null
      setExportProgressVisible(true)
    }, SAVE_PROGRESS_DISPLAY_DELAY_MS)
  }

  const completeSave = async (
    result: XlsxExportResult,
    saveAsNewFile: boolean,
    selectedSaveHandle: SavePickerHandle | null = null,
    suggestNewName = false,
  ) => {
    const bytes = result.bytes
    const checkpoint = saveCheckpointRef.current
    if (!bytes || !result.report.canSave || !checkpoint || checkpoint.workbook !== session.workbook) return
    const isCurrent = () => saveCheckpointRef.current === checkpoint && checkpoint.workbook === session.workbook
    setSaving(true)
    let writable: FilePickerWritable | null = null
    let downloadUrl: string | null = null
    let downloadLink: HTMLAnchorElement | null = null
    const formulaWarning = result.report.entries.some((entry) => entry.category === 'stale-calculation')
    try {
      let handle = saveAsNewFile ? selectedSaveHandle : currentSaveHandleRef.current
      if (saveAsNewFile && !handle) {
        const pickerWindow = window as FilePickerWindow
        if (window.isSecureContext && typeof pickerWindow.showSaveFilePicker === 'function') {
          try {
            handle = await pickerWindow.showSaveFilePicker({
              suggestedName: saveAsSuggestedName(),
              types: [
                {
                  description: 'XLSX workbook',
                  accept: { 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': ['.xlsx'] },
                },
              ],
            })
          } catch (error) {
            if (!isCurrent()) return
            if (error instanceof DOMException && error.name === 'AbortError') {
              setNotice(copy.saveCancelled)
              return
            }
            throw error
          }
        }
      }
      if (!isCurrent()) return
      const sourceHandle = currentSaveHandleRef.current
      if (
        saveAsNewFile &&
        handle &&
        checkpoint.workbook.preservation?.originalArchiveBytes &&
        (handle === sourceHandle ||
          handle.name === currentFileNameRef.current ||
          (sourceHandle && handle.isSameEntry && (await handle.isSameEntry(sourceHandle))))
      ) {
        setNotice(copy.saveAsDifferentFile)
        return
      }
      if (!isCurrent()) return
      const importedSource = importedSourceRef.current
      if (saveAsNewFile && handle && importedSource) {
        const sameSource = handle === importedSource.handle || handle.name === importedSource.name
        const canCompare = Boolean(importedSource.handle && handle.isSameEntry)
        const isAlias = canCompare && (await handle.isSameEntry!(importedSource.handle!))
        const destination = !canCompare && handle.getFile ? await handle.getFile() : null
        if (sameSource || isAlias || (!canCompare && (!destination || destination.size !== 0))) {
          setNotice(copy.saveAsDifferentFile)
          return
        }
      }
      if (!isCurrent()) return
      if (handle) {
        writable = await handle.createWritable()
        if (!isCurrent()) {
          await writable.abort?.()
          return
        }
        await writable.write(new Blob([bytes.slice().buffer as ArrayBuffer]))
        if (!isCurrent()) {
          await writable.abort?.()
          return
        }
        await writable.close()
        if (!isCurrent()) return
        if (saveAsNewFile) currentSaveHandleRef.current = handle
        currentFileNameRef.current = handle.name
        const clean = session.markSaved(checkpoint, result.preservation, bytes)
        const pendingDraft = editDraftRef.current
        const message =
          clean && !(pendingDraft && pendingDraft.text !== pendingDraft.initialText)
            ? copy.saveDone
            : copy.saveSnapshotDone
        setNotice(formulaWarning ? `${message} ${copy.saveFormulaWarning}` : message)
      } else {
        let downloadName = ensureXlsxName(result.report.fileName || currentFileNameRef.current)
        if (suggestNewName) downloadName = saveAsSuggestedName()
        downloadUrl = URL.createObjectURL(new Blob([bytes.slice().buffer as ArrayBuffer]))
        downloadLink = document.createElement('a')
        downloadLink.href = downloadUrl
        downloadLink.download = downloadName
        document.body.appendChild(downloadLink)
        downloadLink.click()
        currentSaveHandleRef.current = null
        currentFileNameRef.current = downloadName
        const clean = session.markSaved(checkpoint, result.preservation, bytes)
        const message = clean ? copy.saveDownloadStarted : `${copy.saveDownloadStarted} ${copy.saveSnapshotDone}`
        setNotice(formulaWarning ? `${message} ${copy.saveFormulaWarning}` : message)
      }
      setPendingSave(null)
    } catch {
      try {
        await writable?.abort?.()
      } catch {
        // The file system stream may already be closed or aborted.
      }
      if (isCurrent()) setNotice(copy.saveFailed)
    } finally {
      downloadLink?.remove()
      if (downloadUrl) window.setTimeout(() => URL.revokeObjectURL(downloadUrl!), 0)
      if (isCurrent()) {
        saveCheckpointRef.current = null
        setSaving(false)
      }
    }
  }

  const requestWorkbookSave = async (forceSaveAs = false) => {
    if (saving || pendingSave || saveCheckpointRef.current) return
    if (editDraftRef.current && !commitEdit()) return
    const checkpoint = session.createSaveCheckpoint()
    const snapshot = structuredClone(session.workbook)
    saveCheckpointRef.current = checkpoint
    const isCurrent = () => saveCheckpointRef.current === checkpoint && checkpoint.workbook === session.workbook
    setPendingSave(null)
    pendingSaveAsHandleRef.current = null
    const saveAsNewFile = forceSaveAs || !currentSaveHandleRef.current
    let selectedSaveHandle: SavePickerHandle | null = null
    const pickerWindow = window as FilePickerWindow
    if (saveAsNewFile && window.isSecureContext && typeof pickerWindow.showSaveFilePicker === 'function') {
      try {
        selectedSaveHandle = await pickerWindow.showSaveFilePicker({
          suggestedName: saveAsSuggestedName(),
          types: [
            {
              description: 'XLSX workbook',
              accept: { 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': ['.xlsx'] },
            },
          ],
        })
      } catch (error) {
        if (!isCurrent()) return
        saveCheckpointRef.current = null
        setNotice(error instanceof DOMException && error.name === 'AbortError' ? copy.saveCancelled : copy.saveFailed)
        return
      }
    }
    if (!isCurrent()) return
    startExportProgress()
    setNotice(copy.saveProgress(copy.savePhaseInspect, 0))
    setSaving(true)
    try {
      const task = startXlsxExport(snapshot, currentFileNameRef.current, (progress) => {
        if (isCurrent()) setExportProgress(progress)
      })
      exportTaskRef.current = task
      const result = await task.promise
      if (!isCurrent()) return
      exportTaskRef.current = null
      clearExportProgress()
      if (!result.report.canSave || result.report.requiresSaveAs) {
        setPendingSave(result)
        pendingSaveAsHandleRef.current = selectedSaveHandle
        setNotice(result.report.canSave ? copy.savePreflightHelp : copy.saveBlocked)
        return
      }
      setSaving(false)
      await completeSave(result, saveAsNewFile, selectedSaveHandle, forceSaveAs)
    } catch {
      if (!isCurrent()) return
      exportTaskRef.current = null
      clearExportProgress()
      setNotice(copy.saveFailed)
      saveCheckpointRef.current = null
      setSaving(false)
    } finally {
      if (isCurrent()) {
        clearExportProgress()
        setSaving(false)
      }
    }
  }

  saveShortcutHandlerRef.current = requestWorkbookSave

  const cancelSaveReview = () => {
    saveCheckpointRef.current = null
    setPendingSave(null)
    pendingSaveAsHandleRef.current = null
    setNotice(copy.saveCancelled)
  }

  const invalidateSave = () => {
    saveCheckpointRef.current = null
    exportTaskRef.current?.cancel()
    exportTaskRef.current = null
    pendingSaveAsHandleRef.current = null
    setPendingSave(null)
    clearExportProgress()
    setSaving(false)
  }

  const confirmSaveAs = async () => {
    const result = pendingSave
    if (!result?.report.canSave || !result.bytes) return
    const selectedHandle = pendingSaveAsHandleRef.current
    pendingSaveAsHandleRef.current = null
    setPendingSave(null)
    await completeSave(result, true, selectedHandle, true)
  }

  useEffect(() => {
    const handleSaveShortcut = (event: globalThis.KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== 's') return
      event.preventDefault()
      void saveShortcutHandlerRef.current?.(false)
    }
    document.addEventListener('keydown', handleSaveShortcut)
    return () => document.removeEventListener('keydown', handleSaveShortcut)
  }, [])

  const scaledRowHeaderWidth = ROW_HEADER_WIDTH * zoomScale
  const scaledColumnHeaderHeight = columnHeaderHeight * zoomScale
  const gridWidth = scaledRowHeaderWidth + columnVirtualizer.getTotalSize()
  const gridHeight = scaledColumnHeaderHeight + rowVirtualizer.getTotalSize()
  const activeVisible =
    visibleContains(virtualRows, selection.active.row - 1) &&
    visibleContains(virtualColumns, selection.active.column - 1)
  const activeDescription = `${activeAddress}, ${activeCellText || copy.emptyCell}`
  const historyState = session.historyState
  const currentNumberFormat = activeCell?.style?.numberFormat
  const matchingFormat = (Object.entries(NUMBER_FORMAT_PRESETS) as Array<[NumberFormatKey, string | undefined]>).find(
    ([, format]) => format === currentNumberFormat,
  )
  const activeFormatKey = matchingFormat?.[0] ?? (currentNumberFormat ? 'custom' : 'general')
  const formulaFunctions = getFormulaFunctionHelp(locale)
  const formulaFunctionQuery = formulaFunctionSearch.trim().toLocaleLowerCase(locale === 'pl' ? 'pl-PL' : 'en-US')
  const filteredFormulaFunctions = formulaFunctionQuery
    ? formulaFunctions.filter((item) =>
        `${item.localizedName} ${item.canonicalName} ${item.signature}`
          .toLocaleLowerCase(locale === 'pl' ? 'pl-PL' : 'en-US')
          .includes(formulaFunctionQuery),
      )
    : formulaFunctions
  const commandTabs = [
    'home',
    'insert',
    'data',
    'view',
    ...(sheet.tables.some(
      (table) =>
        selection.active.row >= table.range.start.row &&
        selection.active.row <= table.range.end.row &&
        selection.active.column >= table.range.start.column &&
        selection.active.column <= table.range.end.column,
    )
      ? ['table' as const]
      : []),
  ] as const
  const commandLabels = {
    file: copy.fileTab,
    home: copy.homeTab,
    data: copy.dataTab,
    insert: copy.insertTab,
    view: copy.viewTab,
    table: copy.tableTab,
  }
  const selectedTable = sheet.tables.find(
    (table) =>
      selection.active.row >= table.range.start.row &&
      selection.active.row <= table.range.end.row &&
      selection.active.column >= table.range.start.column &&
      selection.active.column <= table.range.end.column,
  )
  useLayoutEffect(() => {
    if (commandTab === 'table' && !selectedTable) {
      setCommandTab('home')
      setMobileMore(false)
    }
  }, [commandTab, selectedTable])
  const currentChart = sheet.drawings.find((drawing) => drawing.chart)
  const openChartDialog = () => {
    if (editDraftRef.current || selection.ranges.length !== 1) {
      setNotice(CHART_COPY[locale].errors.context)
      return
    }
    setChartDialog({ range: structuredClone(selection.ranges[0]), editing: false })
  }
  const chartCommand = (
    <Button
      className="grid-command-large"
      variant="outline"
      size="sm"
      disabled={saving || Boolean(currentChart)}
      aria-label={CHART_COPY[locale].command}
      tooltip={CHART_COPY[locale].help}
      onClick={openChartDialog}
    >
      <ChartIcon />
      {CHART_COPY[locale].command}
    </Button>
  )
  const openTableDialog = () => {
    const range = selection.ranges[0]
    if (editDraftRef.current || selection.ranges.length !== 1 || range.end.row <= range.start.row) {
      setNotice(TABLE_COPY[locale].selectionHelp)
      return
    }
    setTableRange(structuredClone(range))
  }
  const convertTable = (tableId: string) => {
    try {
      if (editDraftRef.current) throw new Error('Finish editing')
      session.execute({ type: 'convert-table', sheetId: activeSheetId, tableId })
      focusGrid()
    } catch {
      setNotice(TABLE_COPY[locale].refused)
    }
  }
  const freezeControls = (
    [
      [copy.freezeFirstRow, !frozen.rows, frozen.columns, frozen.rows],
      [copy.freezeFirstColumn, frozen.rows, !frozen.columns, frozen.columns],
      [copy.unfreezePanes, false, false, undefined],
    ] as const
  ).map(([label, rows, columns, pressed]) => (
    <Button
      key={label}
      variant="secondary"
      size="sm"
      icon={pressed ? <CheckIcon /> : <FreezeIcon />}
      aria-pressed={pressed}
      disabled={saving}
      onPointerDown={(event) => {
        if (editDraftRef.current) event.preventDefault()
      }}
      onClick={() => {
        try {
          if (editDraftRef.current) throw new Error('Finish editing')
          session.execute({ type: 'set-frozen-panes', sheetId: activeSheetId, rows, columns })
        } catch {
          setNotice(copy.freezeRefused)
        }
      }}
    >
      {label}
    </Button>
  ))
  const editorActions: EditorActions = {
    undo: performUndo,
    redo: performRedo,
    save: () => void requestWorkbookSave(false),
    canUndo: historyState.canUndo,
    canRedo: historyState.canRedo,
    saving,
    labels: { undo: copy.undoShortcut, redo: copy.redoShortcut, save: copy.saveQuickAction, group: copy.historyGroup },
    onSavePointerDown: (event) => {
      if (editDraftRef.current) event.preventDefault()
    },
  }

  const fileCommands = (
    <>
      <Button variant="outline" size="sm" icon={<FilePlusIcon />} onClick={createNewWorkbook}>
        {copy.newWorkbook}
      </Button>
      <Button
        variant="outline"
        size="sm"
        icon={<FolderOpenIcon />}
        data-grid-open="true"
        onPointerDown={(event) => {
          if (editDraftRef.current) event.preventDefault()
        }}
        onClick={() => void requestWorkbookOpen()}
      >
        {copy.openWorkbook}
      </Button>
      <Button
        variant="outline"
        size="sm"
        icon={<SaveIcon />}
        aria-keyshortcuts="Control+S Meta+S"
        disabled={saving}
        onPointerDown={(event) => {
          if (editDraftRef.current) event.preventDefault()
        }}
        onClick={() => void requestWorkbookSave(false)}
      >
        {copy.saveWorkbook}
      </Button>
      <Button
        variant="outline"
        size="sm"
        icon={<SaveAsIcon />}
        disabled={saving}
        onPointerDown={(event) => {
          if (editDraftRef.current) event.preventDefault()
        }}
        onClick={() => void requestWorkbookSave(true)}
      >
        {copy.saveWorkbookAs}
      </Button>
      <Button
        icon={<UploadIcon />}
        variant="outline"
        size="sm"
        data-grid-open="true"
        disabled={saving}
        onPointerDown={(event) => {
          if (editDraftRef.current) event.preventDefault()
        }}
        onClick={() => void requestWorkbookOpen()}
      >
        {delimitedCopy.import}
      </Button>
      <Button
        icon={<DownloadIcon />}
        variant="outline"
        size="sm"
        disabled={saving}
        onClick={() => {
          if (commitEdit()) setDelimitedExport(true)
        }}
      >
        {delimitedCopy.export}
      </Button>
    </>
  )
  const boldCommand = (
    <Button
      variant="outline"
      size="sm"
      aria-label={copy.bold}
      aria-pressed={Boolean(activeCell?.style?.font?.bold)}
      onClick={() => toggleSelectedFont('bold')}
    >
      <strong aria-hidden="true">B</strong>
    </Button>
  )
  const italicCommand = (
    <Button
      variant="outline"
      size="sm"
      aria-label={copy.italic}
      aria-pressed={Boolean(activeCell?.style?.font?.italic)}
      onClick={() => toggleSelectedFont('italic')}
    >
      <em aria-hidden="true">I</em>
    </Button>
  )
  const clipboardItems = (mode: 'copy' | 'paste') =>
    [false, true].map((formulas) => (
      <Button
        key={String(formulas)}
        variant="outline"
        size="sm"
        icon={formulas ? <FunctionIcon /> : mode === 'copy' ? <CopyIcon /> : <PasteIcon />}
        aria-keyshortcuts={`${formulas ? 'Control+Alt+Shift+' : 'Control+'}${mode === 'copy' ? 'C' : 'V'}`}
        onPointerDown={(event) => {
          if (editDraftRef.current) event.preventDefault()
        }}
        onClick={() => void performValuesClipboard(mode, formulas)}
      >
        {mode === 'copy'
          ? formulas
            ? copy.copyFormulas
            : copy.copyValues
          : formulas
            ? copy.pasteFormulas
            : copy.pasteValues}
      </Button>
    ))
  const insertTableCommand = (
    <Button
      className="grid-command-large"
      variant="outline"
      size="sm"
      disabled={saving}
      aria-label={TABLE_COPY[locale].create}
      tooltip={`${TABLE_COPY[locale].create}: ${TABLE_COPY[locale].selectionHelp}`}
      onClick={openTableDialog}
    >
      <TableIcon />
      {copy.tableTab}
    </Button>
  )
  const sortCommand = (
    <Button
      className="grid-command-large"
      variant="outline"
      size="sm"
      data-grid-open
      disabled={
        saving || session.workbook.sheetOrder.some((id) => session.workbook.sheetsById.get(id)!.tables.length > 0)
      }
      onClick={() => {
        try {
          if (editDraftRef.current || selection.ranges.length !== 1) throw new Error('Incomplete selection')
          const range = selection.ranges[0]
          sortedRangeCells(session.workbook, sheet, {
            range,
            keyColumn: range.start.column,
            direction: 'ascending',
            headers: false,
          })
          setSortRange(structuredClone(range))
        } catch {
          setNotice(SORT_COPY[locale].refused)
        }
      }}
    >
      <SortIcon />
      {SORT_COPY[locale].title}
    </Button>
  )
  const filterCommand = (
    <Button
      variant="outline"
      size="sm"
      data-grid-open
      disabled={saving}
      onClick={() => {
        try {
          if (editDraftRef.current || selection.ranges.length !== 1) throw new Error('Incomplete selection')
          const range =
            (commandTab === 'table' ? selectedTable?.range : undefined) ??
            sheet.autoFilter?.range ??
            selection.ranges[0]
          filteredRows(session.workbook, sheet, range, sheet.autoFilter?.criteria ?? [])
          setFilterColumn(undefined)
          setFilterRange(structuredClone(range))
        } catch {
          setNotice(FILTER_COPY[locale].refused)
        }
      }}
    >
      <FilterIcon />
      {sheet.autoFilter?.criteria?.length ? FILTER_COPY[locale].active : FILTER_COPY[locale].title}
    </Button>
  )
  const clearFilterCommand = sheet.autoFilter && (
    <Button
      variant="outline"
      size="sm"
      disabled={saving || !sheet.autoFilter.criteria?.length}
      onClick={() => {
        try {
          if (editDraftRef.current) throw new Error('Finish editing')
          session.execute({
            type: 'set-auto-filter',
            sheetId: activeSheetId,
            range: sheet.autoFilter!.range,
            criteria: [],
          })
          focusGrid()
        } catch {
          setNotice(FILTER_COPY[locale].refused)
        }
      }}
    >
      <EraserIcon />
      {FILTER_COPY[locale].clear}
    </Button>
  )
  const convertCommand = (
    <Button
      className="grid-command-large"
      variant="outline"
      size="sm"
      disabled={saving}
      tooltip={selectedTable?.ownership === 'simple' ? TABLE_COPY[locale].convertHelp : TABLE_COPY[locale].refused}
      onClick={() => selectedTable && convertTable(selectedTable.id)}
    >
      <TableIcon />
      {TABLE_COPY[locale].convert}
    </Button>
  )
  const freezeCommand = (
    <CommandMenu
      variant="outline"
      presentation={mobileCommands ? 'compact' : 'large'}
      keepOpen
      label={copy.freezePanes}
      icon={<FreezeIcon />}
    >
      {freezeControls}
    </CommandMenu>
  )
  const filterCommands = (
    <>
      {filterCommand}
      {clearFilterCommand}
    </>
  )
  const ribbonContents = {
    home: (
      <>
        <ToolbarGroup label={copy.clipboardGroup} caption={copy.clipboardGroup}>
          {(['paste', 'copy'] as const).map((mode) => (
            <CommandMenu
              variant="outline"
              key={mode}
              presentation={mode === 'paste' ? 'large' : 'compact'}
              label={locale === 'pl' ? (mode === 'copy' ? 'Kopiuj' : 'Wklej') : mode === 'copy' ? 'Copy' : 'Paste'}
              icon={mode === 'copy' ? <CopyIcon /> : <PasteIcon />}
              optionsLabel={
                locale === 'pl'
                  ? mode === 'copy'
                    ? 'Opcje kopiowania'
                    : 'Opcje wklejania'
                  : mode === 'copy'
                    ? 'Copy options'
                    : 'Paste options'
              }
              primaryAction={() => void performValuesClipboard(mode)}
              onPrimaryPointerDown={(event) => {
                if (editDraftRef.current) event.preventDefault()
              }}
            >
              {clipboardItems(mode)}
            </CommandMenu>
          ))}
        </ToolbarGroup>
        <ToolbarGroup className="grid-ribbon-font" label={copy.fontGroup} caption={copy.fontGroup}>
          <div className="grid-ribbon-row">
            <Select
              density="compact"
              options={[]}
              aria-label={copy.fontFamily}
              value={activeCell?.style?.font?.name ?? 'default'}
              onChange={(event) =>
                setSelectedFontFamily(event.currentTarget.value === 'default' ? '' : event.currentTarget.value)
              }
            >
              {activeCell?.style?.font?.name &&
                !['Arial', 'Aptos', 'Calibri', 'Inter', 'Times New Roman', 'Verdana'].includes(
                  activeCell.style.font.name,
                ) && <option value={activeCell.style.font.name}>{activeCell.style.font.name}</option>}
              <option value="default">{copy.defaultFont}</option>
              {['Arial', 'Aptos', 'Calibri', 'Inter', 'Times New Roman', 'Verdana'].map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
            </Select>
            <Select
              className="grid-font-size"
              density="compact"
              options={[]}
              aria-label={copy.fontSize}
              value={String(activeCell?.style?.font?.size ?? 11)}
              onChange={(event) => setSelectedFontSize(event.currentTarget.value)}
            >
              {activeCell?.style?.font?.size &&
                ![8, 9, 10, 11, 12, 14, 16, 18, 24, 36].includes(activeCell.style.font.size) && (
                  <option value={activeCell.style.font.size}>{activeCell.style.font.size}</option>
                )}
              {[8, 9, 10, 11, 12, 14, 16, 18, 24, 36].map((size) => (
                <option key={size} value={size}>
                  {size}
                </option>
              ))}
            </Select>
          </div>
          <div className="grid-ribbon-row">
            {boldCommand}
            {italicCommand}
            <Button
              variant="outline"
              size="sm"
              aria-label={copy.underline}
              aria-pressed={Boolean(activeCell?.style?.font?.underline)}
              onClick={() => toggleSelectedFont('underline')}
            >
              <u aria-hidden="true">U</u>
            </Button>

            <label className="grid-format-color">
              <span aria-hidden="true">A</span>
              <input
                type="color"
                aria-label={copy.textColor}
                value={activeCell?.style?.font?.color ?? '#202124'}
                onChange={(event) => setSelectedTextColor(event.currentTarget.value)}
              />
            </label>
            <label className="grid-format-color">
              <span aria-hidden="true">▧</span>
              <input
                type="color"
                aria-label={copy.fillColor}
                value={activeCell?.style?.fill?.color ?? '#ffffff'}
                onChange={(event) => setSelectedFillColor(event.currentTarget.value)}
              />
            </label>
            <Button
              variant="outline"
              size="sm"
              icon={<EraserIcon />}
              aria-label={copy.clearFormats}
              onClick={clearSelectedFormats}
            ></Button>
          </div>
        </ToolbarGroup>
        <ToolbarGroup className="grid-ribbon-alignment" label={copy.alignmentGroup} caption={copy.alignmentGroup}>
          <Select
            density="compact"
            options={[]}
            aria-label={copy.horizontalAlignment}
            value={activeCell?.style?.alignment?.horizontal ?? 'general'}
            onChange={(event) =>
              event.currentTarget.value === 'general'
                ? applySelectedStyles((style) => {
                    if (style.alignment) delete style.alignment.horizontal
                    return style
                  })
                : setSelectedAlignment(event.currentTarget.value as 'left' | 'center' | 'right')
            }
          >
            <option value="general">{copy.automaticAlignment}</option>
            <option value="left">{copy.alignLeft}</option>
            <option value="center">{copy.alignCenter}</option>
            <option value="right">{copy.alignRight}</option>
          </Select>
          <Button
            variant="outline"
            size="sm"
            aria-label={copy.wrapText}
            aria-pressed={Boolean(activeCell?.style?.alignment?.wrapText)}
            onClick={toggleSelectedWrap}
          >
            <WrapIcon />
            {copy.wrapText}
          </Button>
        </ToolbarGroup>
        <ToolbarGroup className="grid-ribbon-number" label={copy.numberFormat} caption={copy.numberFormat}>
          <Select
            density="compact"
            options={[]}
            aria-label={copy.numberFormat}
            value={activeFormatKey}
            onChange={(event) => {
              if (event.currentTarget.value !== 'custom')
                setSelectedNumberFormat(event.currentTarget.value as NumberFormatKey)
            }}
          >
            {currentNumberFormat && activeFormatKey === 'custom' && (
              <option value="custom">{`${copy.formatPreset.number}: ${currentNumberFormat}`}</option>
            )}
            {(Object.keys(NUMBER_FORMAT_PRESETS) as NumberFormatKey[]).map((key) => (
              <option key={key} value={key}>
                {copy.formatPreset[key]}
              </option>
            ))}
          </Select>
          <div className="grid-ribbon-row">
            <IconButton
              variant="outline"
              size="sm"
              aria-label={copy.decreaseDecimals}
              title={copy.decreaseDecimals}
              icon={<DecimalPlacesIcon direction="decrease" separator={locale === 'pl' ? ',' : '.'} />}
              disabled={isDateNumberFormat(activeCell?.style?.numberFormat)}
              onClick={() => adjustSelectedDecimals(-1)}
            />
            <IconButton
              variant="outline"
              size="sm"
              aria-label={copy.increaseDecimals}
              title={copy.increaseDecimals}
              icon={<DecimalPlacesIcon direction="increase" separator={locale === 'pl' ? ',' : '.'} />}
              disabled={isDateNumberFormat(activeCell?.style?.numberFormat)}
              onClick={() => adjustSelectedDecimals(1)}
            />
          </div>
        </ToolbarGroup>
        <ToolbarGroup className="grid-ribbon-cells" label={copy.cellsGroup} caption={copy.cellsGroup}>
          <Button
            variant="outline"
            size="sm"
            icon={<InsertRowIcon />}
            onClick={async () => {
              if (!commitEdit()) return
              try {
                await editWorkbookRows(session, activeSheetId, selection.active.row, 1)
                rowVirtualizer.measure()
                focusGrid()
              } catch {
                setNotice(copy.structureFailed)
              }
            }}
          >
            {copy.insertRows(1)}
          </Button>
          <Button
            variant="outline"
            size="sm"
            icon={<InsertColumnIcon />}
            onClick={async () => {
              if (!commitEdit()) return
              try {
                await editWorkbookColumns(session, activeSheetId, selection.active.column, 1)
                columnVirtualizer.measure()
                focusGrid()
              } catch {
                setNotice(copy.structureFailed)
              }
            }}
          >
            {copy.insertColumns(1)}
          </Button>
        </ToolbarGroup>
      </>
    ),
    insert: (
      <>
        <ToolbarGroup label={copy.tablesGroup}>{insertTableCommand}</ToolbarGroup>
        <ToolbarGroup label={CHART_COPY[locale].command}>{chartCommand}</ToolbarGroup>
      </>
    ),
    view: <ToolbarGroup label={copy.viewTab}>{freezeCommand}</ToolbarGroup>,
    data: (
      <ToolbarGroup label={copy.dataTab} caption={copy.sortFilterGroup}>
        {sortCommand}
        <div className="grid-ribbon-stack">{filterCommands}</div>
      </ToolbarGroup>
    ),
    table: (
      <>
        <ToolbarGroup label={copy.tableContext}>
          {selectedTable && (
            <span className="grid-table-context">
              <strong>{selectedTable.name}</strong>
              <span>{formatRangeAddress(selectedTable.range)}</span>
            </span>
          )}
        </ToolbarGroup>
        <ToolbarGroup label={FILTER_COPY[locale].title} caption={copy.filterGroup}>
          <div className="grid-ribbon-stack">{filterCommands}</div>
        </ToolbarGroup>
        <ToolbarGroup label={TABLE_COPY[locale].convert}>{convertCommand}</ToolbarGroup>
      </>
    ),
  }

  const moreCommand = (
    <Button
      ref={mobileMoreTrigger}
      variant="secondary"
      aria-expanded={mobileMore}
      aria-controls={mobileMore ? `grid-panel-${commandTab}` : undefined}
      onClick={() => (mobileMore ? closeMobileMore() : setMobileMore(true))}
    >
      {copy.moreAction}
    </Button>
  )
  const appContent = (
    <div
      className="grid-app"
      ref={appElement}
      style={
        {
          '--grid-zoom-scale': zoomScale,
          '--grid-row-header-width': `${scaledRowHeaderWidth}px`,
          '--grid-zoom-font-size': `${14 * zoomScale}px`,
          '--grid-zoom-column-padding': `${8 * zoomScale}px`,
          '--grid-zoom-cell-padding-block': `${3 * zoomScale}px`,
          '--grid-zoom-cell-padding-inline': `${8 * zoomScale}px`,
        } as CSSProperties
      }
      data-eink={isEink || undefined}
      data-theme={appTheme}
      data-dirty={dirty || undefined}
      data-range-selection={rangeDragMode || undefined}
      data-mobile-more={mobileMore || undefined}
    >
      <FullBleedLayout
        className="allsuite-editor-workspace grid-workspace"
        footer={
          <WorkspaceStatusBar
            start={
              <WorkspaceSheetTabs
                placement="footer"
                label={copy.sheetTabs}
                items={session.workbook.sheetOrder
                  .filter(
                    (sheetId) =>
                      session.workbook.sheetsById.get(sheetId)?.visibility !== 'hidden' &&
                      session.workbook.sheetsById.get(sheetId)?.visibility !== 'veryHidden',
                  )
                  .map((sheetId) => {
                    const tabSheet = session.workbook.sheetsById.get(sheetId)!
                    return {
                      id: sheetId,
                      label: tabSheet.name,
                      tooltip: getGridSheetTabTooltip(locale, tabSheet.name),
                      tabId: `grid-sheet-tab-${sheetId}`,
                      panelId: 'grid-sheet-scroll',
                    }
                  })}
                activeId={activeSheetId}
                onChange={switchSheet}
                addLabel={copy.addSheet}
                onAdd={addSheet}
                onRename={openSheetRename}
                renameLabel={copy.renameSheet}
                renameHint={copy.renameSheetHint}
              />
            }
            zoom={zoom}
            onZoom={setZoom}
            locale={locale}
            zoomLabel={copy.zoom}
            end={
              <div className="grid-selection-summary" role="group" aria-label={copy.selectionSummary}>
                <WorkspaceStatusItem className="grid-selection-summary__item">
                  <span>{copy.selectionCells}</span>
                  <span className="grid-selection-summary__value">
                    {selectionCountFormatter.format(selectionSummary.cells)}
                  </span>
                </WorkspaceStatusItem>
                <WorkspaceStatusItem className="grid-selection-summary__item">
                  <span>{copy.selectionSum}</span>
                  <span className="grid-selection-summary__value">
                    {selectionSummary.sum === null ? '—' : selectionNumberFormatter.format(selectionSummary.sum)}
                  </span>
                </WorkspaceStatusItem>
                <WorkspaceStatusItem className="grid-selection-summary__item">
                  <span>{copy.selectionAverage}</span>
                  <span className="grid-selection-summary__value">
                    {selectionSummary.average === null
                      ? '—'
                      : selectionNumberFormatter.format(selectionSummary.average)}
                  </span>
                </WorkspaceStatusItem>
                <WorkspaceStatusItem className="grid-selection-summary__item">
                  <span>{copy.selectionMedian}</span>
                  <span className="grid-selection-summary__value">
                    {selectionSummary.median === null ? '—' : selectionNumberFormatter.format(selectionSummary.median)}
                  </span>
                </WorkspaceStatusItem>
              </div>
            }
          >
            {Boolean(sheet.autoFilter?.criteria?.length) && (
              <WorkspaceStatusItem>{FILTER_COPY[locale].active}</WorkspaceStatusItem>
            )}
            {notice && (
              <WorkspaceStatusItem role="status" aria-live="polite">
                {notice}
              </WorkspaceStatusItem>
            )}
          </WorkspaceStatusBar>
        }
      >
        <EditorNavigation
          className="grid-command-navigation"
          aria-label={copy.toolbarLabel}
          onKeyDown={(event) => {
            if (
              mobileCommands &&
              event.key === 'Tab' &&
              !event.shiftKey &&
              (event.target as HTMLElement).getAttribute('role') === 'tab'
            ) {
              const first = document.querySelector<HTMLButtonElement>('.grid-mobile-dock button')
              if (first) {
                event.preventDefault()
                first.focus()
              }
            }
          }}
          file={
            !mobileCommands && (
              <div className="grid-file-menu">
                <CommandMenu label={copy.fileTab} variant="outline">
                  {fileCommands}
                </CommandMenu>
              </div>
            )
          }
          actions={editorActions}
          tabs={{
            label: copy.toolbarLabel,
            items: commandTabs.map((tab) => ({
              id: tab,
              label: commandLabels[tab],
              tooltip: getGridButtonTooltip(locale, commandLabels[tab]),
              tabId: `grid-command-${tab}`,
              panelId: `grid-panel-${tab}`,
            })),
            activeId: commandTab === 'table' && !selectedTable ? 'home' : commandTab,
            onChange: (tab) => {
              setCommandTab(tab as (typeof commandTabs)[number])
              setMobileMore(false)
            },
          }}
        />
        <Dialog
          open={formulaFunctionsOpen}
          onClose={closeFormulaFunctionDialog}
          title={copy.formulaFunctions}
          closeLabel={copy.closeDialog}
          maxWidth="lg"
          className="grid-formula-functions-dialog"
        >
          <div className="grid-formula-function-picker">
            <Input
              id="grid-formula-function-search"
              className="grid-formula-function-search"
              placeholder={copy.searchFormulaFunctions}
              aria-label={copy.searchFormulaFunctions}
              value={formulaFunctionSearch}
              onChange={(event) => setFormulaFunctionSearch(event.currentTarget.value)}
              startIcon={<SearchIcon />}
              fullWidth
            />
            {filteredFormulaFunctions.length > 0 ? (
              <ul className="grid-formula-function-list" aria-label={copy.formulaFunctions}>
                {filteredFormulaFunctions.map((item) => (
                  <li key={item.canonicalName}>
                    <Button
                      variant="secondary"
                      size="md"
                      aria-label={copy.insertFunction(item.localizedName, item.canonicalName)}
                      tooltip={item.description}
                      onClick={() => chooseFormulaFunction(item.localizedName)}
                    >
                      <span>{item.localizedName}</span>
                      <small>{item.signature}</small>
                    </Button>
                  </li>
                ))}
              </ul>
            ) : (
              <Text variant="caption" role="status">
                {copy.noFormulaFunctionsFound}
              </Text>
            )}
          </div>
        </Dialog>

        {commandTabs.map((tab) => (
          <div
            key={`${tab}:${mobileCommands}`}
            id={`grid-panel-${tab}`}
            className={`grid-command-panel grid-panel-${tab}`}
            role="tabpanel"
            aria-labelledby={`grid-command-${tab}`}
            hidden={commandTab !== tab || (mobileCommands && !mobileMore)}
          >
            {mobileCommands && (
              <div className="grid-more-heading">
                <strong>{commandLabels[tab]}</strong>
                <Button variant="ghost" size="sm" onClick={closeMobileMore}>
                  {copy.doneAction}
                </Button>
              </div>
            )}
            <div className="grid-ribbon-surface">
              <ControlsBar
                className={`allsuite-editor-toolbar grid-toolbar grid-${tab === 'home' ? 'format' : tab}-toolbar`}
                role="toolbar"
                aria-label={commandLabels[tab]}
              >
                {ribbonContents[tab]}
              </ControlsBar>
            </div>
          </div>
        ))}

        <input
          ref={fileInputElement}
          className="grid-file-input"
          type="file"
          accept=".xlsx,.csv,.tsv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv,text/tab-separated-values"
          aria-label={copy.openWorkbook}
          onChange={handleFileInputChange}
          tabIndex={-1}
        />

        {importProgress && (
          <div className="grid-import-progress" role="group" aria-label={copy.importingWorkbook}>
            <Text as="span" variant="caption" role="status" aria-live="polite">
              {copy.importProgress(
                importProgress.phase === 'inspect'
                  ? copy.importPhaseInspect
                  : importProgress.phase === 'decompress'
                    ? copy.importPhaseDecompress
                    : copy.importPhaseMap,
                importProgress.percent,
              )}
            </Text>
            <progress max={100} value={importProgress.percent} aria-label={copy.importingWorkbook} />
            <Button variant="secondary" size="sm" onClick={cancelWorkbookImport}>
              {copy.cancelImport}
            </Button>
          </div>
        )}

        {exportProgressVisible && exportProgress && (
          <div className="grid-import-progress" role="group" aria-label={copy.saveQuickAction}>
            <Text as="span" variant="caption" role="status" aria-live="polite">
              {copy.saveProgress(
                exportProgress.phase === 'inspect'
                  ? copy.savePhaseInspect
                  : exportProgress.phase === 'patch'
                    ? copy.savePhasePatch
                    : copy.savePhaseValidate,
                exportProgress.percent,
              )}
            </Text>
            <progress max={100} value={exportProgress.percent} aria-label={copy.saveQuickAction} />
          </div>
        )}

        {pendingDelimited && (
          <DelimitedPreview
            key={pendingDelimited.name + pendingDelimited.text}
            file={pendingDelimited}
            locale={locale}
            onCancel={cancelDelimited}
            onImport={acceptDelimited}
          />
        )}
        {chartDialog && (
          <ChartDialog
            sheet={sheet}
            locale={locale}
            range={chartDialog.range}
            chart={chartDialog.editing ? currentChart?.chart : undefined}
            onCancel={() => {
              setChartDialog(null)
              requestAnimationFrame(focusGrid)
            }}
            onApply={(chart) => {
              try {
                if (editDraftRef.current || (currentChart && !chartDialog.editing)) throw new ChartError('context')
                session.execute({ type: 'set-chart', sheetId: activeSheetId, chart })
                setChartDialog(null)
                requestAnimationFrame(focusGrid)
                return true
              } catch {
                return false
              }
            }}
          />
        )}
        {tableRange && (
          <TableDialog
            sheet={sheet}
            dateSystem={session.workbook.dateSystem}
            range={tableRange}
            locale={locale}
            onCancel={() => {
              setTableRange(null)
              requestAnimationFrame(focusGrid)
            }}
            onCreate={(name) => {
              try {
                session.execute({ type: 'create-table', sheetId: activeSheetId, range: tableRange, name })
                setTableRange(null)
                requestAnimationFrame(focusGrid)
                return true
              } catch {
                return false
              }
            }}
          />
        )}
        {filterRange && (
          <FilterDialog
            initialColumn={filterColumn}
            sheet={sheet}
            range={filterRange}
            locale={locale}
            onCancel={() => {
              setFilterRange(null)
              focusGrid()
            }}
            onApply={(criteria) => {
              try {
                if (editDraftRef.current || saving) throw new Error('Finish editing')
                session.execute({ type: 'set-auto-filter', sheetId: activeSheetId, range: filterRange, criteria })
                setFilterRange(null)
                if (isRowHidden(sheet, selection.active.row))
                  updateSelection(createSelection({ ...selection.active, row: filterRange.start.row }))
                focusGrid()
              } catch {
                setNotice(FILTER_COPY[locale].refused)
              }
            }}
          />
        )}
        {sortRange && (
          <SortDialog
            range={sortRange}
            locale={locale}
            onCancel={() => {
              setSortRange(null)
              focusGrid()
            }}
            onApply={(options) => {
              try {
                if (
                  editDraftRef.current ||
                  selection.ranges.length !== 1 ||
                  JSON.stringify(selection.ranges[0]) !== JSON.stringify(sortRange)
                )
                  throw new Error('Selection changed')
                session.execute({ type: 'sort-range', sheetId: activeSheetId, ...options })
                setSortRange(null)
                focusGrid()
              } catch {
                setNotice(SORT_COPY[locale].refused)
              }
            }}
          />
        )}
        <Dialog
          open={delimitedExport}
          title={delimitedCopy.export}
          onClose={() => setDelimitedExport(false)}
          closeLabel={delimitedCopy.cancel}
          maxWidth="sm"
          className="grid-delimited-dialog"
          footer={
            <>
              <Button variant="outline" onClick={() => setDelimitedExport(false)}>
                {delimitedCopy.cancel}
              </Button>
              <Button onClick={downloadDelimited}>{delimitedCopy.exportFile}</Button>
            </>
          }
        >
          <p>{delimitedCopy.losses}</p>
          <Select
            options={[]}
            aria-label={delimitedCopy.format}
            value={exportDelimiter}
            onChange={(event) => setExportDelimiter(event.currentTarget.value as Delimiter)}
          >
            <option value=",">CSV ({delimitedCopy.comma})</option>
            <option value=";">CSV ({delimitedCopy.semicolon})</option>
            <option value={'\t'}>TSV</option>
          </Select>
        </Dialog>
        {pendingImport && (
          <div className="grid-import-backdrop">
            <div
              ref={preflightDialogElement}
              className="grid-import-dialog"
              role="dialog"
              aria-modal="true"
              aria-labelledby="grid-import-title"
              aria-describedby="grid-import-help"
              tabIndex={-1}
            >
              <h2 id="grid-import-title">{copy.openPreflightTitle}</h2>
              <p className="grid-import-file-name">{pendingImport.report.fileName}</p>
              <p id="grid-import-help">{copy.openPreflightHelp}</p>
              {pendingImport.workbook && (
                <p className="grid-import-summary">
                  {copy.openPreflightSummary(pendingImport.report.sheetCount, pendingImport.report.cellCount)}
                </p>
              )}
              {!pendingImport.report.canOpen && (
                <p className="grid-import-blocked" role="alert">
                  {copy.openBlocked}
                </p>
              )}
              <div className="grid-import-findings">
                {IMPORT_CATEGORY_ORDER.map((category) => {
                  const categoryFindings = pendingImport.report.findings.filter(
                    (finding) => finding.category === category,
                  )
                  if (!categoryFindings.length) return null
                  return (
                    <section className="grid-import-category" key={category} aria-label={copy.importCategory[category]}>
                      <h3>{copy.importCategory[category]}</h3>
                      <ul>
                        {categoryFindings.map((finding, index) => (
                          <li key={`${finding.code}-${index}`}>{copy.importFinding(finding)}</li>
                        ))}
                      </ul>
                    </section>
                  )
                })}
              </div>
              <div className="grid-import-actions">
                <Button variant="secondary" size="sm" onClick={cancelPreflight}>
                  {copy.openCancelAction}
                </Button>
                <Button
                  variant="primary"
                  size="sm"
                  disabled={!pendingImport.report.canOpen || !pendingImport.workbook}
                  onClick={acceptPreflight}
                >
                  {copy.openWorkbookAction}
                </Button>
              </div>
            </div>
          </div>
        )}

        {pendingSave && (
          <div className="grid-import-backdrop">
            <div
              ref={saveDialogElement}
              className="grid-import-dialog"
              role="dialog"
              aria-modal="true"
              aria-labelledby="grid-save-title"
              aria-describedby="grid-save-help"
              tabIndex={-1}
            >
              <h2 id="grid-save-title">{copy.savePreflightTitle}</h2>
              <p className="grid-import-file-name">{pendingSave.report.fileName}</p>
              <p id="grid-save-help">{copy.savePreflightHelp}</p>
              {!pendingSave.report.canSave && (
                <p className="grid-import-blocked" role="alert">
                  {copy.saveBlocked}
                </p>
              )}
              <div className="grid-import-findings">
                {SAVE_CATEGORY_ORDER.map((category) => {
                  const entries = pendingSave.report.entries.filter((entry) => entry.category === category)
                  if (!entries.length) return null
                  const visibleEntries = entries.slice(0, 50)
                  return (
                    <section className="grid-import-category" key={category} aria-label={copy.saveCategory[category]}>
                      <h3>{copy.saveCategory[category]}</h3>
                      <ul>
                        {visibleEntries.map((entry, index) => (
                          <li key={`${entry.code}-${entry.partName ?? ''}-${index}`}>{copy.saveEntry(entry)}</li>
                        ))}
                        {entries.length > visibleEntries.length && (
                          <li>{copy.saveMoreEntries(entries.length - visibleEntries.length)}</li>
                        )}
                      </ul>
                    </section>
                  )
                })}
              </div>
              <div className="grid-import-actions">
                <Button variant="secondary" size="sm" disabled={saving} onClick={cancelSaveReview}>
                  {copy.saveCancel}
                </Button>
                <Button
                  variant="primary"
                  size="sm"
                  disabled={saving || !pendingSave.report.canSave || !pendingSave.bytes}
                  onClick={() => void confirmSaveAs()}
                >
                  {copy.saveAsAction}
                </Button>
              </div>
            </div>
          </div>
        )}

        <div className="grid-formula-bar">
          <div className="grid-name-box">
            <Input
              label={copy.nameBox}
              density="compact"
              fullWidth
              value={nameBoxValue}
              onChange={(event) => setNameBoxValue(event.currentTarget.value)}
              onKeyDown={handleNameBoxKeyDown}
              onBlur={() => setNameBoxValue(selectedRange)}
              autoComplete="off"
              spellCheck={false}
            />
          </div>
          <div className="grid-formula-input">
            <label htmlFor="grid-formula-field">{copy.formulaBar}</label>
            <TextArea
              ref={formulaInputElement}
              id="grid-formula-field"
              className="grid-formula-field"
              fullWidth
              value={formulaBarValue}
              rows={Math.min(4, Math.max(1, formulaBarValue.split('\n').length))}
              onChange={(event) => changeDraftText(event.currentTarget.value, 'formula-bar')}
              onFocus={handleFormulaBarFocus}
              onBlur={handleFormulaBarBlur}
              onKeyDown={handleFormulaKeyDown}
              placeholder={copy.formulaPlaceholder}
              aria-label={copy.formulaBar}
              aria-multiline="true"
              aria-keyshortcuts="Enter Escape Tab F2 Control+Enter Meta+Enter Alt+Enter"
              inputMode="text"
              autoComplete="off"
              spellCheck={false}
            />
          </div>
          <Button
            className="grid-formula-functions-trigger"
            variant="outline"
            size="sm"
            icon={<SearchIcon />}
            aria-label={copy.formulaFunctions}
            aria-haspopup="dialog"
            aria-expanded={formulaFunctionsOpen}
            onClick={openFormulaFunctionDialog}
          >
            fx
          </Button>
        </div>

        {mobileCommands && (
          <div
            className="grid-mobile-dock"
            data-command-tab={commandTab}
            role="toolbar"
            aria-label={copy.toolbarLabel}
            onKeyDown={(event) => {
              if (
                event.key === 'Tab' &&
                event.shiftKey &&
                event.target === event.currentTarget.querySelector('button')
              ) {
                event.preventDefault()
                document.getElementById(`grid-command-${commandTab}`)?.focus()
              }
            }}
          >
            {commandTab === 'home' ? (
              <>
                {boldCommand}
                {italicCommand}
                <CommandMenu label={copy.clipboardGroup} icon={<CopyIcon />}>
                  {clipboardItems('copy')}
                  {clipboardItems('paste')}
                </CommandMenu>
                {moreCommand}
              </>
            ) : commandTab === 'view' ? (
              freezeCommand
            ) : commandTab === 'insert' ? (
              <>
                {insertTableCommand}
                {chartCommand}
              </>
            ) : (
              <>
                {commandTab !== 'table' && sortCommand}
                <CommandMenu label={copy.filterGroup} icon={<FilterIcon />}>
                  {filterCommands}
                </CommandMenu>
                {commandTab === 'table' && moreCommand}
              </>
            )}
          </div>
        )}
        <span id="grid-navigation-help" hidden>
          {copy.gridNavigationHelp}
        </span>
        <div className="grid-sheet-body">
          <div
            id="grid-sheet-scroll"
            className="grid-sheet-scroll"
            ref={(element) => {
              scrollElement.current = element
              gridElement.current = element
            }}
            role="grid"
            aria-label={copy.gridLabel}
            aria-describedby="grid-navigation-help"
            aria-keyshortcuts="Escape"
            aria-rowcount={viewportSize.rows + 1}
            aria-colcount={viewportSize.columns + 1}
            aria-multiselectable="true"
            aria-activedescendant={activeVisible ? `grid-cell-${activeAddress}` : 'grid-active-cell-proxy'}
            tabIndex={0}
            onKeyDown={handleGridKeyDown}
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerOver={handlePointerOver}
            onPointerUp={handlePointerUp}
            onPointerCancel={cancelPointerGesture}
            onLostPointerCapture={() => {
              draggingSelection.current = false
            }}
            onDoubleClick={handleGridDoubleClick}
            onContextMenu={handleGridContextMenu}
          >
            <div className="grid-sheet" style={{ width: gridWidth, height: gridHeight }}>
              <div
                className="grid-header-row"
                role="row"
                aria-rowindex={1}
                style={{ width: gridWidth, height: scaledColumnHeaderHeight }}
              >
                <div
                  className="grid-corner"
                  role="columnheader"
                  aria-colindex={1}
                  aria-label={copy.cornerLabel}
                  data-select-all="true"
                  style={{ width: scaledRowHeaderWidth, height: scaledColumnHeaderHeight }}
                />
                {virtualColumns.map((item) => {
                  const column = item.index + 1
                  const label = columnNumberToName(column)
                  const selected = selection.ranges.some(
                    (range) => column >= range.start.column && column <= range.end.column,
                  )
                  const size = getColumnWidth(item.index)
                  const clipLeft = frozenAxisClip(
                    item.index,
                    item.start,
                    columnVirtualizer.scrollOffset ?? 0,
                    frozenWidth,
                  )
                  return (
                    <div
                      className={`grid-column-heading${selected ? ' grid-axis-selected' : ''}`}
                      role="columnheader"
                      aria-colindex={column + 1}
                      aria-selected={selected}
                      data-column-header={column}
                      key={item.key}
                      style={{
                        left:
                          scaledRowHeaderWidth +
                          frozenAxisPosition(
                            item.index,
                            item.start,
                            columnVirtualizer.scrollOffset ?? 0,
                            frozen.columns,
                          ),
                        zIndex: frozen.columns && item.index === 0 ? 7 : undefined,
                        clipPath: clipLeft > 0 ? `inset(0 0 0 ${clipLeft}px)` : undefined,
                        width: item.size,
                        height: scaledColumnHeaderHeight,
                      }}
                    >
                      {label}
                      <div
                        className="grid-resize-handle grid-resize-handle--column"
                        role="slider"
                        aria-label={copy.resizeColumn(label)}
                        aria-orientation="horizontal"
                        aria-valuenow={Math.round(size)}
                        aria-valuemin={MIN_COLUMN_WIDTH}
                        aria-valuemax={MAX_COLUMN_WIDTH}
                        tabIndex={0}
                        data-resize-axis="column"
                        data-resize-index={column}
                        onKeyDown={(event) => handleResizeKeyDown(event, 'column', column, size)}
                      />
                    </div>
                  )
                })}
              </div>

              {virtualRows.map((rowItem) => {
                const row = rowItem.index + 1
                const rowSelected = selection.ranges.some((range) => row >= range.start.row && row <= range.end.row)
                const rowSize = getRowHeight(rowItem.index)
                const clipTop = frozenAxisClip(
                  rowItem.index,
                  rowItem.start,
                  rowVirtualizer.scrollOffset ?? 0,
                  frozenHeight,
                )
                return (
                  <div
                    className="grid-virtual-row"
                    role="row"
                    aria-rowindex={row + 1}
                    key={rowItem.key}
                    style={{
                      top:
                        scaledColumnHeaderHeight +
                        frozenAxisPosition(rowItem.index, rowItem.start, rowVirtualizer.scrollOffset ?? 0, frozen.rows),
                      width: gridWidth,
                      height: rowItem.size,
                      zIndex: frozen.rows && rowItem.index === 0 ? 3 : undefined,
                      clipPath: clipTop > 0 ? `inset(${clipTop}px 0 0 0)` : undefined,
                    }}
                  >
                    <div
                      className={`grid-row-heading${rowSelected ? ' grid-axis-selected' : ''}`}
                      role="rowheader"
                      aria-colindex={1}
                      aria-rowindex={row + 1}
                      aria-selected={rowSelected}
                      data-row-header={row}
                      style={{ width: scaledRowHeaderWidth, height: rowItem.size }}
                    >
                      {row}
                      <div
                        className="grid-resize-handle grid-resize-handle--row"
                        role="slider"
                        aria-label={copy.resizeRow(row)}
                        aria-orientation="vertical"
                        aria-valuenow={Math.round(rowSize)}
                        aria-valuemin={MIN_ROW_HEIGHT}
                        aria-valuemax={MAX_ROW_HEIGHT}
                        tabIndex={0}
                        data-resize-axis="row"
                        data-resize-index={row}
                        onKeyDown={(event) => handleResizeKeyDown(event, 'row', row, rowSize)}
                      />
                    </div>
                    {virtualColumns.map((columnItem) => {
                      const column = columnItem.index + 1
                      const address = addressAt(row, column)
                      const key = cellAddressKey(address)
                      const cell = session.getCell(activeSheetId, key)
                      const nativeTable = sheet.tables.find(
                        (table) =>
                          table.ownership === 'simple' &&
                          row >= table.range.start.row &&
                          row <= table.range.end.row &&
                          column >= table.range.start.column &&
                          column <= table.range.end.column,
                      )
                      const tableRole = nativeTable
                        ? row === nativeTable.range.start.row
                          ? 'header'
                          : (row - nativeTable.range.start.row) % 2
                            ? 'band'
                            : 'body'
                        : undefined
                      const cellEdit =
                        editDraft?.sheetId === activeSheetId &&
                        editDraft.address.row === row &&
                        editDraft.address.column === column
                          ? editDraft
                          : null
                      const text = cellEdit?.text ?? formatCellDisplay(cell, locale, session.workbook.dateSystem)
                      const active = address.row === selection.active.row && address.column === selection.active.column
                      const clipLeft = frozenAxisClip(
                        columnItem.index,
                        columnItem.start,
                        columnVirtualizer.scrollOffset ?? 0,
                        frozenWidth,
                      )
                      return (
                        <div
                          className="grid-cell-position"
                          key={`${rowItem.key}:${columnItem.key}`}
                          style={{
                            left:
                              scaledRowHeaderWidth +
                              frozenAxisPosition(
                                columnItem.index,
                                columnItem.start,
                                columnVirtualizer.scrollOffset ?? 0,
                                frozen.columns,
                              ),
                            zIndex:
                              cellEdit?.origin === 'cell'
                                ? 4
                                : frozen.columns && columnItem.index === 0
                                  ? 1
                                  : undefined,
                            clipPath: clipLeft > 0 ? `inset(0 0 0 ${clipLeft}px)` : undefined,
                            top: 0,
                            width: columnItem.size,
                            height: rowItem.size,
                          }}
                        >
                          <GridCell
                            address={key}
                            row={row}
                            column={column}
                            value={text}
                            selected={isSelected(selection, address)}
                            rangeEdges={selectionEdges(selection, address)}
                            active={active}
                            {...styleForCell(cell)}
                            tableRole={tableRole}
                            filterLabel={`${FILTER_COPY[locale].title}: ${text || key}`}
                            onFilter={
                              tableRole === 'header' && nativeTable
                                ? () => {
                                    try {
                                      if (editDraftRef.current) return
                                      filteredRows(
                                        session.workbook,
                                        sheet,
                                        nativeTable.range,
                                        sheet.autoFilter?.criteria ?? [],
                                      )
                                      setFilterColumn(column)
                                      setFilterRange(structuredClone(nativeTable.range))
                                    } catch {
                                      setNotice(FILTER_COPY[locale].refused)
                                    }
                                  }
                                : undefined
                            }
                            emptyLabel={copy.emptyCell}
                            editor={
                              cellEdit?.origin === 'cell'
                                ? {
                                    value: cellEdit.text,
                                    rows: Math.min(6, Math.max(1, cellEdit.text.split('\n').length)),
                                    label: copy.cellEditor(key),
                                    inputRef: cellEditorElement,
                                    onChange: (value) => changeDraftText(value, 'cell'),
                                    onKeyDown: handleCellEditorKeyDown,
                                    onBlur: handleCellEditorBlur,
                                  }
                                : undefined
                            }
                          />
                        </div>
                      )
                    })}
                  </div>
                )
              })}
              {currentChart?.chart && (
                <ChartObject
                  key={activeSheetId + currentChart.id}
                  sheet={sheet}
                  drawing={currentChart}
                  rowSize={getScaledRowHeight}
                  columnSize={getScaledColumnWidth}
                  rows={viewportSize.rows}
                  columns={viewportSize.columns}
                  headerWidth={scaledRowHeaderWidth}
                  headerHeight={scaledColumnHeaderHeight}
                  scrollX={columnVirtualizer.scrollOffset ?? 0}
                  scrollY={rowVirtualizer.scrollOffset ?? 0}
                  frozenWidth={frozenWidth}
                  frozenHeight={frozenHeight}
                  onPlace={(range) => {
                    if (saving || editDraftRef.current) return
                    try {
                      session.execute({ type: 'place-chart', sheetId: activeSheetId, chartId: currentChart.id, range })
                      ensureViewport(range.end.row, range.end.column)
                    } catch (error) {
                      setNotice(chartErrorMessage(error, locale))
                    }
                  }}
                  onReveal={(range) => {
                    rowVirtualizer.scrollToIndex(range.start.row - 1, { align: 'start' })
                    columnVirtualizer.scrollToIndex(range.start.column - 1, { align: 'start' })
                  }}
                  onHistory={(redo) => {
                    if (!saving && !editDraftRef.current) {
                      if (redo) session.redo()
                      else session.undo()
                    }
                  }}
                  locale={locale}
                  disabled={saving}
                  onEdit={() => {
                    if (editDraftRef.current) {
                      setNotice(CHART_COPY[locale].errors.context)
                      return
                    }
                    setChartDialog({ range: currentChart.chart!.sourceRange, editing: true })
                  }}
                  onRemove={() => {
                    try {
                      if (editDraftRef.current) throw new ChartError('context')
                      session.execute({ type: 'remove-chart', sheetId: activeSheetId, chartId: currentChart.id })
                      focusGrid()
                    } catch (error) {
                      setNotice(chartErrorMessage(error, locale))
                    }
                  }}
                />
              )}
              {!activeVisible && (
                <div className="grid-active-proxy-row" role="row" aria-rowindex={selection.active.row + 1}>
                  <div
                    className="grid-active-cell-proxy"
                    id="grid-active-cell-proxy"
                    role="gridcell"
                    aria-colindex={selection.active.column + 1}
                    aria-selected="true"
                    aria-label={activeDescription}
                  />
                </div>
              )}
            </div>
          </div>
        </div>
        {contextMenu && (
          <div
            ref={contextMenuElement}
            className="grid-context-menu"
            role="menu"
            aria-label={copy.contextMenu}
            tabIndex={-1}
            style={{ left: contextMenu.x, top: contextMenu.y }}
            onKeyDown={handleContextMenuKeyDown}
          >
            <Button role="menuitem" variant="secondary" size="sm" onClick={() => runContextMenuAction('clear')}>
              {copy.clearContents}
            </Button>
            <Button role="menuitem" variant="secondary" size="sm" onClick={() => void performValuesClipboard('copy')}>
              {copy.copyValues}
            </Button>
            <Button role="menuitem" variant="secondary" size="sm" disabled aria-disabled="true">
              {copy.cutUnavailable}
            </Button>
            <Button role="menuitem" variant="secondary" size="sm" onClick={() => void performValuesClipboard('paste')}>
              {copy.pasteValues}
            </Button>
            <Button
              role="menuitem"
              variant="secondary"
              size="sm"
              onClick={() => void performValuesClipboard('copy', true)}
            >
              {copy.copyFormulas}
            </Button>
            <Button
              role="menuitem"
              variant="secondary"
              size="sm"
              onClick={() => void performValuesClipboard('paste', true)}
            >
              {copy.pasteFormulas}
            </Button>
            <div className="grid-context-menu-divider" role="separator" />
            <Button role="menuitem" variant="secondary" size="sm" onClick={() => runContextMenuAction('insert-row')}>
              {copy.insertRows(contextMenu.rowCount)}
            </Button>
            <Button role="menuitem" variant="secondary" size="sm" onClick={() => runContextMenuAction('delete-row')}>
              {copy.deleteRows(contextMenu.rowCount)}
            </Button>
            <Button role="menuitem" variant="secondary" size="sm" onClick={() => runContextMenuAction('insert-column')}>
              {copy.insertColumns(contextMenu.columnCount)}
            </Button>
            <Button role="menuitem" variant="secondary" size="sm" onClick={() => runContextMenuAction('delete-column')}>
              {copy.deleteColumns(contextMenu.columnCount)}
            </Button>
          </div>
        )}

        <Dialog
          open={sheetRenameId !== null}
          title={copy.renameSheet}
          description={copy.renameSheetDescription}
          onClose={closeSheetRename}
          maxWidth="sm"
          showCloseButton={false}
          className="grid-rename-sheet-dialog"
          footer={
            <>
              <Button type="button" size="sm" variant="outline" onClick={closeSheetRename}>
                {copy.cancelAction}
              </Button>
              <Button type="submit" size="sm" form="grid-rename-sheet-form" variant="primary">
                {copy.renameAction}
              </Button>
            </>
          }
        >
          <form id="grid-rename-sheet-form" className="grid-rename-sheet-form" onSubmit={submitSheetRename}>
            <Input
              id="grid-rename-sheet-name"
              fullWidth
              density="compact"
              label={copy.sheetName}
              value={sheetRenameName}
              onChange={(event) => {
                setSheetRenameName(event.currentTarget.value)
                setSheetRenameError(undefined)
              }}
              error={sheetRenameError}
              maxLength={31}
              autoComplete="off"
              spellCheck={false}
            />
          </form>
        </Dialog>

        <nav className="grid-touch-controls" aria-label={copy.touchControls}>
          <Button
            className="grid-range-toggle"
            size="sm"
            variant="secondary"
            aria-label={copy.rangeSelection}
            aria-pressed={rangeDragMode}
            onClick={() => {
              const next = !rangeDragMode
              setRangeDragMode(next)
              setNotice(next ? copy.rangeSelectionOn : copy.rangeSelectionOff)
            }}
          >
            {copy.rangeShort}
          </Button>
          <Button
            size="sm"
            variant="secondary"
            aria-label={copy.moveLeft}
            onClick={() => updateSelection(moveSelection(selection, 0, -1, viewportSize))}
          >
            <span aria-hidden="true">←</span>
          </Button>
          <Button
            size="sm"
            variant="secondary"
            aria-label={copy.moveUp}
            onClick={() => updateSelection(moveSelection(selection, -1, 0, viewportSize))}
          >
            <span aria-hidden="true">↑</span>
          </Button>
          <Button
            size="sm"
            variant="secondary"
            aria-label={copy.moveDown}
            onClick={() => updateSelection(moveSelection(selection, 1, 0, viewportSize))}
          >
            <span aria-hidden="true">↓</span>
          </Button>
          <Button
            size="sm"
            variant="secondary"
            aria-label={copy.moveRight}
            onClick={() => updateSelection(moveSelection(selection, 0, 1, viewportSize))}
          >
            <span aria-hidden="true">→</span>
          </Button>
        </nav>

        <div className="grid-screen-reader-status" aria-live="polite" aria-atomic="true">
          {activeDescription}
        </div>
      </FullBleedLayout>
    </div>
  )
  return (
    <ButtonTooltipProvider locale={locale} resolveTooltip={(label) => getGridButtonTooltip(locale, label)}>
      {mobileCommands &&
        headerActions &&
        createPortal(
          <>
            <CommandMenu label={copy.fileTab} variant="outline">
              {fileCommands}
            </CommandMenu>
            <EditorActionCluster actions={editorActions} saveOnly />
          </>,
          headerActions,
        )}
      {appContent}
    </ButtonTooltipProvider>
  )
}
