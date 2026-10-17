import type { DraftDocument, DraftNode } from '../document-model'
import { safeImageSource } from '../images'
import { safeLink, validTargetId } from '../references'
import { paragraphStyleId } from '../styles'
import { bounded, escapeHTML, exportContext, inlineText, tableGrid } from './model'
import { renderHTMLBody } from './html'

const escape = (value: string) => value.replace(/([\\`*_[\]<>~|])/g, '\\$1')
const destination = (value: string) =>
  '<' + value.replace(/[<>\\]/g, (char) => '%' + char.charCodeAt(0).toString(16).toUpperCase()) + '>'
function emphasis(value: string, marker: string) {
  const [, before, text, after] = /^(\s*)([\s\S]*?)(\s*)$/.exec(value)!
  return text ? before + marker + text + marker + after : value
}
function inlineCode(value: string) {
  const count = Math.max(0, ...(value.match(/`+/g) || []).map((ticks) => ticks.length)) + 1
  const fence = '`'.repeat(count)
  const padding = /(^`|`$|^ .* $)/.test(value) ? ' ' : ''
  return fence + padding + value.replace(/\n/g, ' ') + padding + fence
}
export function exportMarkdown(input: DraftDocument): string {
  const context = exportContext(input)
  const targets = new Set<string>()
  function find(node: DraftNode) {
    if (node.attrs?.targetId) targets.add(String(node.attrs.targetId))
    for (const mark of node.marks || [])
      if (mark.type === 'link' && String(mark.attrs?.href).startsWith('#'))
        targets.add(String(mark.attrs!.href).slice(1))
    node.content?.forEach(find)
  }
  find(context.document)
  const anchor = (id: unknown) => (validTargetId(id) ? `<a id="${escapeHTML(id)}"></a>` : '')
  function inline(node: DraftNode, base = {}): string {
    if (node.type === 'captionNumber') return escape(inlineText(node))
    if (node.type === 'text') {
      const format = context.run(node, base)
      let text = node.marks?.some((mark) => mark.type === 'code')
        ? inlineCode(node.text || '')
        : escape(node.text || '')
      if (format.bold) text = emphasis(text, '**')
      if (format.italic) text = emphasis(text, '*')
      if (node.marks?.some((mark) => mark.type === 'strike')) text = emphasis(text, '~~')
      const href = safeLink(node.marks?.find((mark) => mark.type === 'link')?.attrs?.href)
      return href ? `[${text}](${destination(href)})` : text
    }
    if (node.type === 'hardBreak') return '  \n'
    if (node.type === 'pageBreak') return '\n\n'
    if (node.type === 'image') {
      const source = safeImageSource(String(node.attrs?.src || ''))
      return source
        ? `![${escape(String(node.attrs?.alt || ''))}](${destination(source)})`
        : escape(String(node.attrs?.alt || '[Image]'))
    }
    if (node.type === 'crossReference')
      return validTargetId(node.attrs?.targetId)
        ? `[${escape(String(node.attrs?.label || ''))}](#${node.attrs.targetId})`
        : escape(String(node.attrs?.label || ''))
    if (node.type === 'noteReference') return `[^${node.attrs?.id}]`
    return (
      (node.type === 'bookmark' ? anchor(node.attrs?.id) : '') +
      (node.content || []).map((child) => inline(child, base)).join('')
    )
  }
  function block(node: DraftNode): string {
    const contents = () => (node.content || []).map(block).join('\n\n')
    if (node.type === 'doc' || node.type === 'listItem') return contents()
    if (node.type === 'paragraph' || node.type === 'heading' || node.type === 'codeBlock') {
      const level = context.level(node)
      if (paragraphStyleId(node) === 'Code' || node.type === 'codeBlock') {
        const value = inlineText(node)
        const fence = '`'.repeat(
          Math.max(3, Math.max(0, ...(value.match(/`+/g) || []).map((ticks) => ticks.length)) + 1),
        )
        return `${fence}\n${value}\n${fence}`
      }
      const base = context.format(node)
      if (level) base.bold = false // Heading syntax already carries its visual emphasis.
      let value = (node.content || []).map((child) => inline(child, base)).join('')
      if (!level) value = value.replace(/^( {0,3})([-+#>]|\d+[.)])(?=\s)/gm, '$1\\$2')
      if (level) value = '#'.repeat(level) + ' ' + value
      if (paragraphStyleId(node) === 'Quote')
        value = value
          .split('\n')
          .map((line) => '> ' + line)
          .join('\n')
      return (targets.has(String(node.attrs?.anchorId)) ? anchor(node.attrs?.anchorId) + '\n\n' : '') + value
    }
    if (node.type === 'bulletList' || node.type === 'orderedList')
      return (node.content || [])
        .map((item, index) => {
          const marker =
            node.type === 'bulletList' ? '- ' : `${Math.round(bounded(node.attrs?.start, 1, 1, 999999)) + index}. `
          return marker + block(item).replace(/\n/g, '\n' + ' '.repeat(marker.length))
        })
        .join('\n')
    if (node.type === 'table') {
      const complex = (node.content || []).some((row) =>
        row.content?.some(
          (cell) =>
            Number(cell.attrs?.colspan || 1) > 1 ||
            Number(cell.attrs?.rowspan || 1) > 1 ||
            cell.content?.some((child) => !['paragraph', 'heading'].includes(child.type)),
        ),
      )
      if (complex) return renderHTMLBody({ type: 'doc', content: [node] })
      const grid = tableGrid(node)
      if (!grid.length || !grid[0].length) return ''
      const hasHeader = grid[0].every((cell) => cell?.type === 'tableHeader')
      const row = (cells: Array<DraftNode | null>) =>
        '| ' +
        cells
          .map((cell) =>
            (cell?.content || [])
              .map((p) => (p.content || []).map((node) => inline(node)).join(''))
              .join('<br>')
              .replace(/\n/g, '<br>'),
          )
          .join(' | ') +
        ' |'
      const first = hasHeader ? grid.shift()! : grid[0].map(() => null)
      return [row(first), '| ' + first.map(() => '---').join(' | ') + ' |', ...grid.map(row)].join('\n')
    }
    if (node.type === 'tableOfContents')
      return (node.content || [])
        .map(
          (entry) =>
            '  '.repeat(bounded(entry.attrs?.level, 1, 1, 6) - 1) +
            `- [${escape(inlineText(entry))}](#${validTargetId(entry.attrs?.targetId) ? entry.attrs.targetId : ''})`,
        )
        .join('\n')
    if (node.type === 'note') return `[^${node.attrs?.id}]: ` + contents().replace(/\n/g, '\n    ')
    if (node.type === 'blockquote')
      return contents()
        .split('\n')
        .map((line) => '> ' + line)
        .join('\n')
    if (node.type === 'horizontalRule') return '---'
    return inline(node)
  }
  return (
    block(context.document)
      .replace(/\n[ \t]+\n/g, '\n\n')
      .trimEnd() + '\n'
  )
}
