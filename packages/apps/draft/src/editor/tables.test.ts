import { afterEach, describe, expect, it, vi } from 'vitest'
import { Editor } from '@tiptap/core'
import { CellSelection, TableMap } from '@tiptap/pm/tables'
import { editorExtensions } from './extensions'
import { sanitizeClipboardHTML } from './paste'
import { setTableBorders, toggleRepeatHeader } from './tables'

const editors: Editor[] = []
afterEach(() => editors.splice(0).forEach((e) => e.destroy()))
function setup(html = '<p>Before</p>') {
  const e = new Editor({
    extensions: editorExtensions({ requestPlainPaste: vi.fn(), requestLink: vi.fn() }),
    content: html,
  })
  editors.push(e)
  return e
}
function cells(e: Editor) {
  const result: number[] = []
  e.state.doc.descendants((node, pos) => {
    if (node.type.name === 'tableCell' || node.type.name === 'tableHeader') result.push(pos)
  })
  return result
}
function key(e: Editor, key: string, shiftKey = false) {
  const event = new KeyboardEvent('keydown', { key, shiftKey, bubbles: true, cancelable: true })
  e.view.dom.dispatchEvent(event)
}

describe('Draft table editing', () => {
  it('navigates forward/backward and adds a last row with Tab without inserting literal tabs', () => {
    const e = setup()
    e.commands.insertTable({ rows: 2, cols: 2, withHeaderRow: true })
    const positions = cells(e)
    e.commands.setTextSelection(positions[0] + 2)
    key(e, 'Tab')
    expect(e.state.selection.from).toBe(positions[1] + 2)
    key(e, 'Tab', true)
    expect(e.state.selection.from).toBe(positions[0] + 2)
    e.commands.setTextSelection(positions[3] + 2)
    key(e, 'Tab')
    expect(cells(e)).toHaveLength(6)
    expect(e.getText()).not.toContain('\t')
    expect(e.commands.undo()).toBe(true)
  })
  it('selects ranges, merges and splits, applies outer borders using grid coordinates', () => {
    const e = setup('<table><tr><td>A</td><td>B</td></tr><tr><td>C</td><td>D</td></tr></table>')
    const positions = cells(e)
    e.commands.setCellSelection({ anchorCell: positions[0], headCell: positions[1] })
    expect(e.state.selection).toBeInstanceOf(CellSelection)
    expect(e.commands.mergeCells()).toBe(true)
    expect(e.state.doc.firstChild?.firstChild?.firstChild?.attrs.colspan).toBe(2)
    setTableBorders(e, 'outer', '#123456', 2)
    expect(e.state.doc.firstChild?.firstChild?.firstChild?.attrs.borderTop).toBe('2px solid #123456')
    expect(e.state.doc.firstChild?.firstChild?.firstChild?.attrs.borderBottom).toBe('0px none')
    expect(e.commands.splitCell()).toBe(true)
    expect(TableMap.get(e.state.doc.firstChild!).width).toBe(2)
    expect(e.commands.addColumnAfter()).toBe(true)
    e.commands.setTextSelection(cells(e)[0] + 2)
    expect(e.commands.deleteColumn()).toBe(true)
    expect(e.commands.addRowAfter()).toBe(true)
    e.commands.setTextSelection(cells(e)[0] + 2)
    expect(e.commands.deleteRow()).toBe(true)
    toggleRepeatHeader(e)
    expect(e.state.doc.firstChild?.firstChild?.attrs.repeatHeader).toBe(true)
  })
  it('pastes a styled HTML table with spans and column widths after sanitization', () => {
    const html = `<table onclick="evil()"><colgroup><col style="width:120px"><col style="width:135pt"></colgroup><thead><tr><th colspan="2" style="background-color:#ffeeaa;padding:8px;border:2px solid #123456">Heading</th></tr></thead><tbody><tr><td rowspan="2" style="vertical-align:bottom">A</td><td>B</td></tr><tr><td>C<script>evil()</script><img src="https://bad.test/x"></td></tr></tbody></table>`
    const safe = sanitizeClipboardHTML(html)
    expect(safe).not.toMatch(/evil|https:|<script|<img/)
    const e = setup('<p></p>')
    e.commands.insertContent(safe)
    const table = e.getJSON().content?.find((node) => node.type === 'table')
    expect(table?.content?.[0].attrs?.repeatHeader).toBe(true)
    expect(table?.content?.[0].content?.[0].attrs).toMatchObject({ colspan: 2, colwidth: [120, 180], padding: '8px' })
    expect(table?.content?.[1].content?.[0].attrs?.rowspan).toBe(2)
    expect(table?.content?.[2].content).toHaveLength(1)
  })
})
