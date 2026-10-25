import { describe, expect, it } from 'vitest'
import { columnPosition, placeInColumn, supportsColumnLayout } from './columns'
import { pageGeometry, placeOnPage } from './pagination'

describe('measured text columns', () => {
  const geometry = pageGeometry(800, 80, 80)
  it('fills columns before advancing physical pages and keeps the baseline', () => {
    expect(columnPosition(0, 3, 210, 824)).toEqual({ x: 0, y: 0 })
    expect(columnPosition(2, 3, 210, 824)).toEqual({ x: 420, y: -1648 })
    expect(columnPosition(3, 3, 210, 824)).toEqual({ x: 0, y: -1648 })
    expect(placeInColumn(620, 650, 0, geometry, 1)).toEqual(placeOnPage(620, 650, 0, geometry))
    expect(placeInColumn(620, 650, 0, geometry, 3).page).toBe(1)
  })
  it('explicit page breaks skip the remaining columns; boundary breaks do not create a leading blank page', () => {
    expect(placeInColumn(40, 40, 0, geometry, 3, 'always').page).toBe(3)
    expect(placeInColumn(geometry.pitch + 40, geometry.pitch + 40, 0, geometry, 3, 'boundary').page).toBe(3)
    expect(placeInColumn(0, 20, 0, geometry, 3, 'boundary').gap).toBe(0)
  })
  it('preflights nested unsupported objects instead of flattening', () => {
    expect(
      supportsColumnLayout({
        type: 'doc',
        content: [
          {
            type: 'orderedList',
            content: [
              { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Kept' }] }] },
            ],
          },
        ],
      }),
    ).toBe(true)
    for (const type of ['table', 'image', 'mathInline', 'noteReference', 'codeBlock'])
      expect(supportsColumnLayout({ type: 'doc', content: [{ type: 'paragraph', content: [{ type }] }] })).toBe(false)
  })
})
