import { Editor } from '@tiptap/core'
import type { DraftDocument } from '../engine/document-model'
import { referenceTargets, updateReferenceFields, type ReferencePages } from '../engine/references'
import { editorExtensions } from '../editor/extensions'
import { refreshPagination } from '../editor/pagination'
import { readPageSetup } from '../engine/page-setup'
import { formatPage, storiesFor, resolveStory, storyVariant, storyLayout } from '../engine/stories'
import { renderHTMLBody } from '../engine/export/html'
import { loadDocumentFonts } from '../engine/fonts'
import { PAGE_GAP } from '../engine/pagination'

export function hasReferenceFields(document: DraftDocument): boolean {
  return document.content.some(function visit(node): boolean {
    return node.type === 'tableOfContents' || node.type === 'crossReference' || !!node.content?.some(visit)
  })
}

/** An isolated print-width editor resolves fields without moving the live caret or mutating its history. */
export async function prepareReferenceExport(
  input: DraftDocument,
  signal?: AbortSignal,
  requirePagination = false,
  consume?: (editor: Editor, paper: HTMLElement, pages: number, document: DraftDocument) => void | Promise<void>,
  options: { hyphenation?: boolean } = {},
): Promise<DraftDocument> {
  let result = updateReferenceFields(input)
  if (!hasReferenceFields(result) && !consume) return result
  if (Number(input.attrs?.columns || 1) !== 1) {
    if (requirePagination) throw new Error('Reference page layout requires one column')
    // Preserve existing multi-column exports until the ADR's column fragmentation exists.
    return result
  }
  const abort = () => {
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError')
  }
  abort()
  await loadDocumentFonts(result)
  await document.fonts.ready
  abort()
  const setup = readPageSetup(input),
    stories = storiesFor(setup)
  const root = document.createElement('div')
  root.className = 'draft-app draft-reference-measure'
  root.setAttribute('data-theme', 'light')
  root.setAttribute('aria-hidden', 'true')
  root.inert = true
  root.style.cssText = `position:fixed;left:-100000px;top:0;width:${setup.width / 15}px;visibility:hidden;pointer-events:none`
  const area = document.createElement('div'),
    page = document.createElement('div'),
    paper = document.createElement('div'),
    target = document.createElement('div'),
    bands = document.createElement('div')
  area.className = 'draft-document-area'
  page.className = 'draft-page'
  paper.className = 'draft-paper draft-paper--paged' + (options.hyphenation ? ' draft-paper--hyphenate' : '')
  page.style.cssText = `width:${setup.width / 15}px;zoom:1;--draft-page-width:${setup.width / 15}px;--draft-page-height:${setup.height / 15}px;--draft-margin-left:${setup.left / 15}px;--draft-margin-right:${setup.right / 15}px`
  bands.style.width = `${(setup.width - setup.left - setup.right) / 15}px`
  page.append(bands, paper)
  paper.append(target)
  area.append(page)
  root.append(area)
  document.body.append(root)
  let editor: Editor | undefined,
    pages = 1
  const frame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
  const reserve = () => {
    let header = 0,
      footer = 0
    bands.replaceChildren()
    for (const kind of ['header', 'footer'] as const)
      for (const [nodes, index] of [
        [stories[kind].default, 1],
        ...(stories.differentFirst ? [[stories[kind].first, 1]] : []),
        ...(stories.differentEven ? [[stories[kind].even, 2]] : []),
        ...Array.from({ length: pages }, (_, n) => [stories[kind][storyVariant(stories, n + 1)], n + 1]),
      ] as Array<[typeof stories.header.default, number]>) {
        if (!nodes.some((node) => node.content?.length)) continue
        const band = document.createElement('div')
        band.className = 'draft-story-content'
        band.innerHTML = renderHTMLBody({
          ...resolveStory(nodes, stories, index, pages),
          attrs: { styleDefinitions: input.attrs?.styleDefinitions ?? null },
        })
        bands.append(band)
        if (kind === 'header') header = Math.max(header, band.offsetHeight)
        else footer = Math.max(footer, band.offsetHeight)
      }
    const geometry = storyLayout(setup, header, footer)
    paper.dataset.headerScale = String(geometry.headerScale)
    paper.dataset.footerScale = String(geometry.footerScale)
    paper.dataset.footerHeight = String(footer)
    page.style.setProperty('--draft-margin-top', `${geometry.top}px`)
    page.style.setProperty('--draft-margin-bottom', `${geometry.bottom}px`)
    page.style.setProperty('--draft-body-height', `${setup.height / 15 - geometry.top - geometry.bottom - 2}px`)
    page.style.setProperty('--draft-pages-height', `${(pages * setup.height) / 15 + (pages - 1) * PAGE_GAP}px`)
  }
  try {
    reserve()
    editor = new Editor({
      element: target,
      extensions: editorExtensions({
        measurement: true,
        requestPlainPaste: () => {},
        requestLink: () => {},
        onPages: (count) => {
          pages = count
        },
      }),
      content: result,
      editable: false,
      editorProps: { attributes: { class: 'draft-reference-content' } },
    })
    const computed = getComputedStyle(editor.view.dom)
    editor.view.dom.style.fontVariantLigatures = computed.fontVariantLigatures
    editor.view.dom.style.fontFeatureSettings = computed.fontFeatureSettings
    editor.view.dom.style.position = computed.position
    editor.view.dom.classList.remove('tiptap')
    for (let pass = 0; pass < 12; pass++) {
      abort()
      const reservedPages = pages
      reserve()
      await Promise.all(Array.from(root.querySelectorAll('img'), (image) => image.decode().catch(() => {})))
      await document.fonts.ready
      refreshPagination(editor)
      await frame()
      await frame()
      await frame()
      abort()
      const pagesFor: ReferencePages = {},
        wanted = new Set(referenceTargets(result).map((target) => target.id))
      const origin = editor.view.dom.getBoundingClientRect().top,
        pitch = setup.height / 15 + PAGE_GAP
      editor.state.doc.descendants((node, pos) => {
        const id =
          node.type.name === 'bookmark' || node.type.name === 'noteReference' ? node.attrs.id : node.attrs.anchorId
        if (wanted.has(id) && pagesFor[id] === undefined) {
          const y =
            editor!.view.coordsAtPos(pos + (node.isTextblock || node.type.name === 'bookmark' ? 1 : 0), 1).top - origin
          const physical = Math.max(1, Math.floor((y + 0.5) / pitch) + 1)
          pagesFor[id] = formatPage(stories.start + physical - 1, stories.format)
        }
        return node.type.name !== 'tableOfContents' && node.type.name !== 'note'
      })
      const next = updateReferenceFields(result, pagesFor)
      const unchanged = JSON.stringify(next) === JSON.stringify(result)
      if (unchanged && reservedPages === pages) {
        await consume?.(editor, paper, pages, next)
        return next
      }
      result = next
      if (!unchanged) {
        editor.commands.setContent(result)
        editor.view.dom.classList.remove('tiptap')
      }
    }
    throw new Error('Reference pagination did not stabilize')
  } finally {
    editor?.destroy()
    root.remove()
  }
}
