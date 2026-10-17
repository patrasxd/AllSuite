import { Extension, type Editor } from '@tiptap/core'
import { Table, TableCell, TableHeader, TableRow, TableView } from '@tiptap/extension-table'
import type { Node } from '@tiptap/pm/model'
import { TableMap } from '@tiptap/pm/tables'
import { normalizeHexColor } from '../engine/formatting'

const cellStyles: Record<string, [string, string]> = {
  backgroundColor: ['background-color', ''],
  verticalAlign: ['vertical-align', 'top'],
  padding: ['padding', '6px'],
  borderTop: ['border-top', '1px solid #808080'],
  borderRight: ['border-right', '1px solid #808080'],
  borderBottom: ['border-bottom', '1px solid #808080'],
  borderLeft: ['border-left', '1px solid #808080'],
}

export const TableFormatting = Extension.create({
  name: 'tableFormatting',
  addGlobalAttributes() {
    return [
      {
        types: ['tableCell', 'tableHeader'],
        attributes: Object.fromEntries(
          Object.entries(cellStyles).map(([key, [css, fallback]]) => [
            key,
            {
              default: fallback,
              parseHTML: (element: HTMLElement) => {
                const value = element.style.getPropertyValue(css)
                if (key === 'backgroundColor') return normalizeHexColor(value) || fallback
                return value.replace(/rgba?\([^)]+\)/g, (color) => normalizeHexColor(color) || color) || fallback
              },
              renderHTML: (attrs: Record<string, string>) => ({ style: `${css}: ${attrs[key]}` }),
            },
          ]),
        ),
      },
      {
        types: ['tableRow'],
        attributes: {
          repeatHeader: {
            default: false,
            parseHTML: (element: HTMLElement) =>
              element.dataset.repeatHeader === 'true' || element.parentElement?.tagName === 'THEAD',
            renderHTML: ({ repeatHeader }: Record<string, boolean>) =>
              repeatHeader ? { 'data-repeat-header': 'true' } : {},
          },
        },
      },
    ]
  },
})

class DraftTableView extends TableView {
  update(node: Node) {
    if (!super.update(node)) return false
    this.table.style.marginLeft = /margin-left: auto/.test(node.attrs.style) ? 'auto' : '0'
    this.table.style.marginRight = /margin-right: auto/.test(node.attrs.style) ? 'auto' : '0'
    return true
  }
}

export const DraftTable = Table.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      style: {
        default: 'margin-left: 0; margin-right: auto',
        parseHTML: (element) =>
          `margin-left: ${element.style.marginLeft || '0'}; margin-right: ${element.style.marginRight || 'auto'}`,
        renderHTML: ({ style }) => ({ style }),
      },
    }
  },
}).configure({ resizable: true, renderWrapper: true, cellMinWidth: 48, View: DraftTableView })

export const tableExtensions = [DraftTable, TableRow, TableCell, TableHeader, TableFormatting]

export function setTableBorders(editor: Editor, mode: string, color: string, width: number) {
  const { $from } = editor.state.selection
  for (let depth = $from.depth; depth > 0; depth--) {
    const table = $from.node(depth)
    if (table.type.name !== 'table') continue
    const start = $from.start(depth)
    const map = TableMap.get(table)
    const tr = editor.state.tr
    for (const offset of new Set(map.map)) {
      const rect = map.findCell(offset)
      const cell = table.nodeAt(offset)!
      const edges = [rect.top === 0, rect.right === map.width, rect.bottom === map.height, rect.left === 0]
      const attrs = { ...cell.attrs }
      ;['Top', 'Right', 'Bottom', 'Left'].forEach((side, index) => {
        attrs[`border${side}`] =
          mode === 'all' || (mode === 'outer' && edges[index]) ? `${width}px solid ${color}` : '0px none'
      })
      tr.setNodeMarkup(start + offset, undefined, attrs)
    }
    editor.view.dispatch(tr)
    return true
  }
  return false
}

export function toggleRepeatHeader(editor: Editor) {
  const { $from } = editor.state.selection
  for (let depth = $from.depth; depth > 0; depth--) {
    const table = $from.node(depth)
    if (table.type.name !== 'table' || !table.firstChild) continue
    const row = table.firstChild
    editor.view.dispatch(
      editor.state.tr.setNodeMarkup($from.start(depth), undefined, {
        ...row.attrs,
        repeatHeader: !row.attrs.repeatHeader,
      }),
    )
    return true
  }
  return false
}
