import { describe, expect, it } from 'vitest'
import { parseDelimitedValues, valuesToDelimited } from './clipboard'
import { decodeDelimitedFile, prepareDelimitedWorkbook, exportDelimitedSheet } from './delimited'
import { WorkbookSession, createWorkbook } from '../workbook'
import { exportXlsxWorkbook } from '../xlsx/export'
import { parseXlsxWorkbook } from '../xlsx/import'

describe('PP12 delimited files', () => {
  it('does not infer numbers or booleans across embedded terminal newlines', () => {
    expect(parseDelimitedValues('"12\n","TRUE\r\n"', ',', 'scalars')).toEqual([
      [
        { kind: 'string', value: '12\n' },
        { kind: 'string', value: 'TRUE\r\n' },
      ],
    ])
  })
  it('preserves embedded CRLF through actual XLSX save and fresh reopen', async () => {
    const workbook = prepareDelimitedWorkbook('"line\r\nnext",00123', ',', false, 'text')
    const result = await exportXlsxWorkbook(workbook)
    expect(result.report.canSave).toBe(true)
    expect(result.bytes).not.toBeNull()
    const reopened = await parseXlsxWorkbook('roundtrip.xlsx', result.bytes!)
    expect(reopened.workbook?.sheetsById.get(reopened.workbook.activeSheetId)?.cells.get('A1')?.value).toEqual({
      kind: 'string',
      value: 'line\r\nnext',
    })
  })
  it.each([',', ';', '\t'] as const)('round trips exact UTF-8 fields with %j delimiter', (delimiter) => {
    const fields = [
      'Zażółć gęślą jaźń',
      `a${delimiter}b`,
      'line\r\nnext',
      'say "yes"',
      '00123',
      '=SUM(A1)',
      '+cmd',
      '-cmd',
      '@cmd',
      '',
      "'text",
    ]
    const rows = [
      fields.map((value) => (value === '' ? { kind: 'blank' as const } : { kind: 'string' as const, value })),
    ]
    const text = valuesToDelimited(rows, delimiter, true)
    expect(
      parseDelimitedValues(decodeDelimitedFile(new TextEncoder().encode('\ufeff' + text)), delimiter, 'text'),
    ).toEqual(rows)
    expect(text).toContain('"say ""yes"""')
    expect(text).toContain('"=SUM(A1)"')
  })

  it('handles CRLF, blank rows, terminal blank cell, BOM and explicit header/typing', () => {
    const book = prepareDelimitedWorkbook('\ufeffid;value\r\n00123;12\r\n;\r\n=SUM(A1);TRUE\r\n', ';', true, 'scalars')
    const session = new WorkbookSession(book)
    const id = book.activeSheetId
    expect(session.getCell(id, 'A1')?.value).toEqual({ kind: 'string', value: '00123' })
    expect(session.getCell(id, 'B1')?.value).toEqual({ kind: 'number', value: 12 })
    expect(session.getCell(id, 'A2')).toBeUndefined()
    expect(session.getCell(id, 'A3')?.value).toEqual({ kind: 'string', value: '=SUM(A1)' })
    expect(session.getCell(id, 'B3')?.value).toEqual({ kind: 'boolean', value: true })
    expect(parseDelimitedValues('""\r\n""', ',', 'text')).toEqual([[{ kind: 'blank' }], [{ kind: 'blank' }]])
  })

  it('never runs formulas or date/localized inference and preserves text by default', () => {
    const text = "=1+2,00123,12,TRUE,2026-10-20, 12,'x,9007199254740993"
    expect(parseDelimitedValues(text, ',', 'text')[0].every((cell) => cell.kind === 'string')).toBe(true)
    const rows = parseDelimitedValues(text, ',', 'scalars')[0]
    expect(rows.map((cell) => cell.kind)).toEqual([
      'string',
      'string',
      'number',
      'boolean',
      'string',
      'string',
      'string',
      'string',
    ])
  })

  it.each([
    '"unterminated',
    'a"b',
    '"a"x',
    'a,b\nc',
    'a\u0000b',
    'x'.repeat(1_000_001),
    Array(10_002).fill('x').join(','),
  ])('refuses malformed or bounded input %#', (text) => {
    expect(() => prepareDelimitedWorkbook(text, ',', false, 'text')).toThrow()
  })

  it('rejects invalid UTF-8, oversized bytes and header-only imports', () => {
    expect(() => decodeDelimitedFile(new Uint8Array([0xff]))).toThrow()
    expect(() => decodeDelimitedFile(new Uint8Array(4_000_001))).toThrow()
    expect(() => prepareDelimitedWorkbook('header', ',', true, 'text')).toThrow()
  })

  it('exports only current sheet including hidden rows, refuses unsafe formulas, leaves history and dirty intact', () => {
    const session = new WorkbookSession(createWorkbook())
    const id = session.workbook.activeSheetId
    session.setCell(id, 'A1', { kind: 'string', value: '=literal' })
    session.setCell(id, 'B2', { kind: 'string', value: 'Łódź' })
    const otherId = session.createSheet('Other')
    session.setCell(otherId, 'A1', { kind: 'string', value: 'not exported' })
    session.workbook.sheetsById.get(id)!.rowMetadata.set(2, { hidden: true })
    const checkpoint = session.createSaveCheckpoint()
    const history = session.historyState
    expect(new TextDecoder().decode(exportDelimitedSheet(session, id, ','))).toBe('"=literal",\r\n,Łódź')
    expect(session.historyState).toEqual(history)
    expect(session.isDirty).toBe(true)
    session.markSaved(checkpoint)
    exportDelimitedSheet(session, id, '\t')
    expect(session.isDirty).toBe(false)
    session.setCell(id, 'A1', {
      kind: 'formula',
      formula: {
        source: '=1+2',
        canonicalExpression: '=1+2',
        ast: null,
        cachedResult: { kind: 'number', value: 3 },
        calculationStatus: 'stale',
      },
    })
    expect(() => exportDelimitedSheet(session, id, ',')).toThrow()
  })

  it('replaces a fully prepared import as unsaved XLSX without changing default replacement behavior', () => {
    const session = new WorkbookSession(createWorkbook())
    session.replaceWorkbook(prepareDelimitedWorkbook('00123,=1+2', ',', false, 'text'), { markDirty: true })
    expect(session.isDirty).toBe(true)
    expect(session.historyState.undoDepth).toBe(0)
    session.setCell(session.workbook.activeSheetId, 'A1', { kind: 'string', value: 'edit' })
    session.undo()
    expect(session.isDirty).toBe(true)
    session.redo()
    expect(session.getCell(session.workbook.activeSheetId, 'A1')?.value).toEqual({ kind: 'string', value: 'edit' })
    session.replaceWorkbook(createWorkbook())
    expect(session.isDirty).toBe(false)
  })
})
