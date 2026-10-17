import { describe, expect, it } from 'vitest'
import type { DraftDocument, DraftNode } from '../document-model'
import { exportHTML, exportMarkdown, exportPDF, exportText, exportFileName, type ExportFont } from '.'
import { renderHTMLBody } from './html'

const text = (value: string): DraftNode => ({ type: 'text', text: value })
const p = (value: string): DraftNode => ({ type: 'paragraph', content: [text(value)] })
const png =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a1i0AAAAASUVORK5CYII='
const sample: DraftDocument = {
  type: 'doc',
  content: [
    { type: 'heading', attrs: { level: 2 }, content: [text('Zażółć gęślą jaźń')] },
    {
      type: 'paragraph',
      content: [
        text('A '),
        { ...text('bold'), marks: [{ type: 'bold' }] },
        text(' word and '),
        { ...text('link'), marks: [{ type: 'link', attrs: { href: 'https://example.test' } }] },
        { type: 'hardBreak' },
        text('next line.'),
      ],
    },
    {
      type: 'orderedList',
      attrs: { start: 3 },
      content: [
        {
          type: 'listItem',
          content: [p('First'), { type: 'bulletList', content: [{ type: 'listItem', content: [p('Nested')] }] }],
        },
        { type: 'listItem', content: [p('Second')] },
      ],
    },
    {
      type: 'table',
      content: [
        {
          type: 'tableRow',
          attrs: { repeatHeader: true },
          content: [
            { type: 'tableHeader', content: [p('Name')] },
            { type: 'tableHeader', content: [p('Value')] },
          ],
        },
        {
          type: 'tableRow',
          content: [
            { type: 'tableCell', content: [p('A | B')] },
            { type: 'tableCell', content: [p('42')] },
          ],
        },
      ],
    },
    { type: 'paragraph', attrs: { styleId: 'Code' }, content: [text('const text = `a`')] },
  ],
}
const fonts: ExportFont[] = (['Arimo', 'Cousine'] as const).flatMap((family) =>
  ([400, 700] as const).flatMap((weight) =>
    (['normal', 'italic'] as const).flatMap((style) =>
      (['latin', 'latin-ext'] as const).map((subset) => ({
        family,
        weight,
        style,
        subset,
        source: 'data:font/woff2;base64,d09GMg==',
      })),
    ),
  ),
)

describe('pure export converters', () => {
  it('snapshots clean GFM with nested ordered/bullet lists, code fences and pipe tables', () =>
    expect(exportMarkdown(sample)).toMatchSnapshot())
  it('snapshots readable plain text including lists and tab-delimited tables', () =>
    expect(exportText(sample)).toMatchSnapshot())
  it('snapshots semantic HTML with styles and repeating headers', () =>
    expect(renderHTMLBody(sample)).toMatchSnapshot())
  it('snapshots the print stylesheet, page size and embedded font descriptors', () => {
    const html = exportPDF(sample, { title: 'Polish printing', language: 'pl', fonts })
    expect(html).toMatchSnapshot()
    expect(html).toContain('size:595.3pt 841.9pt;margin:56.7pt 56.7pt 56.7pt 56.7pt')
    expect(exportPDF(sample, { fonts, pageSize: 'letter', orientation: 'landscape' })).toContain('size:792pt 612pt')
    expect(() => exportPDF(sample, { fonts: fonts.slice(1) })).toThrow('Missing embedded font')
    const code: DraftDocument = {
      type: 'doc',
      content: [
        { type: 'codeBlock', content: [text('const x = 1')] },
        { type: 'paragraph', content: [{ ...text('inline'), marks: [{ type: 'code' }] }] },
      ],
    }
    expect(() => exportPDF(code, { fonts: fonts.filter((font) => font.family === 'Arimo') })).toThrow('Cousine')
    const codeDOM = new DOMParser().parseFromString(exportPDF(code, { fonts }), 'text/html')
    expect(codeDOM.querySelector('p code span')?.getAttribute('style')).toContain('font-family:Cousine')
    expect(codeDOM.querySelector('p code')?.textContent).toBe('inline')
  })
  it('refreshes exported field results without mutating the editing document', () => {
    const document: DraftDocument = {
      type: 'doc',
      content: [
        { type: 'heading', attrs: { level: 1, anchorId: 'target' }, content: [text('New label')] },
        {
          type: 'tableOfContents',
          attrs: { minLevel: 1, maxLevel: 3 },
          content: [{ type: 'tocEntry', attrs: { targetId: 'target', level: 1 }, content: [text('Cached label')] }],
        },
        {
          type: 'paragraph',
          content: [
            { type: 'bookmark', attrs: { id: 'bookmark' }, content: [text('Marked')] },
            { type: 'crossReference', attrs: { targetId: 'target', label: 'Cached REF' } },
            { type: 'noteReference', attrs: { id: 'source', kind: 'footnote' } },
          ],
        },
        { type: 'note', attrs: { id: 'source', kind: 'footnote' }, content: [p('A source')] },
      ],
    }
    const before = JSON.stringify(document)
    for (const output of [
      exportText(document),
      exportMarkdown(document),
      exportHTML(document),
      exportPDF(document, { fonts }),
    ]) {
      expect(output).toContain('New label')
      expect(output).not.toContain('Cached label')
      expect(output).not.toContain('Cached REF')
      expect(output).toContain('A source')
    }
    expect(exportMarkdown(document)).toContain('<a id="target"></a>')
    expect(exportMarkdown(document)).toContain('[^source]: A source')
    expect(JSON.stringify(document)).toBe(before)
  })
  it('preserves spans with an HTML fallback and does not turn a body row into a GFM header', () => {
    const document: DraftDocument = {
      type: 'doc',
      content: [
        {
          type: 'table',
          content: [
            {
              type: 'tableRow',
              content: [
                {
                  type: 'tableCell',
                  attrs: {
                    colspan: 2,
                    rowspan: 2,
                    colwidth: [80, 120],
                    backgroundColor: '#abcdef',
                    verticalAlign: 'middle',
                    padding: '12px',
                    borderTop: '0px none',
                  },
                  content: [p('Merged')],
                },
                { type: 'tableCell', content: [p('Right')] },
              ],
            },
            { type: 'tableRow', content: [{ type: 'tableCell', content: [p('Bottom')] }] },
          ],
        },
      ],
    }
    expect(exportMarkdown(document)).toContain('<table')
    expect(exportHTML(document)).toContain('colspan="2" rowspan="2"')
    expect(exportHTML(document)).toContain('background-color:#abcdef')
    expect(exportText(document)).toBe('Merged\t\tRight\n\t\tBottom\n')
    const plain: DraftDocument = {
      type: 'doc',
      content: [
        { type: 'table', content: [{ type: 'tableRow', content: [{ type: 'tableCell', content: [p('Data')] }] }] },
      ],
    }
    expect(exportMarkdown(plain)).toBe('|  |\n| --- |\n| Data |\n')
  })
  it('escapes active content, rejects remote images/unsafe links and sanitizes SVG', () => {
    const svg =
      'data:image/svg+xml,' +
      encodeURIComponent(
        '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><script>evil()</script><image href="https://unsafe.test/x"/><rect width="10" height="10"/></svg>',
      )
    const document: DraftDocument = {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            text('<script>alert("x")</script>'),
            {
              ...text('unsafe'),
              marks: [
                { type: 'link', attrs: { href: 'javascript:alert(1)' } },
                { type: 'textStyle', attrs: { color: 'red; background:url(https://unsafe.test)' } },
              ],
            },
            { type: 'image', attrs: { src: 'https://unsafe.test/i', alt: 'Missing' } },
            { type: 'image', attrs: { src: svg, alt: 'Safe SVG' } },
          ],
        },
      ],
    }
    const html = exportHTML(document, { title: '</title><script>evil()</script>', language: '" onload="evil' })
    const dom = new DOMParser().parseFromString(html, 'text/html')
    expect(dom.querySelector('script,[onload]')).toBeNull()
    expect(dom.querySelectorAll('img')).toHaveLength(1)
    const source = dom.querySelector('img')!.src
    expect(atob(source.split(',')[1])).not.toMatch(/script|unsafe\.test/)
    expect(dom.querySelector('html')!.lang).toBe('en')
    expect(html).not.toContain('javascript:')
    expect(html).not.toContain('url(https:')
    expect(exportMarkdown(document)).not.toContain('javascript:')
  })
  it('embeds image bytes, keeps free-resize aspect ratios, and includes no external resources or scripts', () => {
    const document: DraftDocument = {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [{ type: 'image', attrs: { src: png, alt: 'Zażółć', width: 80, height: 40, alignment: 'center' } }],
        },
      ],
    }
    const html = exportHTML(document, {
      fonts: fonts.filter((font) => font.family === 'Arimo'),
      fontLicense: 'OFL license --> <script>',
    })
    expect(html).toContain('aspect-ratio:80/40')
    expect(html).toContain('data:image/png;base64,')
    expect(html).toContain('data:font/woff2;base64,')
    const dom = new DOMParser().parseFromString(html, 'text/html')
    expect(dom.querySelector('script,link[src],link[href],iframe')).toBeNull()
    expect(dom.querySelector('img')!.getAttribute('alt')).toBe('Zażółć')
    expect(exportMarkdown(document)).toContain('![Zażółć](<data:image/png;base64,')
  })
  it('escapes Markdown punctuation and uses fences longer than the code they contain', () => {
    const document: DraftDocument = {
      type: 'doc',
      content: [
        p('- not a list [x] <script>'),
        { type: 'paragraph', attrs: { styleId: 'Code' }, content: [text('```\ntext\n```')] },
      ],
    }
    expect(exportMarkdown(document)).toBe('\\- not a list \\[x\\] \\<script\\>\n\n````\n```\ntext\n```\n````\n')
  })
  it('generates safe download names without changing the source filename', () => {
    expect(exportFileName('Zażółć.docx', 'markdown')).toBe('Zażółć.md')
    expect(exportFileName('A/../B.docx', 'html')).toBe('A_.._B.html')
    expect(exportFileName('', 'text')).toBe('Untitled.txt')
  })
})
