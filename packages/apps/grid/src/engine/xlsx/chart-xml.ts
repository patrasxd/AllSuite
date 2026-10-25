import { DOMParser, XMLSerializer, type Element } from '@xmldom/xmldom'
import { strFromU8 } from 'fflate'
import { formatSheetQualifiedAddress, parseSheetQualifiedAddress } from '../workbook/address'
import { chartData, validateChartAnchor } from '../workbook/chart'
import type { DrawingDescriptor, Worksheet } from '../workbook/types'
import type { RelationshipEntry } from './import'

export const CHART_NS = 'http://schemas.openxmlformats.org/drawingml/2006/chart'
export const DRAWING_NS = 'http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing'
export const OFFICE_REL_NS = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'
export const CHART_CONTENT_TYPE = 'application/vnd.openxmlformats-officedocument.drawingml.chart+xml'
export const DRAWING_CONTENT_TYPE = 'application/vnd.openxmlformats-officedocument.drawing+xml'
const MAIN_NS = 'http://schemas.openxmlformats.org/drawingml/2006/main'

const escape = (value: string) =>
  value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;')

export function columnChartXml(sheet: Worksheet, drawing: DrawingDescriptor, allowCached = false): string {
  const chart = drawing.chart!
  const data = chartData(sheet, chart, allowCached)
  const range = chart.sourceRange
  const firstRow = range.start.row + Number(chart.headers)
  const formula = (column: number, start: number, end: number) =>
    escape(
      formatSheetQualifiedAddress(sheet.name, {
        start: { row: start, column, absoluteRow: true, absoluteColumn: true },
        end: { row: end, column, absoluteRow: true, absoluteColumn: true },
      }),
    )
  const stringPoint = (value: string, index: number) => `<c:pt idx="${index}"><c:v>${escape(value)}</c:v></c:pt>`
  const tx = chart.headers
    ? `<c:tx><c:strRef><c:f>${formula(range.end.column, range.start.row, range.start.row)}</c:f><c:strCache><c:ptCount val="1"/>${stringPoint(data.seriesTitle, 0)}</c:strCache></c:strRef></c:tx>`
    : ''
  return `<c:chartSpace xmlns:c="${CHART_NS}" xmlns:a="${MAIN_NS}"><c:chart><c:title><c:tx><c:rich><a:bodyPr/><a:lstStyle/><a:p><a:r><a:t>${escape(chart.title)}</a:t></a:r></a:p></c:rich></c:tx><c:overlay val="0"/></c:title><c:plotArea><c:layout/><c:barChart><c:barDir val="col"/><c:grouping val="clustered"/><c:varyColors val="0"/><c:ser><c:idx val="0"/><c:order val="0"/>${tx}<c:cat><c:strRef><c:f>${formula(range.start.column, firstRow, range.end.row)}</c:f><c:strCache><c:ptCount val="${data.points.length}"/>${data.points.map((point, index) => stringPoint(point.category, index)).join('')}</c:strCache></c:strRef></c:cat><c:val><c:numRef><c:f>${formula(range.end.column, firstRow, range.end.row)}</c:f><c:numCache><c:formatCode>General</c:formatCode><c:ptCount val="${data.points.length}"/>${data.points.map((point, index) => (point.value === null ? '' : `<c:pt idx="${index}"><c:v>${point.value}</c:v></c:pt>`)).join('')}</c:numCache></c:numRef></c:val></c:ser><c:gapWidth val="80"/><c:axId val="1"/><c:axId val="2"/></c:barChart><c:catAx><c:axId val="1"/><c:scaling><c:orientation val="minMax"/></c:scaling><c:axPos val="b"/><c:tickLblPos val="nextTo"/><c:crossAx val="2"/><c:crosses val="autoZero"/><c:auto val="1"/><c:lblAlgn val="ctr"/><c:lblOffset val="100"/></c:catAx><c:valAx><c:axId val="2"/><c:scaling><c:orientation val="minMax"/></c:scaling><c:axPos val="l"/><c:majorGridlines/><c:numFmt formatCode="General" sourceLinked="1"/><c:tickLblPos val="nextTo"/><c:crossAx val="1"/><c:crosses val="autoZero"/><c:crossBetween val="between"/></c:valAx></c:plotArea><c:plotVisOnly val="0"/><c:dispBlanksAs val="gap"/></c:chart></c:chartSpace>`
}

export function columnDrawingXml(drawing: DrawingDescriptor): string {
  const marker = (name: string, row: number, column: number) =>
    `<xdr:${name}><xdr:col>${column - 1}</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>${row - 1}</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:${name}>`
  return `<xdr:wsDr xmlns:xdr="${DRAWING_NS}" xmlns:a="${MAIN_NS}" xmlns:r="${OFFICE_REL_NS}"><xdr:twoCellAnchor>${marker('from', drawing.range.start.row, drawing.range.start.column)}${marker('to', drawing.range.end.row, drawing.range.end.column)}<xdr:graphicFrame macro=""><xdr:nvGraphicFramePr><xdr:cNvPr id="1" name="AllSuite column chart"/><xdr:cNvGraphicFramePr/></xdr:nvGraphicFramePr><xdr:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/></xdr:xfrm><a:graphic><a:graphicData uri="${CHART_NS}"><c:chart xmlns:c="${CHART_NS}" r:id="rIdChart1"/></a:graphicData></a:graphic></xdr:graphicFrame><xdr:clientData/></xdr:twoCellAnchor></xdr:wsDr>`
}

function canonical(xml: string): string {
  return new XMLSerializer()
    .serializeToString(new DOMParser().parseFromString(xml, 'application/xml'))
    .replace(/^<\?xml[^?]*\?>/u, '')
}

/** Ownership is deliberately conservative: exact authored XML and an exclusive relationship graph.
 * Any extra anchor/series/extension/relationship or changed cache stays opaque, never rewritten.
 */
export function importColumnChart(
  sheet: Worksheet,
  sheetPart: string,
  sourceParts: Map<string, Uint8Array>,
  relationships: RelationshipEntry[],
): void {
  if (sheet.drawings.length !== 1) return
  const opaque = sheet.drawings[0]
  const sheetRels = relationships.filter((rel) => rel.sourcePart === sheetPart && rel.type.endsWith('/drawing'))
  if (sheetRels.length !== 1) return
  const drawingPart = sheetRels[0].resolvedTarget
  const chartPart = opaque.sourcePartName
  if (!drawingPart || !chartPart) return
  if (!/^xl\/charts\/chart[1-9]\d*\.xml$/.test(chartPart) || !/^xl\/drawings\/drawing[1-9]\d*\.xml$/.test(drawingPart))
    return
  const rels = relationships.filter((rel) => rel.sourcePart === drawingPart)
  if (
    rels.length !== 1 ||
    rels[0].id !== 'rIdChart1' ||
    rels[0].type !== `${OFFICE_REL_NS}/chart` ||
    rels[0].resolvedTarget !== chartPart ||
    rels[0].targetMode === 'External'
  )
    return
  if (
    relationships.filter((rel) => rel.resolvedTarget === chartPart).length !== 1 ||
    relationships.filter((rel) => rel.resolvedTarget === drawingPart).length !== 1 ||
    relationships.some((rel) => rel.sourcePart === chartPart)
  )
    return
  const chartBytes = sourceParts.get(chartPart)
  const drawingBytes = sourceParts.get(drawingPart)
  if (!chartBytes || !drawingBytes) return
  try {
    const sheetXml = new DOMParser().parseFromString(strFromU8(sourceParts.get(sheetPart)!), 'application/xml')
    const refs = Array.from(
      sheetXml.getElementsByTagNameNS('http://schemas.openxmlformats.org/spreadsheetml/2006/main', 'drawing'),
    )
    if (refs.length !== 1 || refs[0].getAttributeNS(OFFICE_REL_NS, 'id') !== sheetRels[0].id) return
    const consumers = Array.from(sheetXml.getElementsByTagName('*')).filter((node) =>
      Array.from({ length: node.attributes.length }, (_, index) => node.attributes.item(index)!).some(
        (attr) => attr.namespaceURI === OFFICE_REL_NS && attr.value === sheetRels[0].id,
      ),
    )
    if (consumers.length !== 1 || consumers[0] !== refs[0]) return
    if (
      refs[0].childNodes.length ||
      Array.from({ length: refs[0].attributes.length }, (_, index) => refs[0].attributes.item(index)!).some(
        (attr) => attr.name !== 'r:id' && attr.prefix !== 'xmlns',
      )
    )
      return
    const types = new DOMParser().parseFromString(strFromU8(sourceParts.get('[Content_Types].xml')!), 'application/xml')
    const overrides = Array.from(
      types.getElementsByTagNameNS('http://schemas.openxmlformats.org/package/2006/content-types', 'Override'),
    )
    if (
      ![
        [chartPart, CHART_CONTENT_TYPE],
        [drawingPart, DRAWING_CONTENT_TYPE],
      ].every(([path, type]) => {
        const entries = overrides.filter((node) => node.getAttribute('PartName') === `/${path}`)
        return (
          entries.length === 1 &&
          entries[0].getAttribute('ContentType') === type &&
          !entries[0].childNodes.length &&
          Array.from({ length: entries[0].attributes.length }, (_, index) => entries[0].attributes.item(index)!).every(
            (attr) => ['PartName', 'ContentType'].includes(attr.name),
          )
        )
      })
    )
      return
    // Relationship XML must contain only the standard attributes we rewrite.
    for (const part of [sheetPart, drawingPart]) {
      const slash = part.lastIndexOf('/')
      const relPart = `${part.slice(0, slash + 1)}_rels/${part.slice(slash + 1)}.rels`
      const doc = new DOMParser().parseFromString(strFromU8(sourceParts.get(relPart)!), 'application/xml')
      if (
        part === drawingPart &&
        canonical(strFromU8(sourceParts.get(relPart)!)) !==
          canonical(
            `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rIdChart1" Type="${OFFICE_REL_NS}/chart" Target="${escape(rels[0].target)}"/></Relationships>`,
          )
      )
        return
      const entries = Array.from(
        doc.getElementsByTagNameNS('http://schemas.openxmlformats.org/package/2006/relationships', 'Relationship'),
      )
      for (const entry of entries.filter(
        (entry) => entry.getAttribute('Type') === `${OFFICE_REL_NS}/${part === sheetPart ? 'drawing' : 'chart'}`,
      )) {
        if (
          entry.childNodes.length ||
          Array.from({ length: entry.attributes.length }, (_, index) => entry.attributes.item(index)!).some(
            (attr) => !['Id', 'Type', 'Target', 'TargetMode'].includes(attr.name),
          )
        )
          return
      }
    }
    const xml = strFromU8(chartBytes)
    const root = new DOMParser().parseFromString(xml, 'application/xml').documentElement!
    const find = (parent: Element, name: string) => Array.from(parent.getElementsByTagNameNS(CHART_NS, name))
    const catFormula = find(find(root, 'cat')[0], 'f')[0].textContent!
    const category = parseSheetQualifiedAddress(catFormula)
    const headers = find(find(root, 'ser')[0], 'tx').length === 1
    if (category.sheetName !== sheet.name) return
    const anchorRoot = new DOMParser().parseFromString(strFromU8(drawingBytes), 'application/xml')
    const marker = (name: string) => {
      const node = anchorRoot.getElementsByTagNameNS(DRAWING_NS, name)[0]
      const value = (axis: string) => Number(node.getElementsByTagNameNS(DRAWING_NS, axis)[0].textContent) + 1
      return { row: value('row'), column: value('col') }
    }
    const range = { start: marker('from'), end: marker('to') }
    validateChartAnchor(range)
    const drawing: DrawingDescriptor = {
      id: chartPart,
      kind: 'chart',
      sourcePartName: chartPart,
      drawingPartName: drawingPart,
      relationshipId: 'rIdChart1',
      preservationStatus: 'safe',
      rangeStatus: 'safe',
      range,
      chart: {
        type: 'column',
        title: root.getElementsByTagNameNS(MAIN_NS, 't')[0].textContent!,
        headers,
        sourceRange: {
          start: { row: category.range.start.row - Number(headers), column: category.range.start.column },
          end: { row: category.range.end.row, column: category.range.end.column + 1 },
        },
      },
    }
    if (
      canonical(xml) !== canonical(columnChartXml(sheet, drawing, true)) ||
      canonical(strFromU8(drawingBytes)) !== canonical(columnDrawingXml(drawing))
    )
      return
    sheet.drawings = [drawing]
  } catch {
    // Unknown or unsupported chart metadata retains opaque preservation and its original guards.
  }
}
