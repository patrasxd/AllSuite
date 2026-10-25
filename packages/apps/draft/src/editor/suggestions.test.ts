import { afterEach, describe, expect, it } from 'vitest'
import { Editor } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'
import {
  readSuggestions,
  resolveSuggestions,
  setSuggestionTracking,
  SuggestionMark,
  SuggestionTracking,
} from './suggestions'

let editor: Editor | undefined
afterEach(() => {
  editor?.destroy()
  editor = undefined
})

function createEditor(text: string) {
  editor = new Editor({
    extensions: [StarterKit, SuggestionMark, SuggestionTracking.configure({ getAuthor: () => 'Avery' })],
    content: `<p>${text}</p>`,
  })
  return editor
}

describe('suggestion tracking', () => {
  it('undo and redo a review decision without re-tracking restored revision identities', () => {
    const current = createEditor('Original')
    setSuggestionTracking(current, true)
    current.commands.insertContentAt(9, ' addition')
    const before = readSuggestions(current.state.doc)
    expect(before).toHaveLength(1)
    resolveSuggestions(
      current,
      before.map((item) => item.id),
      'reject',
    )
    expect(current.getText()).toBe('Original')
    current.commands.undo()
    expect(readSuggestions(current.state.doc)).toEqual(before)
    current.commands.redo()
    expect(current.getText()).toBe('Original')
    expect(readSuggestions(current.state.doc)).toEqual([])
  })
  it('records deleted text with its author and timestamp, then rejects the deletion', () => {
    const current = createEditor('keep remove')
    setSuggestionTracking(current, true)
    current.commands.setTextSelection({ from: 6, to: 12 })
    current.commands.deleteSelection()

    const [suggestion] = readSuggestions(current.state.doc)
    expect(suggestion).toMatchObject({ kind: 'delete', author: 'Avery', text: 'remove' })
    expect(Number.isNaN(Date.parse(suggestion.timestamp))).toBe(false)
    expect(current.getText()).toBe('keep remove')

    resolveSuggestions(current, [suggestion.id], 'reject')
    expect(current.getText()).toBe('keep remove')
    expect(readSuggestions(current.state.doc)).toEqual([])
  })

  it('records typed text as an insertion and can reject it', () => {
    const current = createEditor('base')
    setSuggestionTracking(current, true)
    current.commands.setTextSelection(5)
    current.commands.insertContent(' addition')

    const [suggestion] = readSuggestions(current.state.doc)
    expect(suggestion).toMatchObject({ kind: 'insert', author: 'Avery', text: ' addition' })
    resolveSuggestions(current, [suggestion.id], 'reject')
    expect(current.getText()).toBe('base')
  })

  it('records character formatting and accepts or restores the style', () => {
    const current = createEditor('styled')
    setSuggestionTracking(current, true)
    current.commands.setTextSelection({ from: 1, to: 7 })
    current.commands.toggleBold()

    let suggestion = readSuggestions(current.state.doc)[0]
    expect(suggestion).toMatchObject({ kind: 'format', text: 'styled' })
    resolveSuggestions(current, [suggestion.id], 'reject')
    expect(current.isActive('bold')).toBe(false)

    current.commands.setTextSelection({ from: 1, to: 7 })
    current.commands.toggleBold()
    suggestion = readSuggestions(current.state.doc)[0]
    expect(suggestion.kind).toBe('format')
    resolveSuggestions(current, [suggestion.id], 'accept')
    expect(current.isActive('bold')).toBe(true)
    expect(readSuggestions(current.state.doc)).toEqual([])
  })

  it('accepts and rejects all matching revisions in one operation', () => {
    const current = createEditor('alpha beta')
    const mark = current.schema.marks.suggestion
    current.view.dispatch(
      current.state.tr
        .addMark(
          1,
          6,
          mark.create({ id: 'insert-a', kind: 'insert', author: 'Avery', timestamp: '2026-01-01T00:00:00Z' }),
        )
        .addMark(
          7,
          11,
          mark.create({ id: 'delete-b', kind: 'delete', author: 'Sam', timestamp: '2026-01-02T00:00:00Z' }),
        ),
    )

    resolveSuggestions(current, ['insert-a', 'delete-b'], 'accept')
    expect(current.getText()).toBe('alpha ')
    expect(readSuggestions(current.state.doc)).toEqual([])
  })

  it('rejects all matching revisions in one operation', () => {
    const current = createEditor('alpha beta')
    const mark = current.schema.marks.suggestion
    current.view.dispatch(
      current.state.tr
        .addMark(
          1,
          6,
          mark.create({ id: 'insert-a', kind: 'insert', author: 'Avery', timestamp: '2026-01-01T00:00:00Z' }),
        )
        .addMark(
          7,
          11,
          mark.create({ id: 'delete-b', kind: 'delete', author: 'Sam', timestamp: '2026-01-02T00:00:00Z' }),
        ),
    )

    resolveSuggestions(current, ['insert-a', 'delete-b'], 'reject')
    expect(current.getText()).toBe(' beta')
    expect(readSuggestions(current.state.doc)).toEqual([])
  })
})
