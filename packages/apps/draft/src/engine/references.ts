import type { DraftDocument, DraftNode } from './document-model'
import { paragraphStyleId, styleHeading, stylesForDocument } from './styles'

export function safeLink(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const href = value.trim()
  if (Array.from(href).some((character) => character.charCodeAt(0) <= 32 || character.charCodeAt(0) === 127))
    return undefined
  if (/^#(?:(?:note|ref):)?[A-Za-z_][\w-]{0,159}$/.test(href)) return href
  if (!/^(https?:|mailto:|tel:)/i.test(href)) return undefined
  try {
    const url = new URL(href)
    if ((url.protocol === 'http:' || url.protocol === 'https:') && (!url.hostname || url.username || url.password))
      return undefined
    return href
  } catch {
    return undefined
  }
}
export const validTargetId = (value: unknown): value is string =>
  typeof value === 'string' && /^[A-Za-z_][\w-]{0,159}$/.test(value)
export function nodeText(node: DraftNode): string {
  if (node.type === 'captionNumber')
    return `${node.attrs?.showLabel === false ? '' : (node.attrs?.label || 'Figure') + ' '}${node.attrs?.number || 1}`
  if (node.type === 'noteReference') return String(node.attrs?.number || 1)
  if (node.type === 'crossReference') return String(node.attrs?.label || '')
  return node.type === 'text' ? node.text || '' : (node.content || []).map(nodeText).join('')
}
export type ReferenceTarget = {
  id: string
  label: string
  kind: 'heading' | 'bookmark' | 'caption' | 'note'
  level: number
  number?: string
  captionLabel?: string
  noteKind?: 'footnote' | 'endnote'
}
export type ReferencePages = Record<string, string>
export const validCaptionLabel = (value: unknown): value is string =>
  typeof value === 'string' && /^[\p{L}_][\p{L}\p{N} _-]{0,63}$/u.test(value)
export function captionSequence(node: DraftNode): DraftNode | undefined {
  if (node.type === 'captionNumber' && validCaptionLabel(node.attrs?.label)) return node
  for (const child of node.content || []) {
    // Native DOCX often bookmarks only the SEQ result within a caption paragraph.
    if (child.type !== 'bookmark' && child.type !== 'captionNumber') continue
    const sequence = captionSequence(child)
    if (sequence) return sequence
  }
}
export function captionLabels(document: DraftDocument, locale = 'en'): string[] {
  let labels: string[] = locale.toLowerCase().startsWith('pl') ? ['Rysunek', 'Tabela'] : ['Figure', 'Table']
  try {
    const value = JSON.parse(String(document.attrs?.captionLabels))
    if (Array.isArray(value) && value.length <= 50 && value.every(validCaptionLabel)) labels = value
  } catch {
    /* Localized defaults. */
  }
  const visit = (node: DraftNode) => {
    if (node.type === 'captionNumber' && validCaptionLabel(node.attrs?.label)) labels.push(node.attrs.label)
    node.content?.forEach(visit)
  }
  visit(document)
  return [...new Set(labels)]
}
export function referenceTargets(document: DraftDocument): ReferenceTarget[] {
  const styles = stylesForDocument(document)
  const targets: ReferenceTarget[] = []
  function visit(node: DraftNode) {
    if (['tableOfContents', 'note'].includes(node.type)) return
    const level =
      node.type === 'heading'
        ? Number(node.attrs?.level)
        : node.type === 'paragraph'
          ? styleHeading(styles, paragraphStyleId(node))
          : undefined
    const id = node.attrs?.anchorId
    const label = nodeText(node).trim().replace(/\s+/g, ' ')
    if (level && validTargetId(id) && label) targets.push({ id, label, kind: 'heading', level })
    if (node.type === 'paragraph' && validCaptionLabel(node.attrs?.captionLabel) && validTargetId(id)) {
      const seq = captionSequence(node)
      targets.push({
        id,
        label,
        kind: 'caption',
        level: 1,
        captionLabel: node.attrs.captionLabel,
        number: seq ? nodeText(seq) : label,
      })
    }
    if (
      node.type === 'noteReference' &&
      validTargetId(node.attrs?.id) &&
      !targets.some((target) => target.id === node.attrs!.id)
    )
      targets.push({
        id: node.attrs.id,
        label: String(node.attrs.number),
        kind: 'note',
        noteKind: node.attrs.kind === 'endnote' ? 'endnote' : 'footnote',
        level: 0,
        number: String(node.attrs.number),
      })
    if (node.type === 'bookmark' && validTargetId(node.attrs?.id))
      targets.push({
        id: node.attrs.id,
        label: label || String(node.attrs.name || node.attrs.id),
        kind: 'bookmark',
        level: 0,
      })
    for (const child of node.content || []) visit(child)
  }
  visit(document)
  return targets
}
export function tocEntries(
  document: DraftDocument,
  minLevel = 1,
  maxLevel = 3,
  pages?: ReferencePages,
  captionLabel?: string,
): DraftNode[] {
  const min = Math.max(1, Math.min(6, Number(minLevel) || 1))
  const max = Math.max(min, Math.min(6, Number(maxLevel) || 3))
  return referenceTargets(document)
    .filter((target) =>
      captionLabel
        ? target.kind === 'caption' && target.captionLabel === captionLabel
        : target.kind === 'heading' && target.level >= min && target.level <= max,
    )
    .map((target) => ({
      type: 'tocEntry',
      attrs: { targetId: target.id, level: target.level, ...(pages ? { pageNumber: pages[target.id] || '?' } : {}) },
      content: [{ type: 'text', text: target.label }],
    }))
}
export function freshTargetId(document: DraftDocument, prefix: string) {
  const ids = new Set<string>()
  function visit(node: DraftNode) {
    for (const key of ['id', 'anchorId']) if (typeof node.attrs?.[key] === 'string') ids.add(node.attrs[key] as string)
    for (const child of node.content || []) visit(child)
  }
  visit(document)
  let count = 1
  while (ids.has(`${prefix}_${count}`)) count++
  return `${prefix}_${count}`
}

// IDs and note numbers are document data; resolving them never writes to browser storage.
export function normalizeReferences(input: DraftDocument): DraftDocument {
  const document = structuredClone(input)
  const styles = stylesForDocument(document)
  const used = new Set<string>()
  const notes = new Map<string, { number: number; kind: string }>()
  const counts = { footnote: 0, endnote: 0 }
  const sequences = new Map<string, number>()
  function visit(node: DraftNode, inNote = false) {
    if (node.marks) node.marks = node.marks.filter((mark) => mark.type !== 'link' || safeLink(mark.attrs?.href))
    const heading =
      node.type === 'heading' || (node.type === 'paragraph' && styleHeading(styles, paragraphStyleId(node)))
    if (node.type === 'paragraph') {
      const sequence = captionSequence(node)
      if (sequence)
        node.attrs = {
          ...node.attrs,
          captionLabel: sequence.attrs!.label,
          captionPosition: node.attrs?.captionPosition === 'above' ? 'above' : 'below',
        }
      else if (node.attrs?.captionLabel) node.attrs = { ...node.attrs, captionLabel: null, captionPosition: null }
    }
    if (node.type === 'captionNumber' && validCaptionLabel(node.attrs?.label)) {
      const label = node.attrs.label
      const number = (sequences.get(label) || 0) + 1
      sequences.set(label, number)
      node.attrs = { ...node.attrs, number }
    }
    if (((heading || validCaptionLabel(node.attrs?.captionLabel)) && !inNote) || node.type === 'bookmark') {
      const key = node.type === 'bookmark' ? 'id' : 'anchorId'
      let id = node.attrs?.[key]
      if (!validTargetId(id) || used.has(id))
        id = freshTargetId(
          document,
          node.type === 'bookmark' ? 'bookmark' : validCaptionLabel(node.attrs?.captionLabel) ? 'caption' : 'heading',
        )
      node.attrs = { ...node.attrs, [key]: id }
      used.add(id as string)
    }
    if (node.type === 'noteReference' && !inNote) {
      const kind = node.attrs?.kind === 'endnote' ? 'endnote' : 'footnote'
      let id = node.attrs?.id
      if (!validTargetId(id)) id = freshTargetId(document, kind)
      if (!notes.has(id as string)) notes.set(id as string, { number: ++counts[kind], kind })
      node.attrs = { ...node.attrs, id: id as string, ...notes.get(id as string) }
    }
    if (node.type === 'tableOfContents') return
    for (const child of node.content || []) visit(child, inNote || node.type === 'note')
  }
  visit(document)
  const bodies = new Map<string, DraftNode>()
  for (const node of document.content)
    if (node.type === 'note' && !bodies.has(String(node.attrs?.id))) bodies.set(String(node.attrs?.id), node)
  document.content = document.content.filter((node) => node.type !== 'note')
  const ordered = [...notes].sort((a, b) => Number(a[1].kind === 'endnote') - Number(b[1].kind === 'endnote'))
  for (const [id, info] of ordered) {
    let note = bodies.get(id)
    if (!note) {
      note = { type: 'note', attrs: { id }, content: [{ type: 'paragraph' }] }
    }
    note.attrs = { ...note.attrs, ...info }
    document.content.push(note)
  }
  return document
}
export function updateReferenceFields(input: DraftDocument, pages?: ReferencePages): DraftDocument {
  const document = normalizeReferences(input)
  const targets = referenceTargets(document)
  function visit(node: DraftNode) {
    if (node.type === 'tableOfContents') {
      const previous = new Map(node.content?.map((entry) => [entry.attrs?.targetId, entry.attrs?.pageNumber]))
      node.content = tocEntries(
        document,
        Number(node.attrs?.minLevel),
        Number(node.attrs?.maxLevel),
        pages,
        typeof node.attrs?.captionLabel === 'string' ? node.attrs.captionLabel : undefined,
      )
      if (!pages)
        for (const entry of node.content)
          if (previous.has(entry.attrs?.targetId))
            entry.attrs = { ...entry.attrs, pageNumber: previous.get(entry.attrs?.targetId)! }
    }
    if (node.type === 'crossReference')
      node.attrs = {
        ...node.attrs,
        label: (() => {
          const target = targets.find((target) => target.id === node.attrs?.targetId)
          if (!target) return '[Missing reference]'
          return node.attrs?.format === 'page'
            ? pages
              ? pages[target.id] || '?'
              : String(node.attrs.label || '?')
            : node.attrs?.format === 'number'
              ? target.number || target.label
              : target.label
        })(),
      }
    else for (const child of node.content || []) visit(child)
  }
  visit(document)
  return document
}
