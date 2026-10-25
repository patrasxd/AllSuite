import { Extension, Mark } from '@tiptap/core'
import { Plugin, PluginKey, type EditorState } from '@tiptap/pm/state'
import { closeHistory, isHistoryTransaction } from '@tiptap/pm/history'
import { Fragment, Slice, type Mark as ProseMirrorMark, type Node as ProseMirrorNode } from '@tiptap/pm/model'
import type { Editor } from '@tiptap/core'

export type SuggestionKind = 'insert' | 'delete' | 'format'
export type SuggestionDecision = 'accept' | 'reject'

export type SuggestionSummary = {
  id: string
  kind: SuggestionKind
  author: string
  timestamp: string
  text: string
  from: number
  to: number
}

type SuggestionOptions = { getAuthor: () => string }
type TrackingState = { enabled: boolean }

export const SuggestionTrackingKey = new PluginKey<TrackingState>('draftSuggestionTracking')

let suggestionSequence = 0
function createId() {
  return `suggestion-${globalThis.crypto?.randomUUID?.() || `${Date.now().toString(36)}-${(++suggestionSequence).toString(36)}`}`
}

function createRevision(kind: SuggestionKind, author: string, before?: string) {
  return {
    id: createId(),
    kind,
    author: author.trim().slice(0, 200) || 'Guest',
    timestamp: new Date().toISOString(),
    ...(before ? { before } : {}),
  }
}

function suggestionMark(node: ProseMirrorNode) {
  return node.marks.find((mark) => mark.type.name === 'suggestion')
}

function revisionKind(mark: ProseMirrorMark | undefined): SuggestionKind | undefined {
  const kind = mark?.attrs.kind
  return kind === 'insert' || kind === 'delete' || kind === 'format' ? kind : undefined
}

function addMarkToFragment(fragment: Fragment, mark: ProseMirrorMark, dropRevisions = false): Fragment {
  const content: ProseMirrorNode[] = []
  fragment.forEach((node) => {
    if (node.isText) {
      const previous = suggestionMark(node)
      if (dropRevisions && previous && revisionKind(previous) !== 'format') return
      content.push(node.mark(node.marks.filter((item) => item.type.name !== 'suggestion').concat(mark)))
      return
    }
    if (node.isLeaf) return
    content.push(node.copy(addMarkToFragment(node.content, mark, dropRevisions)))
  })
  return Fragment.fromArray(content)
}

function withMark(slice: Slice, mark: ProseMirrorMark, dropRevisions = false) {
  return new Slice(addMarkToFragment(slice.content, mark, dropRevisions), slice.openStart, slice.openEnd)
}

const formattingMarks = new Set([
  'bold',
  'italic',
  'underline',
  'strike',
  'subscript',
  'superscript',
  'textStyle',
  'highlight',
  'characterStyle',
  'link',
])

function rangesForId(doc: ProseMirrorNode, id: string) {
  const ranges: Array<{ from: number; to: number; mark: ProseMirrorMark; text: string }> = []
  doc.descendants((node, position) => {
    if (!node.isText) return true
    const mark = node.marks.find((item) => item.type.name === 'suggestion' && item.attrs.id === id)
    if (!mark) return true
    ranges.push({ from: position, to: position + node.nodeSize, mark, text: node.text || '' })
    return false
  })
  return ranges
}

export function readSuggestions(doc: ProseMirrorNode): SuggestionSummary[] {
  const summaries = new Map<string, SuggestionSummary>()
  doc.descendants((node, position) => {
    if (!node.isText) return true
    const mark = suggestionMark(node)
    const kind = revisionKind(mark)
    const id = mark?.attrs.id
    if (!mark || !kind || typeof id !== 'string') return true
    const current = summaries.get(id)
    if (current) {
      if (position <= current.to + 1) current.text += node.text || ''
      else current.text += ` … ${node.text || ''}`
      current.to = position + node.nodeSize
      return false
    }
    summaries.set(id, {
      id,
      kind,
      author: typeof mark.attrs.author === 'string' ? mark.attrs.author : 'Guest',
      timestamp: typeof mark.attrs.timestamp === 'string' ? mark.attrs.timestamp : '',
      text: node.text || '',
      from: position,
      to: position + node.nodeSize,
    })
    return false
  })
  return [...summaries.values()].sort((left, right) => left.from - right.from)
}

export function setSuggestionTracking(editor: Editor, enabled: boolean) {
  editor.view.dispatch(
    editor.state.tr.setMeta(SuggestionTrackingKey, { enabled, skip: true }).setMeta('addToHistory', false),
  )
}

export function resolveSuggestions(editor: Editor, ids: string[], decision: SuggestionDecision) {
  const state = editor.state
  const markType = state.schema.marks.suggestion
  if (!markType || !ids.length) return
  const targets = ids.flatMap((id) => rangesForId(state.doc, id))
  const deletions = targets.filter(({ mark }) => {
    const kind = revisionKind(mark)
    return (decision === 'accept' && kind === 'delete') || (decision === 'reject' && kind === 'insert')
  })
  // A review decision is one undoable action, separate from the edit it resolves.
  const transaction = closeHistory(state.tr)
  for (const target of targets) {
    if (deletions.includes(target)) continue
    const { from, to, mark } = target
    if (revisionKind(mark) === 'format' && decision === 'reject') {
      for (const type of formattingMarks) {
        const markType = state.schema.marks[type]
        if (markType) transaction.removeMark(from, to, markType)
      }
      try {
        const previous = JSON.parse(String(mark.attrs.before || '')) as Array<{
          type?: string
          attrs?: Record<string, string | number | boolean | null>
        }>
        for (const item of previous) {
          if (!item.type || !formattingMarks.has(item.type) || !state.schema.marks[item.type]) continue
          transaction.addMark(from, to, state.schema.marks[item.type].create(item.attrs))
        }
      } catch {
        // Invalid or unsupported formatting snapshots are ignored safely.
      }
    }
    transaction.removeMark(from, to, mark)
  }
  for (const { from, to } of deletions.sort((left, right) => right.from - left.from)) transaction.delete(from, to)
  transaction.setMeta(SuggestionTrackingKey, { skip: true })
  editor.view.dispatch(transaction)
}

function appendTrackedChanges(
  transactions: readonly import('@tiptap/pm/state').Transaction[],
  oldState: EditorState,
  state: EditorState,
  author: string,
) {
  const changed = transactions.filter((transaction) => transaction.docChanged)
  if (
    !changed.length ||
    changed.some((transaction) => transaction.getMeta(SuggestionTrackingKey)?.skip || isHistoryTransaction(transaction))
  )
    return null
  const additions: Array<{ from: number; to: number; mark: ProseMirrorMark }> = []
  const removed: Array<{ from: number; slice: Slice }> = []
  const revisionAuthor = author.trim().slice(0, 200) || 'Guest'
  for (const transaction of changed) {
    for (let index = 0; index < transaction.steps.length; index++) {
      const step = transaction.steps[index]
      const data = step.toJSON() as {
        stepType?: string
        from?: number
        to?: number
        slice?: unknown
        mark?: { type?: string }
      }
      if (data.stepType === 'replace' && typeof data.from === 'number' && typeof data.to === 'number') {
        const before = transaction.docs[index]
        const mapping = transaction.mapping.slice(index + 1)
        const insertedSlice = Slice.fromJSON(state.schema, data.slice)
        const insertedFrom = mapping.map(data.from, -1)
        const insertedTo = mapping.map(data.from + insertedSlice.size, 1)
        if (insertedSlice.size > 0 && insertedTo > insertedFrom) {
          const insertionPoint = transaction.docs[index].resolve(data.from)
          const neighbor = insertionPoint.nodeBefore?.isText ? insertionPoint.nodeBefore : insertionPoint.nodeAfter
          const existing = neighbor?.isText ? suggestionMark(neighbor) : undefined
          const attrs =
            data.from === data.to && revisionKind(existing) === 'insert' && existing?.attrs.author === revisionAuthor
              ? existing.attrs
              : createRevision('insert', revisionAuthor)
          const mark = state.schema.marks.suggestion.create(attrs)
          additions.push({ from: insertedFrom, to: insertedTo, mark })
        }
        if (data.to > data.from) {
          const slice = before.slice(data.from, data.to)
          const from = mapping.map(data.from, -1)
          if (slice.content.size) {
            const mark = state.schema.marks.suggestion.create(createRevision('delete', revisionAuthor))
            const marked = withMark(slice, mark, true)
            if (marked.content.size) removed.push({ from, slice: marked })
          }
        }
      }
    }
  }

  const formatRanges: Array<{ from: number; to: number }> = []
  let onlyFormattingSteps = true
  for (const transaction of changed)
    for (let index = 0; index < transaction.steps.length; index++) {
      const data = transaction.steps[index].toJSON() as {
        stepType?: string
        from?: number
        to?: number
        mark?: { type?: string }
      }
      if (data.stepType === 'addMark' || data.stepType === 'removeMark') {
        if (formattingMarks.has(data.mark?.type || '') && typeof data.from === 'number' && typeof data.to === 'number')
          formatRanges.push({ from: data.from, to: data.to })
      } else onlyFormattingSteps = false
    }
  if (onlyFormattingSteps && formatRanges.length) {
    const id = createRevision('format', revisionAuthor).id
    const timestamp = new Date().toISOString()
    const seen = new Set<string>()
    for (const { from, to } of formatRanges) {
      oldState.doc.nodesBetween(from, to, (node, position) => {
        if (!node.isText || suggestionMark(node)) return
        const key = `${position}:${position + node.nodeSize}`
        if (seen.has(key)) return
        seen.add(key)
        const mappedFrom = state.tr.mapping.map(position, -1)
        const mappedTo = state.tr.mapping.map(position + node.nodeSize, 1)
        const previous = node.marks
          .filter((mark) => !['suggestion', 'comment'].includes(mark.type.name))
          .map((mark) => mark.toJSON())
        additions.push({
          from: mappedFrom,
          to: mappedTo,
          mark: state.schema.marks.suggestion.create({
            id,
            kind: 'format',
            author: revisionAuthor,
            timestamp,
            before: JSON.stringify(previous),
          }),
        })
      })
    }
  }

  if (!additions.length && !removed.length) return null
  const transaction = state.tr
  for (const { from, to, mark } of additions) if (to > from) transaction.addMark(from, to, mark)
  for (const entry of removed.sort((left, right) => right.from - left.from))
    transaction.replace(entry.from, entry.from, entry.slice)
  transaction.setMeta(SuggestionTrackingKey, { skip: true })
  return transaction
}

export const SuggestionMark = Mark.create({
  name: 'suggestion',
  inclusive: false,
  addAttributes() {
    return {
      id: { default: null, parseHTML: (element: HTMLElement) => element.getAttribute('data-suggestion-id') },
      kind: { default: 'insert', parseHTML: (element: HTMLElement) => element.getAttribute('data-suggestion-kind') },
      author: { default: 'Guest', parseHTML: (element: HTMLElement) => element.getAttribute('data-suggestion-author') },
      timestamp: {
        default: null,
        parseHTML: (element: HTMLElement) => element.getAttribute('data-suggestion-timestamp'),
      },
      before: { default: null },
    }
  },
  parseHTML() {
    return [{ tag: 'span[data-suggestion-id]' }]
  },
  renderHTML({ mark, HTMLAttributes }) {
    const kind = revisionKind(mark) || 'insert'
    return [
      'span',
      {
        ...HTMLAttributes,
        'data-suggestion-id': mark.attrs.id,
        'data-suggestion-kind': kind,
        'data-suggestion-author': mark.attrs.author,
        'data-suggestion-timestamp': mark.attrs.timestamp,
        class: `draft-suggestion draft-suggestion--${kind}`,
        title: `${kind} by ${mark.attrs.author || 'Guest'}${mark.attrs.timestamp ? ` at ${mark.attrs.timestamp}` : ''}`,
      },
      0,
    ]
  },
})

export const SuggestionTracking = Extension.create<SuggestionOptions>({
  name: 'suggestionTracking',
  addOptions() {
    return { getAuthor: () => 'Guest' }
  },
  addProseMirrorPlugins() {
    return [
      new Plugin<TrackingState>({
        key: SuggestionTrackingKey,
        state: {
          init: () => ({ enabled: false }),
          apply(transaction, current) {
            const meta = transaction.getMeta(SuggestionTrackingKey) as { enabled?: boolean } | undefined
            return typeof meta?.enabled === 'boolean' ? { enabled: meta.enabled } : current
          },
        },
        appendTransaction: (transactions, oldState, state) => {
          if (!SuggestionTrackingKey.getState(state)?.enabled) return null
          return appendTrackedChanges(transactions, oldState, state, this.options.getAuthor())
        },
      }),
    ]
  },
})
