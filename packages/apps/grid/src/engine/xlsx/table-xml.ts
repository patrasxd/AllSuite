import { DOMImplementation, XMLSerializer } from '@xmldom/xmldom'
import { formatRangeAddress } from '../workbook/address'
import type { TableDescriptor, Worksheet } from '../workbook/types'

export const TABLE_NS = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'
export const TABLE_CONTENT_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.table+xml'

/** The entire supported native XML grammar; exact import comparison rejects every extension. */
export function simpleTableXml(table: TableDescriptor, filter: Worksheet['autoFilter']): string {
  const doc = new DOMImplementation().createDocument(TABLE_NS, 'table', null)
  const root = doc.documentElement!
  const add = (parent: typeof root, name: string, attrs: Record<string, string | number>) => {
    const node = doc.createElementNS(TABLE_NS, name)
    for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, String(value))
    parent.appendChild(node)
    return node
  }
  for (const [key, value] of Object.entries({
    id: table.nativeId!,
    name: table.name,
    displayName: table.name,
    ref: formatRangeAddress(table.range),
    headerRowCount: 1,
    totalsRowShown: 0,
  }))
    root.setAttribute(key, String(value))
  const auto = add(root, 'autoFilter', { ref: formatRangeAddress(table.range) })
  for (const criterion of filter?.criteria ?? []) {
    const column = add(auto, 'filterColumn', { colId: criterion.column - table.range.start.column })
    const filters = add(column, 'filters', criterion.blank ? { blank: 1 } : {})
    for (const value of criterion.values) add(filters, 'filter', { val: value })
  }
  const columns = add(root, 'tableColumns', { count: table.columns.length })
  for (const column of table.columns) add(columns, 'tableColumn', { id: column.id, name: column.name })
  add(root, 'tableStyleInfo', {
    name: 'TableStyleMedium2',
    showFirstColumn: 0,
    showLastColumn: 0,
    showRowStripes: 1,
    showColumnStripes: 0,
  })
  return new XMLSerializer().serializeToString(root)
}
