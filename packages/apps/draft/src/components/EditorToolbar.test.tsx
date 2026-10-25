import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Editor } from '@tiptap/core'
import { EditorContent } from '@tiptap/react'
import { EditorToolbar } from './EditorToolbar'
import { editorExtensions } from '../editor/extensions'

const instances: Editor[] = []
afterEach(() => {
  cleanup()
  for (const editor of instances.splice(0)) editor.destroy()
})

function setup(
  content = '<p>Hello</p>',
  onClipboard = vi.fn(),
  toolbarProps: Partial<Parameters<typeof EditorToolbar>[0]> = {},
) {
  const editor = new Editor({
    content,
    extensions: editorExtensions({ requestPlainPaste: vi.fn(), requestLink: vi.fn() }),
  })
  instances.push(editor)
  render(
    <>
      <EditorToolbar editor={editor} locale="en" onClipboard={onClipboard} {...toolbarProps} />
      <EditorContent editor={editor} />
    </>,
  )
  return editor
}

describe('toolbar commands and selection state', () => {
  it('renders toolbar controls through AllUI primitives', () => {
    setup()

    for (const item of screen.getAllByRole('tab')) expect(item).toHaveClass('all-btn', 'all-btn--ghost')
    const bold = screen.getByRole('button', { name: 'Bold', exact: true })
    expect(bold).toHaveAttribute('title', 'Make selected text bold')
    expect(bold).toHaveClass('all-btn', 'all-icon-btn', 'all-btn--outline')
    expect(screen.getByRole('combobox', { name: 'Font family' })).toHaveClass('all-select-field')
    expect(screen.getByRole('combobox', { name: 'Font family' }).closest('.all-select-container')).toHaveClass(
      'all-select-container--compact',
    )

    fireEvent.click(screen.getByRole('tab', { name: 'View', exact: true }))
    const ruler = screen.getByRole('button', { name: 'Ruler' })
    const marks = screen.getByRole('button', { name: 'Show formatting marks' })
    expect(ruler).toHaveClass('all-btn', 'all-btn--sm', 'all-btn--primary')
    expect(ruler).toHaveAttribute('aria-pressed', 'true')
    expect(ruler.querySelector('.all-btn__icon svg')).toBeInTheDocument()
    expect(marks).toHaveClass('all-btn--outline')

    fireEvent.click(screen.getByRole('tab', { name: 'Insert', exact: true }))
    expect(screen.getByRole('button', { name: 'Horizontal rule' })).toHaveClass('all-btn--outline')
    expect(screen.getByRole('button', { name: 'Special characters' })).toHaveClass('all-btn--outline')
    expect(screen.getByRole('button', { name: 'Emoji' })).toHaveClass('all-btn--outline')
    for (const name of [
      'Horizontal rule',
      'Special characters',
      'Emoji',
      'Insert table',
      'Insert image',
      'Paste image',
    ]) {
      expect(screen.getByRole('button', { name, exact: true }).querySelector('.all-btn__icon svg')).toBeInTheDocument()
    }

    fireEvent.click(screen.getByRole('tab', { name: 'Layout', exact: true }))
    expect(screen.getByRole('combobox', { name: 'Paper size' }).closest('.all-select-container')).toHaveClass(
      'all-select-container--compact',
    )
    expect(screen.getByRole('button', { name: 'Open paragraph settings' })).toHaveClass('all-btn--outline')

    fireEvent.click(screen.getByRole('button', { name: 'File', exact: true }))
    expect(screen.getByRole('button', { name: 'New', exact: true })).toHaveClass('all-btn', 'all-btn--ghost')
  })

  it('navigates tabs by keyboard without replacing the document or formatting selection', () => {
    const editor = setup('<p>Hello</p>')
    act(() => editor.commands.setTextSelection({ from: 1, to: 6 }))
    fireEvent.click(screen.getByRole('button', { name: 'Bold', exact: true }))
    const edit = screen.getByRole('tab', { name: 'Home', exact: true })
    edit.focus()
    fireEvent.keyDown(edit, { key: 'Home' })
    expect(edit).toHaveFocus()
    expect(screen.getByRole('button', { name: 'Save document', exact: true })).toBeEnabled()
    fireEvent.click(screen.getByRole('button', { name: 'File', exact: true }))
    expect(screen.getByRole('button', { name: 'New', exact: true })).toBeEnabled()
    fireEvent.keyDown(screen.getByRole('button', { name: 'New', exact: true }), { key: 'Escape' })
    edit.focus()
    fireEvent.click(edit)
    expect(edit).toHaveFocus()
    expect(edit).toHaveAttribute('aria-selected', 'true')
    fireEvent.click(screen.getByRole('tab', { name: 'Home', exact: true }))
    expect(screen.getByRole('button', { name: 'Bold', exact: true })).toHaveAttribute('aria-pressed', 'true')
    expect(editor.getHTML()).toContain('<strong>Hello</strong>')
  })
  it('routes the Insert tab image paste action to the image clipboard flow', () => {
    const onClipboard = vi.fn()
    setup('<p>Hello</p>', onClipboard)
    fireEvent.click(screen.getByRole('tab', { name: 'Insert', exact: true }))
    fireEvent.click(screen.getByRole('button', { name: 'Paste image', exact: true }))
    expect(onClipboard).toHaveBeenCalledWith('pasteImage')
  })
  it('uses the View tab AllUI pressed button style for Review switches', () => {
    const onToggleTracking = vi.fn()
    const onToggleCommentsInPDF = vi.fn()
    setup('<p>Hello</p>', vi.fn(), { onToggleTracking, onToggleCommentsInPDF })
    fireEvent.click(screen.getByRole('tab', { name: 'Review', exact: true }))

    const trackChanges = screen.getByRole('button', { name: 'Track changes', exact: true })
    const includeComments = screen.getByRole('button', { name: 'Include comments in PDF', exact: true })
    for (const button of [trackChanges, includeComments]) {
      expect(button).toHaveClass('all-btn', 'all-btn--sm', 'all-btn--outline')
      expect(button).toHaveAttribute('aria-pressed', 'false')
    }

    fireEvent.click(trackChanges)
    fireEvent.click(includeComments)
    expect(onToggleTracking).toHaveBeenCalledWith(true)
    expect(onToggleCommentsInPDF).toHaveBeenCalledTimes(1)
  })
  it('toggles bold on actual selected text and reflects selection changes', () => {
    const editor = setup('<p>Hello world</p>')
    act(() => {
      editor.commands.setTextSelection({ from: 1, to: 6 })
    })
    const bold = screen.getByRole('button', { name: 'Bold', exact: true })
    expect(screen.getByRole('button', { name: 'Left', exact: true })).toHaveAttribute('aria-label', 'Left')
    fireEvent.click(bold)
    expect(editor.getHTML()).toContain('<strong>Hello</strong>')
    expect(bold).toHaveAttribute('aria-pressed', 'true')
    act(() => {
      editor.commands.setTextSelection(11)
    })
    expect(bold).toHaveAttribute('aria-pressed', 'false')
    act(() => {
      editor.commands.setTextSelection({ from: 1, to: 6 })
    })
    fireEvent.click(bold)
    expect(editor.getHTML()).not.toContain('<strong>')
  })

  it('enables undo/redo only when history can perform those commands', () => {
    const editor = setup()
    fireEvent.click(screen.getByRole('tab', { name: 'Home', exact: true }))
    const undo = screen.getByRole('button', { name: 'Undo', exact: true })
    const redo = screen.getByRole('button', { name: 'Redo', exact: true })
    expect(undo).toBeDisabled()
    expect(redo).toBeDisabled()
    act(() => {
      editor.commands.setTextSelection({ from: 1, to: 6 })
    })
    act(() => {
      editor.chain().focus().toggleBold().run()
    })
    expect(undo).not.toBeDisabled()
    fireEvent.click(undo)
    expect(editor.getHTML()).not.toContain('<strong>')
    expect(redo).not.toBeDisabled()
    fireEvent.click(redo)
    expect(editor.getHTML()).toContain('<strong>Hello</strong>')
  })

  it('nests and outdents a selected second list item', () => {
    const editor = setup('<ul><li><p>One</p></li><li><p>Two</p></li></ul>')
    let position = 0
    editor.state.doc.descendants((node, pos) => {
      if (node.isText && node.text === 'Two') position = pos
    })
    act(() => {
      editor.commands.setTextSelection(position)
    })
    const indent = screen.getByRole('button', { name: 'Indent list', exact: true })
    expect(indent).not.toBeDisabled()
    fireEvent.click(indent)
    expect(editor.view.dom.querySelectorAll('ul ul')).toHaveLength(1)
    fireEvent.click(screen.getByRole('button', { name: 'Outdent list', exact: true }))
    expect(editor.view.dom.querySelectorAll('ul ul')).toHaveLength(0)
    act(() => {
      editor.commands.setContent('<p>Plain</p>')
    })
    expect(indent).toBeDisabled()
  })

  it('applies point sizes, headings and mutually exclusive sub/superscript', () => {
    const editor = setup()
    act(() => {
      editor.commands.setTextSelection({ from: 1, to: 6 })
    })
    const size = screen.getByRole('textbox', { name: 'Font size (pt)' })
    fireEvent.change(size, { target: { value: '18' } })
    fireEvent.keyDown(size, { key: 'Enter' })
    expect(editor.getHTML()).toContain('font-size: 18pt')
    fireEvent.click(screen.getByRole('button', { name: 'Text style', exact: true }))
    fireEvent.click(screen.getByRole('button', { name: 'Heading 6', exact: true }))
    fireEvent.click(screen.getByRole('button', { name: 'More formatting', exact: true }))
    expect(editor.getHTML()).toContain('<h6')
    fireEvent.click(screen.getByRole('button', { name: 'Subscript' }))
    fireEvent.click(screen.getByRole('button', { name: 'Superscript' }))
    expect(editor.isActive('subscript')).toBe(false)
    expect(editor.isActive('superscript')).toBe(true)
  })

  it('clears formatting and applies the format painter once or repeatedly', () => {
    const editor = setup('<p><strong>Source</strong> Target Again</p>')
    act(() => editor.commands.setTextSelection({ from: 1, to: 7 }))
    const painter = screen.getByRole('button', { name: 'Format painter', exact: true })
    expect(painter).toHaveClass('all-icon-btn')
    expect(painter.textContent).toBe('')
    fireEvent.click(painter)
    act(() => editor.commands.setTextSelection({ from: 8, to: 14 }))
    expect(editor.getHTML()).toContain('<strong>Target</strong>')

    act(() => editor.commands.setTextSelection({ from: 1, to: 7 }))
    fireEvent.doubleClick(painter)
    act(() => editor.commands.setTextSelection({ from: 15, to: 20 }))
    expect(editor.getHTML()).toContain('<strong>Again</strong>')
    expect(painter).toHaveAttribute('aria-pressed', 'true')
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(painter).toHaveAttribute('aria-pressed', 'false')

    act(() => editor.commands.setTextSelection({ from: 1, to: 7 }))
    fireEvent.keyDown(painter, { key: 'Enter', shiftKey: true })
    expect(painter).toHaveAttribute('aria-pressed', 'true')
    fireEvent.keyDown(window, { key: 'Escape' })

    act(() => editor.commands.selectAll())
    fireEvent.click(screen.getByRole('button', { name: 'Clear formatting', exact: true }))
    expect(editor.getHTML()).not.toContain('<strong>')
  })
})
