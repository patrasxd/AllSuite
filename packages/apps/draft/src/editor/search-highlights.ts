import { Extension, type Editor } from '@tiptap/core'
import type { Node as ProseMirrorNode } from '@tiptap/pm/model'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'
import { findTextMatches, MAX_SEARCH_MATCHES, type SearchOptions, type SearchResult } from '../engine/search'

export type DocumentMatch = { from: number; to: number; text: string }
type HighlightState = { matches: DocumentMatch[]; current: number }

const highlightKey = new PluginKey<DecorationSet>('draftSearchHighlights')

export const SearchHighlights = Extension.create({
  name: 'searchHighlights',
  addProseMirrorPlugins() {
    return [
      new Plugin<DecorationSet>({
        key: highlightKey,
        state: {
          init: () => DecorationSet.empty,
          apply(transaction, previous) {
            const next = transaction.getMeta(highlightKey) as HighlightState | undefined
            if (!next) return previous.map(transaction.mapping, transaction.doc)
            return DecorationSet.create(
              transaction.doc,
              next.matches.map((match, index) =>
                Decoration.inline(match.from, match.to, {
                  class:
                    index === next.current ? 'draft-search-match draft-search-match--current' : 'draft-search-match',
                }),
              ),
            )
          },
        },
        props: { decorations: (state) => highlightKey.getState(state) },
      }),
    ]
  },
})

function textBlocks(doc: ProseMirrorNode) {
  const blocks: Array<{ text: string; positions: number[] }> = []
  doc.descendants((node, position) => {
    if (!node.isTextblock) return true
    let text = ''
    const positions: number[] = []
    node.descendants((child, offset) => {
      if (!child.isText || !child.text) return true
      for (let index = 0; index < child.text.length; index += 1) {
        text += child.text[index]
        positions.push(position + 1 + offset + index)
      }
      return false
    })
    blocks.push({ text, positions })
    return false
  })
  return blocks
}

export function findDocumentMatches(editor: Editor, query: string, options: SearchOptions) {
  const matches: DocumentMatch[] = []
  let error: SearchResult['error']
  let truncated = false
  const deadline = Date.now() + 50
  for (const block of textBlocks(editor.state.doc)) {
    if (Date.now() > deadline) {
      error = 'timeout'
      truncated = true
      break
    }
    const result = findTextMatches(block.text, query, options)
    error ||= result.error
    truncated ||= result.truncated
    for (const match of result.matches) {
      const from = block.positions[match.from]
      const last = block.positions[Math.max(match.from, match.to - 1)]
      if (from === undefined || last === undefined) continue
      matches.push({ from, to: last + 1, text: match.text })
      if (matches.length >= MAX_SEARCH_MATCHES) {
        truncated = true
        break
      }
    }
    if (matches.length >= MAX_SEARCH_MATCHES) break
  }
  return { matches, error, truncated }
}

export function setSearchHighlights(editor: Editor, matches: DocumentMatch[], current: number) {
  editor.view.dispatch(editor.state.tr.setMeta(highlightKey, { matches, current }))
}
