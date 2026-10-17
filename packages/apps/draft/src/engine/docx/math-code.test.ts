import { strFromU8, unzipSync } from 'fflate'
import { describe, expect, it } from 'vitest'
import type { DraftDocument, DraftNode } from '../document-model'
import { exportDocxArrayBuffer } from './export'
import { importDocx } from './import'

function findNodes(node: DraftNode, type: string, result: DraftNode[] = []) {
  if (node.type === type) result.push(node)
  node.content?.forEach((child) => findNodes(child, type, result))
  return result
}

describe('DOCX equations and code blocks', () => {
  it('exports equations as OMML and round-trips equations and styled code', async () => {
    const document: DraftDocument = {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            { type: 'text', text: 'Inline ' },
            { type: 'mathInline', attrs: { latex: '\\frac{a}{b}+x_1^2' } },
          ],
        },
        { type: 'mathBlock', attrs: { latex: '\\sqrt{y^2+1}' } },
        {
          type: 'bulletList',
          content: [
            {
              type: 'listItem',
              content: [
                { type: 'paragraph', content: [{ type: 'text', text: 'List item' }] },
                { type: 'mathBlock', attrs: { latex: 'a^2+b^2=c^2' } },
                {
                  type: 'codeBlock',
                  attrs: { language: 'python' },
                  content: [{ type: 'text', text: 'print(42)' }],
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
                    { type: 'paragraph', content: [{ type: 'mathInline', attrs: { latex: 'x+1' } }] },
                    { type: 'codeBlock', attrs: {}, content: [{ type: 'text', text: 'x = 1' }] },
                  ],
                },
              ],
            },
          ],
        },
        {
          type: 'codeBlock',
          attrs: { language: 'javascript' },
          content: [{ type: 'text', text: 'const answer = 42;\nreturn answer;' }],
        },
      ],
    }

    const bytes = await exportDocxArrayBuffer(document)
    const files = unzipSync(new Uint8Array(bytes))
    const xml = strFromU8(files['word/document.xml'])
    const styles = strFromU8(files['word/styles.xml'])
    expect(xml).toContain('<m:oMath')
    expect(xml).toContain('<m:oMathPara')
    expect(xml).toContain('<m:f>')
    expect(xml).toContain('[javascript]')
    expect(xml).toContain('Consolas')
    expect(styles).toContain('DraftCodeBlock')

    const imported = importDocx(bytes).document
    const inlineMath = findNodes(imported, 'mathInline')
    const blockMath = findNodes(imported, 'mathBlock')
    const code = findNodes(imported, 'codeBlock')
    expect(inlineMath).toHaveLength(2)
    expect(inlineMath[0].attrs?.latex).toContain('\\frac')
    expect(blockMath).toHaveLength(2)
    expect(blockMath[0].attrs?.latex).toContain('\\sqrt')
    expect(code).toHaveLength(3)
    expect(code.map((node) => node.attrs?.language)).toEqual(['python', undefined, 'javascript'])
    expect(code[2].content?.map((node) => node.text || '').join('')).toBe('const answer = 42;\nreturn answer;')
  })
})
