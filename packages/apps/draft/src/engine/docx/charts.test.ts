import { afterEach, expect, it, vi } from 'vitest'
import { Blob as NodeBlob } from 'node:buffer'
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate'
import { chartDocx, chartXML } from '../../../../../../tests/fixtures/charts'
import { generatedPNG } from '../../../../../../tests/fixtures/png'
import { parseChart, renderChart } from './import/charts'
import { importDocx } from './import'
import { prepareImportedImages } from '../image-processing'
import { exportDocxArrayBuffer } from './export'

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

it.each(['barChart', 'lineChart', 'pieChart'])('reads %s cached data without a workbook', (type) => {
  const chart = parseChart(chartXML(type))
  expect(chart).toMatchObject({
    title: 'Quarterly sales',
    type,
    series: [{ name: 'Revenue', categories: ['Jan', 'Feb', 'Mar'], values: [10, 20, 30] }],
  })
  const rendered = renderChart(chart)
  expect(rendered.supported).toBe(true)
  expect(rendered.alt).toBe('Quarterly sales; Revenue')
  expect(rendered.svg).toContain(type === 'barChart' ? '<rect x=' : type === 'lineChart' ? '<circle' : 'A120 120')
  const imported = importDocx(chartDocx(chartXML(type)))
  expect(imported.document.content[0].content?.map((n) => n.type)).toEqual(['text', 'image', 'text'])
  expect(imported.unsupported).toEqual([{ kind: 'chart (Quarterly sales; Revenue) — converted to images' }])
})

it('renders horizontal bars, negative values and sparse line caches without shifting indices', () => {
  const chart = parseChart(
    chartXML(
      'lineChart',
      '<c:numCache><c:ptCount val="3"/><c:pt idx="0"><c:v>-10</c:v></c:pt><c:pt idx="2"><c:v>20</c:v></c:pt></c:numCache>',
    ),
  )
  expect(chart.series[0].values).toEqual([-10, null, 20])
  expect(renderChart(chart).svg).not.toContain('stroke-width="3"')
  expect(renderChart(parseChart(chartXML().replace('val="col"', 'val="bar"'))).svg).toContain('height="64"')
})

it.each([
  '<bad>',
  chartXML('barChart', ''),
  chartXML('barChart').replace('<c:v>20</c:v>', '<c:v>NaN</c:v>'),
  '<!DOCTYPE x>' + chartXML(),
])('reports malformed or missing cache charts without aborting import', (xml) => {
  expect(() => parseChart(xml)).toThrow()
  const imported = importDocx(chartDocx(xml))
  expect(imported.unsupported).toEqual([{ kind: 'chart — could not be rendered' }])
  expect(imported.document.content[0].content?.map((n) => n.text)).toEqual(['Before chart', 'After chart'])
})

it('creates a safe title-bearing placeholder for unsupported chart types', () => {
  const xml = chartXML('scatterChart').replace('Quarterly sales', '&lt;script&gt;')
  const rendered = renderChart(parseChart(xml))
  expect(rendered.supported).toBe(false)
  expect(rendered.svg).toContain('Chart not supported')
  expect(rendered.svg).toContain('&#60;script&#62;')
  expect(rendered.svg).not.toContain('<script>')
  expect(importDocx(chartDocx(xml)).unsupported[0].kind).toContain('could not be rendered')
})

it('does not resolve external chart relationships', () => {
  expect(importDocx(chartDocx(chartXML(), true)).unsupported).toEqual([{ kind: 'chart — could not be rendered' }])
})

it('converts charts in note bodies using their own normalized relationships', () => {
  const files = unzipSync(chartDocx())
  const xml = strFromU8(files['word/document.xml'])
  files['word/footnotes.xml'] = strToU8(
    xml
      .replace('<w:document ', '<w:footnotes ')
      .replace('</w:document>', '</w:footnotes>')
      .replace('<w:body>', '<w:footnote w:id="1">')
      .replace('</w:body>', '</w:footnote>'),
  )
  files['word/_rels/footnotes.xml.rels'] = strToU8(
    strFromU8(files['word/_rels/document.xml.rels']).replace('charts/chart1.xml', './charts/chart1.xml'),
  )
  files['word/document.xml'] = strToU8(
    xml.replace(/<w:body>[\s\S]*?<\/w:body>/, '<w:body><w:p><w:r><w:footnoteReference w:id="1"/></w:r></w:p></w:body>'),
  )
  delete files['word/_rels/document.xml.rels']
  const result = importDocx(zipSync(files))
  expect(result.unsupported[0].kind).toContain('converted to images')
  expect(result.document.content.find((n) => n.type === 'note')?.content?.[0].content?.[1].type).toBe('image')
})

it('preserves multiple series and cached numeric categories with arbitrary XML prefixes', () => {
  const second = /<c:ser>[\s\S]*?<\/c:ser>/.exec(chartXML())![0].replace('Revenue', 'Costs')
  const xml = chartXML().replace('</c:ser>', '</c:ser>' + second)
  const chart = parseChart(xml.replaceAll('c:', 'z:').replace('xmlns:c=', 'xmlns:z='))
  expect(chart.series.map((s) => s.name)).toEqual(['Revenue', 'Costs'])
  expect(renderChart(chart).alt).toBe('Quarterly sales; Revenue; Costs')
  const numeric = chartXML().replace(
    /<c:cat>[\s\S]*?<\/c:cat>/,
    '<c:cat><c:numRef><c:numCache><c:ptCount val="3"/><c:pt idx="2"><c:v>2026</c:v></c:pt><c:pt idx="0"><c:v>2024</c:v></c:pt><c:pt idx="1"><c:v>2025</c:v></c:pt></c:numCache></c:numRef></c:cat>',
  )
  expect(parseChart(numeric).series[0].categories).toEqual(['2024', '2025', '2026'])
})

it('rasterizes charts to ordinary PNG pictures and exports no chart/workbook parts', async () => {
  vi.stubGlobal('Blob', NodeBlob)
  const close = vi.fn()
  vi.stubGlobal('createImageBitmap', vi.fn().mockResolvedValue({ width: 640, height: 380, close }))
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
    drawImage: vi.fn(),
  } as unknown as CanvasRenderingContext2D)
  vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation((cb) =>
    cb(new NodeBlob([generatedPNG()]) as unknown as Blob),
  )
  const result = importDocx(chartDocx())
  await prepareImportedImages(result.document, result.unsupported)
  const attrs = result.document.content[0].content?.[1].attrs
  expect(attrs?.src).toMatch(/^data:image\/png;base64,/)
  expect(attrs?.importChart).toBeUndefined()
  expect(attrs?.alt).toBe('Quarterly sales; Revenue')
  const files = unzipSync(new Uint8Array(await exportDocxArrayBuffer(result.document)))
  expect(Object.keys(files).some((p) => /word\/(charts|embeddings)\//.test(p))).toBe(false)
  expect(strFromU8(files['word/document.xml'])).toContain('pic:pic')
  expect(strFromU8(files['word/_rels/document.xml.rels'])).toContain('/image')
  expect(importDocx(await exportDocxArrayBuffer(result.document)).unsupported).toEqual([])
  expect(close).toHaveBeenCalled()
})

it('keeps the rest of the document and reports a canvas failure', async () => {
  vi.stubGlobal('Blob', NodeBlob)
  vi.stubGlobal('createImageBitmap', vi.fn().mockResolvedValue({ width: 640, height: 380, close: vi.fn() }))
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null)
  const result = importDocx(chartDocx())
  await prepareImportedImages(result.document, result.unsupported)
  expect(result.unsupported[0].kind).toContain('could not be rendered')
  expect(result.document.content[0].content?.[2].text).toBe('After chart')
  expect(result.document.content[0].content?.[1].type).toBe('text')
})
