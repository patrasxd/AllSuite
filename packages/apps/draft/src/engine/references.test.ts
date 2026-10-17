import { describe, expect, it } from 'vitest'
import type { DraftDocument, DraftNode } from './document-model'
import { normalizeReferences, referenceTargets, safeLink, tocEntries, updateReferenceFields } from './references'

const text = (value: string): DraftNode => ({ type: 'text', text: value })
const heading = (level: number, value: string, anchorId?: string): DraftNode => ({
  type: 'heading',
  attrs: { level, ...(anchorId ? { anchorId } : {}) },
  content: value ? [text(value)] : [],
})
const ref = (id: string, kind = 'footnote'): DraftNode => ({ type: 'noteReference', attrs: { id, kind, number: 99 } })
const doc = (content: DraftNode[]): DraftDocument => ({ type: 'doc', content })

describe('safe links', () => {
  it.each([
    'https://example.test/path?q=1#part',
    'http://localhost:8080/',
    'mailto:reader@example.test',
    'tel:+48123456789',
    '#heading_1',
  ])('allows %s', (href) => expect(safeLink(href)).toBe(href))
  it.each([
    'javascript:alert(1)',
    'data:text/html,x',
    'file:///secret',
    'ftp://example.test',
    '//example.test',
    '/relative',
    'https://',
    'java\nscript:alert(1)',
    'https://exam\tple.test',
    'https://a.test/has space',
    '#bad"onclick',
    'https://user:password@example.test',
    '',
    null,
  ])('strips %s', (href) => expect(safeLink(href)).toBeUndefined())
})

it('generates ordered TOC entries across nested blocks, skipping empty headings and notes', () => {
  const before = doc([
    heading(1, '  First   section '),
    heading(2, ''),
    { type: 'bulletList', content: [{ type: 'listItem', content: [heading(3, 'Nested')] }] },
    heading(6, 'Deep'),
    {
      type: 'paragraph',
      content: [{ type: 'bookmark', attrs: { id: 'mark', name: 'mark' }, content: [text('Marked text')] }],
    },
  ])
  const normalized = normalizeReferences(before)
  expect(tocEntries(normalized).map((entry) => [entry.attrs?.level, entry.content?.[0].text])).toEqual([
    [1, 'First section'],
    [3, 'Nested'],
  ])
  expect(tocEntries(normalized, 3, 6).map((entry) => entry.content?.[0].text)).toEqual(['Nested', 'Deep'])
  expect(referenceTargets(normalized).at(-1)).toMatchObject({ id: 'mark', label: 'Marked text', kind: 'bookmark' })
  expect(normalizeReferences(normalized)).toEqual(normalized)
  expect(before.content[0].attrs?.anchorId).toBeUndefined()
  expect(tocEntries(normalizeReferences(doc([heading(1, ' ')])))).toEqual([])
})

it('repairs duplicate targets without changing valid IDs and updates fields only on request', () => {
  const before = normalizeReferences(
    doc([
      heading(1, 'Original', 'stable'),
      heading(2, 'Other', 'stable'),
      { type: 'tableOfContents', attrs: { minLevel: 1, maxLevel: 1 }, content: [] },
      {
        type: 'paragraph',
        content: [
          { type: 'crossReference', attrs: { targetId: 'stable', label: 'Cached' } },
          { type: 'crossReference', attrs: { targetId: 'gone', label: 'Old' } },
        ],
      },
    ]),
  )
  expect(before.content[0].attrs?.anchorId).toBe('stable')
  expect(before.content[1].attrs?.anchorId).not.toBe('stable')
  expect(before.content[2].content).toEqual([])
  const after = updateReferenceFields(before)
  expect(after.content[2].content).toHaveLength(1)
  expect(after.content[3].content?.map((node) => node.attrs?.label)).toEqual(['Original', '[Missing reference]'])
  expect(before.content[3].content?.[0].attrs?.label).toBe('Cached')
})

it('renumbers notes in reference order independently by type, reuses references and deletes orphan notes', () => {
  const before = doc([
    { type: 'paragraph', content: [ref('b'), ref('end', 'endnote'), ref('a'), ref('b')] },
    {
      type: 'note',
      attrs: { id: 'a', kind: 'footnote' },
      content: [{ type: 'paragraph', content: [text('Keep note body')] }],
    },
    { type: 'note', attrs: { id: 'orphan' }, content: [{ type: 'paragraph' }] },
  ])
  const first = normalizeReferences(before)
  expect(first.content[0].content?.map((node) => node.attrs?.number)).toEqual([1, 1, 2, 1])
  expect(first.content.filter((node) => node.type === 'note')).toHaveLength(3)
  expect(JSON.stringify(first)).toContain('Keep note body')
  first.content[0].content = [ref('a')]
  const after = normalizeReferences(first)
  expect(after.content).toHaveLength(2)
  expect(after.content[0].content?.[0].attrs?.number).toBe(1)
  expect(after.content[1].attrs).toMatchObject({ id: 'a', number: 1 })
})
