import { useEffect, useRef, useState, type PointerEvent } from 'react'
import { Button, Dialog, Input } from '@all/ui'
import { CHART_COPY, ColumnChart } from './Chart'
import { chartAxisMarker, chartBox } from './engine/viewport/chart'
import { formatRangeAddress, parseRangeAddress } from './engine/workbook/address'
import { validateChartAnchor } from './engine/workbook/chart'
import type { CellRange, DrawingDescriptor, Worksheet } from './engine/workbook/types'
import type { Locale } from './types'

export function ChartObject({
  sheet,
  drawing,
  locale,
  disabled,
  rowSize,
  columnSize,
  rows,
  columns,
  headerWidth,
  headerHeight,
  scrollX,
  scrollY,
  frozenWidth,
  frozenHeight,
  onPlace,
  onReveal,
  onEdit,
  onRemove,
  onHistory,
}: {
  sheet: Worksheet
  drawing: DrawingDescriptor
  locale: Locale
  disabled: boolean
  rowSize: (index: number) => number
  columnSize: (index: number) => number
  rows: number
  columns: number
  headerWidth: number
  headerHeight: number
  scrollX: number
  scrollY: number
  frozenWidth: number
  frozenHeight: number
  onPlace: (range: CellRange) => void
  onReveal: (range: CellRange) => void
  onEdit: () => void
  onRemove: () => void
  onHistory: (redo: boolean) => void
}) {
  const root = useRef<HTMLDivElement>(null)
  const [selected, setSelected] = useState(false)
  const [preview, setPreview] = useState<CellRange | null>(null)
  const [position, setPosition] = useState<string | null>(null)
  const [invalid, setInvalid] = useState(false)
  const gesture = useRef<{ x: number; y: number; range: CellRange; corner?: string } | null>(null)
  const dragged = useRef(false)
  const chart = drawing.chart!
  const copy = CHART_COPY[locale]
  const placeLabel = locale === 'pl' ? 'Pozycja i rozmiar' : 'Position and size'
  const moveLabel = locale === 'pl' ? 'Przenieś wykres' : 'Move chart'
  const resizeLabel = locale === 'pl' ? 'Zmień rozmiar wykresu' : 'Resize chart'
  const help =
    locale === 'pl'
      ? 'Przeciągnij tytuł lub uchwyty. Strzałki przenoszą, Shift + strzałki zmieniają rozmiar. Escape anuluje.'
      : 'Drag the title or handles. Arrow keys move; Shift + arrows resize. Escape cancels.'
  useEffect(() => {
    const outside = (event: globalThis.PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setSelected(false)
    }
    document.addEventListener('pointerdown', outside)
    return () => document.removeEventListener('pointerdown', outside)
  }, [])
  const range = preview ?? drawing.range
  const box = chartBox(range, rowSize, columnSize)
  const begin = (event: PointerEvent<HTMLButtonElement>, corner?: string) => {
    event.stopPropagation()
    // Touching the title retains native sheet panning; explicit handles opt into resizing.
    if (disabled || (!corner && (!selected || event.pointerType === 'touch'))) return
    gesture.current = { x: event.clientX, y: event.clientY, range: structuredClone(drawing.range), corner }
    dragged.current = false
    event.currentTarget.setPointerCapture(event.pointerId)
  }
  const move = (event: PointerEvent<HTMLButtonElement>) => {
    event.stopPropagation()
    const start = gesture.current
    if (!start || Math.hypot(event.clientX - start.x, event.clientY - start.y) < 5) return
    dragged.current = true
    const initial = chartBox(start.range, rowSize, columnSize)
    const dx = event.clientX - start.x,
      dy = event.clientY - start.y
    const next = structuredClone(start.range)
    if (!start.corner) {
      const rowSpan = next.end.row - next.start.row,
        colSpan = next.end.column - next.start.column
      next.start.row = chartAxisMarker(initial.top + dy, rowSize, Math.max(1, rows - rowSpan))
      next.start.column = chartAxisMarker(initial.left + dx, columnSize, Math.max(1, columns - colSpan))
      next.end = { row: next.start.row + rowSpan, column: next.start.column + colSpan }
    } else {
      if (start.corner.includes('w'))
        next.start.column = Math.min(next.end.column - 3, chartAxisMarker(initial.left + dx, columnSize, columns))
      else
        next.end.column = Math.max(
          next.start.column + 3,
          chartAxisMarker(initial.left + initial.width + dx, columnSize, columns),
        )
      if (start.corner.includes('n'))
        next.start.row = Math.min(next.end.row - 6, chartAxisMarker(initial.top + dy, rowSize, rows))
      else
        next.end.row = Math.max(next.start.row + 6, chartAxisMarker(initial.top + initial.height + dy, rowSize, rows))
    }
    setPreview(next)
  }
  const end = (event: PointerEvent<HTMLButtonElement>, cancel = false) => {
    event.stopPropagation()
    if (!gesture.current) return
    if (!gesture.current.corner || cancel) dragged.current = false
    gesture.current = null
    if (preview && !cancel) onPlace(preview)
    setPreview(null)
  }
  return (
    <div
      ref={root}
      className="grid-chart-panel grid-chart-object"
      role="presentation"
      data-selected={selected}
      data-anchor={formatRangeAddress(range)}
      style={{
        left: box.left + headerWidth,
        top: box.top + headerHeight,
        width: box.width,
        height: box.height,
        clipPath: `inset(${Math.max(0, scrollY + frozenHeight - box.top)}px 0 0 ${Math.max(0, scrollX + frozenWidth - box.left)}px)`,
      }}
      onPointerDown={(event) => event.stopPropagation()}
      onDoubleClick={(event) => event.stopPropagation()}
      onContextMenu={(event) => event.stopPropagation()}
      onClick={() => setSelected(true)}
      onKeyDown={(event) => {
        // Portal dialogs keep native text editing and their document-level Escape handler.
        // Workbook Save also belongs to the existing document shortcut listener.
        if (
          (event.target instanceof Element && event.target.closest('[role="dialog"]')) ||
          event.nativeEvent.isComposing ||
          event.nativeEvent.keyCode === 229 ||
          ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's')
        )
          return
        event.stopPropagation()
        if (event.key === 'Escape') {
          gesture.current = null
          setPreview(null)
          setSelected(false)
          return
        }
        if ((event.ctrlKey || event.metaKey) && ['z', 'y'].includes(event.key.toLowerCase())) {
          event.preventDefault()
          onHistory(event.key.toLowerCase() === 'y' || event.shiftKey)
          return
        }
        if (!selected || disabled || event.target !== root.current?.querySelector('.grid-chart-title')) return
        if (event.key === 'Delete') {
          event.preventDefault()
          onRemove()
          return
        }
        const dr = Number(event.key === 'ArrowDown') - Number(event.key === 'ArrowUp')
        const dc = Number(event.key === 'ArrowRight') - Number(event.key === 'ArrowLeft')
        if (!dr && !dc) return
        event.preventDefault()
        const next = structuredClone(drawing.range)
        if (!event.shiftKey) {
          next.start.row += dr
          next.start.column += dc
        }
        next.end.row += dr
        next.end.column += dc
        try {
          validateChartAnchor(next)
          onPlace(next)
        } catch {
          /* Boundary: retain current placement. */
        }
      }}
    >
      <Button
        className="grid-chart-title"
        variant="ghost"
        aria-label={`${copy.select}: ${chart.title}`}
        aria-pressed={selected}
        title={`${moveLabel}. ${help}`}
        onClick={() => setSelected(true)}
        onPointerDown={begin}
        onPointerMove={move}
        onPointerUp={(event) => end(event)}
        onPointerCancel={(event) => end(event, true)}
        onLostPointerCapture={() => {
          gesture.current = null
          setPreview(null)
        }}
      >
        <strong>{chart.title}</strong>
      </Button>
      <div className="grid-chart-content">
        <ColumnChart sheet={sheet} chart={chart} locale={locale} />
      </div>
      {selected && (
        <>
          <div className="grid-chart-actions">
            <Button variant="outline" disabled={disabled} onClick={onEdit}>
              {copy.edit}
            </Button>
            <Button
              variant="outline"
              disabled={disabled}
              onClick={() => {
                setPosition(formatRangeAddress(drawing.range))
                setInvalid(false)
              }}
            >
              {placeLabel}
            </Button>
            <Button variant="outline" disabled={disabled} onClick={onRemove}>
              {copy.remove}
            </Button>
          </div>
          {['nw', 'ne', 'sw', 'se'].map((corner) => (
            <button
              key={corner}
              type="button"
              className={`grid-chart-handle grid-chart-handle-${corner}`}
              aria-label={`${resizeLabel} ${corner}`}
              disabled={disabled}
              onPointerDown={(event) => begin(event, corner)}
              onPointerMove={move}
              onPointerUp={(event) => end(event)}
              onPointerCancel={(event) => end(event, true)}
              onLostPointerCapture={() => {
                gesture.current = null
                setPreview(null)
              }}
              onClick={() => {
                if (!dragged.current) {
                  setPosition(formatRangeAddress(drawing.range))
                  setInvalid(false)
                }
                dragged.current = false
              }}
            />
          ))}
        </>
      )}
      {position !== null && (
        <Dialog
          open
          title={placeLabel}
          closeLabel={copy.cancel}
          onClose={() => setPosition(null)}
          description={help}
          footer={
            <>
              <Button variant="outline" onClick={() => setPosition(null)}>
                {copy.cancel}
              </Button>
              <Button
                onClick={() => {
                  try {
                    const next = parseRangeAddress(position)
                    validateChartAnchor(next)
                    onPlace(next)
                    requestAnimationFrame(() => onReveal(next))
                    setPosition(null)
                  } catch {
                    setInvalid(true)
                  }
                }}
              >
                {copy.apply}
              </Button>
            </>
          }
        >
          <Input
            label={placeLabel}
            aria-label={placeLabel}
            value={position}
            onChange={(event) => {
              setPosition(event.currentTarget.value)
              setInvalid(false)
            }}
          />
          {invalid && (
            <p role="alert">
              {locale === 'pl'
                ? 'Podaj zakres o szerokości co najmniej 3 kolumn i wysokości 6 wierszy, np. D1:L18.'
                : 'Enter an anchor spanning at least 3 columns and 6 rows, e.g. D1:L18.'}
            </p>
          )}
        </Dialog>
      )}
    </div>
  )
}
