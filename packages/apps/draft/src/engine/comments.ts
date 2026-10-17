import type { DraftDocument, DraftMark, DraftNode } from './document-model'

export type CommentReply = { id: string; author: string; text: string }
export type CommentThread = {
  id: string
  author: string
  text: string
  resolved: boolean
  replies: CommentReply[]
}

const validId = (value: unknown): value is string => typeof value === 'string' && /^[\w-]{1,160}$/.test(value)

function cleanText(value: unknown, limit = 20_000) {
  return typeof value === 'string' ? value.trim().slice(0, limit) : ''
}

export function readCommentThreads(value: unknown): CommentThread[] {
  let input = value
  if (typeof input === 'string') {
    try {
      input = JSON.parse(input)
    } catch {
      return []
    }
  }
  if (!Array.isArray(input)) return []
  const threads: CommentThread[] = []
  const seen = new Set<string>()
  for (const item of input.slice(0, 2000)) {
    if (!item || typeof item !== 'object') continue
    const thread = item as Record<string, unknown>
    if (!validId(thread.id) || seen.has(thread.id)) continue
    const text = cleanText(thread.text)
    if (!text) continue
    seen.add(thread.id)
    const replies: CommentReply[] = []
    const replyIds = new Set<string>()
    if (Array.isArray(thread.replies))
      for (const value of thread.replies.slice(0, 2000)) {
        if (!value || typeof value !== 'object') continue
        const reply = value as Record<string, unknown>
        if (!validId(reply.id) || replyIds.has(reply.id)) continue
        const replyText = cleanText(reply.text)
        if (!replyText) continue
        replyIds.add(reply.id)
        replies.push({
          id: reply.id,
          author: cleanText(reply.author, 200) || 'Guest',
          text: replyText,
        })
      }
    threads.push({
      id: thread.id,
      author: cleanText(thread.author, 200) || 'Guest',
      text,
      resolved: thread.resolved === true,
      replies,
    })
  }
  return threads
}

export const serializeCommentThreads = (threads: CommentThread[]) => JSON.stringify(readCommentThreads(threads))

export function commentIdsInNode(node: DraftNode): Set<string> {
  return new Set(
    (node.marks || [])
      .filter((mark) => mark.type === 'comment' && validId(mark.attrs?.id))
      .map((mark) => String(mark.attrs!.id)),
  )
}

export function anchoredCommentIds(document: Pick<DraftDocument, 'content'>): Set<string> {
  const ids = new Set<string>()
  const visit = (node: DraftNode) => {
    if (node.type === 'text') for (const id of commentIdsInNode(node)) ids.add(id)
    node.content?.forEach(visit)
  }
  document.content.forEach(visit)
  return ids
}

export function reconcileCommentThreads(document: DraftDocument): DraftDocument {
  const comments = readCommentThreads(document.attrs?.comments)
  const anchored = anchoredCommentIds(document)
  const reconciled = comments.filter((thread) => anchored.has(thread.id))
  if (reconciled.length !== comments.length)
    return {
      ...document,
      attrs: { ...document.attrs, comments: serializeCommentThreads(reconciled) },
    }
  return document
}

export type CommentRangeBoundary = { start: string[]; end: string[] }

/** Marks the first and last text node of each contiguous anchor for DOCX export. */
export function commentRangeBoundaries(nodes: DraftNode[], threadIds: Set<string>) {
  const textNodes: DraftNode[] = []
  const visit = (node: DraftNode) => {
    if (node.type === 'text') textNodes.push(node)
    node.content?.forEach(visit)
  }
  nodes.forEach(visit)
  const boundaries = new Map<DraftNode, CommentRangeBoundary>()
  const get = (node: DraftNode) => {
    let boundary = boundaries.get(node)
    if (!boundary) boundaries.set(node, (boundary = { start: [], end: [] }))
    return boundary
  }
  let previous: DraftNode | undefined
  let active = new Set<string>()
  for (const node of textNodes) {
    const current = new Set([...commentIdsInNode(node)].filter((id) => threadIds.has(id)))
    for (const id of active) if (!current.has(id) && previous) get(previous).end.push(id)
    for (const id of current) if (!active.has(id)) get(node).start.push(id)
    active = current
    previous = node
  }
  if (previous) for (const id of active) get(previous).end.push(id)
  return boundaries
}

export function commentMark(id: string): DraftMark {
  return { type: 'comment', attrs: { id } }
}
