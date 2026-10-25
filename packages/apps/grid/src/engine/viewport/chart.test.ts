import { expect, it } from 'vitest'
import { chartAxisMarker, chartBox } from './chart'

it('uses cell dimensions, hidden rows and zoom consistently for anchors and pointer snapping', () => {
  const rows = [24, 0, 40, 28],
    columns = [90, 160, 120, 80]
  const range = { start: { row: 3, column: 2 }, end: { row: 5, column: 4 } }
  const row = (i: number) => rows[i],
    column = (i: number) => columns[i]
  expect(chartBox(range, row, column)).toEqual({ top: 24, left: 90, width: 280, height: 68 })
  expect(
    chartBox(
      range,
      (i) => row(i) * 1.5,
      (i) => column(i) * 1.5,
    ),
  ).toEqual({ top: 36, left: 135, width: 420, height: 102 })
  expect(chartAxisMarker(96, column, 5)).toBe(2)
  expect(chartAxisMarker(24, row, 5)).toBe(3)
  expect(chartAxisMarker(-100, column, 5)).toBe(1)
})
