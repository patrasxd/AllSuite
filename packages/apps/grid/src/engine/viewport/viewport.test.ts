import { describe, expect, it } from 'vitest'
import { MAX_COLUMNS, MAX_ROWS } from '../workbook/types'
import {
  clampViewport,
  growViewport,
  INITIAL_VIEWPORT_COLUMNS,
  INITIAL_VIEWPORT_ROWS,
  VIEWPORT_COLUMN_GROWTH,
  VIEWPORT_ROW_GROWTH,
} from './viewport'

describe('Grid virtual viewport sizing', () => {
  it('starts finite and grows only when scrolling or navigation approaches an edge', () => {
    const initial = { rows: INITIAL_VIEWPORT_ROWS, columns: INITIAL_VIEWPORT_COLUMNS }
    expect(initial.rows * initial.columns).toBeLessThan(3_000)
    expect(growViewport(initial, 50, 10)).toEqual(initial)
    expect(growViewport(initial, 96, 8)).toEqual({ rows: initial.rows + VIEWPORT_ROW_GROWTH, columns: initial.columns })
    expect(growViewport(initial, 12, 24)).toEqual({
      rows: initial.rows,
      columns: initial.columns + VIEWPORT_COLUMN_GROWTH,
    })
    expect(growViewport(initial, 10_000, 26)).toEqual({ rows: 10_001, columns: 42 })
  })

  it('never grows past worksheet limits', () => {
    expect(growViewport({ rows: MAX_ROWS - 10, columns: MAX_COLUMNS - 5 }, MAX_ROWS, MAX_COLUMNS)).toEqual({
      rows: MAX_ROWS,
      columns: MAX_COLUMNS,
    })
    expect(clampViewport({ rows: MAX_ROWS + 1, columns: 0 })).toEqual({ rows: MAX_ROWS, columns: 1 })
  })
})
