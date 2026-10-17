import { useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { EditorContent } from '@tiptap/react'
import type { Editor } from '@tiptap/core'
import type { PageSetup } from '../engine/page-setup'
import { pagePreset } from '../engine/page-setup'
import { PAGE_GAP } from '../engine/pagination'
import { refreshPagination } from '../editor/pagination'
import { DocumentRuler } from './DocumentRuler'
import { translations } from '../i18n'
import type { Locale } from '../types'
import { pageLabels } from './PageSetupDialog'
import { clampZoom, type PageView, type PageZoom } from '../engine/page-view'
import { storiesFor, storyVariant, resolveStory, storyLayout, type StoryKind } from '../engine/stories'
import { renderHTMLBody } from '../engine/export/html'
import { storyLabels } from './StoryEditor'
import type { CommentThread } from '../engine/comments'

export function PageCanvas({
  editor,
  page,
  pages,
  zoom,
  isEink,
  locale,
  ruler,
  hyphenation,
  columns,
  view,
  onZoom,
  onCurrentPage,
  onEditStories,
  comments,
  onSelectComment,
}: {
  editor: Editor
  page: PageSetup
  pages: number
  zoom: PageZoom
  view: PageView
  onZoom: (value: PageZoom) => void
  onCurrentPage: (value: number) => void
  onEditStories: (kind: StoryKind, variant: ReturnType<typeof storyVariant>) => void
  isEink: boolean
  locale: Locale
  ruler: boolean
  hyphenation: boolean
  columns: number
  comments: CommentThread[]
  onSelectComment: (id: string) => void
}) {
  const pane = useRef<HTMLElement>(null)
  const paged = view === 'print' && columns === 1
  const measurements = useRef<HTMLDivElement>(null)
  const [storyHeights, setStoryHeights] = useState({ header: 0, footer: 0 })
  const [commentPins, setCommentPins] = useState<
    Array<{ id: string; page: number; top: number; label: number; title: string }>
  >([])
  const stories = useMemo(() => storiesFor(page), [page])
  const styleDefinitions = editor.state.doc.attrs.styleDefinitions
  const sheetHTML = useMemo(
    () =>
      Array.from({ length: pages }, (_, index) =>
        Object.fromEntries(
          (['header', 'footer'] as const).map((kind) => [
            kind,
            stories[kind][storyVariant(stories, index + 1)].some((node) => node.content?.length)
              ? renderHTMLBody({
                  ...resolveStory(stories[kind][storyVariant(stories, index + 1)], stories, index + 1, pages),
                  attrs: { styleDefinitions },
                })
              : '',
          ]),
        ),
      ),
    [stories, pages, styleDefinitions],
  )
  const storyHTML = useMemo(() => {
    const result = new Map<string, string>()
    for (const kind of ['header', 'footer'] as const)
      for (const variant of ['default', 'first', 'even'] as const)
        result.set(
          `${kind}:${variant}`,
          stories[kind][variant].some((node) => node.content?.length)
            ? renderHTMLBody({
                ...resolveStory(stories[kind][variant], stories, variant === 'even' ? 2 : 1, pages),
                attrs: { styleDefinitions },
              })
            : '',
        )
    return result
  }, [stories, pages, styleDefinitions])
  const bands = storyLayout(page, storyHeights.header, storyHeights.footer)
  useLayoutEffect(() => {
    const element = measurements.current
    if (!element) return
    const measure = () => {
      const next = { header: 0, footer: 0 }
      pane.current!.querySelectorAll<HTMLElement>('[data-story-kind]').forEach((node) => {
        const kind = node.dataset.storyKind as StoryKind
        next[kind] = Math.max(next[kind], node.offsetHeight)
      })
      setStoryHeights((previous) =>
        previous.header === next.header && previous.footer === next.footer ? previous : next,
      )
    }
    measure()
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(measure)
    pane.current!.querySelectorAll('[data-story-kind]').forEach((child) => observer.observe(child))
    return () => observer.disconnect()
  }, [page, storyHTML, paged])
  const [fit, setFit] = useState(1)
  const [webWidth, setWebWidth] = useState((page.width - page.left - page.right) / 15)
  const scale = zoom === 'fit' ? (view === 'print' ? fit : 1) : (zoom / 100) * (view === 'print' ? Math.min(1, fit) : 1)
  const interaction = useRef({
    zoom,
    fit,
    view,
    scale,
    onZoom,
    onCurrentPage,
    pages,
    height: page.height / 15,
    editor,
    paged,
  })
  const reportCurrent = useRef(() => {})
  interaction.current = {
    zoom,
    fit,
    view,
    scale,
    onZoom,
    onCurrentPage,
    pages,
    height: page.height / 15,
    editor,
    paged,
  }
  const height = page.height / 15,
    width = page.width / 15
  useLayoutEffect(() => {
    let frame = 0
    const update = () => {
      if (frame) cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => {
        frame = 0
        const paper = pane.current?.querySelector<HTMLElement>('.draft-paper')
        if (!paper || !paged) {
          setCommentPins([])
          return
        }
        const origin = paper.getBoundingClientRect().top
        const pitch = height + PAGE_GAP
        const threadMap = new Map(comments.map((thread, index) => [thread.id, { thread, label: index + 1 }]))
        const byId = new Map<string, { y: number; thread: CommentThread; label: number }>()
        editor.state.doc.descendants((node, position) => {
          if (!node.isText) return true
          for (const mark of node.marks) {
            const match = mark.type.name === 'comment' ? threadMap.get(mark.attrs.id) : undefined
            if (match && !byId.has(mark.attrs.id))
              byId.set(mark.attrs.id, {
                y: (editor.view.coordsAtPos(position).top - origin) / scale,
                thread: match.thread,
                label: match.label,
              })
          }
          return false
        })
        const occupied: number[] = Array(pages).fill(-44)
        const pins = [...byId].flatMap(([id, value]) => {
          const pageIndex = Math.max(0, Math.min(pages - 1, Math.floor(value.y / pitch)))
          const top = Math.min(height - 44, Math.max(value.y - pageIndex * pitch - 22, occupied[pageIndex] + 46))
          occupied[pageIndex] = top + 44
          return [
            { id, page: pageIndex, top, label: value.label, title: `${value.thread.author}: ${value.thread.text}` },
          ]
        })
        setCommentPins(pins)
      })
    }
    editor.on('transaction', update)
    const paneNode = pane.current
    paneNode?.addEventListener('scroll', update, { passive: true })
    window.addEventListener('resize', update)
    update()
    return () => {
      if (frame) cancelAnimationFrame(frame)
      editor.off('transaction', update)
      paneNode?.removeEventListener('scroll', update)
      window.removeEventListener('resize', update)
    }
  }, [editor, comments, pages, height, scale, paged])
  useLayoutEffect(() => {
    const element = pane.current!
    const resize = () => {
      const css = getComputedStyle(element)
      const available =
        element.clientWidth - (Number.parseFloat(css.paddingLeft) || 0) - (Number.parseFloat(css.paddingRight) || 0)
      setFit(Math.max(0.1, available / width))
      const paper = element.querySelector<HTMLElement>('.draft-paper')
      if (view === 'web' && paper?.clientWidth) {
        const paperCSS = getComputedStyle(paper)
        setWebWidth(
          paper.clientWidth -
            (Number.parseFloat(paperCSS.paddingLeft) || 0) -
            (Number.parseFloat(paperCSS.paddingRight) || 0),
        )
      }
    }
    resize()
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(resize)
    observer.observe(element)
    const paper = element.querySelector('.draft-paper')
    if (paper) observer.observe(paper)
    return () => observer.disconnect()
  }, [width, view, scale])
  useLayoutEffect(() => {
    refreshPagination(editor)
  }, [editor, page, zoom, fit, hyphenation, columns, view, bands.top, bands.bottom])
  useLayoutEffect(() => {
    const element = pane.current!
    let frame = 0,
      zoomFrame = 0,
      gesture: { distance: number; zoom: number; x: number; y: number } | undefined
    const report = (selection = false) => {
      if (!editor.isInitialized) return
      const value = interaction.current
      if (!value.paged) return
      const paper = element.querySelector('.draft-paper')?.getBoundingClientRect()
      if (!paper) return
      const bounds = element.getBoundingClientRect()
      const point = selection
        ? value.editor.view.coordsAtPos(value.editor.state.selection.head).top
        : bounds.top + Math.min(bounds.height / 2, 100)
      value.onCurrentPage(
        Math.max(
          1,
          Math.min(value.pages, Math.floor((point - paper.top) / value.scale / (value.height + PAGE_GAP)) + 1),
        ),
      )
    }
    const scroll = () => {
      if (!frame)
        frame = requestAnimationFrame(() => {
          frame = 0
          report()
        })
    }
    const selection = () => report(true)
    const transaction = () => {
      if (editor.isInitialized && editor.view.hasFocus()) report(true)
    }
    reportCurrent.current = () => {
      if (editor.isInitialized) report(editor.view.hasFocus())
    }
    const distance = (event: TouchEvent) =>
      Math.hypot(
        event.touches[0].clientX - event.touches[1].clientX,
        event.touches[0].clientY - event.touches[1].clientY,
      )
    const start = (event: TouchEvent) => {
      if (event.touches.length !== 2) return
      event.preventDefault()
      const value = interaction.current,
        bounds = element.getBoundingClientRect()
      const x = (event.touches[0].clientX + event.touches[1].clientX) / 2 - bounds.left
      const y = (event.touches[0].clientY + event.touches[1].clientY) / 2 - bounds.top
      const base = value.view === 'print' ? Math.min(1, value.fit) : 1
      gesture = {
        distance: Math.max(1, distance(event)),
        zoom: (value.scale / base) * 100,
        x: (element.scrollLeft + x) / value.scale,
        y: (element.scrollTop + y) / value.scale,
      }
    }
    const move = (event: TouchEvent) => {
      if (!gesture || event.touches.length !== 2) return
      event.preventDefault()
      const value = interaction.current,
        bounds = element.getBoundingClientRect()
      const next = clampZoom((gesture.zoom * distance(event)) / gesture.distance)
      value.onZoom(next)
      const base = value.view === 'print' ? Math.min(1, value.fit) : 1
      const point = gesture
      if (zoomFrame) cancelAnimationFrame(zoomFrame)
      zoomFrame = requestAnimationFrame(() => {
        zoomFrame = 0
        if (!element.isConnected) return
        element.scrollLeft =
          ((point.x * next) / 100) * base - (event.touches[0].clientX + event.touches[1].clientX) / 2 + bounds.left
        element.scrollTop =
          ((point.y * next) / 100) * base - (event.touches[0].clientY + event.touches[1].clientY) / 2 + bounds.top
      })
    }
    const end = () => {
      gesture = undefined
    }
    element.addEventListener('scroll', scroll, { passive: true })
    element.addEventListener('touchstart', start, { passive: false })
    element.addEventListener('touchmove', move, { passive: false })
    element.addEventListener('touchend', end)
    element.addEventListener('touchcancel', end)
    editor.on('selectionUpdate', selection)
    editor.on('transaction', transaction)
    report()
    return () => {
      if (frame) cancelAnimationFrame(frame)
      if (zoomFrame) cancelAnimationFrame(zoomFrame)
      reportCurrent.current = () => {}
      element.removeEventListener('scroll', scroll)
      element.removeEventListener('touchstart', start)
      element.removeEventListener('touchmove', move)
      element.removeEventListener('touchend', end)
      element.removeEventListener('touchcancel', end)
      editor.off('selectionUpdate', selection)
      editor.off('transaction', transaction)
    }
  }, [editor])
  useLayoutEffect(() => {
    reportCurrent.current()
  }, [pages, scale, view, page])
  return (
    <section ref={pane} className="draft-document-area" aria-label={translations[locale].document}>
      {columns > 1 && view === 'print' && (
        <p className="draft-pagination-notice" role="note">
          {pageLabels[locale].columnsHint}
        </p>
      )}
      <div
        className={`draft-page draft-page--${pagePreset(page)} draft-page--${page.orientation}${view === 'web' ? ' draft-page--web' : ''}`}
        style={
          {
            zoom: scale,
            '--draft-page-scale': scale,
            '--draft-page-width': `${width}px`,
            '--draft-page-height': `${height}px`,
            '--draft-margin-top': `${bands.top}px`,
            '--draft-margin-right': `${page.right / 15}px`,
            '--draft-margin-bottom': `${bands.bottom}px`,
            '--draft-margin-left': `${page.left / 15}px`,
            '--draft-body-height': view === 'web' ? '100000px' : `${height - bands.top - bands.bottom - 2}px`,
            '--draft-pages-height': `${pages * height + (pages - 1) * PAGE_GAP}px`,
          } as CSSProperties
        }
      >
        <div
          ref={measurements}
          className="draft-story-measurements"
          aria-hidden="true"
          style={{ width: (page.width - page.left - page.right) / 15 }}
        >
          {(['header', 'footer'] as const).flatMap((kind) =>
            ['default', ...(stories.differentFirst ? ['first'] : []), ...(stories.differentEven ? ['even'] : [])].map(
              (variant) => (
                <div
                  className="draft-story-content"
                  data-story-kind={kind}
                  key={`${kind}:${variant}`}
                  dangerouslySetInnerHTML={{ __html: storyHTML.get(`${kind}:${variant}`)! }}
                />
              ),
            ),
          )}
        </div>
        {ruler && (
          <DocumentRuler
            editor={editor}
            locale={locale}
            widthPt={view === 'web' ? webWidth * 0.75 : (page.width - page.left - page.right) / 20}
          />
        )}
        <div
          className={`draft-paper${paged ? ' draft-paper--paged' : ''}${hyphenation ? ' draft-paper--hyphenate' : ''}`}
          data-theme={isEink ? undefined : 'light'}
          style={{ '--draft-columns': columns } as CSSProperties}
        >
          {paged && (
            <div className="draft-page-backgrounds" aria-hidden="true">
              {Array.from({ length: pages }, (_, index) => (
                <div
                  className="draft-sheet"
                  key={index}
                  data-page-number={index + 1}
                  style={{ top: index * (height + PAGE_GAP), height }}
                />
              ))}
            </div>
          )}
          <EditorContent editor={editor} />
          {paged && (
            <div className="draft-page-margins">
              {Array.from({ length: pages }, (_, index) => (
                <div key={index} className="draft-page-bands" style={{ top: index * (height + PAGE_GAP), height }}>
                  <div
                    className="draft-page-band draft-page-band--top"
                    style={{ height: `calc(${bands.top}px + 1px - var(--draft-sheet-border, 1px))` }}
                  >
                    <button
                      type="button"
                      className="draft-story-region"
                      aria-label={`${storyLabels[locale].edit} — ${storyLabels[locale].header} ${index + 1}`}
                      onClick={(event) => {
                        event.preventDefault()
                        onEditStories('header', storyVariant(stories, index + 1))
                      }}
                      style={{
                        top: Math.max(0, page.header / 15 - Math.max(0, 44 - storyHeights.header * bands.headerScale)),
                        height: Math.max(44, storyHeights.header * bands.headerScale),
                      }}
                    >
                      <div
                        data-story-kind="header"
                        aria-hidden="true"
                        className="draft-story-content"
                        style={{
                          transform: `scale(${bands.headerScale})`,
                          width: '100%',
                          top: Math.min(page.header / 15, Math.max(0, 44 - storyHeights.header * bands.headerScale)),
                        }}
                        dangerouslySetInnerHTML={{ __html: sheetHTML[index].header }}
                      />
                    </button>
                  </div>
                  <div
                    className="draft-page-band draft-page-band--bottom"
                    style={{ height: `calc(${bands.bottom}px + 1px - var(--draft-sheet-border, 1px))` }}
                  >
                    <button
                      type="button"
                      className="draft-story-region draft-story-region--footer"
                      aria-label={`${storyLabels[locale].edit} — ${storyLabels[locale].footer} ${index + 1}`}
                      onClick={(event) => {
                        event.preventDefault()
                        onEditStories('footer', storyVariant(stories, index + 1))
                      }}
                      style={{
                        bottom: Math.max(
                          0,
                          page.footer / 15 - Math.max(0, 44 - storyHeights.footer * bands.footerScale),
                        ),
                        height: Math.max(44, storyHeights.footer * bands.footerScale),
                      }}
                    >
                      <div
                        data-story-kind="footer"
                        aria-hidden="true"
                        className="draft-story-content"
                        style={{
                          transform: `scale(${bands.footerScale})`,
                          width: '100%',
                          top: 0,
                        }}
                        dangerouslySetInnerHTML={{ __html: sheetHTML[index].footer }}
                      />
                    </button>
                  </div>
                  {index < pages - 1 && (
                    <div className="draft-page-gutter" style={{ top: height - 1, height: PAGE_GAP + 2 }} />
                  )}
                  {commentPins
                    .filter((pin) => pin.page === index)
                    .map((pin) => (
                      <button
                        type="button"
                        className="draft-comment-pin"
                        key={pin.id}
                        style={{ top: pin.top }}
                        title={pin.title}
                        aria-label={`${translations[locale].goToComment}: ${pin.title}`}
                        onClick={() => onSelectComment(pin.id)}
                      >
                        {pin.label}
                      </button>
                    ))}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </section>
  )
}
