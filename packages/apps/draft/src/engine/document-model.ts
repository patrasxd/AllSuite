export type DraftMark = {
  type: string
  attrs?: Record<string, string | number | boolean | null>
}

export type DraftNode = {
  type: string
  attrs?: Record<string, string | number | boolean | null | number[]>
  text?: string
  marks?: DraftMark[]
  content?: DraftNode[]
}

export type DraftDocument = { type: 'doc'; attrs?: DraftNode['attrs']; content: DraftNode[] }

export type UnsupportedContent = {
  kind: string
  detail?: string
}

export type ImportResult = {
  document: DraftDocument
  language?: string
  unsupported: UnsupportedContent[]
}

export function emptyDocument(): DraftDocument {
  return { type: 'doc', attrs: { columns: 1 }, content: [{ type: 'paragraph' }] }
}

export function textDocument(text: string): DraftDocument {
  const content = text
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((line) => ({
      type: 'paragraph',
      content: line ? [{ type: 'text', text: line }] : undefined,
    }))
  return { type: 'doc', attrs: { columns: 1 }, content: content.length ? content : [{ type: 'paragraph' }] }
}
