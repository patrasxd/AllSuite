import type { DraftDocument, DraftNode } from '../document-model'
import { exportContext, inlineText, tableGrid, bounded } from './model'

export function exportText(input: DraftDocument): string {
  const { document } = exportContext(input)
  function block(node: DraftNode): string {
    if (node.type === 'doc' || node.type === 'listItem') return (node.content || []).map(block).join('\n\n')
    if (node.type === 'bulletList' || node.type === 'orderedList')
      return (node.content || [])
        .map((item, index) => {
          const marker =
            node.type === 'bulletList' ? '- ' : `${Math.round(bounded(node.attrs?.start, 1, 1, 999999)) + index}. `
          return marker + block(item).replace(/\n/g, '\n' + ' '.repeat(marker.length))
        })
        .join('\n')
    if (node.type === 'table')
      return tableGrid(node)
        .map((row) =>
          row
            .map((cell) => (cell ? block({ type: 'doc', content: cell.content }).replace(/\n+/g, ' ') : ''))
            .join('\t'),
        )
        .join('\n')
    if (node.type === 'tableOfContents')
      return (node.content || [])
        .map((entry) => '  '.repeat(Math.max(0, Number(entry.attrs?.level) - 1)) + inlineText(entry))
        .join('\n')
    if (node.type === 'note')
      return `${node.attrs?.kind === 'endnote' ? 'Endnote' : 'Footnote'} ${node.attrs?.number}: ${(node.content || []).map(block).join('\n\n')}`
    if (node.type === 'horizontalRule') return '---'
    if (node.type === 'blockquote') return (node.content || []).map(block).join('\n\n')
    return inlineText(node)
  }
  return (
    block(document)
      .replace(/\n{3,}/g, '\n\n')
      .trimEnd() + '\n'
  )
}
