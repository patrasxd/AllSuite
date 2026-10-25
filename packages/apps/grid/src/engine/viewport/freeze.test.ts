import { describe, expect, it } from 'vitest'
import { frozenAxisPosition, frozenAxisClip, includeFrozenIndex } from './freeze'
import { createSelection, selectCell, selectionEdges } from './selection'

describe('PP10 single virtual viewport coordinates', () => {
  it.each([false, true])('retains unique original indices, frozen=%s', (frozen) => {
    expect(includeFrozenIndex([0, 1, 2], frozen)).toEqual([0, 1, 2])
    expect(includeFrozenIndex([30, 31], frozen)).toEqual(frozen ? [0, 30, 31] : [30, 31])
  })
  it.each([0.5, 1, 2])('uses current sizes and scroll offsets at zoom %s on either axis', (zoom) => {
    for (const size of [32, 72, 112, 240]) {
      const offset = 800 * zoom
      expect(frozenAxisPosition(0, 0, offset, true)).toBe(offset)
      expect(frozenAxisPosition(0, 0, offset, false)).toBe(0)
      expect(frozenAxisPosition(5, size * 5 * zoom, offset, true)).toBe(size * 5 * zoom)
      expect(frozenAxisClip(0, 0, offset, size * zoom)).toBe(0)
      expect(frozenAxisClip(1, size * zoom, (size * zoom) / 2, size * zoom)).toBe((size * zoom) / 2)
      expect(frozenAxisClip(5, size * 5 * zoom, 0, size * zoom)).toBe(0)
      // Hidden first row has zero extent, never occupies a frozen band.
      expect(frozenAxisClip(1, 0, 0, 0)).toBe(0)
    }
  })
  it('keeps worksheet selection and cell identity across both frozen boundaries', () => {
    const selected = selectCell(createSelection({ row: 1, column: 1 }), { row: 3, column: 3 }, { extend: true })
    expect(selected.ranges).toEqual([{ start: { row: 1, column: 1 }, end: { row: 3, column: 3 } }])
    expect(selectionEdges(selected, { row: 1, column: 1 })).toBe('top left')
    expect(selectionEdges(selected, { row: 3, column: 3 })).toBe('bottom right')
  })
})
