import { Node, mergeAttributes, type Editor } from '@tiptap/core'
import { NodeSelection } from '@tiptap/pm/state'
import { NodeViewWrapper, ReactNodeViewRenderer, type NodeViewProps } from '@tiptap/react'
import { Button } from '@all/ui'
import { useRef, useState } from 'react'
import { safeImageSource, type ImageAttributes } from '../engine/images'
import { DraftIcon } from '../components/DraftIcons'

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

function ImageView({ node, selected, editor, getPos, extension }: NodeViewProps) {
  const [preview, setPreview] = useState<{ width: number; height: number }>()
  const drag = useRef<{
    x: number
    y: number
    width: number
    height: number
    scale: number
    left: boolean
    top: boolean
  }>()
  const attrs = { ...(node.attrs as ImageAttributes), ...preview }
  const pl = extension.options.getLocale() === 'pl'
  const corners = pl
    ? { nw: 'lewy górny', ne: 'prawy górny', sw: 'lewy dolny', se: 'prawy dolny' }
    : { nw: 'top left', ne: 'top right', sw: 'bottom left', se: 'bottom right' }
  return (
    <NodeViewWrapper
      as="span"
      className={`draft-image${selected ? ' draft-image--selected' : ''}`}
      data-alignment={attrs.alignment}
      data-wrap={attrs.wrap}
      style={imageBoxStyle(attrs)}
    >
      <img
        src={attrs.src}
        alt={attrs.alt || ''}
        width={attrs.width}
        height={attrs.height}
        draggable="true"
        data-drag-handle
        style={{ width: '100%', height: 'auto', aspectRatio: `${attrs.width} / ${attrs.height}` }}
      />
      {selected && (
        <span className="draft-image-actions" contentEditable={false}>
          <Button
            size="sm"
            variant="primary"
            icon={<DraftIcon name="alt" />}
            onClick={() => extension.options.onEdit()}
          >
            {pl ? 'Tekst alternatywny' : 'Alt text'}
          </Button>
          {(['nw', 'ne', 'sw', 'se'] as const).map((corner) => (
            <Button
              key={corner}
              size="sm"
              variant="primary"
              className={`draft-image-handle draft-image-handle--${corner}`}
              aria-label={`${pl ? 'Zmień rozmiar obrazu' : 'Resize image'} ${corners[corner]}`}
              onPointerDown={(event) => {
                event.preventDefault()
                const container = event.currentTarget.closest('.draft-image')!.getBoundingClientRect()
                drag.current = {
                  x: event.clientX,
                  y: event.clientY,
                  width: node.attrs.width,
                  height: node.attrs.height,
                  scale: node.attrs.width / container.width,
                  left: corner.endsWith('w'),
                  top: corner.startsWith('n'),
                }
                event.currentTarget.setPointerCapture(event.pointerId)
              }}
              onPointerMove={(event) => {
                const start = drag.current
                if (!start) return
                const dx = (event.clientX - start.x) * start.scale * (start.left ? -1 : 1)
                const dy = (event.clientY - start.y) * start.scale * (start.top ? -1 : 1)
                const nextWidth = event.shiftKey
                  ? start.width + dx
                  : Math.abs(dx) >= Math.abs((dy * start.width) / start.height)
                    ? start.width + dx
                    : start.width + (dy * start.width) / start.height
                setPreview(resizedImage(start.width, start.height, nextWidth, start.height + dy, event.shiftKey))
              }}
              onPointerUp={(event) => {
                if (!drag.current) return
                drag.current = undefined
                event.currentTarget.releasePointerCapture(event.pointerId)
                if (preview) updateImageAttributes(editor, preview, getPos())
                setPreview(undefined)
              }}
              onPointerCancel={() => {
                drag.current = undefined
                setPreview(undefined)
              }}
            >
              <DraftIcon name="resize" />
            </Button>
          ))}
        </span>
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
