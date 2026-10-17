import { expect, it } from 'vitest'
import { strFromU8, unzipSync, strToU8, zipSync } from 'fflate'
import type { DraftDocument, DraftNode } from '../document-model'
import { normalizeReferences, updateReferenceFields, referenceTargets, captionLabels, nodeText } from '../references'
import { exportDocxArrayBuffer } from './export'
import { importDocx } from './import'

const caption = (id: string, label: string, title: string): DraftNode => ({
  type: 'paragraph',
  attrs: { anchorId: id, captionLabel: label, captionPosition: 'below' },
  content: [
    { type: 'captionNumber', attrs: { label, number: 99 } },
    { type: 'text', text: `: ${title}` },
  ],
})
const cross = (targetId: string, format: string): DraftNode => ({
  type: 'crossReference',
  attrs: { targetId, format, label: 'stale' },
})
const sample = (): DraftDocument => ({
  type: 'doc',
  attrs: { captionLabels: JSON.stringify(['Figure', 'Table', 'Diagram', 'Rysunek']) },
  content: [
    { type: 'heading', attrs: { level: 1, anchorId: 'intro' }, content: [{ type: 'text', text: 'Introduction' }] },
    caption('fig_a', 'Figure', 'Alpha'),
    caption('tab_a', 'Table', 'Measurements'),
    caption('fig_b', 'Figure', 'Beta'),
    { type: 'tableOfContents', attrs: { minLevel: 1, maxLevel: 3 }, content: [] },
    { type: 'tableOfContents', attrs: { minLevel: 1, maxLevel: 6, captionLabel: 'Figure' }, content: [] },
    { type: 'tableOfContents', attrs: { minLevel: 1, maxLevel: 6, captionLabel: 'Table' }, content: [] },
    {
      type: 'paragraph',
      content: [
        cross('fig_b', 'number'),
        { type: 'text', text: ' on page ' },
        cross('fig_b', 'page'),
        cross('intro', 'text'),
        { type: 'noteReference', attrs: { id: 'source', kind: 'footnote' } },
        cross('source', 'number'),
        cross('source', 'page'),
      ],
    },
    {
      type: 'note',
      attrs: { id: 'source', kind: 'footnote' },
      content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Source text' }] }],
    },
  ],
})

it('retains captions with bookmarked SEQ results and ordinary reference targets ending in _number', async () => {
  const bytes = zipSync({
    'word/document.xml': strToU8(
      '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>' +
        '<w:p><w:r><w:t>Figure </w:t></w:r><w:bookmarkStart w:id="1" w:name="seq_result"/><w:fldSimple w:instr="SEQ Figure"><w:r><w:t>1</w:t></w:r></w:fldSimple><w:bookmarkEnd w:id="1"/><w:r><w:t>: Synthetic caption</w:t></w:r></w:p>' +
        '<w:p><w:bookmarkStart w:id="2" w:name="ordinary_number"/><w:r><w:t>Ordinary target</w:t></w:r><w:bookmarkEnd w:id="2"/></w:p>' +
        '<w:p><w:fldSimple w:instr="REF ordinary_number"><w:r><w:t>Ordinary target</w:t></w:r></w:fldSimple><w:fldSimple w:instr="REF seq_result"><w:r><w:t>1</w:t></w:r></w:fldSimple></w:p>' +
        '</w:body></w:document>',
    ),
  })
  let document = importDocx(bytes).document
  for (let round = 0; round < 2; round++) {
    const targets = referenceTargets(document)
    expect(targets.find((target) => target.kind === 'caption')).toMatchObject({
      captionLabel: 'Figure',
      label: 'Figure 1: Synthetic caption',
    })
    const updated = updateReferenceFields(document, {})
    expect(updated.content[2].content?.[0]).toMatchObject({
      attrs: { targetId: 'ordinary_number', format: 'text', label: 'Ordinary target' },
    })
    expect(updated.content[2].content?.[1]).toMatchObject({ attrs: { targetId: 'seq_result', label: '1' } })
    document = importDocx(await exportDocxArrayBuffer(document)).document
  }
})

it('numbers per label, preserves target identity through reordering and updates text/page caches on demand', () => {
  const input = sample(),
    before = JSON.stringify(input)
  const first = updateReferenceFields(input, { intro: 'i', fig_a: 'ii', tab_a: 'iii', fig_b: 'iv', source: 'ii' })
  expect(first.content.filter((n) => n.attrs?.captionLabel && n.type === 'paragraph').map(nodeText)).toEqual([
    'Figure 1: Alpha',
    'Table 1: Measurements',
    'Figure 2: Beta',
  ])
  expect(first.content[5].content?.map((n) => [nodeText(n), n.attrs?.pageNumber])).toEqual([
    ['Figure 1: Alpha', 'ii'],
    ['Figure 2: Beta', 'iv'],
  ])
  expect(first.content[7].content?.filter((n) => n.type === 'crossReference').map((n) => n.attrs?.label)).toEqual([
    'Figure 2',
    'iv',
    'Introduction',
    '1',
    'ii',
  ])
  ;[first.content[1], first.content[3]] = [first.content[3], first.content[1]]
  const numbered = normalizeReferences(first)
  expect(nodeText(numbered.content[1])).toBe('Figure 1: Beta')
  expect(numbered.content[1].attrs?.anchorId).toBe('fig_b')
  expect(numbered.content[7].content?.[0].attrs?.label).toBe('Figure 2')
  const updated = updateReferenceFields(numbered, { intro: 'i', fig_b: 'ii', fig_a: 'iv', source: 'iii' })
  expect(updated.content[7].content?.[0].attrs?.label).toBe('Figure 1')
  expect(updated.content[7].content?.[2].attrs?.label).toBe('ii')
  expect(updated.content[6].content?.[0].attrs?.pageNumber).toBe('?')
  expect(referenceTargets(updated).map((target) => target.kind)).toContain('note')
  expect(captionLabels({ type: 'doc', content: [] }, 'pl')).toEqual(['Rysunek', 'Tabela'])
  expect(captionLabels(input)).toContain('Diagram')
  expect(JSON.stringify(input)).toBe(before)
})

it('exports valid TOC/REF/PAGEREF/SEQ instructions with cached results and survives two DOCX round trips', async () => {
  let document = updateReferenceFields(sample(), { intro: '1', fig_a: '2', tab_a: '3', fig_b: '7', source: '2' })
  for (let round = 0; round < 2; round++) {
    const bytes = await exportDocxArrayBuffer(document)
    const files = unzipSync(new Uint8Array(bytes)),
      xml = strFromU8(files['word/document.xml'])
    expect(xml).not.toContain('<undefined>')
    expect(xml).toContain(' TOC \\o &quot;1-3&quot; \\h')
    expect(xml).toContain(' TOC \\c &quot;Figure&quot; \\h')
    expect(xml).toContain('SEQ &quot;Figure&quot; \\* ARABIC')
    expect(xml).toContain('REF fig_b_number \\h')
    expect(xml).toContain('PAGEREF fig_b \\h')
    expect(xml).toContain('w:leader="dot"')
    expect(xml).toContain('w:val="right"')
    expect(xml).toContain('>Figure 2</w:t>')
    expect(xml).toContain('>7</w:t>')
    const imported = importDocx(bytes)
    expect(imported.unsupported).toEqual([])
    expect(captionLabels(imported.document)).toEqual(['Figure', 'Table', 'Diagram', 'Rysunek'])
    const targets = referenceTargets(imported.document)
    expect(targets.find((t) => t.id === 'fig_b')).toMatchObject({ kind: 'caption', label: 'Figure 2: Beta' })
    expect(
      imported.document.content
        .find((n) => n.type === 'tableOfContents' && n.attrs?.captionLabel === 'Figure')
        ?.content?.map((n) => n.attrs?.pageNumber),
    ).toEqual(['2', '7'])
    expect(JSON.stringify(imported.document)).toContain('Source text')
    const fields: DraftNode[] = []
    const collect = (node: DraftNode) => {
      if (node.type === 'crossReference') fields.push(node)
      node.content?.forEach(collect)
    }
    collect(imported.document)
    expect(fields.find((n) => n.attrs?.targetId === 'fig_b' && n.attrs?.format === 'number')?.attrs?.label).toBe(
      'Figure 2',
    )
    expect(fields.find((n) => n.attrs?.targetId === 'fig_b' && n.attrs?.format === 'page')?.attrs?.label).toBe('7')
    document = imported.document
  }
})

it('imports known complex SEQ and PAGEREF fields and preserves unsupported sequence switches as cached text', () => {
  const complex = (instruction: string, cache: string) =>
    `<w:r><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:instrText>${instruction}</w:instrText></w:r><w:r><w:fldChar w:fldCharType="separate"/></w:r><w:r><w:t>${cache}</w:t></w:r><w:r><w:fldChar w:fldCharType="end"/></w:r>`
  const result = importDocx(
    zipSync({
      'word/document.xml': strToU8(
        `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:bookmarkStart w:name="diagram" w:id="1"/><w:r><w:t>Rysunek </w:t></w:r>${complex('SEQ Rysunek \\* ARABIC', '3')}<w:r><w:t>: Opis</w:t></w:r><w:bookmarkEnd w:id="1"/></w:p><w:p>${complex('PAGEREF diagram \\h', '9')}</w:p><w:p>${complex('SEQ Figure \\r 5', '5')}</w:p></w:body></w:document>`,
      ),
    }),
  )
  expect(result.document.content[0].attrs).toMatchObject({ anchorId: 'diagram', captionLabel: 'Rysunek' })
  expect(nodeText(result.document.content[0])).toBe('Rysunek 1: Opis')
  expect(result.document.content[1].content?.[0]).toMatchObject({
    type: 'crossReference',
    attrs: { targetId: 'diagram', format: 'page', label: '9' },
  })
  expect(nodeText(result.document.content[2])).toBe('5')
  expect(result.unsupported).toContainEqual({ kind: 'field' })
})
