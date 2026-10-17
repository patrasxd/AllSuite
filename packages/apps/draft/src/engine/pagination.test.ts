import { expect, it } from 'vitest'
import { pageGeometry, placeOnPage, paragraphRuns } from './pagination'
it('moves overflowing lines to the next physical body and honors explicit breaks', () => {
  const page = pageGeometry(1000, 100, 100)
  expect(placeOnPage(0, 24, 0, page).gap).toBe(0)
  const next = placeOnPage(790, 814, 0, page)
  expect(next.offset + 790).toBe(page.pitch)
  expect(placeOnPage(0, 0, 0, page, 'always').page).toBe(1)
  expect(placeOnPage(0, 0, 0, page, 'boundary').page).toBe(0)
  expect(placeOnPage(10, 5000, 0, page).gap).toBe(0)
})

it('groups first and last lines for widow/orphan control and relaxes impossible keeps', () => {
  const lines = Array.from({ length: 7 }, (_, i) => ({ top: i * 24, bottom: (i + 1) * 24 }))
  expect(paragraphRuns(lines, 1000, true, true)).toEqual([[0, 7]])
  expect(paragraphRuns(lines, 100, false, true)).toEqual([
    [0, 2],
    [2, 3],
    [3, 4],
    [4, 5],
    [5, 7],
  ])
  expect(paragraphRuns(lines.slice(0, 3), 100, false, true)).toEqual([[0, 3]])
  expect(paragraphRuns(lines.slice(0, 3), 100, false, false)).toEqual([
    [0, 1],
    [1, 2],
    [2, 3],
  ])
})
