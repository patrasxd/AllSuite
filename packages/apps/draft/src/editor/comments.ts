import { Extension, Mark } from '@tiptap/core'
import { Plugin } from '@tiptap/pm/state'
import { readCommentThreads, serializeCommentThreads } from '../engine/comments'

export const CommentMark = Mark.create({
  name: 'comment',
  inclusive: false,
  addAttributes() {
    return {
      id: {
        default: null,
        parseHTML: (element: HTMLElement) => element.getAttribute('data-comment-id'),
        renderHTML: (attributes: { id?: string }) =>
          typeof attributes.id === 'string' && /^[\w-]{1,160}$/.test(attributes.id)
            ? { 'data-comment-id': attributes.id }
            : {},
      },
    }
  },
  parseHTML() {
    return [{ tag: 'span[data-comment-id]' }]
  },
  renderHTML({ HTMLAttributes }) {
    return ['span', { ...HTMLAttributes, class: 'draft-comment-anchor' }, 0]
  },
})

export const CommentCleanup = Extension.create({
  name: 'commentCleanup',
  addProseMirrorPlugins() {
    return [
      new Plugin({
        appendTransaction(transactions, _oldState, state) {
          if (!transactions.some((transaction) => transaction.docChanged)) return null
          const comments = readCommentThreads(state.doc.attrs.comments)
          if (!comments.length) return null
          const removedFrom = new Set<string>()
          const collect = (document: typeof state.doc, from: number, to: number) => {
            if (to <= from) return
            document.nodesBetween(from, to, (node) => {
              if (!node.isText) return
              for (const mark of node.marks)
                if (mark.type.name === 'comment' && typeof mark.attrs.id === 'string') removedFrom.add(mark.attrs.id)
            })
          }
          for (const transaction of transactions)
            transaction.steps.forEach((step, index) => {
              const data = step.toJSON() as {
                stepType?: string
                from?: number
                to?: number
                mark?: { type?: string }
              }
              const document = transaction.docs[index] || _oldState.doc
              if (data.stepType === 'removeMark' && data.mark?.type === 'comment') {
                if (typeof data.from === 'number' && typeof data.to === 'number') collect(document, data.from, data.to)
              } else step.getMap().forEach((from, to) => collect(document, from, to))
            })
          if (!removedFrom.size) return null
          const remaining = new Set<string>()
          state.doc.descendants((node) => {
            if (!node.isText) return true
            for (const mark of node.marks)
              if (mark.type.name === 'comment' && removedFrom.has(mark.attrs.id)) remaining.add(mark.attrs.id)
            return remaining.size < removedFrom.size
          })
          const retained = comments.filter((thread) => !removedFrom.has(thread.id) || remaining.has(thread.id))
          if (retained.length === comments.length) return null
          return state.tr.setDocAttribute('comments', serializeCommentThreads(retained))
        },
      }),
    ]
  },
})
