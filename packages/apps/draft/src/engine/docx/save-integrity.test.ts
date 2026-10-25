import { expect, it } from 'vitest'
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate'
import { importDocx } from './import'
import { exportDocxArrayBuffer } from './export'
import { readPageSetup } from '../page-setup'

it('preserves supported core properties, language and text through an edited DOCX round trip', async () => {
  const input = zipSync({
    'word/document.xml': strToU8(
      '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:rPr><w:lang w:val="pl-PL"/></w:rPr><w:t>Original</w:t></w:r></w:p></w:body></w:document>',
    ),
    'docProps/core.xml': strToU8(
      '<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>Private title</dc:title><dc:creator>Original author</dc:creator><dc:subject>Subject</dc:subject><dc:description>Description</dc:description><cp:keywords>one, two</cp:keywords><cp:lastModifiedBy>Reviewer</cp:lastModifiedBy><cp:revision>7</cp:revision><dcterms:created xsi:type="dcterms:W3CDTF">2020-01-02T03:04:05Z</dcterms:created><dcterms:modified xsi:type="dcterms:W3CDTF">2021-02-03T04:05:06Z</dcterms:modified></cp:coreProperties>',
    ),
  })
  const imported = importDocx(input)
  expect(imported.language).toBe('pl-PL')
  imported.document.content[0].content!.push({ type: 'text', text: ' edited' })
  const output = await exportDocxArrayBuffer(imported.document, imported.language)
  const parts = unzipSync(new Uint8Array(output))
  const core = strFromU8(parts['docProps/core.xml'])
  for (const value of [
    'Private title',
    'Original author',
    'Subject',
    'Description',
    'one, two',
    'Reviewer',
    '>7<',
    '2020-01-02T03:04:05Z',
    '2021-02-03T04:05:06Z',
  ])
    expect(core).toContain(value)
  expect(strFromU8(parts['_rels/.rels'])).toContain('docProps/core.xml')
  expect(strFromU8(parts['[Content_Types].xml'])).toContain(
    'application/vnd.openxmlformats-package.core-properties+xml',
  )
  const reopened = importDocx(output)
  expect(reopened.language).toBe('pl-PL')
  expect(reopened.document.content[0].content?.map((node) => node.text).join('')).toBe('Original edited')
  const page = readPageSetup(reopened.document)
  page.stories!.title = 'Changed title'
  reopened.document.attrs!.pageSetup = JSON.stringify(page)
  const changed = unzipSync(new Uint8Array(await exportDocxArrayBuffer(reopened.document, reopened.language)))
  const changedCore = strFromU8(changed['docProps/core.xml'])
  expect(changedCore).toContain('Changed title')
  expect(changedCore).not.toContain('Private title')
  expect(changedCore).toContain('Original author')
  expect(changedCore).toContain('2020-01-02T03:04:05Z')
})
