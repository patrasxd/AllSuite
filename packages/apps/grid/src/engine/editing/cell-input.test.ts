import { describe, expect, it } from 'vitest'
import { dateToSerial } from '../workbook/dates'
import { getCellEditText, getCellEntryText, inferCellValue, formatCellDisplay } from './cell-input'

describe('Grid cell input and display', () => {
  it('retains ambiguous identifiers, unsafe integers and surrounding whitespace verbatim', () => {
    for (const locale of ['en', 'pl'] as const) {
      for (const value of ['00123', '9007199254740993', '12\n', '2025-02-03\n', ' true ', '01/02/2025', '2025-02-30']) {
        expect(inferCellValue(value, locale, '1900')).toEqual({ kind: 'string', value })
      }
    }
    expect(inferCellValue('12,5', 'en', '1900')).toEqual({ kind: 'string', value: '12,5' })
    expect(inferCellValue('12.5', 'pl', '1900')).toEqual({ kind: 'string', value: '12.5' })
  })

  it('edits numeric storage without currency, grouping, rounding or percentage decoration', () => {
    const value = { kind: 'number' as const, value: 0.1234567890123456 }
    for (const numberFormat of ['0.00%', '$#,##0.00', '#,##0', 'yyyy-mm-dd']) {
      const cell = { value, style: { numberFormat } }
      for (const locale of ['en', 'pl'] as const) {
        expect(inferCellValue(getCellEditText(cell, locale, '1900'), locale, '1900')).toEqual(value)
      }
    }
  })
  it('distinguishes formulas from apostrophe-prefixed literal expressions', () => {
    expect(inferCellValue('=SUM(A1:A2)', 'en', '1900')).toMatchObject({
      kind: 'formula',
      formula: {
        source: '=SUM(A1:A2)',
        canonicalExpression: '=SUM(A1:A2)',
        calculationStatus: 'stale',
      },
    })
    expect(inferCellValue('=SUMA(1,5;2,5)', 'en', '1900')).toMatchObject({
      kind: 'formula',
      formula: {
        source: '=SUMA(1,5;2,5)',
        canonicalExpression: '=SUM(1.5,2.5)',
        calculationStatus: 'stale',
      },
    })
    expect(inferCellValue("'=SUM(A1:A2)", 'en', '1900')).toEqual({ kind: 'string', value: '=SUM(A1:A2)' })
  })

  it('infers locale decimals and booleans without interpreting ambiguous separators', () => {
    expect(inferCellValue('12.5', 'en', '1900')).toEqual({ kind: 'number', value: 12.5 })
    expect(inferCellValue('12,5', 'pl', '1900')).toEqual({ kind: 'number', value: 12.5 })
    expect(inferCellValue('PRAWDA', 'pl', '1900')).toEqual({ kind: 'boolean', value: true })
    expect(inferCellValue('1,234', 'en', '1900')).toEqual({ kind: 'string', value: '1,234' })
  })

  it('parses unambiguous locale dates and keeps ambiguous English slash dates verbatim', () => {
    expect(inferCellValue('2025-02-03', 'en', '1900')).toEqual({
      kind: 'date',
      serial: dateToSerial(new Date(Date.UTC(2025, 1, 3)), '1900'),
      numberFormat: 'yyyy-mm-dd',
    })
    expect(inferCellValue('31.12.2025', 'pl', '1900')).toMatchObject({
      kind: 'date',
      serial: dateToSerial(new Date(Date.UTC(2025, 11, 31)), '1900'),
      numberFormat: 'dd.mm.yyyy',
    })
    expect(inferCellValue('01/02/2025', 'en', '1900')).toEqual({ kind: 'string', value: '01/02/2025' })
    expect(inferCellValue('02/13/2025', 'en', '1900')).toEqual({ kind: 'string', value: '02/13/2025' })
    expect(inferCellValue('1900-01-02', 'pl', '1904')).toEqual({ kind: 'string', value: '1900-01-02' })
  })

  it('formats values for cells while keeping formula source in the formula bar', () => {
    const formulaCell = {
      value: {
        kind: 'formula' as const,
        formula: {
          source: '=1+1',
          canonicalExpression: '=1+1',
          ast: null,
          cachedResult: { kind: 'number' as const, value: 2 },
          calculationStatus: 'fresh' as const,
        },
      },
      style: { numberFormat: '0.00' },
    }

    expect(formatCellDisplay(formulaCell, 'en', '1900')).toBe('2.00')
    expect(getCellEntryText(formulaCell, 'en', '1900')).toBe('=1+1')
    expect(formatCellDisplay({ value: { kind: 'date', serial: 1, numberFormat: 'dd.mm.yyyy' } }, 'pl', '1900')).toBe(
      '01.01.1900',
    )
    const now = new Date(Date.UTC(2025, 0, 2, 13, 5, 6))
    expect(
      formatCellDisplay(
        { value: { kind: 'date', serial: dateToSerial(now, '1900'), numberFormat: 'yyyy-mm-dd hh:mm:ss' } },
        'en',
        '1900',
      ),
    ).toBe('2025-01-02 13:05:06')
  })

  it('formats numeric storage as currency, percent and supported custom patterns by locale', () => {
    const numericCell = { value: { kind: 'number' as const, value: 1234.5 } }
    expect(formatCellDisplay({ ...numericCell, style: { numberFormat: '#,##0.00' } }, 'pl', '1900')).toContain(',50')
    expect(formatCellDisplay({ ...numericCell, style: { numberFormat: '"PLN" #,##0.00' } }, 'en', '1900')).toMatch(
      /PLN|zł/u,
    )
    expect(formatCellDisplay({ ...numericCell, style: { numberFormat: '€ #,##0.00' } }, 'en', '1900')).toContain('€')
    expect(formatCellDisplay({ ...numericCell, style: { numberFormat: '$#,##0.00' } }, 'en', '1900')).toContain('$')
    expect(
      formatCellDisplay(
        { value: { kind: 'number', value: -12.5 }, style: { numberFormat: '"PLN" #,##0.00;("PLN" #,##0.00);–' } },
        'en',
        '1900',
      ),
    ).toMatch(/^\(.*\)$/u)
    expect(
      formatCellDisplay(
        { value: { kind: 'number', value: 0 }, style: { numberFormat: '"PLN" #,##0.00;("PLN" #,##0.00);–' } },
        'en',
        '1900',
      ),
    ).toBe('–')
    expect(
      formatCellDisplay({ value: { kind: 'number', value: 0.125 }, style: { numberFormat: '0.0%' } }, 'pl', '1900'),
    ).toBe('12,5%')
    expect(formatCellDisplay({ ...numericCell, style: { numberFormat: '0.00 "kg"' } }, 'en', '1900')).toBe('1234.50 kg')
    expect(formatCellDisplay({ ...numericCell, style: { numberFormat: '0.00E+00' } }, 'en', '1900')).toBe('1234.5')
    expect(numericCell.value).toEqual({ kind: 'number', value: 1234.5 })
  })

  it('uses date format masks for numeric formula results under both Excel date systems', () => {
    expect(
      formatCellDisplay({ value: { kind: 'number', value: 60 }, style: { numberFormat: 'yyyy-mm-dd' } }, 'en', '1900'),
    ).toBe('1900-02-29')
    expect(
      formatCellDisplay({ value: { kind: 'number', value: 0 }, style: { numberFormat: 'yyyy-mm-dd' } }, 'en', '1904'),
    ).toBe('1904-01-01')
  })

  it('escapes stored text that would otherwise re-enter as a different value kind', () => {
    for (const value of ['=A1', '001', 'true', "'quoted"]) {
      const cell = { value: { kind: 'string' as const, value } }
      const editText = getCellEditText(cell, 'en', '1900')
      expect(inferCellValue(editText, 'en', '1900')).toEqual({ kind: 'string', value })
    }
    expect(getCellEntryText({ value: { kind: 'string', value: '=A1' } }, 'en', '1900')).toBe('=A1')
  })
})
