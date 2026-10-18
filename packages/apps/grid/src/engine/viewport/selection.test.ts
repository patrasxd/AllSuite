import { describe, expect, it } from 'vitest'
import { formatRangeAddress } from '../workbook/address'
import {
  createSelection,
  isSelected,
  moveSelection,
  moveToEdge,
  selectCell,
  selectRange,
  selectionEdges,
} from './selection'

describe('Grid selection math', () => {
  it('outlines the range perimeter without drawing internal edges', () => {
    const selected = selectRange(createSelection({ row: 1, column: 1 }), 'A1:C3')
    expect(selectionEdges(selected, { row: 1, column: 1 })).toBe('top left')
    expect(selectionEdges(selected, { row: 3, column: 3 })).toBe('bottom right')
    expect(selectionEdges(selected, { row: 2, column: 2 })).toBe('')
    expect(selectionEdges(selected, { row: 4, column: 3 })).toBe('')
  })
  it('selects and extends normalized A1 ranges', () => {
    const initial = createSelection({ row: 1, column: 1 })
    const moved = moveSelection(initial, 19, 3, { rows: 100, columns: 26 }, true)

    expect(moved.anchor).toEqual({ row: 1, column: 1 })
    expect(moved.active).toEqual({ row: 20, column: 4 })
    expect(formatRangeAddress(moved.ranges[0])).toBe('A1:D20')
    expect(isSelected(moved, { row: 10, column: 2 })).toBe(true)
    expect(isSelected(moved, { row: 21, column: 2 })).toBe(false)
  })

  it('parses a name-box range with its end cell active', () => {
    const selected = selectRange(createSelection({ row: 1, column: 1 }), 'A1:D20')
    expect(selected.active).toMatchObject({ row: 20, column: 4 })
    expect(formatRangeAddress(selected.ranges[0])).toBe('A1:D20')
  })

  it('toggles control-clicked cells while keeping a single-cell active range', () => {
    let selected = createSelection({ row: 1, column: 1 })
    selected = selectCell(selected, { row: 3, column: 2 }, { toggle: true })
    expect(selected.ranges).toHaveLength(2)
    expect(isSelected(selected, { row: 1, column: 1 })).toBe(true)
    expect(isSelected(selected, { row: 3, column: 2 })).toBe(true)

    selected = selectCell(selected, { row: 3, column: 2 }, { toggle: true })
    expect(selected.ranges).toHaveLength(1)
    expect(selected.active).toEqual({ row: 1, column: 1 })
    expect(isSelected(selected, { row: 3, column: 2 })).toBe(false)
  })

  it('extends only the most recent range and retains earlier disjoint selections', () => {
    let selected = createSelection({ row: 1, column: 1 })
    selected = selectCell(selected, { row: 3, column: 3 }, { toggle: true })
    selected = selectCell(selected, { row: 5, column: 5 }, { toggle: true })
    selected = moveSelection(selected, 1, 0, { rows: 100, columns: 26 }, true)
    selected = moveSelection(selected, 1, 0, { rows: 100, columns: 26 }, true)
    expect(selected.ranges.map(formatRangeAddress)).toEqual(['A1', 'C3', 'E5:E7'])
    selected = moveSelection(selected, -3, -1, { rows: 100, columns: 26 }, true)
    expect(selected.ranges.map(formatRangeAddress)).toEqual(['A1', 'C3', 'D4:E5'])
    expect(isSelected(selected, selected.active)).toBe(true)
  })

  it('clamps movement to finite viewport boundaries and supports Home/End', () => {
    const atStart = createSelection({ row: 1, column: 1 })
    expect(moveSelection(atStart, -1, -1, { rows: 100, columns: 26 }).active).toEqual({ row: 1, column: 1 })

    const atEnd = moveToEdge(atStart, 'column', 'end', { rows: 100, columns: 26 })
    expect(atEnd.active).toEqual({ row: 1, column: 26 })
    expect(moveSelection(atEnd, 200, 20, { rows: 100, columns: 26 }).active).toEqual({ row: 100, column: 26 })
  })
})
