import { MAX_COLUMNS, MAX_ROWS } from '../workbook/types'

export const INITIAL_VIEWPORT_ROWS = 100
export const INITIAL_VIEWPORT_COLUMNS = 26
export const VIEWPORT_ROW_GROWTH = 100
export const VIEWPORT_COLUMN_GROWTH = 16
export const VIEWPORT_GROW_BUFFER = 12

export interface ViewportSize {
  rows: number
  columns: number
}

/** Extends a finite window as scrolling or keyboard navigation approaches its edge. */
export function growViewport(size: ViewportSize, nearRow: number, nearColumn: number): ViewportSize {
  return {
    rows:
      nearRow >= size.rows - VIEWPORT_GROW_BUFFER
        ? Math.min(MAX_ROWS, Math.max(size.rows + VIEWPORT_ROW_GROWTH, nearRow + 1))
        : size.rows,
    columns:
      nearColumn >= size.columns - VIEWPORT_GROW_BUFFER
        ? Math.min(MAX_COLUMNS, Math.max(size.columns + VIEWPORT_COLUMN_GROWTH, nearColumn + 1))
        : size.columns,
  }
}

export function clampViewport(size: ViewportSize): ViewportSize {
  return {
    rows: Math.max(1, Math.min(MAX_ROWS, Math.floor(size.rows))),
    columns: Math.max(1, Math.min(MAX_COLUMNS, Math.floor(size.columns))),
  }
}
