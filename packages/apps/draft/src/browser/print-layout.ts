import { prepareReferenceExport } from './reference-layout'
import type { DraftDocument } from '../engine/document-model'
import { readPageSetup } from '../engine/page-setup'
import { storiesFor, storyVariant, resolveStory, storyLayout } from '../engine/stories'
import { renderHTMLBody } from '../engine/export/html'
import { referenceTargets, safeLink } from '../engine/references'
import { exportFontFamily } from '../engine/export/model'
import { PAGE_GAP } from '../engine/pagination'
import { readCommentThreads } from '../engine/comments'
import { columnCount, supportsColumnLayout } from '../engine/columns'
import type { Box, PrintItem, PrintLayout } from '../engine/print-layout'

export async function capturePrintLayout(
  document: DraftDocument,
  title: string,
  language: string,
  signal?: AbortSignal,
  options: {
    hyphenation?: boolean
    includeComments?: boolean
    onResolved?: (document: DraftDocument) => void
  } = {},
): Promise<PrintLayout> {
  if (
    columnCount(document) > 1 &&
    (!supportsColumnLayout(document) ||
      (options.includeComments && readCommentThreads(document.attrs?.comments).length))
  )
    throw new Error('printColumns')
  let output!: PrintLayout
  await prepareReferenceExport(
    document,
    signal,
    true,
    async (editor, paper, count, resolved) => {
      const setup = readPageSetup(resolved),
        width = setup.width / 15,
        height = setup.height / 15,
        pitch = height + PAGE_GAP
      output = {
        width,
        height,
        title: storiesFor(setup).title || title,
        language,
        pages: Array.from({ length: count }, () => ({ items: [], links: [] })),
        destinations: {},
        headings: [],
      }
      const origin = paper.getBoundingClientRect()
      const css = getComputedStyle(paper)
      const top = parseFloat(css.getPropertyValue('--draft-margin-top')),
        bottom = parseFloat(css.getPropertyValue('--draft-margin-bottom'))
      const body: Box = {
        x: setup.left / 15 + 1,
        y: top + 1,
        width: width - (setup.left + setup.right) / 15 - 2,
        height: height - top - bottom - 2,
      }
      const add = (item: PrintItem, pageIndex?: number) => {
        const first = pageIndex ?? Math.max(0, Math.floor(item.y / pitch))
        const last = pageIndex ?? Math.min(count - 1, Math.floor((item.y + Math.max(0, item.height - 0.01)) / pitch))
        for (let index = first; index <= last && index < count; index++) {
          const offset = pageIndex === undefined ? index * pitch : 0
          const copy = {
            ...item,
            y: item.y - offset,
            ...(item.kind === 'text' ? { baseline: item.baseline - offset } : {}),
            ...(pageIndex === undefined ? { clip: body } : {}),
          } as PrintItem
          if (pageIndex === undefined && (copy.y >= body.y + body.height || copy.y + copy.height <= body.y)) continue
          output.pages[index].items.push(copy)
        }
      }
      const canvas = window.document.createElement('canvas'),
        ctx = canvas.getContext('2d')!
      const range = window.document.createRange()
      const rasters = new Map<string, string>()
      function capture(root: HTMLElement, baseX = origin.left, baseY = origin.top, pageIndex?: number, scale = 1) {
        // Document colors survive e-ink's screen-only overrides; the projection always represents print.
        for (const element of Array.from(root.querySelectorAll<HTMLElement>('[style]'))) {
          if (element.style.color) element.style.setProperty('color', element.style.color, 'important')
          if (element.style.backgroundColor)
            element.style.setProperty('background-color', element.style.backgroundColor, 'important')
        }
        const rect = (box: DOMRect): Box => ({
          x: box.left - baseX,
          y: box.top - baseY,
          width: box.width,
          height: box.height,
        })
        const ignored = (element: Element) =>
          !!element.closest('.draft-image-actions,.draft-formatting-marker,.draft-page-break,.draft-story-measurements')
        for (const element of [root, ...Array.from(root.querySelectorAll<HTMLElement>('*'))]) {
          if (ignored(element)) continue
          const style = getComputedStyle(element),
            box = rect(element.getBoundingClientRect())
          if (!box.width || !box.height || style.display === 'none' || style.visibility === 'hidden') continue
          if (
            element !== root &&
            style.backgroundColor !== 'rgba(0, 0, 0, 0)' &&
            style.backgroundColor !== 'transparent'
          )
            add({ kind: 'rect', ...box, color: style.backgroundColor }, pageIndex)
          if (!element.matches('.draft-image,.draft-image *')) {
            for (const side of ['Top', 'Right', 'Bottom', 'Left'] as const) {
              const size = parseFloat(style[`border${side}Width`]) * scale
              if (!size || style[`border${side}Style`] === 'none') continue
              const edge = { ...box }
              if (side === 'Top' || side === 'Bottom') {
                edge.height = size
                if (side === 'Bottom') edge.y += box.height - size
              } else {
                edge.width = size
                if (side === 'Right') edge.x += box.width - size
              }
              add(
                {
                  kind: 'rect',
                  ...edge,
                  color: style[`border${side}Color`],
                  ...(style[`border${side}Style`] === 'dotted' || style[`border${side}Style`] === 'dashed'
                    ? { dash: style[`border${side}Style`] as 'dotted' | 'dashed' }
                    : {}),
                },
                pageIndex,
              )
            }
          }
          if (element instanceof HTMLImageElement && element.currentSrc.startsWith('data:image/')) {
            // Capture the decoded image, including sanitized SVG/WebP, as a local PNG for both renderers.
            let source = rasters.get(element.currentSrc)
            if (!source) {
              const image = window.document.createElement('canvas')
              image.width = element.naturalWidth
              image.height = element.naturalHeight
              image.getContext('2d')!.drawImage(element, 0, 0)
              source = image.toDataURL('image/png')
              rasters.set(element.currentSrc, source)
            }
            add({ kind: 'image', ...box, source }, pageIndex)
          }
          const href = element instanceof HTMLAnchorElement && safeLink(element.getAttribute('href'))
          if (href)
            for (const bounds of Array.from(element.getClientRects())) {
              const link = rect(bounds),
                index = pageIndex ?? Math.floor(link.y / pitch)
              if (index >= 0 && index < count)
                output.pages[index].links.push({
                  ...link,
                  y: pageIndex === undefined ? link.y - index * pitch : link.y,
                  href,
                })
            }
          if (element.tagName === 'LI' && !element.hasAttribute('data-column-marker')) {
            const list = element.parentElement!,
              ordered = list.tagName === 'OL'
            const marker = ordered
              ? `${Number(list.getAttribute('start') || 1) + Array.from(list.children).indexOf(element)}.`
              : '•'
            ctx.font = `${style.fontStyle} ${style.fontWeight} ${style.fontSize} ${style.fontFamily}`
            const size = parseFloat(style.fontSize) * scale,
              markerWidth = ctx.measureText(marker).width * scale
            add(
              {
                kind: 'text',
                x: box.x - markerWidth - 8 * scale,
                y: box.y,
                width: markerWidth,
                height: size * 1.2,
                baseline:
                  box.y + (ctx.measureText(marker).fontBoundingBoxAscent || parseFloat(style.fontSize) * 0.85) * scale,
                text: marker,
                family: exportFontFamily(style.fontFamily),
                size,
                bold: Number(style.fontWeight) >= 600,
                italic: style.fontStyle === 'italic',
                color: style.color,
              },
              pageIndex,
            )
          }
        }
        const walker = window.document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
        for (let current = walker.nextNode(); current; current = walker.nextNode()) {
          const text = current as Text,
            parent = text.parentElement!
          if (!text.length || ignored(parent)) continue
          const style = getComputedStyle(parent)
          if (style.visibility === 'hidden' || style.display === 'none') continue
          ctx.font = `${style.fontStyle} ${style.fontWeight} ${style.fontSize} ${style.fontFamily}`
          const size = parseFloat(style.fontSize) * scale
          range.selectNodeContents(text)
          const lines = Array.from(range.getClientRects()).filter((box) => box.width > 0.01 && box.height > 0.01)
          const offsets = [...new Intl.Segmenter(language, { granularity: 'grapheme' }).segment(text.data)].map(
            (segment) => segment.index,
          )
          offsets.push(text.length)
          const at = (index: number) => {
            range.setStart(text, offsets[index])
            range.setEnd(text, offsets[index + 1])
            return range.getBoundingClientRect()
          }
          let start = 0
          for (const line of lines) {
            if (start >= offsets.length - 1) break
            let low = start,
              high = offsets.length - 1
            while (low < high) {
              const middle = Math.floor((low + high) / 2)
              if (at(middle).top <= line.top + 0.5) low = middle + 1
              else high = middle
            }
            const end = Math.max(start + 1, low)
            // Split local font subsets at their Unicode ranges, preserving native positions/kerning.
            let segmentStart = start
            const subset = (index: number) => {
              const code = text.data.codePointAt(offsets[index])!
              return code > 255 && code < 0x2000
            }
            for (let index = start + 1; index <= end; index++)
              if (index === end || subset(index) !== subset(segmentStart)) {
                range.setStart(text, offsets[segmentStart])
                range.setEnd(text, offsets[index])
                const box = rect(range.getBoundingClientRect()),
                  value = text.data
                    .slice(offsets[segmentStart], offsets[index])
                    .replace(/[\r\n\t]/g, ' ')
                    .normalize('NFC')
                const metrics = ctx.measureText(value)
                if (value && box.width)
                  add(
                    {
                      kind: 'text',
                      ...box,
                      text: value,
                      baseline: box.y + (metrics.fontBoundingBoxAscent || parseFloat(style.fontSize) * 0.85) * scale,
                      family: exportFontFamily(style.fontFamily),
                      size,
                      bold: Number(style.fontWeight) >= 600,
                      italic: style.fontStyle === 'italic',
                      color: style.color,
                      underline: style.textDecorationLine.includes('underline') || !!parent.closest('u,a'),
                      strike: style.textDecorationLine.includes('line-through') || !!parent.closest('s'),
                    },
                    pageIndex,
                  )
                segmentStart = index
              }
            start = end
          }
        }
      }
      editor.view.dom.style.visibility = 'visible'
      capture(editor.view.dom)
      if (options.includeComments) {
        const threads = new Map(readCommentThreads(resolved.attrs?.comments).map((thread) => [thread.id, thread]))
        const anchors = new Map<string, DOMRect>()
        for (const element of Array.from(editor.view.dom.querySelectorAll<HTMLElement>('[data-comment-id]'))) {
          const id = element.dataset.commentId
          if (id && threads.has(id) && !anchors.has(id)) anchors.set(id, element.getBoundingClientRect())
        }
        const occupied: number[] = Array(count).fill(0)
        const notes = [...anchors].flatMap(([id, box]) => {
          const thread = threads.get(id)
          if (!thread) return []
          const pageIndex = Math.max(0, Math.min(count - 1, Math.floor((box.top - origin.top) / pitch)))
          const anchorY = Math.max(8, box.top - origin.top - pageIndex * pitch)
          const noteWidth = Math.max(58, Math.min(108, width - body.x - body.width - 8))
          const x = width - noteWidth - 4
          ctx.font = '8px Arimo'
          const wrap = (value: string) => {
            const lines: string[] = []
            for (const paragraph of value.split(/\r?\n/)) {
              let line = ''
              for (const word of paragraph.split(/\s+/)) {
                const candidate = line ? `${line} ${word}` : word
                if (line && ctx.measureText(candidate).width > noteWidth - 8) {
                  lines.push(line)
                  line = word
                } else line = candidate
                while (ctx.measureText(line).width > noteWidth - 8 && line.length > 1) {
                  let split = line.length - 1
                  while (split > 1 && ctx.measureText(line.slice(0, split)).width > noteWidth - 8) split--
                  lines.push(line.slice(0, split))
                  line = line.slice(split)
                }
              }
              if (line) lines.push(line)
              else if (!paragraph) lines.push('')
            }
            return lines
          }
          const allText = [thread.text, ...thread.replies.map((reply) => `${reply.author}: ${reply.text}`)]
            .join('\n')
            .slice(0, 1200)
          const lines = [thread.author, ...wrap(allText)]
          if (allText.length === 1200) lines.push('…')
          const cardHeight = lines.length * 10 + 8
          const y = Math.min(Math.max(anchorY, occupied[pageIndex] + 4), height - cardHeight - 4)
          occupied[pageIndex] = y + cardHeight
          return [{ id, author: thread.author, lines, pageIndex, x, y, width: noteWidth, height: cardHeight }]
        })
        for (const note of notes) {
          add(
            { kind: 'rect', x: note.x, y: note.y, width: note.width, height: note.height, color: '#fff8dc' },
            note.pageIndex,
          )
          add({ kind: 'rect', x: note.x, y: note.y, width: note.width, height: 1, color: '#8b7740' }, note.pageIndex)
          add(
            { kind: 'rect', x: note.x, y: note.y + note.height - 1, width: note.width, height: 1, color: '#8b7740' },
            note.pageIndex,
          )
          add({ kind: 'rect', x: note.x, y: note.y, width: 1, height: note.height, color: '#8b7740' }, note.pageIndex)
          add(
            { kind: 'rect', x: note.x + note.width - 1, y: note.y, width: 1, height: note.height, color: '#8b7740' },
            note.pageIndex,
          )
          note.lines.forEach((line, index) => {
            ctx.font = index === 0 ? 'bold 8px Arimo' : '8px Arimo'
            const width = Math.min(note.width - 8, ctx.measureText(line).width)
            add(
              {
                kind: 'text',
                x: note.x + 4,
                y: note.y + 4 + index * 10,
                width,
                height: 10,
                text: line,
                baseline: note.y + 4 + index * 10 + 7,
                family: 'Arimo',
                size: 8,
                bold: index === 0,
                italic: false,
                color: '#222222',
              },
              note.pageIndex,
            )
          })
        }
      }
      const targets = referenceTargets(resolved)
      for (const element of Array.from(editor.view.dom.querySelectorAll<HTMLElement>('[id]'))) {
        const box = element.getBoundingClientRect(),
          y = box.top - origin.top,
          page = Math.min(count - 1, Math.max(0, Math.floor(y / pitch)))
        output.destinations[element.id] = { page, x: box.left - origin.left, y: y - page * pitch }
      }
      for (const target of targets)
        if (target.kind === 'heading' && output.destinations[target.id])
          output.headings.push({ ...output.destinations[target.id], title: target.label, level: target.level })
      const stories = storiesFor(setup)
      const nodes: Array<{ element: HTMLElement; kind: 'header' | 'footer'; page: number }> = []
      for (let index = 0; index < count; index++)
        for (const kind of ['header', 'footer'] as const) {
          const element = window.document.createElement('div')
          element.className = 'draft-story-content'
          element.style.cssText = `position:absolute;left:${setup.left / 15 + 1}px;top:0;width:${body.width}px;min-height:0;visibility:visible`
          element.innerHTML = renderHTMLBody({
            ...resolveStory(stories[kind][storyVariant(stories, index + 1)], stories, index + 1, count),
            attrs: { styleDefinitions: resolved.attrs?.styleDefinitions ?? null },
          })
          paper.append(element)
          nodes.push({ element, kind, page: index })
        }
      await Promise.all(
        nodes.flatMap((node) => Array.from(node.element.querySelectorAll('img'), (image) => image.decode())),
      )
      await window.document.fonts.ready
      const headerHeight = Math.max(
        0,
        ...nodes.filter((node) => node.kind === 'header').map((node) => node.element.offsetHeight),
      )
      const footerHeight = Math.max(
        0,
        ...nodes.filter((node) => node.kind === 'footer').map((node) => node.element.offsetHeight),
      )
      const bands = storyLayout(setup, headerHeight, footerHeight)
      for (const node of nodes) {
        const factor = Number(
          node.kind === 'header'
            ? paper.dataset.headerScale || bands.headerScale
            : paper.dataset.footerScale || bands.footerScale,
        )
        node.element.style.top = `${node.kind === 'header' ? setup.header / 15 : height - setup.footer / 15 - Number(paper.dataset.footerHeight || footerHeight) * factor}px`
        node.element.style.transform = `scale(${factor})`
        const bounds = paper.getBoundingClientRect()
        capture(node.element, bounds.left, bounds.top, node.page, factor)
        node.element.remove()
      }
      options.onResolved?.(resolved)
    },
    options,
  )
  return output
}
