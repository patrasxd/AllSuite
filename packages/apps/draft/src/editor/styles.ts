import { Extension, Mark, type Editor } from '@tiptap/core'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'
import type { Node as PMNode } from '@tiptap/pm/model'
import { renderFontFamily } from '../engine/fonts'
import { textBlockChange } from './text-block-change'
import {
  cleanStyleFormat,
  paragraphFormat,
  paragraphStyleId,
  paragraphStyleKeys,
  readStyles,
  runFormat,
  styleHeading,
  type DocumentStyle,
  type StyleFormat,
} from '../engine/styles'

export function editorStyles(editor: Editor) {
  return readStyles(editor.state.doc.attrs.styleDefinitions)
}
function selectedParagraph(editor: Editor) {
  const { selection, doc } = editor.state
  let node = selection.$from.parent
  if (!['paragraph', 'heading'].includes(node.type.name)) {
    doc.nodesBetween(selection.from, selection.to, (candidate) => {
      if (['paragraph', 'heading'].includes(candidate.type.name) && !['paragraph', 'heading'].includes(node.type.name))
        node = candidate
    })
  }
  return node
}
export function selectedStyleId(editor: Editor) {
  const node = selectedParagraph(editor)
  return paragraphStyleId({ type: node.type.name, attrs: node.attrs })
}
export function selectionFormat(editor: Editor): StyleFormat {
  const { $from } = editor.state.selection
  const styles = editorStyles(editor)
  const node = selectedParagraph(editor)
  const base = paragraphFormat(styles, { type: node.type.name, attrs: node.attrs })
  let marks = editor.state.storedMarks || $from.marks()
  if (!editor.state.selection.empty) {
    let found = false
    editor.state.doc.nodesBetween(editor.state.selection.from, editor.state.selection.to, (child) => {
      if (child.isText && !found) {
        marks = child.marks
        found = true
      }
    })
  }
  return runFormat(styles, { marks: marks.map((mark) => ({ type: mark.type.name, attrs: mark.attrs })) }, base)
}
export function setStyleDefinitions(editor: Editor, styles: DocumentStyle[]) {
  editor.view.dispatch(editor.state.tr.setDocAttribute('styleDefinitions', JSON.stringify(readStyles(styles))))
}
export function saveStyle(editor: Editor, style: DocumentStyle) {
  setStyleDefinitions(editor, [
    ...editorStyles(editor).filter((item) => item.id !== style.id),
    { ...style, format: cleanStyleFormat(style.format) },
  ])
}
export function applyDocumentStyle(editor: Editor, id: string) {
  const styles = editorStyles(editor)
  const style = styles.find((item) => item.id === id)
  if (!style) return false
  if (style.kind === 'character') return editor.chain().focus().setMark('characterStyle', { styleId: id }).run()
  const { from, to } = editor.state.selection
  const tr = editor.state.tr
  const heading = styleHeading(styles, id)
  editor.state.doc.nodesBetween(from, to, (node, pos) => {
    if (!['paragraph', 'heading'].includes(node.type.name)) return true
    const listParagraph = editor.state.doc.resolve(pos).parent.type.name === 'listItem'
    tr.setNodeMarkup(pos, editor.schema.nodes[heading && !listParagraph ? 'heading' : 'paragraph'], {
      ...node.attrs,
      level: heading,
      styleId: id,
    })
    return false
  })
  if (!tr.docChanged) return false
  editor.view.dispatch(tr.scrollIntoView())
  editor.commands.focus()
  return true
}
export function clearDirectFormatting(editor: Editor) {
  const { from, to } = editor.state.selection
  const tr = editor.state.tr
  for (const name of ['bold', 'italic', 'underline', 'strike', 'subscript', 'superscript', 'highlight', 'textStyle']) {
    const mark = editor.schema.marks[name]
    if (mark) {
      tr.removeMark(from, to, mark)
      tr.removeStoredMark(mark)
    }
  }
  editor.state.doc.nodesBetween(from, to, (node, pos) => {
    if (!['paragraph', 'heading'].includes(node.type.name)) return true
    tr.setNodeMarkup(pos, undefined, {
      ...node.attrs,
      ...Object.fromEntries(paragraphStyleKeys.map((key) => [key, null])),
      tabStops: [],
    })
    return false
  })
  editor.view.dispatch(tr.scrollIntoView())
  editor.commands.focus()
}
export function toggleStyleEmphasis(editor: Editor, key: 'bold' | 'italic') {
  const format = selectionFormat(editor)
  const attr = key === 'bold' ? 'styleBold' : 'styleItalic'
  // Explicit false is needed to turn off emphasis inherited from a named style.
  const mark = key === 'bold' ? 'bold' : 'italic'
  const chain = editor
    .chain()
    .focus()
    .unsetMark(mark)
    .setMark('textStyle', { [attr]: format[key] ? false : null })
  if (!format[key]) chain.setMark(mark)
  return chain.run()
}

export function styleCSS(format: StyleFormat, paragraph = true) {
  const css: string[] = []
  if (format.fontFamily) css.push(`font-family:${renderFontFamily(format.fontFamily)}`)
  if (format.fontSize) css.push(`font-size:${format.fontSize}pt`)
  if (format.color) css.push(`color:${format.color}`)
  if (format.bold !== undefined) css.push(`font-weight:${format.bold ? 700 : 400}`)
  if (format.italic !== undefined) css.push(`font-style:${format.italic ? 'italic' : 'normal'}`)
  if (paragraph) {
    if (format.textAlign) css.push(`text-align:${format.textAlign}`)
    if (format.lineSpacing) css.push(`line-height:${format.lineSpacing}`)
    for (const [key, property] of [
      ['spacingBefore', 'margin-top'],
      ['spacingAfter', 'margin-bottom'],
      ['indentLeft', 'margin-left'],
      ['indentRight', 'margin-right'],
    ] as const)
      if (format[key] !== undefined) css.push(`${property}:${format[key]}pt`)
    if (format.indentFirstLine || format.indentHanging)
      css.push(`text-indent:${format.indentFirstLine || -(format.indentHanging || 0)}pt`)
  }
  return css.join(';')
}
function decorations(doc: PMNode) {
  const styles = readStyles(doc.attrs.styleDefinitions)
  const result: Decoration[] = []
  doc.descendants((node, pos) => {
    if (!['paragraph', 'heading'].includes(node.type.name)) return true
    const format = paragraphFormat(styles, { type: node.type.name, attrs: node.attrs })
    result.push(Decoration.node(pos, pos + node.nodeSize, { style: styleCSS(format) }))
    node.descendants((child, offset) => {
      if (!child.isText || !child.marks.some((mark) => mark.type.name === 'characterStyle')) return
      const run = runFormat(
        styles,
        { marks: child.marks.map((mark) => ({ type: mark.type.name, attrs: mark.attrs })) },
        format,
      )
      result.push(
        Decoration.inline(pos + 1 + offset, pos + 1 + offset + child.nodeSize, { style: styleCSS(run, false) }),
      )
    })
    return false
  })
  return DecorationSet.create(doc, result)
}
const key = new PluginKey<DecorationSet>('draftStyles')
export const DocumentStyles = Extension.create({
  name: 'documentStyles',
  priority: 1100,
  addGlobalAttributes() {
    return [
      { types: ['doc'], attributes: { styleDefinitions: { default: null, rendered: false } } },
      {
        types: ['paragraph', 'heading'],
        attributes: {
          styleId: {
            default: null,
            parseHTML: (element) => element.getAttribute('data-draft-style'),
            renderHTML: (attrs) => (attrs.styleId ? { 'data-draft-style': attrs.styleId } : {}),
          },
        },
      },
      {
        types: ['textStyle'],
        attributes: {
          styleBold: {
            default: null,
            renderHTML: (attrs) => (attrs.styleBold === false ? { style: 'font-weight:400' } : {}),
          },
          styleItalic: {
            default: null,
            renderHTML: (attrs) => (attrs.styleItalic === false ? { style: 'font-style:normal' } : {}),
          },
        },
      },
    ]
  },
  addKeyboardShortcuts() {
    return {
      'Mod-b': () => toggleStyleEmphasis(this.editor, 'bold'),
      'Mod-i': () => toggleStyleEmphasis(this.editor, 'italic'),
      ...Object.fromEntries(
        [1, 2, 3, 4, 5, 6].map((level) => [
          `Mod-Alt-${level}`,
          () => applyDocumentStyle(this.editor, `Heading${level}`),
        ]),
      ),
      Enter: () => {
        const { selection } = this.editor.state
        if (
          !selection.empty ||
          selection.$from.parentOffset !== selection.$from.parent.content.size ||
          this.editor.isActive('listItem') ||
          this.editor.isActive('table')
        )
          return false
        const next = editorStyles(this.editor).find((style) => style.id === selectedStyleId(this.editor))?.next
        if (next === selectedStyleId(this.editor)) return false
        const style = editorStyles(this.editor).find((item) => item.id === next && item.kind === 'paragraph')
        if (!style) return false
        return this.editor
          .chain()
          .splitBlock()
          .command(({ tr }) => {
            const position = tr.selection.$from.before()
            const heading = styleHeading(editorStyles(this.editor), style.id)
            tr.setNodeMarkup(position, this.editor.schema.nodes[heading ? 'heading' : 'paragraph'], {
              ...tr.selection.$from.parent.attrs,
              level: heading,
              styleId: style.id,
            })
            return true
          })
          .run()
      },
    }
  },
  addProseMirrorPlugins() {
    return [
      new Plugin({
        key,
        state: {
          init: (_, state) => decorations(state.doc),
          apply: (tr, value) =>
            !tr.docChanged
              ? value
              : textBlockChange(tr.before, tr.doc)
                ? value.map(tr.mapping, tr.doc)
                : decorations(tr.doc),
        },
        props: { decorations: (state) => key.getState(state) },
      }),
    ]
  },
})
export const CharacterStyle = Mark.create({
  name: 'characterStyle',
  addAttributes() {
    return { styleId: { default: null } }
  },
  parseHTML() {
    return [
      {
        tag: 'span[data-draft-character-style]',
        getAttrs: (element) => ({ styleId: element.getAttribute('data-draft-character-style') }),
      },
    ]
  },
  renderHTML({ HTMLAttributes }) {
    return ['span', { 'data-draft-character-style': HTMLAttributes.styleId }, 0]
  },
})
