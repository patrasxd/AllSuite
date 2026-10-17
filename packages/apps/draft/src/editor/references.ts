import { Extension, Node, mergeAttributes, type Editor } from '@tiptap/core'
import Link from '@tiptap/extension-link'
import { Plugin, TextSelection } from '@tiptap/pm/state'
import { DOMSerializer } from '@tiptap/pm/model'
import { closeHistory } from '@tiptap/pm/history'
import {
  freshTargetId,
  normalizeReferences,
  referenceTargets,
  safeLink,
  tocEntries,
  updateReferenceFields,
  validTargetId,
  validCaptionLabel,
  captionSequence,
  type ReferencePages,
} from '../engine/references'
import type { DraftDocument, DraftNode } from '../engine/document-model'

export function jumpToTarget(editor: Editor, id: string) {
  if (!validTargetId(id) && !/^(note|ref):[A-Za-z_][\w-]{0,159}$/.test(id)) return false
  let target: number | undefined
  let offset = 1
  editor.state.doc.descendants((node, pos) => {
    if (
      target === undefined &&
      (node.attrs.anchorId === id ||
        (node.type.name === 'bookmark' && node.attrs.id === id) ||
        (node.type.name === 'note' && `note:${node.attrs.id}` === id) ||
        (node.type.name === 'noteReference' && `ref:${node.attrs.id}` === id))
    ) {
      target = pos
      offset = node.type.name === 'note' ? 2 : 1
    }
  })
  if (target === undefined) return false
  editor.commands.setTextSelection(Math.min(editor.state.doc.content.size, target + offset))
  editor.commands.focus()
  editor.view.dom.querySelector<HTMLElement>(`[id="${id}"]`)?.scrollIntoView?.({ block: 'start', behavior: 'instant' })
  return true
}
export function insertBookmark(editor: Editor, name: string) {
  if (
    !/^[A-Za-z_][\w-]{0,39}$/.test(name) ||
    referenceTargets(editor.getJSON() as DraftDocument).some((target) => target.id === name)
  )
    return false
  const { from, to, $from, $to } = editor.state.selection
  if (!$from.sameParent($to) || !$from.parent.inlineContent) return false
  const content = editor.state.doc.slice(from, to).content.toJSON() || []
  return editor
    .chain()
    .focus()
    .insertContent({ type: 'bookmark', attrs: { id: name, name }, content })
    .run()
}
export function insertNote(editor: Editor, kind: 'footnote' | 'endnote') {
  if (editor.isActive('note')) return false
  const id = freshTargetId(editor.getJSON() as DraftDocument, kind)
  editor.chain().focus().insertContent({ type: 'noteReference', attrs: { id, kind } }).run()
  jumpToTarget(editor, `note:${id}`)
  return true
}
export function insertTOC(editor: Editor, minLevel: number, maxLevel: number, captionLabel?: string) {
  const document = normalizeReferences(editor.getJSON() as DraftDocument)
  return editor
    .chain()
    .focus()
    .insertContent({
      type: 'tableOfContents',
      attrs: { minLevel, maxLevel, captionLabel: captionLabel || null },
      content: tocEntries(document, minLevel, maxLevel, undefined, captionLabel),
    })
    .run()
}
export function updateFields(editor: Editor, pages?: ReferencePages) {
  applyFieldDocument(editor, updateReferenceFields(editor.getJSON() as DraftDocument, pages))
}
export async function updatePagedFields(editor: Editor) {
  const before = editor.state.doc
  const { prepareReferenceExport } = await import('../browser/reference-layout')
  const document = await prepareReferenceExport(before.toJSON() as DraftDocument, undefined, true)
  if (editor.isDestroyed || editor.state.doc !== before) return false
  applyFieldDocument(editor, document)
  return true
}
export function applyReferenceSnapshot(editor: Editor, document: DraftDocument) {
  // Printing refreshes visible caches as one separate undo event, preserving body text/caret.
  editor.view.dispatch(closeHistory(editor.state.tr))
  applyFieldDocument(editor, document)
  editor.view.dispatch(closeHistory(editor.state.tr))
}
function applyFieldDocument(editor: Editor, document: DraftDocument) {
  const fields: DraftNode[] = []
  const collect = (node: DraftNode) => {
    if (['tableOfContents', 'crossReference'].includes(node.type)) fields.push(node)
    else node.content?.forEach(collect)
  }
  collect(document)
  const tr = editor.state.tr
  let index = 0
  editor.state.doc.descendants((node, pos) => {
    if (!['tableOfContents', 'crossReference'].includes(node.type.name)) return true
    const replacement = editor.schema.nodeFromJSON(fields[index++])
    if (!node.eq(replacement)) tr.replaceWith(tr.mapping.map(pos), tr.mapping.map(pos + node.nodeSize), replacement)
    return false
  })
  if (tr.docChanged) editor.view.dispatch(tr)
}
export function insertCaption(editor: Editor, label: string, text: string, position: 'above' | 'below') {
  if (!validCaptionLabel(label) || editor.isActive('note')) return false
  const { $from, from } = editor.state.selection
  const pos = $from.depth ? $from.before(1) : from
  const node = editor.state.doc.nodeAt(pos)
  if (!node) return false
  const previous = node.attrs.captionLabel ? (node.toJSON() as DraftNode) : undefined
  const oldSequence = previous && captionSequence(previous)
  const showLabel = oldSequence?.attrs?.showLabel !== false
  const number: DraftNode = { type: 'captionNumber', attrs: { label, number: 1, showLabel } }
  const retainSequenceBookmarks = (child: DraftNode): DraftNode =>
    child.type === 'bookmark'
      ? { ...child, content: child.content?.filter((item) => captionSequence(item)).map(retainSequenceBookmarks) }
      : number
  const template = previous?.content?.find((child) => captionSequence(child))
  const caption = editor.schema.nodeFromJSON({
    type: 'paragraph',
    attrs: {
      anchorId: node.attrs.captionLabel
        ? node.attrs.anchorId
        : freshTargetId(editor.getJSON() as DraftDocument, 'caption'),
      captionLabel: label,
      captionPosition: position,
      keepNext: position === 'above',
    },
    content: [
      ...(!showLabel ? [{ type: 'text', text: `${label} ` }] : []),
      template ? retainSequenceBookmarks(template) : number,
      ...(text ? [{ type: 'text', text: `: ${text}` }] : []),
    ],
  })
  const tr = editor.state.tr
  if (node.attrs.captionLabel) {
    const previous = pos ? tr.doc.resolve(pos).nodeBefore : null
    const next = tr.doc.nodeAt(pos + node.nodeSize)
    const object = (n: typeof node | null) =>
      n &&
      (n.type.name === 'table' ||
        (n.type.name === 'paragraph' && n.content.content.some((child) => child.type.name === 'image')))
    if (
      position !== node.attrs.captionPosition &&
      (node.attrs.captionPosition === 'above' ? object(next) : object(previous))
    ) {
      const target = position === 'below' ? pos + next!.nodeSize : pos - previous!.nodeSize
      tr.delete(pos, pos + node.nodeSize).insert(target, caption)
    } else tr.replaceWith(pos, pos + node.nodeSize, caption)
  } else tr.insert(position === 'above' ? pos : pos + node.nodeSize, caption)
  editor.view.dispatch(tr)
  return true
}
export const SafeLink = Link.extend({
  renderHTML({ HTMLAttributes }) {
    const href = safeLink(HTMLAttributes.href)
    return href
      ? [
          'a',
          mergeAttributes(HTMLAttributes, {
            href,
            target: href.startsWith('#') ? null : '_blank',
            rel: 'noopener noreferrer',
          }),
          0,
        ]
      : ['span', {}, 0]
  },
}).configure({
  openOnClick: false,
  autolink: false,
  linkOnPaste: false,
  protocols: ['http', 'https', 'mailto', 'tel'],
  isAllowedUri: (href) => Boolean(safeLink(href)),
  HTMLAttributes: { target: '_blank', rel: 'noopener noreferrer' },
})

const Bookmark = Node.create({
  name: 'bookmark',
  priority: 1200,
  group: 'inline',
  inline: true,
  content: 'inline*',
  defining: true,
  addKeyboardShortcuts() {
    const escape = (forward: boolean) => {
      const { selection } = this.editor.state
      const { $from } = selection
      if (
        !selection.empty ||
        $from.parent.type.name !== 'bookmark' ||
        $from.parentOffset !== (forward ? $from.parent.content.size : 0)
      )
        return false
      return this.editor.commands.setTextSelection(forward ? $from.after() : $from.before())
    }
    return {
      ArrowRight: () => escape(true),
      ArrowLeft: () => escape(false),
      Enter: () => {
        const { selection, doc } = this.editor.state
        const { $from, $to, from, to } = selection
        if ($from.parent.type.name !== 'bookmark' || !$from.sameParent($to) || !$from.node($from.depth - 1).isTextblock)
          return false
        // End this range at the paragraph break; continue remaining text in the new paragraph.
        const end = $from.end()
        const tail = doc.slice(to, end).content
        return this.editor
          .chain()
          .command(({ tr }) => {
            tr.delete(from, end)
              .insert(from + 1, tail)
              .setSelection(TextSelection.create(tr.doc, from + 1))
            return true
          })
          .splitBlock()
          .run()
      },
    }
  },
  addAttributes() {
    return { id: { default: null }, name: { default: '' } }
  },
  parseHTML() {
    return [
      {
        tag: 'span[data-draft-bookmark]',
        getAttrs: (el) => ({ id: el.getAttribute('id'), name: el.getAttribute('data-draft-bookmark') }),
      },
    ]
  },
  renderHTML({ node }) {
    return [
      'span',
      { id: node.attrs.id, 'data-draft-bookmark': node.attrs.name, class: 'draft-bookmark', title: node.attrs.name },
      0,
    ]
  },
})
const CrossReference = Node.create({
  name: 'crossReference',
  group: 'inline',
  inline: true,
  atom: true,
  addAttributes() {
    return { targetId: { default: '' }, label: { default: '[Missing reference]' }, format: { default: 'text' } }
  },
  parseHTML() {
    return [
      {
        tag: 'span[data-draft-ref]',
        getAttrs: (el) => ({
          targetId: el.getAttribute('data-draft-ref'),
          label: el.textContent,
          format: el.getAttribute('data-ref-format') || 'text',
        }),
      },
    ]
  },
  renderHTML({ node }) {
    return [
      'span',
      {
        class: 'draft-cross-reference',
        'data-draft-ref': node.attrs.targetId,
        'data-ref-format': node.attrs.format,
        contenteditable: 'false',
      },
      ['a', { href: `#${node.attrs.targetId}` }, node.attrs.label],
    ]
  },
  renderText({ node }) {
    return String(node.attrs.label)
  },
})
const TOCEntry = Node.create({
  name: 'tocEntry',
  content: 'text*',
  addAttributes() {
    return { targetId: { default: '' }, level: { default: 1 }, pageNumber: { default: null } }
  },
  parseHTML() {
    return [
      {
        tag: 'p[data-toc-target]',
        contentElement: (el) => el.querySelector<HTMLElement>('.draft-toc-label') || el,
        getAttrs: (el) => ({
          targetId: el.getAttribute('data-toc-target'),
          level: Number(el.getAttribute('data-level')) || 1,
          pageNumber: el.getAttribute('data-page-number'),
        }),
      },
    ]
  },
  renderHTML({ node }) {
    return [
      'p',
      {
        'data-toc-target': node.attrs.targetId,
        'data-level': node.attrs.level,
        'data-page-number': node.attrs.pageNumber,
        class: 'draft-toc-entry',
        style: `margin-left:${Math.max(0, Number(node.attrs.level) - 1) * 16}px`,
      },
      [
        'a',
        { href: `#${node.attrs.targetId}` },
        ['span', { class: 'draft-toc-label' }, 0],
        ['span', { class: 'draft-toc-leader', 'aria-hidden': 'true' }],
        ['span', { class: 'draft-toc-page' }, String(node.attrs.pageNumber || '?')],
      ],
    ]
  },
})
const TOC = Node.create({
  name: 'tableOfContents',
  group: 'block',
  content: 'tocEntry*',
  atom: true,
  isolating: true,
  addNodeView() {
    return ({ node, editor }) => {
      const serializer = DOMSerializer.fromSchema(editor.schema)
      const dom = serializer.serializeNode(node) as HTMLElement
      return {
        dom,
        // Cached field contents are rendered from the model, never read back as editable DOM.
        update(next) {
          if (next.type !== node.type) return false
          dom.setAttribute('data-min', String(next.attrs.minLevel))
          dom.setAttribute('data-max', String(next.attrs.maxLevel))
          if (next.attrs.captionLabel) dom.setAttribute('data-caption-label', next.attrs.captionLabel)
          else dom.removeAttribute('data-caption-label')
          dom.replaceChildren(serializer.serializeFragment(next.content))
          return true
        },
        ignoreMutation: (mutation) => mutation.type !== 'selection',
      }
    }
  },
  addAttributes() {
    return { minLevel: { default: 1 }, maxLevel: { default: 3 }, captionLabel: { default: null } }
  },
  parseHTML() {
    return [
      {
        tag: 'nav[data-draft-toc]',
        getAttrs: (el) => ({
          minLevel: Number(el.getAttribute('data-min')) || 1,
          maxLevel: Number(el.getAttribute('data-max')) || 3,
          captionLabel: el.getAttribute('data-caption-label'),
        }),
      },
    ]
  },
  renderHTML({ node }) {
    return [
      'nav',
      {
        'data-draft-toc': '',
        'data-min': node.attrs.minLevel,
        'data-max': node.attrs.maxLevel,
        'data-caption-label': node.attrs.captionLabel,
        class: 'draft-toc',
        contenteditable: 'false',
        'aria-label': 'Table of contents',
      },
      0,
    ]
  },
})
const NoteReference = Node.create({
  name: 'noteReference',
  group: 'inline',
  inline: true,
  atom: true,
  addAttributes() {
    return { id: { default: null }, kind: { default: 'footnote' }, number: { default: 1 } }
  },
  parseHTML() {
    return [
      {
        tag: 'sup[data-note-ref]',
        getAttrs: (el) => ({
          id: el.getAttribute('data-note-ref'),
          kind: el.getAttribute('data-kind'),
          number: Number(el.textContent) || 1,
        }),
      },
    ]
  },
  renderHTML({ node }) {
    return [
      'sup',
      {
        id: `ref:${node.attrs.id}`,
        'data-note-ref': node.attrs.id,
        'data-kind': node.attrs.kind,
        contenteditable: 'false',
      },
      [
        'a',
        { href: `#note:${node.attrs.id}`, 'aria-label': `${node.attrs.kind} ${node.attrs.number}` },
        String(node.attrs.number),
      ],
    ]
  },
  renderText({ node }) {
    return `[${node.attrs.number}]`
  },
})
const Note = Node.create({
  name: 'note',
  group: 'block',
  content: 'paragraph+',
  defining: true,
  isolating: true,
  addAttributes() {
    return { id: { default: null }, kind: { default: 'footnote' }, number: { default: 1 } }
  },
  parseHTML() {
    return [
      {
        tag: 'section[data-draft-note]',
        getAttrs: (el) => ({
          id: el.getAttribute('data-draft-note'),
          kind: el.getAttribute('data-kind'),
          number: Number(el.getAttribute('data-number')) || 1,
        }),
      },
    ]
  },
  renderHTML({ node }) {
    return [
      'section',
      {
        id: `note:${node.attrs.id}`,
        'data-draft-note': node.attrs.id,
        'data-kind': node.attrs.kind,
        'data-number': node.attrs.number,
        class: 'draft-note',
      },
      [
        'a',
        {
          href: `#ref:${node.attrs.id}`,
          contenteditable: 'false',
          class: 'draft-note-back',
          'aria-label': `Back to ${node.attrs.kind} ${node.attrs.number}`,
        },
        String(node.attrs.number),
      ],
      ['div', {}, 0],
    ]
  },
})
const References = Extension.create({
  name: 'references',
  addGlobalAttributes() {
    return [
      { types: ['doc'], attributes: { captionLabels: { default: null, rendered: false } } },
      {
        types: ['paragraph'],
        attributes: {
          captionLabel: {
            default: null,
            keepOnSplit: false,
            parseHTML: (el) => el.getAttribute('data-caption-label'),
            renderHTML: (attrs) => (attrs.captionLabel ? { 'data-caption-label': attrs.captionLabel } : {}),
          },
          captionPosition: {
            default: null,
            keepOnSplit: false,
            parseHTML: (el) => el.getAttribute('data-caption-position'),
            renderHTML: (attrs) => (attrs.captionPosition ? { 'data-caption-position': attrs.captionPosition } : {}),
          },
        },
      },
      {
        types: ['paragraph', 'heading'],
        attributes: {
          anchorId: {
            default: null,
            keepOnSplit: false,
            parseHTML: (el) => (validTargetId(el.id) ? el.id : null),
            renderHTML: (attrs) => (validTargetId(attrs.anchorId) ? { id: attrs.anchorId } : {}),
          },
        },
      },
    ]
  },
  addProseMirrorPlugins() {
    const editor = this.editor
    return [
      new Plugin({
        appendTransaction(transactions, _old, state) {
          if (!transactions.some((tr) => tr.docChanged)) return null
          const normalized = normalizeReferences(state.doc.toJSON() as DraftDocument)
          const expected: DraftNode[] = []
          const collect = (node: DraftNode) => {
            if (node.type === 'note') return
            expected.push(node)
            if (node.type !== 'tableOfContents') node.content?.forEach(collect)
          }
          normalized.content.forEach(collect)
          const tr = state.tr
          let index = 0
          state.doc.descendants((node, pos) => {
            if (node.type.name === 'note') return false
            const want = expected[index++]
            if (
              ['paragraph', 'heading', 'bookmark', 'noteReference', 'captionNumber'].includes(node.type.name) &&
              want &&
              JSON.stringify({ ...node.attrs, ...want.attrs }) !== JSON.stringify(node.attrs)
            )
              tr.setNodeMarkup(pos, undefined, { ...node.attrs, ...want.attrs })
            return node.type.name !== 'tableOfContents'
          })
          const noteIds = new Set<string>()
          state.doc.forEach((node, pos) => {
            if (node.type.name !== 'note') return
            const want = normalized.content.find((item) => item.type === 'note' && item.attrs?.id === node.attrs.id)
            if (!want || noteIds.has(node.attrs.id)) tr.delete(tr.mapping.map(pos), tr.mapping.map(pos + node.nodeSize))
            else {
              noteIds.add(node.attrs.id)
              if (JSON.stringify({ ...node.attrs, ...want.attrs }) !== JSON.stringify(node.attrs))
                tr.setNodeMarkup(tr.mapping.map(pos), undefined, { ...node.attrs, ...want.attrs })
            }
          })
          for (const note of normalized.content.filter(
            (node) => node.type === 'note' && !noteIds.has(String(node.attrs?.id)),
          ))
            tr.insert(tr.doc.content.size, state.schema.nodeFromJSON(note))
          const wanted = normalized.content.filter((node) => node.type === 'note').map((node) => String(node.attrs?.id))
          const present: Array<{ id: string; pos: number; size: number }> = []
          tr.doc.forEach((node, pos) => {
            if (node.type.name === 'note') present.push({ id: node.attrs.id, pos, size: node.nodeSize })
          })
          if (
            present.some(
              (note, index) =>
                note.id !== wanted[index] ||
                (index > 0 && present[index - 1].pos + present[index - 1].size !== note.pos) ||
                (index === present.length - 1 && note.pos + note.size !== tr.doc.content.size),
            )
          ) {
            const remember = (pos: number) => {
              const resolved = tr.doc.resolve(pos)
              for (let depth = resolved.depth; depth > 0; depth--)
                if (resolved.node(depth).type.name === 'note')
                  return { id: resolved.node(depth).attrs.id, offset: pos - resolved.before(depth) }
              return undefined
            }
            const anchor = remember(tr.selection.anchor)
            const head = remember(tr.selection.head)
            const nodes = new Map(present.map((note) => [note.id, tr.doc.nodeAt(note.pos)!]))
            for (const note of [...present].reverse()) tr.delete(note.pos, note.pos + note.size)
            const positions = new Map<string, number>()
            for (const id of wanted) {
              positions.set(id, tr.doc.content.size)
              tr.insert(tr.doc.content.size, nodes.get(id)!)
            }
            if (anchor && head && positions.has(anchor.id) && positions.has(head.id))
              tr.setSelection(
                TextSelection.create(
                  tr.doc,
                  positions.get(anchor.id)! + anchor.offset,
                  positions.get(head.id)! + head.offset,
                ),
              )
          }
          state.doc.descendants((node, pos) => {
            for (const mark of node.marks)
              if (mark.type.name === 'link' && !safeLink(mark.attrs.href))
                tr.removeMark(tr.mapping.map(pos), tr.mapping.map(pos + node.nodeSize), mark)
          })
          // Appended changes belong to the triggering edit, including note-body removal.
          // Keeping them in its history event lets Undo restore the reference and its text together.
          return tr.docChanged ? tr : null
        },
        props: {
          handleDOMEvents: {
            click(_view, event) {
              const anchor = (event.target as HTMLElement)?.closest('a')
              if (!anchor) return false
              const href = safeLink(anchor.getAttribute('href'))
              if (href?.startsWith('#')) {
                event.preventDefault()
                return jumpToTarget(editor, href.slice(1))
              }
              return false
            },
          },
        },
      }),
    ]
  },
})
const CaptionNumber = Node.create({
  name: 'captionNumber',
  inline: true,
  group: 'inline',
  atom: true,
  addAttributes: () => ({ label: { default: 'Figure' }, number: { default: 1 }, showLabel: { default: true } }),
  parseHTML: () => [
    {
      tag: 'span[data-caption-number]',
      getAttrs: (el) => ({
        label: el.getAttribute('data-caption-number'),
        number: Number(el.getAttribute('data-number')) || 1,
        showLabel: el.getAttribute('data-show-label') !== 'false',
      }),
    },
  ],
  renderHTML: ({ node }) => [
    'span',
    {
      'data-caption-number': node.attrs.label,
      'data-number': node.attrs.number,
      'data-show-label': String(node.attrs.showLabel),
      contenteditable: 'false',
    },
    `${node.attrs.showLabel ? node.attrs.label + ' ' : ''}${node.attrs.number}`,
  ],
  renderText: ({ node }) => `${node.attrs.showLabel ? node.attrs.label + ' ' : ''}${node.attrs.number}`,
})
export const referenceExtensions = [
  SafeLink,
  Bookmark,
  CrossReference,
  TOCEntry,
  TOC,
  NoteReference,
  Note,
  CaptionNumber,
  References,
]
