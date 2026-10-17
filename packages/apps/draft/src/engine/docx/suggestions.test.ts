import { strFromU8, unzipSync } from 'fflate'
import { describe, expect, it } from 'vitest'
import type { DraftDocument, DraftNode } from '../document-model'
import { exportDocxArrayBuffer } from './export'
import { importDocx } from './import'

const revision = (id: string, kind: 'insert' | 'delete' | 'format', author: string) => ({
  type: 'suggestion',
  attrs: { id, kind, author, timestamp: '2026-04-05T12:30:00.000Z', ...(kind === 'format' ? { before: '[]' } : {}) },
})

function collect(node: DraftNode, output: Array<{ text: string; kind?: string; author?: string }> = []) {
  const suggestion = node.marks?.find((mark) => mark.type === 'suggestion')
  if (node.type === 'text')
    output.push({
      text: node.text || '',
      kind: typeof suggestion?.attrs?.kind === 'string' ? suggestion.attrs.kind : undefined,
      author: typeof suggestion?.attrs?.author === 'string' ? suggestion.attrs.author : undefined,
    })
  node.content?.forEach((child) => collect(child, output))
  return output
}

describe('DOCX tracked changes', () => {
  it('round-trips insertions, deletions and character formatting revisions in lists and tables', async () => {
    const document: DraftDocument = {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            { type: 'text', text: 'Added', marks: [revision('insert-1', 'insert', 'Avery')] },
            { type: 'text', text: ' ' },
            {
              type: 'text',
              text: 'Linked',
              marks: [
                { type: 'link', attrs: { href: 'https://example.test', target: '_blank', rel: 'noopener noreferrer' } },
                revision('insert-link', 'insert', 'Avery'),
              ],
            },
            { type: 'text', text: ' ' },
            { type: 'text', text: 'removed', marks: [revision('delete-1', 'delete', 'Sam')] },
          ],
        },
        {
          type: 'bulletList',
          content: [
            {
              type: 'listItem',
              content: [
                {
                  type: 'paragraph',
                  content: [{ type: 'text', text: 'List edit', marks: [revision('insert-list', 'insert', 'Avery')] }],
                },
              ],
            },
          ],
        },
        {
          type: 'table',
          content: [
            {
              type: 'tableRow',
              content: [
                {
                  type: 'tableCell',
                  content: [
                    {
                      type: 'paragraph',
                      content: [
                        {
                          type: 'text',
                          text: 'Formatted',
                          marks: [{ type: 'bold' }, revision('format-1', 'format', 'Sam')],
                        },
                      ],
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
    }

    const bytes = await exportDocxArrayBuffer(document)
    const files = unzipSync(new Uint8Array(bytes))
    const xml = strFromU8(files['word/document.xml'])
    expect(xml).toContain('<w:ins')
    expect(xml).toContain('<w:del')
    expect(xml).toContain('<w:delText')
    expect(xml).toContain('<w:rPrChange')

    const roundTripped = importDocx(bytes).document
    const revisions = roundTripped.content.flatMap((node) => collect(node))
    expect(revisions).toEqual(
      expect.arrayContaining([
        { text: 'Added', kind: 'insert', author: 'Avery' },
        { text: 'Linked', kind: 'insert', author: 'Avery' },
        { text: 'removed', kind: 'delete', author: 'Sam' },
        { text: 'List edit', kind: 'insert', author: 'Avery' },
        { text: 'Formatted', kind: 'format', author: 'Sam' },
      ]),
    )
  })
})
