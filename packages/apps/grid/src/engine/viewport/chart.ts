import type { CellRange } from '../workbook/types'

/** Same zero-based size callbacks used by the cell virtualizers; marker coordinates are one-based. */
export function chartAxisOffset(marker: number, size: (index: number) => number): number {
  let offset = 0
  for (let index = 0; index < marker - 1; index++) offset += size(index)
  return offset
}

export function chartAxisMarker(pixel: number, size: (index: number) => number, limit: number): number {
  let offset = 0
  for (let index = 0; index < limit - 1; index++) {
    const next = offset + size(index)
    if (pixel < (offset + next) / 2) return index + 1
    offset = next
  }
  return limit
}

export function chartBox(range: CellRange, rowSize: (index: number) => number, columnSize: (index: number) => number) {
  const left = chartAxisOffset(range.start.column, columnSize)
  const top = chartAxisOffset(range.start.row, rowSize)
  return {
    left,
    top,
    width: chartAxisOffset(range.end.column, columnSize) - left,
    height: chartAxisOffset(range.end.row, rowSize) - top,
  }
}
