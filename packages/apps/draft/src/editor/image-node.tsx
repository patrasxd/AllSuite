import { Node, mergeAttributes, type Editor } from '@tiptap/core'
import { Fragment, Slice } from '@tiptap/pm/model'
import { NodeSelection } from '@tiptap/pm/state'
import { dropPoint } from '@tiptap/pm/transform'
import { NodeViewWrapper, ReactNodeViewRenderer, type NodeViewProps } from '@tiptap/react'
import { createPortal } from 'react-dom'
import { Button, Input, Select, TrashIcon } from '@all/ui'
import { useLayoutEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { safeImageSource, type ImageAttributes } from '../engine/images'
import { DraftIcon } from '../components/DraftIcons'
import { imageLabels } from '../components/image-labels'

export function resizedImage(width: number, height: number, nextWidth: number, nextHeight: number, free = false) {
  let w = Math.max(16, Math.min(16384, Math.round(nextWidth)))
  if (free) return { width: w, height: Math.max(16, Math.min(16384, Math.round(nextHeight))) }
  let h = Math.max(1, Math.round((w * height) / width))
  if (h > 16384) {
    h = 16384
    w = Math.max(1, Math.round((h * width) / height))
  }
  return { width: w, height: h }
}

const imageLayoutModes = {
  inline: { alignment: 'inline', wrap: 'inline' },
  left: { alignment: 'left', wrap: 'inline' },
  center: { alignment: 'center', wrap: 'inline' },
  right: { alignment: 'right', wrap: 'inline' },
  'square-left': { alignment: 'left', wrap: 'square-left' },
  'square-right': { alignment: 'right', wrap: 'square-right' },
  'top-bottom': { alignment: 'inline', wrap: 'top-bottom' },
} as const
type ImageLayout = keyof typeof imageLayoutModes
type ImageResizeHandle = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w'

export const imageBoxStyle = (attrs: Pick<ImageAttributes, 'width' | 'height'>) => ({
  width: `${attrs.width}px`,
  maxWidth: `min(100%, calc((var(--draft-body-height, 100000px) - 24px) * ${attrs.width / attrs.height}))`,
})
/** Identical geometry for an isolated core Editor without React portals or editing controls. */
export function measuredImageDOM(attrs: ImageAttributes) {
  const dom = document.createElement('span'),
    image = document.createElement('img')
  dom.className = 'draft-image'
  dom.dataset.alignment = attrs.alignment
  dom.dataset.wrap = attrs.wrap
  Object.assign(dom.style, imageBoxStyle(attrs))
  image.src = attrs.src
  image.alt = attrs.alt || ''
  image.width = attrs.width
  image.height = attrs.height
  image.style.cssText = `width:100%;height:auto;aspect-ratio:${attrs.width} / ${attrs.height}`
  dom.append(image)
  return dom
}
export function updateImageAttributes(editor: Editor, attrs: Record<string, unknown>, position?: number) {
  const selection = editor.state.selection
  const pos = position ?? (selection instanceof NodeSelection ? selection.from : undefined)
  if (pos === undefined || editor.state.doc.nodeAt(pos)?.type.name !== 'image') return false
  const node = editor.state.doc.nodeAt(pos)!
  const tr = editor.state.tr.setNodeMarkup(pos, undefined, { ...node.attrs, ...attrs })
  tr.setSelection(NodeSelection.create(tr.doc, pos))
  editor.view.dispatch(tr)
  return true
}

export function moveImage(editor: Editor, from: number, to: number) {
  const image = editor.state.doc.nodeAt(from)
  if (!image || image.type.name !== 'image' || (to >= from && to <= from + image.nodeSize)) return false

  const transaction = editor.state.tr.delete(from, from + image.nodeSize)
  const mappedTarget = transaction.mapping.map(to, to < from ? -1 : 1)
  const position = dropPoint(transaction.doc, mappedTarget, new Slice(Fragment.from(image), 0, 0))
  if (position === null || position === from) return false

  transaction.insert(position, image)
  transaction.setSelection(NodeSelection.create(transaction.doc, position))
  editor.view.dispatch(transaction.scrollIntoView())
  return true
}

function ImageView({ node, selected, editor, getPos, extension }: NodeViewProps) {
  const [preview, setPreview] = useState<{ width: number; height: number }>()
  const [movePreview, setMovePreview] = useState<{ x: number; y: number }>()
  const toolbarRef = useRef<HTMLDivElement>(null)
  const scheduleToolbarPosition = useRef<() => void>(() => {})
  const move = useRef<{ pointerId: number; from: number; x: number; y: number; moved: boolean }>()
  const resizeListeners = useRef<{
    move: (event: PointerEvent) => void
    up: (event: PointerEvent) => void
    cancel: (event: PointerEvent) => void
  }>()
  const drag = useRef<{
    pointerId: number
    x: number
    y: number
    width: number
    height: number
    scale: number
    handle: ImageResizeHandle
    next?: { width: number; height: number }
  }>()
  const attrs = { ...(node.attrs as ImageAttributes), ...preview }
  const locale = extension.options.getLocale() === 'pl' ? 'pl' : 'en'
  const t = imageLabels[locale]
  const pl = locale === 'pl'
  const layout = (
    attrs.wrap === 'square-left' || attrs.wrap === 'square-right' || attrs.wrap === 'top-bottom'
      ? attrs.wrap
      : attrs.alignment
  ) as ImageLayout
  const handleLabels = pl
    ? {
        nw: 'lewy górny róg',
        n: 'górna krawędź',
        ne: 'prawy górny róg',
        e: 'prawa krawędź',
        se: 'prawy dolny róg',
        s: 'dolna krawędź',
        sw: 'lewy dolny róg',
        w: 'lewa krawędź',
      }
    : {
        nw: 'top left corner',
        n: 'top edge',
        ne: 'top right corner',
        e: 'right edge',
        se: 'bottom right corner',
        s: 'bottom edge',
        sw: 'bottom left corner',
        w: 'left edge',
      }

  useLayoutEffect(
    () => () => {
      const listeners = resizeListeners.current
      if (!listeners) return
      window.removeEventListener('pointermove', listeners.move, true)
      window.removeEventListener('pointerup', listeners.up, true)
      window.removeEventListener('pointercancel', listeners.cancel, true)
      resizeListeners.current = undefined
    },
    [],
  )

  useLayoutEffect(() => {
    if (!selected) return

    let frame = 0
    const positionToolbar = () => {
      frame = 0
      const position = getPos()
      if (typeof position !== 'number') return
      const anchor = editor.view.nodeDOM(position)
      if (!(anchor instanceof HTMLElement)) return
      const area = anchor.closest<HTMLElement>('.draft-document-area')
      const toolbar = toolbarRef.current
      if (!area || !toolbar) return

      const areaRect = area.getBoundingClientRect()
      const imageRect = anchor.getBoundingClientRect()
      if (imageRect.bottom < areaRect.top || imageRect.top > areaRect.bottom) {
        toolbar.classList.add('draft-image-tools--hidden')
        return
      }

      const maxWidth = Math.max(0, areaRect.width - 24)
      toolbar.style.maxWidth = `${maxWidth}px`
      const toolbarRect = toolbar.getBoundingClientRect()
      const leftMin = areaRect.left + 12
      const leftMax = Math.max(leftMin, areaRect.right - toolbarRect.width - 12)
      const topMin = Math.max(8, areaRect.top + 8)
      const topMax = Math.min(window.innerHeight - 8, areaRect.bottom - 8)
      const roomAbove = imageRect.top - topMin
      const roomBelow = topMax - imageRect.bottom
      const flipped = roomAbove < toolbarRect.height + 8 && roomBelow > roomAbove
      const desiredTop = flipped ? imageRect.bottom + 8 : imageRect.top - toolbarRect.height - 8
      const top = Math.max(topMin, Math.min(desiredTop, Math.max(topMin, topMax - toolbarRect.height)))
      const left = Math.max(leftMin, Math.min(imageRect.left, leftMax))
      toolbar.style.left = `${left}px`
      toolbar.style.top = `${top}px`
      toolbar.style.maxWidth = `${maxWidth}px`
      toolbar.classList.remove('draft-image-tools--hidden')
    }
    const schedulePosition = () => {
      if (frame) cancelAnimationFrame(frame)
      frame = requestAnimationFrame(positionToolbar)
    }
    scheduleToolbarPosition.current = schedulePosition

    positionToolbar()
    const position = getPos()
    const anchor = typeof position === 'number' ? editor.view.nodeDOM(position) : null
    const area = editor.view.dom.closest<HTMLElement>('.draft-document-area')
    const toolbar = toolbarRef.current
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(schedulePosition)
    if (anchor instanceof HTMLElement) observer?.observe(anchor)
    if (area) observer?.observe(area)
    if (toolbar) observer?.observe(toolbar)

    window.addEventListener('scroll', schedulePosition, true)
    window.addEventListener('resize', schedulePosition)
    editor.on('transaction', schedulePosition)
    editor.on('selectionUpdate', schedulePosition)
    return () => {
      if (frame) cancelAnimationFrame(frame)
      observer?.disconnect()
      scheduleToolbarPosition.current = () => {}
      window.removeEventListener('scroll', schedulePosition, true)
      window.removeEventListener('resize', schedulePosition)
      editor.off('transaction', schedulePosition)
      editor.off('selectionUpdate', schedulePosition)
    }
  }, [editor, getPos, locale, selected])

  const update = (changes: Record<string, unknown>) => {
    const position = getPos()
    if (typeof position === 'number') updateImageAttributes(editor, changes, position)
  }
  const clearResizeListeners = () => {
    const listeners = resizeListeners.current
    if (!listeners) return
    window.removeEventListener('pointermove', listeners.move, true)
    window.removeEventListener('pointerup', listeners.up, true)
    window.removeEventListener('pointercancel', listeners.cancel, true)
    resizeListeners.current = undefined
  }
  const moveResize = (event: PointerEvent) => {
    const start = drag.current
    if (!start || start.pointerId !== event.pointerId) return
    event.preventDefault()
    event.stopPropagation()
    const dx = (event.clientX - start.x) * start.scale
    const dy = (event.clientY - start.y) * start.scale
    const isCorner = ['nw', 'ne', 'sw', 'se'].includes(start.handle)
    let nextWidth = start.width
    let nextHeight = start.height

    if (isCorner) {
      const widthDelta = dx * (start.handle.endsWith('w') ? -1 : 1)
      const heightDelta = dy * (start.handle.startsWith('n') ? -1 : 1)
      if (event.shiftKey) {
        nextWidth = start.width + widthDelta
        nextHeight = start.height + heightDelta
      } else {
        const aspect = start.width / start.height
        if (Math.abs(widthDelta) >= Math.abs(heightDelta * aspect)) {
          nextWidth = start.width + widthDelta
          nextHeight = nextWidth / aspect
        } else {
          nextHeight = start.height + heightDelta
          nextWidth = nextHeight * aspect
        }
      }
    } else if (start.handle === 'e' || start.handle === 'w') {
      nextWidth = start.width + dx * (start.handle === 'w' ? -1 : 1)
    } else {
      nextHeight = start.height + dy * (start.handle === 'n' ? -1 : 1)
    }

    const next = resizedImage(start.width, start.height, nextWidth, nextHeight, event.shiftKey || !isCorner)
    start.next = next
    setPreview(next)
  }
  const finishResize = (event: PointerEvent) => {
    const start = drag.current
    if (!start || start.pointerId !== event.pointerId) return
    event.preventDefault()
    event.stopPropagation()
    clearResizeListeners()
    drag.current = undefined
    if (start.next) updateImageAttributes(editor, start.next, getPos())
    setPreview(undefined)
  }
  const cancelResize = (event: PointerEvent) => {
    if (drag.current?.pointerId !== event.pointerId) return
    clearResizeListeners()
    drag.current = undefined
    setPreview(undefined)
  }
  const beginResize = (event: ReactPointerEvent<HTMLButtonElement>, handle: ImageResizeHandle) => {
    if (!event.isPrimary || event.button !== 0) return
    event.preventDefault()
    event.stopPropagation()
    clearResizeListeners()
    const container = event.currentTarget.closest('.draft-image')!.getBoundingClientRect()
    drag.current = {
      pointerId: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      width: node.attrs.width,
      height: node.attrs.height,
      scale: node.attrs.width / Math.max(1, container.width),
      handle,
    }
    event.currentTarget.setPointerCapture(event.pointerId)
    const listeners = { move: moveResize, up: finishResize, cancel: cancelResize }
    resizeListeners.current = listeners
    window.addEventListener('pointermove', listeners.move, true)
    window.addEventListener('pointerup', listeners.up, true)
    window.addEventListener('pointercancel', listeners.cancel, true)
  }
  const toolbarHost = editor.view.dom.closest('.draft-document-area')

  return (
    <NodeViewWrapper
      as="span"
      className={`draft-image${selected ? ' draft-image--selected' : ''}${movePreview ? ' draft-image--moving' : ''}`}
      data-alignment={attrs.alignment}
      data-wrap={attrs.wrap}
      style={{
        ...imageBoxStyle(attrs),
        transform: movePreview ? `translate3d(${movePreview.x}px, ${movePreview.y}px, 0)` : undefined,
      }}
    >
      <img
        src={attrs.src}
        alt={attrs.alt || ''}
        title={pl ? 'Przeciągnij obraz, aby go przenieść' : 'Drag image to move it'}
        width={attrs.width}
        height={attrs.height}
        draggable={false}
        style={{
          width: '100%',
          height: 'auto',
          aspectRatio: `${attrs.width} / ${attrs.height}`,
          touchAction: selected ? 'none' : 'pan-y',
        }}
        onPointerDown={(event) => {
          if (!event.isPrimary || event.button !== 0) return
          const position = getPos()
          if (typeof position !== 'number') return
          event.preventDefault()
          editor.commands.setNodeSelection(position)
          editor.view.focus()
          move.current = {
            pointerId: event.pointerId,
            from: position,
            x: event.clientX,
            y: event.clientY,
            moved: false,
          }
          event.currentTarget.setPointerCapture(event.pointerId)
        }}
        onPointerMove={(event) => {
          const start = move.current
          if (!start || start.pointerId !== event.pointerId) return
          const x = event.clientX - start.x
          const y = event.clientY - start.y
          if (!start.moved && Math.hypot(x, y) < 4) return
          start.moved = true
          setMovePreview({ x, y })
          scheduleToolbarPosition.current()
        }}
        onPointerUp={(event) => {
          const start = move.current
          if (!start || start.pointerId !== event.pointerId) return
          move.current = undefined
          if (event.currentTarget.hasPointerCapture(event.pointerId))
            event.currentTarget.releasePointerCapture(event.pointerId)
          setMovePreview(undefined)
          if (start.moved) {
            const target = editor.view.posAtCoords({ left: event.clientX, top: event.clientY })
            if (target) moveImage(editor, start.from, target.pos)
          }
        }}
        onPointerCancel={(event) => {
          if (move.current?.pointerId !== event.pointerId) return
          move.current = undefined
          setMovePreview(undefined)
        }}
      />
      {selected && (
        <span className="draft-image-actions" contentEditable={false}>
          {(['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'] as const).map((handle) => (
            <button
              key={handle}
              type="button"
              className={`draft-image-handle draft-image-handle--${handle}`}
              aria-label={`${pl ? 'Zmień rozmiar obrazu' : 'Resize image'}: ${handleLabels[handle]}`}
              onPointerDown={(event) => beginResize(event, handle)}
            />
          ))}
        </span>
      )}
      {selected &&
        toolbarHost &&
        createPortal(
          <div
            ref={toolbarRef}
            role="toolbar"
            aria-label={t.tools}
            className="draft-image-tools draft-image-tools--hidden"
            onClick={(event) => event.stopPropagation()}
            onPointerDown={(event) => event.stopPropagation()}
            onKeyDown={(event) => event.stopPropagation()}
          >
            <Button
              size="sm"
              variant="outline"
              icon={<DraftIcon name="alt" />}
              onClick={() => extension.options.onEdit()}
            >
              {t.alt}
            </Button>
            <Select
              aria-label={t.layout}
              density="compact"
              value={layout}
              options={[
                { value: 'inline', label: t.inline },
                { value: 'left', label: t.alignLeft },
                { value: 'center', label: t.center },
                { value: 'right', label: t.alignRight },
                { value: 'square-left', label: t.squareLeft },
                { value: 'square-right', label: t.squareRight },
                { value: 'top-bottom', label: t.topBottom },
              ]}
              onChange={(event) => update(imageLayoutModes[event.target.value as ImageLayout])}
            />
            <Input
              type="number"
              aria-label={t.width}
              density="compact"
              min={16}
              max={16384}
              value={attrs.width}
              onChange={(event) => {
                const width = Math.max(16, Math.min(16384, Number(event.target.value) || 16))
                update({ width, height: Math.max(16, Math.round((width * attrs.height) / attrs.width)) })
              }}
            />
            <Input
              type="number"
              aria-label={t.height}
              density="compact"
              min={16}
              max={16384}
              value={attrs.height}
              onChange={(event) => {
                const height = Math.max(16, Math.min(16384, Number(event.target.value) || 16))
                update({ height, width: Math.max(16, Math.round((height * attrs.width) / attrs.height)) })
              }}
            />
            <Button
              size="sm"
              variant="outline"
              icon={<TrashIcon />}
              onClick={() => {
                const position = getPos()
                if (typeof position === 'number') {
                  editor
                    .chain()
                    .focus()
                    .deleteRange({ from: position, to: position + node.nodeSize })
                    .run()
                }
              }}
            >
              {t.remove}
            </Button>
          </div>,
          toolbarHost,
        )}
    </NodeViewWrapper>
  )
}

export const DraftImage = Node.create<{ getLocale: () => string; onEdit: () => void }>({
  name: 'image',
  inline: true,
  group: 'inline',
  atom: true,
  draggable: true,
  addOptions() {
    return { getLocale: () => 'en', onEdit: () => {} }
  },
  addAttributes() {
    return {
      src: { default: '', parseHTML: (element) => safeImageSource(element.getAttribute('src') || '') },
      alt: { default: '', parseHTML: (element) => element.getAttribute('alt') || '' },
      width: {
        default: 300,
        parseHTML: (element) => Math.max(1, Math.min(16384, Number(element.getAttribute('width')) || 300)),
      },
      height: {
        default: 150,
        parseHTML: (element) => Math.max(1, Math.min(16384, Number(element.getAttribute('height')) || 150)),
      },
      alignment: {
        default: 'inline',
        parseHTML: (element) =>
          ['inline', 'left', 'center', 'right'].includes(element.dataset.alignment || '')
            ? element.dataset.alignment
            : 'inline',
        renderHTML: ({ alignment }) => ({ 'data-alignment': alignment }),
      },
      wrap: {
        default: 'inline',
        parseHTML: (element) =>
          ['inline', 'square-left', 'square-right', 'top-bottom'].includes(element.dataset.wrap || '')
            ? element.dataset.wrap
            : 'inline',
        renderHTML: ({ wrap }) => ({ 'data-wrap': wrap }),
      },
      fallbackSrc: {
        default: null,
        parseHTML: (element) => safeImageSource(element.getAttribute('data-fallback-src') || ''),
        renderHTML: ({ fallbackSrc }) => (fallbackSrc ? { 'data-fallback-src': fallbackSrc } : {}),
      },
    }
  },
  parseHTML() {
    return [
      {
        tag: 'img[src]',
        getAttrs: (element) => (safeImageSource((element as HTMLElement).getAttribute('src') || '') ? {} : false),
      },
    ]
  },
  renderHTML({ HTMLAttributes }) {
    return ['img', mergeAttributes(HTMLAttributes)]
  },
  addNodeView() {
    return ReactNodeViewRenderer(ImageView)
  },
  addKeyboardShortcuts() {
    const resize = (dx: number, dy: number) => {
      const selection = this.editor.state.selection
      if (!(selection instanceof NodeSelection) || selection.node.type.name !== 'image') return false
      const { width, height } = selection.node.attrs
      const nextWidth = dx ? width + dx : width + (dy * width) / height
      return updateImageAttributes(this.editor, resizedImage(width, height, nextWidth, height + dy))
    }
    return {
      'Mod-Alt-a': () => {
        if (!this.editor.isActive('image')) return false
        this.options.onEdit()
        return true
      },
      'Alt-ArrowRight': () => resize(1, 0),
      'Alt-ArrowLeft': () => resize(-1, 0),
      'Alt-ArrowUp': () => resize(0, -1),
      'Alt-ArrowDown': () => resize(0, 1),
      'Alt-Shift-ArrowRight': () => resize(10, 0),
      'Alt-Shift-ArrowLeft': () => resize(-10, 0),
      'Alt-Shift-ArrowUp': () => resize(0, -10),
      'Alt-Shift-ArrowDown': () => resize(0, 10),
    }
  },
})
