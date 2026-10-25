import { Extension, type Editor } from '@tiptap/core'
import type { Node as PMNode } from '@tiptap/pm/model'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { Decoration, DecorationSet, type EditorView } from '@tiptap/pm/view'
import { pageGeometry, paragraphRuns } from '../engine/pagination'
import { COLUMN_GAP, columnCount, columnPosition, placeInColumn } from '../engine/columns'
import { readPageSetup } from '../engine/page-setup'
import { paragraphFormat, readStyles } from '../engine/styles'
import { textBlockChange } from './text-block-change'

declare module '@tiptap/core' {
  interface Storage {
    pagination: { refresh: () => void }
  }
}

const key = new PluginKey<DecorationSet>('draft-pagination')
type Anchor = { pos: () => number; top: number; bottom: number; glyph: number }
type Block = {
  pos: number
  top: number
  bottom: number
  before?: boolean
  keepNext?: boolean
  keepLines?: boolean
  widowControl?: boolean
  lines?: Array<Anchor & { force?: boolean }>
  rows?: Row[]
}
type Row = {
  pos: number
  top: number
  bottom: number
  cells: Block[][]
  dom: HTMLTableRowElement
  spans: number
  repeat: boolean
}
type Gap = { pos: number; height: number; expected: number; lane: number; row?: Row; headers?: HTMLTableRowElement[] }

export function refreshPagination(editor: Editor) {
  if (!editor.isDestroyed) editor.storage.pagination?.refresh()
}

function measure(view: EditorView, scale: number): Block[] {
  const styles = readStyles(view.state.doc.attrs.styleDefinitions)
  const origin = view.dom.getBoundingClientRect()
  const y = (value: number) => (value - origin.top) / scale
  const range = document.createRange()
  function block(node: PMNode, pos: number): Block[] {
    if (node.isText || node.isInline) return []
    const dom = view.nodeDOM(pos)
    if (!(dom instanceof HTMLElement)) return []
    const rect = dom.getBoundingClientRect()
    const result: Block = { pos, top: y(rect.top), bottom: y(rect.bottom), before: !!node.attrs.pageBreakBefore }
    if (node.isTextblock) {
      const format = paragraphFormat(styles, { type: node.type.name, attrs: node.attrs })
      result.keepNext = format.keepNext ?? node.type.name === 'heading'
      result.keepLines = format.keepLines ?? false
      result.widowControl = format.widowControl ?? true
    }
    if (node.type.name === 'table') {
      result.rows = []
      node.forEach((row, offset) => {
        const rowPos = pos + 1 + offset,
          rowDOM = view.nodeDOM(rowPos)
        if (!(rowDOM instanceof HTMLTableRowElement)) return
        const rect = rowDOM.getBoundingClientRect(),
          cells: Block[][] = []
        let spans = 1
        row.forEach((cell, offset) => {
          spans = Math.max(spans, Number(cell.attrs.rowspan) || 1)
          const contents: Block[] = []
          cell.forEach((child, inner) => contents.push(...block(child, rowPos + 2 + offset + inner)))
          cells.push(contents)
        })
        result.rows!.push({
          pos: rowPos,
          top: y(rect.top),
          bottom: y(rect.bottom),
          cells,
          dom: rowDOM,
          spans,
          repeat: !!row.attrs.repeatHeader,
        })
      })
      return [result]
    }
    if (!node.isTextblock) {
      const children: Block[] = []
      node.forEach((child, offset) => children.push(...block(child, pos + 1 + offset)))
      if (!children.length)
        result.lines = [{ top: result.top, bottom: result.bottom, glyph: result.top, pos: () => pos }]
      return children.length ? children : [result]
    }
    const lines: Array<Anchor & { force?: boolean }> = []
    const walker = document.createTreeWalker(dom, NodeFilter.SHOW_TEXT)
    for (let text = walker.nextNode(); text; text = walker.nextNode()) {
      const excluded = text.parentElement?.closest(
        '[contenteditable="false"],.draft-page-break,.draft-format-paragraph',
      )
      // Read-only measurement views still paginate their body text; only nested atoms are excluded.
      if (!text.textContent || (excluded && excluded !== view.dom)) continue
      const source = text as Text,
        start = view.posAtDOM(source, 0)
      const css = getComputedStyle(source.parentElement!),
        lineHeight = Number.parseFloat(css.lineHeight) || Number.parseFloat(css.fontSize) * 1.2
      range.selectNodeContents(source)
      for (const box of Array.from(range.getClientRects())) {
        if (!box.width || !box.height) continue
        const leading = Math.max(0, lineHeight - box.height / scale) / 2
        const top = y(box.top) - leading,
          bottom = y(box.bottom) + leading
        const existing = lines.find(
          (line) =>
            !line.force &&
            Math.min(line.bottom, bottom) - Math.max(line.top, top) >
              Math.min(line.bottom - line.top, bottom - top) * 0.5,
        )
        if (existing) {
          existing.top = Math.min(existing.top, top)
          existing.bottom = Math.max(existing.bottom, bottom)
          continue
        }
        const glyph = y(box.top)
        lines.push({
          top,
          bottom,
          glyph,
          pos: () => {
            let low = 0,
              high = source.length
            // Only page boundaries need a text-position search; never measure character-by-character.
            while (low < high) {
              const middle = Math.floor((low + high) / 2)
              range.setStart(source, middle)
              range.setEnd(source, Math.min(source.length, middle + 1))
              if (y(range.getBoundingClientRect().top) < glyph - 0.5) low = middle + 1
              else high = middle
            }
            // Keep surrogate pairs and combining sequences together.
            while (
              low > 0 &&
              (/^[\uDC00-\uDFFF\p{Mark}]/u.test(source.data.slice(low)) || source.data.charCodeAt(low - 1) === 0x200d)
            )
              low--
            return start + low
          },
        })
      }
    }
    node.forEach((child, offset) => {
      if (child.type.name !== 'pageBreak' && child.type.name !== 'image') return
      const childPos = pos + 1 + offset,
        childDOM = view.nodeDOM(childPos)
      if (!(childDOM instanceof HTMLElement)) return
      // React's inline node-view wrapper has a font-sized box; the image wrapper owns its actual height.
      const visual = child.type.name === 'image' ? childDOM.querySelector('.draft-image') || childDOM : childDOM
      const box = visual.getBoundingClientRect()
      if (child.type.name === 'pageBreak')
        lines.push({
          top: y(box.top),
          bottom: y(box.top),
          glyph: y(box.top),
          force: true,
          pos: () => childPos + child.nodeSize,
        })
      else lines.push({ top: y(box.top), bottom: y(box.bottom), glyph: y(box.top), pos: () => childPos })
    })
    if (!lines.length) lines.push({ top: result.top, bottom: result.bottom, glyph: result.top, pos: () => pos + 1 })
    result.lines = lines.sort((a, b) => a.top - b.top || Number(!!b.force) - Number(!!a.force))
    return [result]
  }
  const result: Block[] = []
  view.state.doc.forEach((node, pos) => result.push(...block(node, pos)))
  return result
}

function gapDOM(gap: Gap) {
  const dom = document.createElement(gap.row ? 'tr' : 'span')
  dom.className = gap.row ? 'draft-pagination-row-gap' : 'draft-pagination-gap'
  dom.contentEditable = 'false'
  dom.inert = true
  dom.setAttribute('aria-hidden', 'true')
  if (gap.row) {
    const cell = document.createElement('td')
    cell.colSpan =
      gap.row!.dom.closest('table')?.querySelector('colgroup')?.children.length ||
      Array.from(gap.row!.dom.cells).reduce((sum, cell) => sum + cell.colSpan, 0)
    cell.style.height = `${gap.height}px`
    dom.appendChild(cell)
    if (gap.headers?.length) {
      const table = document.createElement('table'),
        head = document.createElement('thead')
      table.className = 'draft-pagination-repeat-header'
      // The gap cell is narrower than its outer table's border box. Percentage
      // width can wrap a formerly single-line header and clip its first line.
      const source = gap.row.dom.closest('table')!
      table.style.width = getComputedStyle(source).width
      const columns = gap.row.dom.closest('table')?.querySelector(':scope > colgroup')
      if (columns) table.appendChild(columns.cloneNode(true))
      for (const row of gap.headers) head.appendChild(row.cloneNode(true))
      table.appendChild(head)
      cell.appendChild(table)
    }
  } else dom.style.height = `${gap.height}px`
  return dom
}

export const Pagination = Extension.create<{ onPages: (pages: number) => void }>({
  name: 'pagination',
  addOptions: () => ({ onPages: () => {} }),
  addStorage: () => ({ refresh: () => {} }),
  addProseMirrorPlugins() {
    const onPages = this.options.onPages
    const storage = this.storage
    return [
      new Plugin({
        key,
        state: {
          init: () => DecorationSet.empty,
          apply: (tr, value) => tr.getMeta(key) ?? value.map(tr.mapping, tr.doc),
        },
        props: { decorations: (state) => key.getState(state) },
        view(view) {
          let frame = 0,
            busy = false,
            dead = false,
            width = 0,
            pages = 1,
            followCaret = false
          let stableHeights = new WeakMap<PMNode, number>()
          const schedule = () => {
            if (dead || busy || frame || !window.requestAnimationFrame) return
            frame = requestAnimationFrame(() => {
              frame = 0
              if (!view.composing) layout()
            })
          }
          storage.refresh = schedule
          function layout() {
            const paper = view.dom.closest<HTMLElement>('.draft-paper')
            if (!paper || !view.dom.isConnected || !view.dom.getBoundingClientRect().width) return
            busy = true
            const scroll = paper.closest('.draft-document-area')!
            const scrollTop = scroll.scrollTop
            try {
              const setup = readPageSetup({ attrs: view.state.doc.attrs })
              const columns = paper.classList.contains('draft-paper--columns')
                ? columnCount({ attrs: view.state.doc.attrs })
                : 1
              const bodyWidth = (setup.width - setup.left - setup.right) / 15 - 2
              const columnWidth = (bodyWidth - (columns - 1) * COLUMN_GAP) / columns
              view.dom.style.width = columns > 1 ? `${columnWidth}px` : ''
              const css = getComputedStyle(paper)
              const geometry = pageGeometry(
                setup.height / 15,
                Number.parseFloat(css.getPropertyValue('--draft-margin-top')) || setup.top / 15,
                Number.parseFloat(css.getPropertyValue('--draft-margin-bottom')) || setup.bottom / 15,
              )
              const zoom = Number.parseFloat(getComputedStyle(paper.closest('.draft-page')!).zoom) || 1
              const placeOnPage = (
                top: number,
                bottom: number,
                offset: number,
                geometry: Parameters<typeof placeInColumn>[3],
                force?: 'always' | 'boundary',
                header = 0,
              ) => placeInColumn(top, bottom, offset, geometry, columns, force, header)
              view.dispatch(view.state.tr.setMeta(key, DecorationSet.empty).setMeta('addToHistory', false))
              // Unsupported object documents retain their continuous editing view.
              if (!paper.classList.contains('draft-paper--paged')) {
                stableHeights = new WeakMap()
                return
              }
              const blocks = measure(view, zoom),
                gaps: Gap[] = []
              let end = 0
              function flow(blocks: Block[], offset: number, lane = 0): number {
                for (let blockIndex = 0; blockIndex < blocks.length; blockIndex++) {
                  const block = blocks[blockIndex]
                  if (block.rows) {
                    const headers: HTMLTableRowElement[] = []
                    let headerHeight = 0
                    for (const row of block.rows) {
                      if (!row.repeat) break
                      headers.push(row.dom)
                      headerHeight += row.bottom - row.top
                    }
                    for (let index = 0; index < block.rows.length; index++) {
                      const row = block.rows[index]
                      let last = index + row.spans
                      for (let i = index + 1; i < Math.min(last, block.rows.length); i++)
                        last = Math.max(last, i + block.rows[i].spans)
                      const group = block.rows.slice(index, Math.min(last, block.rows.length))
                      const bottom = group[group.length - 1].bottom
                      if (bottom - row.top <= geometry.body) {
                        const repeat =
                          index >= headers.length &&
                          headerHeight < geometry.body / 2 &&
                          bottom - row.top + headerHeight <= geometry.body
                            ? headerHeight
                            : 0
                        const placed = placeOnPage(row.top, bottom, offset, geometry, undefined, repeat)
                        if (placed.gap)
                          gaps.push({
                            pos: row.pos,
                            height: placed.gap,
                            expected: row.top + placed.offset,
                            lane,
                            row,
                            headers: repeat ? headers : undefined,
                          })
                        offset = placed.offset
                      } else {
                        offset = Math.max(
                          offset,
                          ...group.flatMap((row) => row.cells.map((cells, i) => flow(cells, offset, row.pos + i + 1))),
                        )
                      }
                      end = Math.max(end, bottom + offset)
                      index += group.length - 1
                    }
                  } else {
                    const first = block.lines?.[0]
                    let required = first?.bottom ?? block.bottom
                    if (first && !first.force) {
                      // A keep chain includes the complete preceding paragraphs and
                      // the first legal line group (or first table row) of its successor.
                      let index = blockIndex
                      while (blocks[index]?.keepNext && !blocks[index].lines?.some((line) => line.force)) {
                        const next = blocks[index + 1]
                        if (!next || next.before) break
                        if (next.rows) {
                          required =
                            next.rows[Math.min(next.rows.length - 1, next.rows[0]?.repeat ? 1 : 0)]?.bottom ??
                            next.bottom
                          break
                        }
                        const lines = next.lines || []
                        if (!lines.length || lines[0].force) break
                        const length =
                          next.keepLines && next.bottom - next.top <= geometry.body
                            ? lines.length
                            : Math.min(lines.length, next.widowControl ? 2 : 1)
                        required = lines[length - 1].bottom
                        if (required - first.top > geometry.body) break
                        index++
                      }
                      {
                        const placed = placeOnPage(
                          first.top,
                          required - first.top <= geometry.body ? required : first.bottom,
                          offset,
                          geometry,
                          block.before ? 'boundary' : undefined,
                        )
                        if (placed.gap)
                          gaps.push({
                            pos: first.pos(),
                            height: placed.gap,
                            expected: first.glyph + placed.offset,
                            lane,
                          })
                        offset = placed.offset
                      }
                    }
                    if (block.before) {
                      // The first-line placement above already applied the boundary.
                      if (!first || first.force) {
                        const placed = placeOnPage(block.top, block.top, offset, geometry, 'boundary')
                        if (placed.gap)
                          gaps.push({ pos: block.pos, height: placed.gap, expected: block.top + placed.offset, lane })
                        offset = placed.offset
                      }
                    }
                    const lines = block.lines || []
                    const units: Array<{ first: Anchor; bottom: number; force?: boolean }> = []
                    for (let index = 0; index < lines.length;) {
                      if (lines[index].force) {
                        units.push({ first: lines[index], bottom: lines[index].bottom, force: true })
                        index++
                        continue
                      }
                      let last = index
                      while (last < lines.length && !lines[last].force) last++
                      const section = lines.slice(index, last)
                      for (const [from, to] of paragraphRuns(
                        section,
                        geometry.body,
                        !!block.keepLines,
                        !!block.widowControl,
                      ))
                        units.push({ first: section[from], bottom: section[to - 1].bottom })
                      index = last
                    }
                    for (const unit of units) {
                      const line = unit.first
                      const placed = placeOnPage(
                        line.top,
                        unit.bottom,
                        offset,
                        geometry,
                        unit.force ? 'always' : undefined,
                      )
                      if (placed.gap)
                        gaps.push({ pos: line.pos(), height: placed.gap, expected: line.glyph + placed.offset, lane })
                      offset = placed.offset
                      end = Math.max(end, unit.bottom + offset)
                    }
                    end = Math.max(end, block.bottom + offset)
                  }
                }
                return offset
              }
              flow(blocks, 0)
              const decorations = () =>
                DecorationSet.create(
                  view.state.doc,
                  gaps.map((gap) =>
                    Decoration.widget(gap.pos, () => gapDOM(gap), {
                      side: -1,
                      ignoreSelection: true,
                      stopEvent: () => true,
                      key: `${gap.pos}:${gap.height}`,
                    }),
                  ),
                )
              view.dispatch(view.state.tr.setMeta(key, decorations()).setMeta('addToHistory', false))
              // Block widgets inside inline content can introduce leading. Compensate without
              // another content measurement or any document/history transaction.
              const errorByLane = new Map<number, number>()
              let corrected = false
              for (const gap of gaps) {
                const actual = gap.row ? gap.row.dom.getBoundingClientRect().top : view.coordsAtPos(gap.pos, 1).top
                const error = (actual - view.dom.getBoundingClientRect().top) / zoom - gap.expected
                const adjustment = error - (errorByLane.get(gap.lane) || 0)
                errorByLane.set(gap.lane, error)
                if (Math.abs(adjustment) > 0.75 && gap.height - adjustment >= 0) {
                  gap.height -= adjustment
                  corrected = true
                }
              }
              if (corrected) view.dispatch(view.state.tr.setMeta(key, decorations()).setMeta('addToHistory', false))
              if (columns > 1) {
                // The existing paginator measures a narrow continuous lane. Project its
                // virtual pages into physical columns using view-only decorations.
                const projected: Decoration[] = []
                const measured = measure(view, zoom)
                for (const block of measured) {
                  const node = view.state.doc.nodeAt(block.pos)
                  if (!node?.isTextblock) continue
                  const lines = (block.lines || []).filter((line) => !line.force)
                  const first = lines[0]
                  if (!first) continue
                  const laneAt = (line: Anchor) => Math.max(0, Math.floor((line.glyph + 0.5) / geometry.pitch))
                  const firstLane = laneAt(first)
                  const transform = (lane: number) => {
                    const shift = columnPosition(lane, columns, columnWidth + COLUMN_GAP, geometry.pitch)
                    return `position:relative;left:${shift.x}px;top:${shift.y}px`
                  }
                  if (lines.every((line) => laneAt(line) === firstLane)) {
                    projected.push(
                      Decoration.node(block.pos, block.pos + node.nodeSize, { style: transform(firstLane) }),
                    )
                  } else {
                    for (let i = 0; i < lines.length;) {
                      const lane = laneAt(lines[i])
                      let last = i + 1
                      while (last < lines.length && laneAt(lines[last]) === lane) last++
                      const from = i === 0 ? block.pos + 1 : lines[i].pos()
                      const to = last < lines.length ? lines[last].pos() : block.pos + node.nodeSize - 1
                      if (to > from) projected.push(Decoration.inline(from, to, { style: transform(lane) }))
                      i = last
                    }
                  }
                }
                view.state.doc.descendants((node, pos) => {
                  if (node.type.name !== 'listItem') return true
                  const paragraph = measured.find((block) => block.pos === pos + 1)
                  if (!paragraph?.lines?.length) return true
                  const lane = Math.max(0, Math.floor((paragraph.lines[0].glyph + 0.5) / geometry.pitch))
                  const shift = columnPosition(lane, columns, columnWidth + COLUMN_GAP, geometry.pitch)
                  const parent = view.state.doc.resolve(pos).parent
                  let index = 0
                  parent.forEach((child, offset) => {
                    if (offset < pos - view.state.doc.resolve(pos).start()) index++
                  })
                  const marker =
                    parent.type.name === 'orderedList' ? `${Number(parent.attrs.start || 1) + index}.` : '•'
                  projected.push(Decoration.node(pos, pos + node.nodeSize, { 'data-column-marker': 'true' }))
                  projected.push(
                    Decoration.widget(
                      pos + 2,
                      () => {
                        const span = document.createElement('span')
                        span.className = 'draft-column-marker'
                        span.textContent = marker
                        const whole = paragraph.lines!.every(
                          (line) => Math.floor((line.glyph + 0.5) / geometry.pitch) === lane,
                        )
                        span.style.cssText = `display:inline-block;width:0;white-space:nowrap;overflow:visible;position:relative;left:${whole ? -24 : shift.x - 24}px;top:${whole ? 0 : shift.y}px`
                        return span
                      },
                      { side: -1 },
                    ),
                  )
                  return true
                })
                view.dispatch(
                  view.state.tr
                    .setMeta(key, decorations().add(view.state.doc, projected))
                    .setMeta('addToHistory', false),
                )
              }
              stableHeights = new WeakMap()
              if (columns === 1)
                view.state.doc.descendants((node, pos) => {
                  if (!node.isTextblock) return true
                  const dom = view.nodeDOM(pos)
                  if (dom instanceof HTMLElement) stableHeights.set(node, dom.getBoundingClientRect().height / zoom)
                  return false
                })
              const next = Math.max(1, Math.ceil((Math.floor((Math.max(0, end) - 0.5) / geometry.pitch) + 1) / columns))
              if (next !== pages) {
                pages = next
                onPages(pages)
              }
            } finally {
              scroll.scrollTop = scrollTop
              if (followCaret && view.hasFocus()) {
                const caret = view.coordsAtPos(view.state.selection.head),
                  bounds = scroll.getBoundingClientRect()
                if (caret.bottom > bounds.bottom - 12) scroll.scrollTop += caret.bottom - bounds.bottom + 12
                else if (caret.top < bounds.top + 12) scroll.scrollTop -= bounds.top + 12 - caret.top
              }
              followCaret = false
              busy = false
            }
          }
          const observer =
            typeof ResizeObserver === 'undefined'
              ? undefined
              : new ResizeObserver(() => {
                  const next = view.dom.getBoundingClientRect().width
                  if (Math.abs(next - width) > 0.5) {
                    width = next
                    schedule()
                  }
                })
          observer?.observe(view.dom)
          view.dom.addEventListener('load', schedule, true)
          view.dom.addEventListener('compositionend', schedule)
          document.fonts?.addEventListener('loadingdone', schedule)
          schedule()
          return {
            update(next, previous) {
              if (!next.state.doc.eq(previous.doc)) {
                const changed = !frame && textBlockChange(previous.doc, next.state.doc)
                if (
                  changed &&
                  !key
                    .getState(next.state)
                    ?.find(changed.pos, changed.pos + changed.node.nodeSize)
                    .some((gap) => gap.from > changed.pos + 1 && gap.from < changed.pos + changed.node.nodeSize)
                ) {
                  const known = stableHeights.get(changed.previous),
                    dom = next.nodeDOM(changed.pos)
                  const scale =
                    Number.parseFloat(getComputedStyle(next.dom.closest('.draft-page') || next.dom).zoom) || 1
                  if (
                    known !== undefined &&
                    dom instanceof HTMLElement &&
                    Math.abs(dom.getBoundingClientRect().height / scale - known) < 0.1
                  ) {
                    stableHeights.set(changed.node, known)
                    return
                  }
                }
                followCaret = next.hasFocus()
                schedule()
              }
            },
            destroy() {
              dead = true
              storage.refresh = () => {}
              if (frame) cancelAnimationFrame(frame)
              observer?.disconnect()
              view.dom.removeEventListener('load', schedule, true)
              view.dom.removeEventListener('compositionend', schedule)
              document.fonts?.removeEventListener('loadingdone', schedule)
            },
          }
        },
      }),
    ]
  },
})
