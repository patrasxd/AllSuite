import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { Editor } from '@tiptap/core'
import { editorExtensions } from '../editor/extensions'
import { InsertTable, TableTools } from './TableTools'

const instances: Editor[] = []
afterEach(() => instances.splice(0).forEach((editor) => editor.destroy()))
function setup(content = '<p>Outside</p>') {
  const editor = new Editor({
    extensions: editorExtensions({ requestPlainPaste: vi.fn(), requestLink: vi.fn() }),
    content,
  })
  instances.push(editor)
  return editor
}
it('only shows contextual controls in tables and uses Polish labels', () => {
  const editor = setup()
  const { rerender } = render(<TableTools editor={editor} locale="pl" />)
  expect(screen.queryByRole('toolbar')).not.toBeInTheDocument()
  act(() => {
    editor.commands.insertTable({ rows: 2, cols: 2 })
  })
  rerender(<TableTools editor={editor} locale="pl" />)
  expect(screen.getByRole('toolbar', { name: 'Narzędzia tabeli' })).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'Usuń tabelę' }))
  expect(editor.getHTML()).not.toContain('<table')
})
it('inserts the requested grid from the size picker', () => {
  const editor = setup()
  render(<InsertTable editor={editor} locale="en" />)
  fireEvent.click(screen.getByRole('button', { name: 'Insert table' }))
  fireEvent.click(screen.getByRole('button', { name: '2 × 3' }))
  const table = editor.getJSON().content?.find((node) => node.type === 'table')
  expect(table?.content).toHaveLength(2)
  expect(table?.content?.[0].content).toHaveLength(3)
})

it('formats a cell range and applies whole-table border presets', () => {
  const editor = setup('<table><tr><td>A</td><td>B</td></tr></table>')
  const positions: number[] = []
  editor.state.doc.descendants((node, pos) => {
    if (node.type.name === 'tableCell') positions.push(pos)
  })
  editor.commands.setCellSelection({ anchorCell: positions[0], headCell: positions[1] })
  render(<TableTools editor={editor} locale="en" />)
  fireEvent.change(screen.getByLabelText('Cell background'), { target: { value: '#abcdef' } })
  fireEvent.change(screen.getByLabelText('Vertical alignment'), { target: { value: 'bottom' } })
  fireEvent.change(screen.getByLabelText('Cell padding (px)'), { target: { value: '12' } })
  for (const cell of editor.getJSON().content?.[0].content?.[0].content || []) {
    expect(cell.attrs).toMatchObject({ backgroundColor: '#abcdef', verticalAlign: 'bottom', padding: '12px' })
  }
  fireEvent.change(screen.getByLabelText('Table borders'), { target: { value: 'none' } })
  expect(editor.getJSON().content?.[0].content?.[0].content?.[0].attrs?.borderTop).toBe('0px none')
  fireEvent.change(screen.getByLabelText('Border color'), { target: { value: '#123456' } })
  fireEvent.change(screen.getByLabelText('Border width (px)'), { target: { value: '3' } })
  fireEvent.change(screen.getByLabelText('Table borders'), { target: { value: 'all' } })
  expect(editor.getJSON().content?.[0].content?.[0].content?.[0].attrs?.borderTop).toBe('3px solid #123456')
})
