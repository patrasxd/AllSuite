import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Editor } from '@tiptap/core'
import { editorExtensions } from '../editor/extensions'
import { ParagraphDialog } from './ParagraphDialog'

const editors: Editor[] = []

afterEach(() => {
  cleanup()
  for (const editor of editors.splice(0)) editor.destroy()
})

function setup(locale: 'en' | 'pl' = 'en') {
  const editor = new Editor({
    content: '<p>Paragraph</p>',
    extensions: editorExtensions({ requestPlainPaste: vi.fn(), requestLink: vi.fn() }),
  })
  editors.push(editor)
  const onClose = vi.fn()
  render(<ParagraphDialog editor={editor} locale={locale} open onClose={onClose} />)
  return { editor, onClose }
}

describe('paragraph dialog', () => {
  it('keeps actions inside the dialog body without a separate footer shelf', () => {
    setup()
    const dialog = screen.getByRole('dialog', { name: 'Paragraph settings' })
    expect(dialog.querySelector('.all-dialog__footer')).toBeNull()
    expect(dialog.querySelector('.draft-dialog-actions')).toContainElement(
      screen.getByRole('button', { name: 'Apply' }),
    )
  })

  it('applies spacing, custom line spacing, indents and tab stops to the selected paragraph', () => {
    const { editor, onClose } = setup()
    fireEvent.change(screen.getByRole('textbox', { name: 'Spacing before (pt)' }), { target: { value: '6' } })
    fireEvent.change(screen.getByRole('textbox', { name: 'Spacing after (pt)' }), { target: { value: '12' } })
    fireEvent.change(screen.getByRole('combobox', { name: 'Line spacing' }), { target: { value: 'custom' } })
    fireEvent.change(screen.getByRole('textbox', { name: 'Custom line spacing' }), { target: { value: '1.25' } })
    fireEvent.change(screen.getByRole('textbox', { name: 'Left indent (pt)' }), { target: { value: '18' } })
    fireEvent.change(screen.getByRole('textbox', { name: 'Right indent (pt)' }), { target: { value: '9' } })
    fireEvent.change(screen.getByRole('textbox', { name: 'Hanging indent (pt)' }), { target: { value: '6' } })
    fireEvent.change(screen.getByRole('textbox', { name: 'Tab stops (pt)' }), { target: { value: '144, 72' } })
    fireEvent.click(screen.getByRole('checkbox', { name: 'Keep with next' }))
    fireEvent.click(screen.getByRole('checkbox', { name: 'Keep lines together' }))
    fireEvent.click(screen.getByRole('checkbox', { name: 'Widow/orphan control' }))
    act(() => fireEvent.click(screen.getByRole('button', { name: 'Apply' })))
    expect(editor.getJSON().content?.[0].attrs).toMatchObject({
      spacingBefore: 6,
      spacingAfter: 12,
      lineSpacing: 1.25,
      indentLeft: 18,
      indentRight: 9,
      indentHanging: 6,
      tabStops: [72, 144],
      keepNext: true,
      keepLines: true,
      widowControl: false,
    })
    expect(onClose).toHaveBeenCalledOnce()
  })

  it('keeps the Polish dialog open when a value is invalid', () => {
    const { onClose } = setup('pl')
    fireEvent.change(screen.getByRole('textbox', { name: 'Odstęp przed (pt)' }), { target: { value: '-2' } })
    fireEvent.click(screen.getByRole('button', { name: 'Zastosuj' }))
    expect(screen.getByRole('alert')).toHaveTextContent('Podaj poprawne wartości')
    expect(onClose).not.toHaveBeenCalled()
  })
  it('shows inherited spacing and preserves an explicit zero override', () => {
    const { editor } = setup()
    expect(screen.getByRole('textbox', { name: 'Spacing after (pt)' })).toHaveValue('8')
    expect(screen.getByRole('combobox', { name: 'Line spacing' })).toHaveValue('1.5')
    fireEvent.change(screen.getByRole('textbox', { name: 'Spacing after (pt)' }), { target: { value: '0' } })
    fireEvent.click(screen.getByRole('button', { name: 'Apply' }))
    expect(editor.getJSON().content?.[0].attrs?.spacingAfter).toBe(0)
  })
})
