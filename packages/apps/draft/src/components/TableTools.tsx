import { useState } from 'react'
import { Button, Dialog, Input, Select, TrashIcon } from '@all/ui'
import { DraftIcon } from './DraftIcons'
import { useEditorState } from '@tiptap/react'
import type { Editor } from '@tiptap/core'
import type { Locale } from '../types'
import { setTableBorders, toggleRepeatHeader } from '../editor/tables'

const labels = {
  en: {
    insert: 'Insert table',
    rows: 'Rows',
    columns: 'Columns',
    tools: 'Table tools',
    beforeRow: 'Row above',
    afterRow: 'Row below',
    deleteRow: 'Delete row',
    beforeCol: 'Column before',
    afterCol: 'Column after',
    deleteCol: 'Delete column',
    merge: 'Merge cells',
    split: 'Split cell',
    header: 'Header row',
    repeat: 'Repeat header row',
    remove: 'Delete table',
    background: 'Cell background',
    vertical: 'Vertical alignment',
    padding: 'Cell padding (px)',
    borders: 'Table borders',
    color: 'Border color',
    width: 'Border width (px)',
    align: 'Table alignment',
    none: 'None',
    all: 'All',
    outer: 'Outer',
    top: 'Top',
    middle: 'Middle',
    bottom: 'Bottom',
    left: 'Left',
    center: 'Center',
    right: 'Right',
  },
  pl: {
    insert: 'Wstaw tabelę',
    rows: 'Wiersze',
    columns: 'Kolumny',
    tools: 'Narzędzia tabeli',
    beforeRow: 'Wiersz powyżej',
    afterRow: 'Wiersz poniżej',
    deleteRow: 'Usuń wiersz',
    beforeCol: 'Kolumna przed',
    afterCol: 'Kolumna za',
    deleteCol: 'Usuń kolumnę',
    merge: 'Scal komórki',
    split: 'Podziel komórkę',
    header: 'Wiersz nagłówka',
    repeat: 'Powtarzaj nagłówek',
    remove: 'Usuń tabelę',
    background: 'Tło komórki',
    vertical: 'Wyrównanie pionowe',
    padding: 'Margines komórki (px)',
    borders: 'Obramowanie tabeli',
    color: 'Kolor obramowania',
    width: 'Grubość obramowania (px)',
    align: 'Wyrównanie tabeli',
    none: 'Brak',
    all: 'Wszystkie',
    outer: 'Zewnętrzne',
    top: 'Góra',
    middle: 'Środek',
    bottom: 'Dół',
    left: 'Do lewej',
    center: 'Wyśrodkowane',
    right: 'Do prawej',
  },
}

export function InsertTable({ editor, locale }: { editor: Editor; locale: Locale }) {
  const t = labels[locale]
  const [open, setOpen] = useState(false)
  const [rows, setRows] = useState(3)
  const [cols, setCols] = useState(3)
  return (
    <>
      <Button size="sm" variant="outline" icon={<DraftIcon name="table" />} onClick={() => setOpen(true)}>
        {t.insert}
      </Button>
      <Dialog open={open} onClose={() => setOpen(false)} title={t.insert}>
        <div className="draft-table-picker">
          <Input
            type="number"
            min={1}
            max={20}
            aria-label={t.rows}
            label={t.rows}
            value={rows}
            onChange={(event) => setRows(Number(event.target.value))}
          />
          <Input
            type="number"
            min={1}
            max={20}
            aria-label={t.columns}
            label={t.columns}
            value={cols}
            onChange={(event) => setCols(Number(event.target.value))}
          />
          <div className="draft-table-size-grid">
            {Array.from({ length: 25 }, (_, i) => (
              <Button
                key={i}
                variant="outline"
                aria-label={`${Math.floor(i / 5) + 1} × ${(i % 5) + 1}`}
                onClick={() => {
                  editor
                    .chain()
                    .focus()
                    .insertTable({ rows: Math.floor(i / 5) + 1, cols: (i % 5) + 1, withHeaderRow: true })
                    .run()
                  setOpen(false)
                }}
              >
                {Math.floor(i / 5) + 1} × {(i % 5) + 1}
              </Button>
            ))}
          </div>
          <Button
            icon={<DraftIcon name="table" />}
            disabled={
              !Number.isInteger(rows) || !Number.isInteger(cols) || rows < 1 || rows > 20 || cols < 1 || cols > 20
            }
            onClick={() => {
              editor.chain().focus().insertTable({ rows, cols, withHeaderRow: true }).run()
              setOpen(false)
            }}
          >
            {t.insert}
          </Button>
        </div>
      </Dialog>
    </>
  )
}

export function TableTools({ editor, locale }: { editor: Editor; locale: Locale }) {
  const t = labels[locale]
  const [color, setColor] = useState('#808080')
  const [width, setWidth] = useState(1)
  const [borderMode, setBorderMode] = useState('all')
  const state = useEditorState({
    editor,
    selector: ({ editor: e }) => ({
      active: e.isActive('table'),
      merge: e.can().mergeCells(),
      split: e.can().splitCell(),
      header: e.isActive('tableHeader'),
      cell: e.getAttributes(e.isActive('tableHeader') ? 'tableHeader' : 'tableCell'),
      style: e.getAttributes('table').style || '',
      repeat: (() => {
        const { $from } = e.state.selection
        for (let d = $from.depth; d > 0; d--)
          if ($from.node(d).type.name === 'table') return Boolean($from.node(d).firstChild?.attrs.repeatHeader)
        return false
      })(),
    }),
  })
  if (!state.active) return null
  const cell = (key: string, value: string) => editor.chain().focus().setCellAttribute(key, value).run()
  const actions = [
    [t.beforeRow, () => editor.chain().focus().addRowBefore().run(), 'rowBefore'],
    [t.afterRow, () => editor.chain().focus().addRowAfter().run(), 'rowAfter'],
    [t.deleteRow, () => editor.chain().focus().deleteRow().run(), 'rowDelete'],
    [t.beforeCol, () => editor.chain().focus().addColumnBefore().run(), 'columnBefore'],
    [t.afterCol, () => editor.chain().focus().addColumnAfter().run(), 'columnAfter'],
    [t.deleteCol, () => editor.chain().focus().deleteColumn().run(), 'columnDelete'],
  ] as const
  return (
    <div className="draft-table-tools" role="toolbar" aria-label={t.tools}>
      {actions.map(([label, action, icon]) => (
        <Button key={label} size="sm" variant="outline" icon={<DraftIcon name={icon} />} onClick={action}>
          {label}
        </Button>
      ))}
      <Button
        size="sm"
        variant="outline"
        disabled={!state.merge}
        icon={<DraftIcon name="merge" />}
        onClick={() => editor.chain().focus().mergeCells().run()}
      >
        {t.merge}
      </Button>
      <Button
        size="sm"
        variant="outline"
        disabled={!state.split}
        icon={<DraftIcon name="split" />}
        onClick={() => editor.chain().focus().splitCell().run()}
      >
        {t.split}
      </Button>
      <Button
        size="sm"
        variant="outline"
        aria-pressed={state.header}
        icon={<DraftIcon name="header" />}
        onClick={() => editor.chain().focus().toggleHeaderRow().run()}
      >
        {t.header}
      </Button>
      <Button
        size="sm"
        variant="outline"
        icon={<DraftIcon name="repeatHeader" />}
        aria-pressed={state.repeat}
        onClick={() => toggleRepeatHeader(editor)}
      >
        {t.repeat}
      </Button>
      <label>
        {t.background}
        <Input
          type="color"
          aria-label={t.background}
          value={state.cell.backgroundColor || '#ffffff'}
          onChange={(e) => cell('backgroundColor', e.target.value)}
        />
      </label>
      <label>
        {t.vertical}
        <Select
          aria-label={t.vertical}
          value={state.cell.verticalAlign || 'top'}
          onChange={(e) => cell('verticalAlign', e.target.value)}
          options={(['top', 'middle', 'bottom'] as const).map((v) => ({ value: v, label: t[v] }))}
        />
      </label>
      <label>
        {t.padding}
        <Input
          type="number"
          min={0}
          max={96}
          aria-label={t.padding}
          value={parseFloat(state.cell.padding) || 0}
          onChange={(e) => cell('padding', `${Math.max(0, Math.min(96, Number(e.target.value)))}px`)}
        />
      </label>
      <label>
        {t.borders}
        <Select
          aria-label={t.borders}
          value={borderMode}
          onChange={(e) => {
            setBorderMode(e.target.value)
            setTableBorders(editor, e.target.value, color, width)
          }}
          options={(['none', 'all', 'outer'] as const).map((v) => ({ value: v, label: t[v] }))}
        />
      </label>
      <label>
        {t.color}
        <Input
          type="color"
          aria-label={t.color}
          value={color}
          onChange={(e) => {
            setColor(e.target.value)
            setTableBorders(editor, borderMode, e.target.value, width)
          }}
        />
      </label>
      <label>
        {t.width}
        <Input
          type="number"
          min={0}
          max={12}
          aria-label={t.width}
          value={width}
          onChange={(e) => {
            const w = Math.max(0, Math.min(12, Number(e.target.value)))
            setWidth(w)
            setTableBorders(editor, borderMode, color, w)
          }}
        />
      </label>
      <label>
        {t.align}
        <Select
          aria-label={t.align}
          value={
            state.style.includes('margin-left: auto')
              ? state.style.includes('margin-right: auto')
                ? 'center'
                : 'right'
              : 'left'
          }
          onChange={(e) =>
            editor
              .chain()
              .focus()
              .updateAttributes('table', {
                style: `margin-left: ${e.target.value === 'left' ? '0' : 'auto'}; margin-right: ${e.target.value === 'right' ? '0' : 'auto'}`,
              })
              .run()
          }
          options={(['left', 'center', 'right'] as const).map((v) => ({ value: v, label: t[v] }))}
        />
      </label>
      <Button
        size="sm"
        variant="outline"
        icon={<TrashIcon />}
        onClick={() => editor.chain().focus().deleteTable().run()}
      >
        {t.remove}
      </Button>
    </div>
  )
}
