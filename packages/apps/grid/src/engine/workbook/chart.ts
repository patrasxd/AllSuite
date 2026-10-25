import { cellAddressKey, rangesOverlap } from './address'
import { validateRange } from './model'
import type { CellRange, DrawingDescriptor, FormulaResult, SimpleColumnChart, Workbook, Worksheet } from './types'

export const MAX_CHART_POINTS = 24

/** Native charts use whole-cell twoCellAnchor markers (move and size with cells). */
export function validateChartAnchor(range: CellRange): void {
  validateRange(range)
  if (range.end.row - range.start.row < 6 || range.end.column - range.start.column < 3) throw new ChartError('range')
}

export type ChartErrorCode = 'range' | 'empty' | 'numeric' | 'stale' | 'context' | 'title'
export class ChartError extends Error {
  constructor(readonly code: ChartErrorCode) {
    super(`Unsupported chart: ${code}`)
  }
}

function valueAt(sheet: Worksheet, row: number, column: number, allowCached: boolean): FormulaResult {
  const value = sheet.cells.get(cellAddressKey({ row, column }))?.value ?? { kind: 'blank' }
  if (value.kind !== 'formula') return value
  if (!allowCached && value.formula.calculationStatus !== 'fresh') throw new ChartError('stale')
  return value.formula.cachedResult
}

/** Two adjacent columns, optional text headers, at most 24 data rows. Blank values remain gaps. */
export function chartData(sheet: Worksheet, chart: SimpleColumnChart, allowCached = false) {
  const range = chart.sourceRange
  validateRange(range)
  const count = range.end.row - range.start.row + 1 - Number(chart.headers)
  if (chart.type !== 'column' || range.end.column !== range.start.column + 1 || count < 1 || count > MAX_CHART_POINTS)
    throw new ChartError('range')
  if (sheet.merges.some((merge) => rangesOverlap(merge, range))) throw new ChartError('range')
  if (
    !chart.title.trim() ||
    chart.title.length > 120 ||
    [...chart.title].some((char) => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127)
  )
    throw new ChartError('title')
  const label = (row: number, column: number): string => {
    const value = valueAt(sheet, row, column, allowCached)
    if (value.kind === 'blank') return ''
    if (value.kind !== 'number' && value.kind !== 'string') throw new ChartError('range')
    return String(value.value)
  }
  const categoryTitle = chart.headers ? label(range.start.row, range.start.column) : ''
  const seriesTitle = chart.headers ? label(range.start.row, range.end.column) : ''
  const points = Array.from({ length: count }, (_, index) => {
    const row = range.start.row + Number(chart.headers) + index
    const value = valueAt(sheet, row, range.end.column, allowCached)
    if (value.kind !== 'blank' && (value.kind !== 'number' || !Number.isFinite(value.value)))
      throw new ChartError('numeric')
    return { category: label(row, range.start.column), value: value.kind === 'number' ? value.value : null }
  })
  if (!points.some((point) => point.value !== null)) {
    const nonempty = points.some((point) => point.category)
    throw new ChartError(nonempty ? 'numeric' : 'empty')
  }
  return { categoryTitle, seriesTitle, points }
}

export function defaultChart(sheet: Worksheet, sourceRange: CellRange): SimpleColumnChart {
  const value = valueAt(sheet, sourceRange.start.row, sourceRange.end.column, false)
  const headers = value.kind === 'string'
  return {
    type: 'column',
    title: headers && value.value.trim() ? value.value.slice(0, 120) : sheet.name,
    sourceRange,
    headers,
  }
}

export function planColumnChart(
  workbook: Workbook,
  sheet: Worksheet,
  chart: SimpleColumnChart,
  existing?: DrawingDescriptor,
): DrawingDescriptor {
  chartData(sheet, chart)
  const sheetPart = workbook.preservation?.sheetMappings?.find((mapping) => mapping.sheetId === sheet.id)?.partName
  if (
    !existing &&
    sheetPart &&
    workbook.preservation?.inventory?.relationships.some(
      (rel) => rel.sourcePart === sheetPart && rel.type.endsWith('/drawing'),
    )
  )
    throw new ChartError('context')
  if (
    sheet.drawings.some((drawing) => drawing !== existing) ||
    sheet.pivots.length ||
    sheet.visibility === 'veryHidden'
  )
    throw new ChartError('context')
  if (existing) return { ...structuredClone(existing), chart: structuredClone(chart) }
  const used = new Set(workbook.preservation?.parts.map((part) => part.partName))
  for (const candidate of workbook.sheetsById.values()) {
    for (const drawing of candidate.drawings) {
      if (drawing.sourcePartName) used.add(drawing.sourcePartName)
      if (drawing.drawingPartName) used.add(drawing.drawingPartName)
    }
  }
  let number = 1
  while (
    used.has(`xl/charts/chart${number}.xml`) ||
    used.has(`xl/drawings/drawing${number}.xml`) ||
    used.has(`xl/drawings/_rels/drawing${number}.xml.rels`)
  )
    number++
  const column =
    chart.sourceRange.end.column <= 16377 ? chart.sourceRange.end.column + 2 : chart.sourceRange.start.column - 6
  const row = Math.min(1048566, chart.sourceRange.start.row)
  return {
    id: `xl/charts/chart${number}.xml`,
    kind: 'chart',
    sourcePartName: `xl/charts/chart${number}.xml`,
    drawingPartName: `xl/drawings/drawing${number}.xml`,
    relationshipId: 'rIdChart1',
    range: { start: { row, column }, end: { row: row + 10, column: column + 5 } },
    preservationStatus: 'safe',
    rangeStatus: 'safe',
    chart: structuredClone(chart),
  }
}
