import {
  memo,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
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
import { useVirtualizer } from '@tanstack/react-virtual'
import {
  Button,
  ButtonTooltipProvider,
  Dialog,
  FilePlusIcon,
  FolderOpenIcon,
  FullBleedLayout,
  IconButton,
  Input,
  RedoIcon,
  SearchIcon,
  SaveAsIcon,
  SaveIcon,
  Select,
  Text,
  TextArea,
  ThemeContext,
  ToolbarPager as ControlsBar,
  ToolbarGroup,
  UndoIcon,
  WorkspaceStatusBar,
  WorkspaceStatusItem,
  WorkspaceSheetTabs,
  WorkspaceTabs,
} from '@all/ui'
import type { AppComponentProps } from './types'
import { GRID_COPY } from './i18n'
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
import './grid.css'

const ROW_HEADER_WIDTH = 48
const DEFAULT_ROW_HEIGHT = 32
const DEFAULT_COLUMN_WIDTH = 112
const MIN_ROW_HEIGHT = 24
const MAX_ROW_HEIGHT = 160
const MIN_COLUMN_WIDTH = 56
const MAX_COLUMN_WIDTH = 480
const MAX_FILL_CELLS = 10_000
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

export function Grid({ locale, isEink = false, setIsDirty }: AppComponentProps) {
  const copy = GRID_COPY[locale]
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
  const [commandTab, setCommandTab] = useState<'file' | 'format'>('format')
  const [notice, setNotice] = useState(copy.initialStatus)
  const [pendingImport, setPendingImport] = useState<XlsxImportPreflight | null>(null)
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
  const pendingOpenHandleRef = useRef<FilePickerHandle | null>(null)
  const pendingSaveAsHandleRef = useRef<SavePickerHandle | null>(null)
  const currentFileNameRef = useRef('Book1.xlsx')
  const saveShortcutHandlerRef = useRef<((forceSaveAs?: boolean) => Promise<void>) | null>(null)
  const openRequestId = useRef(0)
  const appTheme = isEink ? (theme?.isDark ? 'e-ink-dark' : 'e-ink-light') : theme?.theme
  const columnHeaderHeight = coarsePointer ? 44 : 36
  const defaultRowHeight = coarsePointer ? 44 : DEFAULT_ROW_HEIGHT
  const zoomScale = zoom / 100
  const sheet =
    session.workbook.sheetsById.get(activeSheetId) ?? session.workbook.sheetsById.get(session.workbook.activeSheetId)!
  const activeAddress = formatCellAddress(selection.active)
  const selectedRange = formatRangeAddress(selection.ranges[selection.ranges.length - 1])
  const activeCell = session.getCell(activeSheetId, selection.active)
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

  useEffect(() => session.subscribe(() => setRevision((current) => current + 1)), [session])

  useEffect(() => setNotice(copy.initialStatus), [copy.initialStatus])

  useEffect(() => setNameBoxValue(selectedRange), [selectedRange])

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

  const rowVirtualizer = useVirtualizer({
    count: viewportSize.rows,
    getScrollElement: () => scrollElement.current,
    estimateSize: getScaledRowHeight,
    overscan: 6,
    scrollPaddingEnd: columnHeaderHeight * zoomScale,
    initialRect: { width: 960, height: 480 },
  })
  const columnVirtualizer = useVirtualizer({
    count: viewportSize.columns,
    getScrollElement: () => scrollElement.current,
    estimateSize: getScaledColumnWidth,
    horizontal: true,
    overscan: 4,
    scrollPaddingEnd: ROW_HEADER_WIDTH * zoomScale,
    initialRect: { width: 960, height: 480 },
  })
  const virtualRows = rowVirtualizer.getVirtualItems()
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

  useEffect(() => {
    rowVirtualizer.scrollToIndex(selection.active.row - 1, { align: 'auto' })
    columnVirtualizer.scrollToIndex(selection.active.column - 1, { align: 'auto' })
  }, [
    selection.active.row,
    selection.active.column,
    viewportSize.rows,
    viewportSize.columns,
    rowVirtualizer,
    columnVirtualizer,
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
    const current = editDraftRef.current
    const targetChanged =
      current &&
      (current.sheetId !== activeSheetId ||
        current.address.row !== next.active.row ||
        current.address.column !== next.active.column)
    if (targetChanged && !commitEdit()) return
    setSelection(next)
    ensureViewport(next.active.row, next.active.column)
    setNotice(copy.ready)
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

  const handleGridKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    // Nested resize sliders and editors keep their own keyboard and Tab behavior.
    if (event.target !== event.currentTarget) return
    if (event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229) return
    if (event.key === 'Escape' && editDraftRef.current) {
      event.preventDefault()
      cancelEdit()
      return
    }
    if (event.key === 'Enter' && (event.ctrlKey || event.metaKey) && editDraftRef.current) {
      event.preventDefault()
      if (commitEdit(true)) focusGrid()
      return
    }
    const extend = event.shiftKey
    const meta = event.ctrlKey || event.metaKey
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
      if (commitEdit()) focusGrid()
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
      if (commitEdit()) focusGrid()
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
    if (pendingImport || importProgress) return true
    return (
      target instanceof HTMLElement &&
      (target.hasAttribute('data-grid-open') ||
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

  const runContextMenuAction = (action: 'clear' | 'insert-row' | 'delete-row' | 'insert-column' | 'delete-column') => {
    const menu = contextMenu
    if (!menu || (editDraftRef.current && !commitEdit())) return
    try {
      if (action === 'clear') clearSelectionContents(menu.selection, menu.sheetId)
      if (action === 'insert-row')
        session.insertRows(
          menu.sheetId,
          menu.targetType === 'row' ? menu.selection.ranges[0].start.row : menu.row,
          menu.rowCount,
        )
      if (action === 'delete-row')
        session.deleteRows(
          menu.sheetId,
          menu.targetType === 'row' ? menu.selection.ranges[0].start.row : menu.row,
          menu.rowCount,
        )
      if (action === 'insert-column')
        session.insertColumns(
          menu.sheetId,
          menu.targetType === 'column' ? menu.selection.ranges[0].start.column : menu.column,
          menu.columnCount,
        )
      if (action === 'delete-column')
        session.deleteColumns(
          menu.sheetId,
          menu.targetType === 'column' ? menu.selection.ranges[0].start.column : menu.column,
          menu.columnCount,
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
    setImportProgress(null)
    const workbook = createWorkbook({ firstSheetName: 'Sheet1' })
    session.replaceWorkbook(workbook)
    currentSaveHandleRef.current = null
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
    setImportProgress(null)
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
      const task = startXlsxExport(session.workbook, currentFileNameRef.current, (progress) => {
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
  const commandTabs = ['file', 'format'] as const
  const commandLabels = { file: copy.fileTab, format: copy.formatTab }
  const historyControls = (
    <ToolbarGroup label={copy.historyGroup} caption={copy.historyGroup}>
      <IconButton
        aria-label={copy.undoShortcut}
        title={copy.undoShortcut}
        icon={<UndoIcon />}
        size="sm"
        variant="outline"
        aria-keyshortcuts="Control+Z Meta+Z"
        disabled={!historyState.canUndo}
        onMouseDown={(event) => event.preventDefault()}
        onClick={performUndo}
      />
      <IconButton
        aria-label={copy.redoShortcut}
        title={copy.redoShortcut}
        icon={<RedoIcon />}
        size="sm"
        variant="outline"
        aria-keyshortcuts="Control+Y Control+Shift+Z Meta+Y Meta+Shift+Z"
        disabled={!historyState.canRedo}
        onMouseDown={(event) => event.preventDefault()}
        onClick={performRedo}
      />
    </ToolbarGroup>
  )

  const appContent = (
    <div
      className="grid-app"
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
    >
      <FullBleedLayout
        className="grid-workspace"
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
          >
            <WorkspaceStatusItem role="status" aria-live="polite" aria-label={`${copy.selectedCell}: ${selectedRange}`}>
              {notice || copy.ready} — {selectedRange}
            </WorkspaceStatusItem>
          </WorkspaceStatusBar>
        }
      >
        <WorkspaceTabs
          label={copy.toolbarLabel}
          items={commandTabs.map((tab) => ({
            id: tab,
            label: commandLabels[tab],
            tooltip: getGridButtonTooltip(locale, commandLabels[tab]),
            tabId: `grid-command-${tab}`,
            panelId: `grid-panel-${tab}`,
          }))}
          activeId={commandTab}
          onChange={(tab) => setCommandTab(tab as (typeof commandTabs)[number])}
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
        <div
          id="grid-panel-file"
          className="grid-command-panel"
          role="tabpanel"
          aria-labelledby="grid-command-file"
          hidden={commandTab !== 'file'}
        >
          <ControlsBar locale={locale} className="grid-toolbar" role="toolbar" aria-label={copy.toolbarLabel}>
            <ToolbarGroup label={copy.workbookGroup} caption={copy.workbookGroup}>
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
              <Button variant="outline" size="sm" icon={<FilePlusIcon />} onClick={createNewWorkbook}>
                {copy.newWorkbook}
              </Button>
            </ToolbarGroup>
            {commandTab === 'file' && historyControls}
          </ControlsBar>
        </div>
        <input
          ref={fileInputElement}
          className="grid-file-input"
          type="file"
          accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
          aria-label={copy.openWorkbook}
          onChange={handleFileInputChange}
          tabIndex={-1}
        />
        <div
          id="grid-panel-format"
          className="grid-command-panel"
          role="tabpanel"
          aria-labelledby="grid-command-format"
          hidden={commandTab !== 'format'}
        >
          <ControlsBar
            locale={locale}
            className="grid-toolbar grid-format-toolbar"
            role="toolbar"
            aria-label={copy.formatToolbar}
          >
            {commandTab === 'format' && historyControls}
            <ToolbarGroup label={copy.numberFormat} caption={copy.numberFormat}>
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
              <IconButton
                variant="secondary"
                size="sm"
                aria-label={copy.decreaseDecimals}
                title={copy.decreaseDecimals}
                icon={<DecimalPlacesIcon direction="decrease" separator={locale === 'pl' ? ',' : '.'} />}
                disabled={isDateNumberFormat(activeCell?.style?.numberFormat)}
                onClick={() => adjustSelectedDecimals(-1)}
              />
              <IconButton
                variant="secondary"
                size="sm"
                aria-label={copy.increaseDecimals}
                title={copy.increaseDecimals}
                icon={<DecimalPlacesIcon direction="increase" separator={locale === 'pl' ? ',' : '.'} />}
                disabled={isDateNumberFormat(activeCell?.style?.numberFormat)}
                onClick={() => adjustSelectedDecimals(1)}
              />
            </ToolbarGroup>
            <ToolbarGroup label={copy.typographyGroup} caption={copy.typographyGroup}>
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
                <option value="default">{copy.formatPreset.general}</option>
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
            </ToolbarGroup>
            <ToolbarGroup label={copy.emphasisGroup} caption={copy.emphasisGroup}>
              <Button
                variant="secondary"
                size="sm"
                aria-label={copy.bold}
                aria-pressed={Boolean(activeCell?.style?.font?.bold)}
                onClick={() => toggleSelectedFont('bold')}
              >
                <strong aria-hidden="true">B</strong>
              </Button>
              <Button
                variant="secondary"
                size="sm"
                aria-label={copy.italic}
                aria-pressed={Boolean(activeCell?.style?.font?.italic)}
                onClick={() => toggleSelectedFont('italic')}
              >
                <em aria-hidden="true">I</em>
              </Button>
              <Button
                variant="secondary"
                size="sm"
                aria-label={copy.underline}
                aria-pressed={Boolean(activeCell?.style?.font?.underline)}
                onClick={() => toggleSelectedFont('underline')}
              >
                <u aria-hidden="true">U</u>
              </Button>
            </ToolbarGroup>
            <ToolbarGroup label={copy.colorsGroup} caption={copy.colorsGroup}>
              <label className="grid-format-color">
                <span>{copy.textColor}</span>
                <input
                  type="color"
                  aria-label={copy.textColor}
                  value={activeCell?.style?.font?.color ?? '#202124'}
                  onChange={(event) => setSelectedTextColor(event.currentTarget.value)}
                />
              </label>
              <label className="grid-format-color">
                <span>{copy.fillColor}</span>
                <input
                  type="color"
                  aria-label={copy.fillColor}
                  value={activeCell?.style?.fill?.color ?? '#ffffff'}
                  onChange={(event) => setSelectedFillColor(event.currentTarget.value)}
                />
              </label>
            </ToolbarGroup>
            <ToolbarGroup label={copy.alignmentGroup} caption={copy.alignmentGroup}>
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
                <option value="general">{copy.formatPreset.general}</option>
                <option value="left">{copy.alignLeft}</option>
                <option value="center">{copy.alignCenter}</option>
                <option value="right">{copy.alignRight}</option>
              </Select>
              <Button
                variant="secondary"
                size="sm"
                aria-label={copy.wrapText}
                aria-pressed={Boolean(activeCell?.style?.alignment?.wrapText)}
                onClick={toggleSelectedWrap}
              >
                {copy.wrapText}
              </Button>
              <Button variant="secondary" size="sm" aria-label={copy.clearFormats} onClick={clearSelectedFormats}>
                {copy.clearFormats}
              </Button>
            </ToolbarGroup>
          </ControlsBar>
        </div>

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
          <div className="grid-import-progress" role="group" aria-label={copy.saveWorkbook}>
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
            <progress max={100} value={exportProgress.percent} aria-label={copy.saveWorkbook} />
          </div>
        )}

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

        <div
          id="grid-sheet-scroll"
          className="grid-sheet-scroll"
          ref={(element) => {
            scrollElement.current = element
            gridElement.current = element
          }}
          role="grid"
          aria-label={copy.gridLabel}
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
                return (
                  <div
                    className={`grid-column-heading${selected ? ' grid-axis-selected' : ''}`}
                    role="columnheader"
                    aria-colindex={column + 1}
                    aria-selected={selected}
                    data-column-header={column}
                    key={item.key}
                    style={{
                      left: scaledRowHeaderWidth + item.start,
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
              return (
                <div
                  className="grid-virtual-row"
                  role="row"
                  aria-rowindex={row + 1}
                  key={rowItem.key}
                  style={{ top: scaledColumnHeaderHeight + rowItem.start, width: gridWidth, height: rowItem.size }}
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
                    const cellEdit =
                      editDraft?.sheetId === activeSheetId &&
                      editDraft.address.row === row &&
                      editDraft.address.column === column
                        ? editDraft
                        : null
                    const text = cellEdit?.text ?? formatCellDisplay(cell, locale, session.workbook.dateSystem)
                    const active = address.row === selection.active.row && address.column === selection.active.column
                    return (
                      <div
                        className="grid-cell-position"
                        key={`${rowItem.key}:${columnItem.key}`}
                        style={{
                          left: scaledRowHeaderWidth + columnItem.start,
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
            <Button role="menuitem" variant="secondary" size="sm" disabled aria-disabled="true">
              {copy.copyUnavailable}
            </Button>
            <Button role="menuitem" variant="secondary" size="sm" disabled aria-disabled="true">
              {copy.cutUnavailable}
            </Button>
            <Button role="menuitem" variant="secondary" size="sm" disabled aria-disabled="true">
              {copy.pasteUnavailable}
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
      {appContent}
    </ButtonTooltipProvider>
  )
}
