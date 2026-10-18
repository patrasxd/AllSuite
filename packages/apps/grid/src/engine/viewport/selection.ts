import { isAddressInRange, parseRangeAddress } from '../workbook/address'
import type { CellAddress, CellRange } from '../workbook/types'

export interface GridSelection {
  anchor: CellAddress
  active: CellAddress
  ranges: CellRange[]
}

export interface GridBounds {
  rows: number
  columns: number
}

export function rangeBetween(start: CellAddress, end: CellAddress): CellRange {
  return {
    start: {
      row: Math.min(start.row, end.row),
      column: Math.min(start.column, end.column),
    },
    end: {
      row: Math.max(start.row, end.row),
      column: Math.max(start.column, end.column),
    },
  }
}

export function createSelection(address: CellAddress): GridSelection {
  return { anchor: address, active: address, ranges: [rangeBetween(address, address)] }
}

export function selectRange(selection: GridSelection, input: string): GridSelection {
  const range = parseRangeAddress(input)
  return { anchor: range.start, active: range.end, ranges: [range] }
}

export function isSelected(selection: GridSelection, address: CellAddress): boolean {
  return selection.ranges.some((range) => isAddressInRange(address, range))
}

/** Stable primitive props let memoized cells draw range boundaries without a canvas overlay. */
export function selectionEdges(selection: GridSelection, address: CellAddress): string {
  const edges = new Set<string>()
  for (const range of selection.ranges) {
    if (!isAddressInRange(address, range)) continue
    if (address.row === range.start.row) edges.add('top')
    if (address.row === range.end.row) edges.add('bottom')
    if (address.column === range.start.column) edges.add('left')
    if (address.column === range.end.column) edges.add('right')
  }
  return [...edges].join(' ')
}

export function selectCell(
  selection: GridSelection,
  address: CellAddress,
  options: { extend?: boolean; toggle?: boolean } = {},
): GridSelection {
  if (options.extend) {
    return {
      anchor: selection.anchor,
      active: address,
      ranges: [...selection.ranges.slice(0, -1), rangeBetween(selection.anchor, address)],
    }
  }

  if (options.toggle) {
    const matchingIndex = selection.ranges.findIndex(
      (range) =>
        range.start.row === address.row &&
        range.end.row === address.row &&
        range.start.column === address.column &&
        range.end.column === address.column,
    )
    const ranges =
      matchingIndex >= 0
        ? selection.ranges.filter((_, index) => index !== matchingIndex)
        : [...selection.ranges, rangeBetween(address, address)]
    if (!ranges.length) return createSelection(address)
    const active = matchingIndex >= 0 ? ranges[ranges.length - 1].end : address
    return { anchor: { ...active }, active: { ...active }, ranges }
  }

  return createSelection(address)
}

export function moveSelection(
  selection: GridSelection,
  rowDelta: number,
  columnDelta: number,
  bounds: GridBounds,
  extend = false,
): GridSelection {
  const active = {
    row: Math.max(1, Math.min(bounds.rows, selection.active.row + rowDelta)),
    column: Math.max(1, Math.min(bounds.columns, selection.active.column + columnDelta)),
  }
  return selectCell(selection, active, { extend })
}

export function moveToEdge(
  selection: GridSelection,
  axis: 'row' | 'column',
  edge: 'start' | 'end',
  bounds: GridBounds,
  extend = false,
): GridSelection {
  const address = { ...selection.active }
  address[axis] = edge === 'start' ? 1 : bounds[axis === 'row' ? 'rows' : 'columns']
  return selectCell(selection, address, { extend })
}

export function isAddressInSelection(selection: GridSelection, address: CellAddress): boolean {
  return isSelected(selection, address)
}
