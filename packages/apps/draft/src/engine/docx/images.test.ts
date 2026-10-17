import { describe, expect, it } from 'vitest'
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate'
import { generatedPNG } from '../../../../../../tests/fixtures/png'
import { bytesToDataURL } from '../images'
import { exportDocxArrayBuffer } from './export'
import { importDocx } from './import'
import type { DraftDocument } from '../document-model'

it.each(['inline', 'square-left', 'square-right', 'top-bottom'])(
  'round trips PNG media, EMU size, alt and %s wrapping twice',
  async (wrap) => {
    const bytes = generatedPNG(8, 4)
    const attrs = {
      src: bytesToDataURL(bytes, 'image/png'),
      width: 160,
      height: 80,
      alt: 'Synthetic blue rectangle',
      alignment: wrap === 'square-right' ? 'right' : 'center',
      wrap,
    }
    let document: DraftDocument = {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            { type: 'text', text: 'Before ' },
            { type: 'image', attrs },
            { type: 'text', text: ' after' },
          ],
        },
      ],
    }
    for (let pass = 0; pass < 2; pass++) {
      const packed = await exportDocxArrayBuffer(document)
      const files = unzipSync(new Uint8Array(packed))
      const media = Object.keys(files).filter((name) => name.startsWith('word/media/') && name.endsWith('.png'))
      expect(media).toHaveLength(1)
      expect(files[media[0]]).toEqual(bytes)
      const xml = strFromU8(files['word/document.xml'])
      expect(xml).toContain('cx="1524000"')
      expect(xml).toContain('cy="762000"')
      expect(xml).toContain('Synthetic blue rectangle')
      if (wrap === 'square-left') expect(xml).toContain('<wp:align>left</wp:align>')
      if (wrap === 'square-right') expect(xml).toContain('<wp:align>right</wp:align>')
      expect(strFromU8(files['word/_rels/document.xml.rels'])).toContain('/image')
      const imported = importDocx(packed)
      expect(imported.unsupported).toEqual([])
      document = imported.document
      expect(document.content[0].content?.[1]).toMatchObject({ type: 'image', attrs })
      expect(document.content[0].content?.[2].text).toBe(' after')
    }
  },
)

describe('DOCX image security and compatibility', () => {
  it('preserves inline alignment and blank decorative alt text', async () => {
    const imported = importDocx(
      await exportDocxArrayBuffer({
        type: 'doc',
        content: [
          {
            type: 'paragraph',
            content: [
              {
                type: 'image',
                attrs: {
                  src: bytesToDataURL(generatedPNG(), 'image/png'),
                  width: 8,
                  height: 4,
                  alignment: 'inline',
                  wrap: 'inline',
                  alt: '',
                },
              },
            ],
          },
        ],
      }),
    )
    expect(imported.document.content[0].content?.[0].attrs).toMatchObject({ alignment: 'inline', alt: '' })
  })
  it('embeds sanitized SVG plus its PNG fallback and restores the vector source', async () => {
    const src = bytesToDataURL(
      strToU8(
        '<svg xmlns="http://www.w3.org/2000/svg" width="8" height="4"><script>bad()</script><rect width="8" height="4" fill="red"/></svg>',
      ),
      'image/svg+xml',
    )
    const packed = await exportDocxArrayBuffer({
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            {
              type: 'image',
              attrs: {
                src,
                fallbackSrc: bytesToDataURL(generatedPNG(), 'image/png'),
                width: 8,
                height: 4,
                alt: 'Vector',
              },
            },
          ],
        },
      ],
    })
    const files = unzipSync(new Uint8Array(packed))
    const svg = Object.keys(files).find((key) => key.endsWith('.svg'))!
    expect(strFromU8(files[svg])).not.toContain('script')
    expect(importDocx(packed).document.content[0].content?.[0].attrs?.src).toContain('data:image/svg+xml;base64,')
  })
  it('ignores and reports external and missing image relationships without fetching', () => {
    const doc =
      '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><w:body><w:p><w:r><w:drawing><a:blip r:embed="image"/></w:drawing></w:r></w:p></w:body></w:document>'
    const rels =
      '<Relationships><Relationship Id="image" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" TargetMode="External" Target="https://unsafe.test/a.png"/></Relationships>'
    const imported = importDocx(
      zipSync({ 'word/document.xml': strToU8(doc), 'word/_rels/document.xml.rels': strToU8(rels) }),
    )
    expect(imported.document.content[0].content).toEqual([])
    expect(imported.unsupported.map((item) => item.kind)).toContain('external image')
  })
})
