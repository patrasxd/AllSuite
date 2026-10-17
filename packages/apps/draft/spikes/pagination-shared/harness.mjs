import { Editor, Node, Extension } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'
import { TableKit } from '@tiptap/extension-table'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'
import './style.css'

export const BODY = ((297 - 40) * 96) / 25.4
const key = new PluginKey('spike-pages')
const Image = Node.create({
  name: 'spikeImage',
  group: 'block',
  atom: true,
  addAttributes: () => ({ src: {}, height: { default: 1400 }, width: { default: 200 } }),
  parseHTML: () => [{ tag: 'img' }],
  renderHTML: ({ HTMLAttributes }) => ['img', HTMLAttributes],
})

// Deliberately minimal full-scan algorithm: no document mutations, no line/row splitting.
const Pages = Extension.create({
  name: 'spikePages',
  addStorage: () => ({ refresh: () => {} }),
  addProseMirrorPlugins() {
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
          let busy = false
          function measure() {
            if (busy) return
            busy = true
            const blocks = []
            view.state.doc.forEach((node, pos) => {
              const dom = view.nodeDOM(pos)
              if (dom instanceof HTMLElement) blocks.push({ pos, height: dom.getBoundingClientRect().height })
            })
            let used = 0
            const decorations = []
            for (const block of blocks) {
              if (used > 0 && used + block.height > BODY + 0.5) {
                const height = BODY - used + (40 * 96) / 25.4 + 24
                decorations.push(
                  Decoration.widget(
                    block.pos,
                    () => {
                      const spacer = document.createElement('div')
                      spacer.className = 'page-spacer'
                      spacer.style.height = `${Math.max(24, height)}px`
                      spacer.contentEditable = 'false'
                      spacer.setAttribute('aria-hidden', 'true')
                      return spacer
                    },
                    { side: -1, key: `page-${block.pos}-${height}` },
                  ),
                )
                used = 0
              }
              used += block.height
              // An oversized atomic block is reported, not retried forever.
              if (used > BODY) used %= BODY
            }
            view.dispatch(view.state.tr.setMeta(key, DecorationSet.create(view.state.doc, decorations)))
            busy = false
          }
          storage.refresh = measure
          return {
            update: (next, previous) => {
              if (!busy && !next.state.doc.eq(previous.doc)) measure()
            },
          }
        },
      }),
    ]
  },
})

const lines = (count, label) => ({
  type: 'paragraph',
  content: Array.from({ length: count }, (_, i) => [
    ...(i ? [{ type: 'hardBreak' }] : []),
    { type: 'text', text: `${label} line ${i + 1} — Zażółć gęślą jaźń.` },
  ]).flat(),
})

export function mount(widgets) {
  document.documentElement.style.setProperty('--line', `${BODY / 40}px`)
  let editor
  function load(kind) {
    editor?.destroy()
    document.querySelector('#editor').replaceChildren()
    const canvas = document.createElement('canvas')
    canvas.width = 200
    canvas.height = 1400
    const ctx = canvas.getContext('2d')
    ctx.fillStyle = '#777'
    ctx.fillRect(0, 0, 200, 1400)
    ctx.fillStyle = '#000'
    ctx.fillRect(0, 1380, 200, 20)
    const table = {
      type: 'table',
      content: Array.from({ length: 80 }, (_, i) => ({
        type: 'tableRow',
        content: [{ type: i === 0 ? 'tableHeader' : 'tableCell', content: [lines(1, `Row ${i}`)] }],
      })),
    }
    const content =
      kind === 'hundred'
        ? Array.from({ length: 1000 }, (_, i) => lines(4, `Block ${i}`))
        : [
            lines(10, 'Before'),
            lines(100, 'Long paragraph'),
            table,
            { type: 'spikeImage', attrs: { src: canvas.toDataURL(), width: 200, height: 1400 } },
            lines(1, 'END'),
          ]
    const start = performance.now()
    editor = new Editor({
      element: document.querySelector('#editor'),
      extensions: [StarterKit, TableKit, Image, ...(widgets ? [Pages] : [])],
      content: { type: 'doc', content },
    })
    // Initial measurement must run after the editor DOM has been mounted.
    if (widgets) editor.storage.spikePages.refresh()
    document.querySelector('.tiptap').setAttribute('aria-label', 'Spike document')
    return { initMs: performance.now() - start, blocks: content.length, bodyPx: BODY }
  }
  window.spike = {
    load,
    inspect: () => {
      const children = [...editor.view.dom.children].filter((node) => !node.classList.contains('page-spacer'))
      return {
        oversized: children
          .map((node) => ({ tag: node.tagName, height: node.getBoundingClientRect().height }))
          .filter((node) => node.height > BODY),
        widgets: document.querySelectorAll('.page-spacer').length,
        textLength: editor.state.doc.textContent.length,
        scrollHeight: editor.view.dom.scrollHeight,
      }
    },
    prepare: (part) => {
      const position =
        part === 'start'
          ? 1
          : part === 'middle'
            ? Math.floor(editor.state.doc.childCount / 2)
            : editor.state.doc.childCount - 1
      let offset = 1
      if (part !== 'start') {
        offset = 0
        for (let i = 0; i < position; i++) offset += editor.state.doc.child(i).nodeSize
        offset += 1
      }
      editor.commands.setTextSelection(offset)
      editor.view.focus()
      editor.view.domAtPos(offset).node.parentElement?.scrollIntoView({ block: 'center' })
    },
    insert: () => {
      const start = performance.now()
      editor.commands.insertContent('x')
      editor.view.dom.getBoundingClientRect()
      return performance.now() - start
    },
    json: () => JSON.stringify(editor.getJSON()),
  }
  load('correctness')
}
