import { describe, expect, it, vi } from 'vitest'
import { inferCellValue } from '../editing/cell-input'
import { createWorkbook } from '../workbook/model'
import { WorkbookSession } from '../workbook/session'
import type { FormulaAstNode, FormulaResult, Workbook } from '../workbook/types'
import { FormulaRuntime, FORMULA_RESOURCE_LIMITS, formulaDateSerialParts } from './runtime'
import { createFormulaWorkbookSnapshot } from './types'
import { SUPPORTED_FORMULA_FUNCTIONS } from './locale'

function createFormulaFixture(dateSystem: Workbook['dateSystem'] = '1900') {
  const workbook = createWorkbook({ firstSheetName: 'Main' })
  workbook.dateSystem = dateSystem
  const session = new WorkbookSession(workbook)
  const mainSheetId = workbook.activeSheetId
  let generation = 0
  const runtime = new FormulaRuntime()

  const set = (sheetId: string, address: string, value: string | number | boolean | FormulaResult) => {
    if (typeof value === 'string') {
      session.setCell(sheetId, address, inferCellValue(value, 'en', session.workbook.dateSystem))
      return
    }
    if (typeof value === 'object' && value.kind === 'date') {
      session.setCell(sheetId, address, value)
      return
    }
    if (typeof value === 'object' && value.kind === 'error') {
      session.setCell(sheetId, address, value)
      return
    }
    if (typeof value === 'object' && value.kind === 'number') {
      session.setCell(sheetId, address, { kind: 'number', value: value.value })
      return
    }
    if (typeof value === 'object' && value.kind === 'string') {
      session.setCell(sheetId, address, { kind: 'string', value: value.value })
      return
    }
    if (typeof value === 'object' && value.kind === 'boolean') {
      session.setCell(sheetId, address, { kind: 'boolean', value: value.value })
      return
    }
    session.setCell(
      sheetId,
      address,
      typeof value === 'number' ? { kind: 'number', value } : { kind: 'boolean', value },
    )
  }

  const setCachedFormula = (sheetId: string, address: string, source: string, cachedResult: FormulaResult) => {
    const parsed = inferCellValue(source, 'en', session.workbook.dateSystem)
    if (parsed.kind !== 'formula') throw new Error('Expected a formula fixture.')
    session.setCell(sheetId, address, {
      kind: 'formula',
      formula: { ...parsed.formula, cachedResult, calculationStatus: 'unsupported' },
    })
  }

  const recalculate = async (forceRebuild = false) => {
    const response = await runtime.calculate(
      createFormulaWorkbookSnapshot(session.workbook, ++generation),
      forceRebuild,
    )
    session.applyCalculationResults(response.updates)
    return response
  }

  return { session, runtime, mainSheetId, set, setCachedFormula, recalculate }
}

function formulaResult(session: WorkbookSession, sheetId: string, address: string): FormulaResult {
  const cell = session.getCell(sheetId, address)
  if (!cell || cell.value.kind !== 'formula') throw new Error(`Expected formula at ${address}.`)
  return cell.value.formula.cachedResult
}

function formulaReferenceFlags(node: FormulaAstNode): Array<{ absoluteRow?: boolean; absoluteColumn?: boolean }> {
  switch (node.type) {
    case 'reference':
      return [{ absoluteRow: node.address.absoluteRow, absoluteColumn: node.address.absoluteColumn }]
    case 'range':
      return [
        { absoluteRow: node.range.start.absoluteRow, absoluteColumn: node.range.start.absoluteColumn },
        { absoluteRow: node.range.end.absoluteRow, absoluteColumn: node.range.end.absoluteColumn },
      ]
    case 'unary':
      return formulaReferenceFlags(node.operand)
    case 'binary':
      return [...formulaReferenceFlags(node.left), ...formulaReferenceFlags(node.right)]
    case 'call':
      return node.arguments.flatMap(formulaReferenceFlags)
    case 'literal':
    case 'error':
      return []
  }
}

describe('Grid formula runtime', () => {
  it('calculates reference-like strings as text while retaining actual external references as unsupported', async () => {
    const { session, set, mainSheetId, recalculate } = createFormulaFixture()
    set(mainSheetId, 'A1', '=CONCAT("[Remote.xlsx]Sheet!A1"," ","""quoted""")')
    set(mainSheetId, 'A2', "='[Remote.xlsx]Sheet'!A1")
    await recalculate()
    expect(formulaResult(session, mainSheetId, 'A1')).toEqual({
      kind: 'string',
      value: '[Remote.xlsx]Sheet!A1 "quoted"',
    })
    expect(session.getCell(mainSheetId, 'A2')?.value).toMatchObject({
      formula: { calculationStatus: 'unsupported' },
    })
  })

  it('handles missing sheets inside IFERROR and lazy branches, then resolves a newly added sheet', async () => {
    const { session, set, mainSheetId, recalculate } = createFormulaFixture()
    set(mainSheetId, 'A1', '=IFERROR(Missing!A1,7)')
    set(mainSheetId, 'A2', '=IF(TRUE,8,Missing!A1)')
    set(mainSheetId, 'A3', '=Missing!A1+1')
    await recalculate()
    expect(formulaResult(session, mainSheetId, 'A1')).toEqual({ kind: 'number', value: 7 })
    expect(formulaResult(session, mainSheetId, 'A2')).toEqual({ kind: 'number', value: 8 })
    expect(formulaResult(session, mainSheetId, 'A3')).toEqual({ kind: 'error', code: '#REF!' })
    const missingSheet = session.createSheet('Missing')
    set(missingSheet, 'A1', 12)
    await recalculate()
    expect(formulaResult(session, mainSheetId, 'A1')).toEqual({ kind: 'number', value: 12 })
    expect(formulaResult(session, mainSheetId, 'A3')).toEqual({ kind: 'number', value: 13 })
  })

  it('treats imported error codes as literal errors rather than executable formula source', async () => {
    const { session, set, mainSheetId, recalculate } = createFormulaFixture()
    set(mainSheetId, 'A1', { kind: 'error', code: 'SUM(40,2)' })
    set(mainSheetId, 'A2', '=IFERROR(A1,7)')
    set(mainSheetId, 'B1', { kind: 'error', code: 'WEBSERVICE("https://example.invalid")' })
    set(mainSheetId, 'B2', '=B1')
    await recalculate()
    expect(formulaResult(session, mainSheetId, 'A2')).toEqual({ kind: 'number', value: 7 })
    expect(formulaResult(session, mainSheetId, 'B2')).toEqual({ kind: 'error', code: '#VALUE!' })

    set(mainSheetId, 'A1', { kind: 'error', code: 'ABS(-99)' })
    await recalculate()
    expect(formulaResult(session, mainSheetId, 'A2')).toEqual({ kind: 'number', value: 7 })
  })

  it('checks criteria, exact lookup misses, duplicate keys and INDEX/MATCH composition', async () => {
    const { session, set, mainSheetId, recalculate } = createFormulaFixture()
    for (const [address, value] of [
      ['A1', 'alpha'],
      ['A2', 'beta'],
      ['A3', 'alpha'],
      ['B1', 10],
      ['B2', 20],
      ['B3', 30],
    ] as const)
      set(mainSheetId, address, value)
    const cases = [
      ['D1', '=SUMIFS(B1:B3,A1:A3,"alpha",B1:B3,">15")', 30],
      ['D2', '=COUNTIFS(A1:A3,"alpha",B1:B3,">15")', 1],
      ['D3', '=COUNTIF(A1:A3,"a*")', 2],
      ['D4', '=XLOOKUP("alpha",A1:A3,B1:B3)', 10],
      ['D5', '=XLOOKUP("missing",A1:A3,B1:B3,"absent")', 'absent'],
      ['D6', '=INDEX(B1:B3,MATCH("beta",A1:A3,0))', 20],
      ['D7', '=IFERROR(VLOOKUP("missing",A1:B3,2,FALSE),99)', 99],
    ] as const
    for (const [address, source] of cases) set(mainSheetId, address, source)
    await recalculate()
    for (const [address, , value] of cases)
      expect(formulaResult(session, mainSheetId, address)).toEqual(
        typeof value === 'number' ? { kind: 'number', value } : { kind: 'string', value },
      )
  })

  it('does not publish spill arrays or their dependents as successfully calculated scalar cells', async () => {
    const { session, set, setCachedFormula, mainSheetId, recalculate } = createFormulaFixture()
    set(mainSheetId, 'A1', 1)
    set(mainSheetId, 'B1', 10)
    set(mainSheetId, 'C1', 20)
    setCachedFormula(mainSheetId, 'E1', '=XLOOKUP(1,A1:A1,B1:C1)', { kind: 'number', value: 123 })
    setCachedFormula(mainSheetId, 'G1', '=F1+1', { kind: 'number', value: 456 })
    await recalculate()
    expect(session.getCell(mainSheetId, 'E1')?.value).toMatchObject({
      kind: 'formula',
      formula: { calculationStatus: 'unsupported', cachedResult: { kind: 'number', value: 123 } },
    })
    expect(session.getCell(mainSheetId, 'G1')?.value).toMatchObject({
      kind: 'formula',
      formula: { calculationStatus: 'stale', cachedResult: { kind: 'number', value: 456 } },
    })
  })

  it('distinguishes error-like text from errors and evaluates literal errors through lazy branches', async () => {
    const { session, set, mainSheetId, recalculate } = createFormulaFixture()
    const cases = [
      ['A1', '="#DIV/0!"', { kind: 'string', value: '#DIV/0!' }],
      ['A2', '=IFERROR(#REF!,7)', { kind: 'number', value: 7 }],
      ['A3', '=IF(FALSE,1/0,9)', { kind: 'number', value: 9 }],
      ['A4', '=IFERROR(#N/A,"missing")', { kind: 'string', value: 'missing' }],
      ['A5', '=IFERROR("#N/A","wrong")', { kind: 'string', value: '#N/A' }],
      ['A6', '=-2^2', { kind: 'number', value: 4 }],
      ['A7', '=2^3^2', { kind: 'number', value: 64 }],
      ['A8', '="a"&"b"', { kind: 'string', value: 'ab' }],
      ['A9', '=ROUND(-1.25,1)', { kind: 'number', value: -1.3 }],
      ['A10', '=IF(2>=1,ABS(-3),0)', { kind: 'number', value: 3 }],
    ] as const
    for (const [address, source] of cases) set(mainSheetId, address, source)
    await recalculate()
    for (const [address, , result] of cases)
      expect(formulaResult(session, mainSheetId, address), address).toEqual(result)
  })

  it('rebuilds when the date system changes and refuses excessive parser nesting without losing caches', async () => {
    const { session, set, setCachedFormula, mainSheetId, recalculate } = createFormulaFixture()
    set(mainSheetId, 'A1', '=DATE(1904,1,1)')
    await recalculate()
    expect(formulaResult(session, mainSheetId, 'A1')).toMatchObject({ kind: 'date', serial: 1462 })
    session.workbook.dateSystem = '1904'
    setCachedFormula(mainSheetId, 'A2', `=${'('.repeat(300)}1${')'.repeat(300)}`, { kind: 'number', value: 17 })
    await recalculate()
    expect(formulaResult(session, mainSheetId, 'A1')).toMatchObject({ kind: 'date', serial: 0 })
    expect(session.getCell(mainSheetId, 'A2')?.value).toMatchObject({
      kind: 'formula',
      formula: { calculationStatus: 'unsupported', cachedResult: { kind: 'number', value: 17 } },
    })
  })

  it('calculates every advertised starter function family in the pinned runtime', async () => {
    const fixture = createFormulaFixture()
    const { session, set, mainSheetId, recalculate } = fixture
    set(mainSheetId, 'A1', 1)
    set(mainSheetId, 'A2', 2)
    set(mainSheetId, 'B1', 10)
    set(mainSheetId, 'B2', 20)

    const formulas = [
      ['D1', '=SUM(A1:A2)', 3],
      ['D2', '=AVERAGE(A1:A2)', 1.5],
      ['D3', '=MIN(A1:A2)', 1],
      ['D4', '=MAX(A1:A2)', 2],
      ['D5', '=COUNT(A1,"x")', 1],
      ['D6', '=COUNTA(0,"x")', 2],
      ['D7', '=IF(A1=1,3,4)', 3],
      ['D8', '=AND(TRUE,FALSE)', false],
      ['D9', '=OR(TRUE,FALSE)', true],
      ['D10', '=NOT(TRUE)', false],
      ['D11', '=IFERROR(1/0,7)', 7],
      ['D12', '=ROUND(1.234,2)', 1.23],
      ['D13', '=ABS(-2)', 2],
      ['D14', '=SUMIF(A1:A2,">1",B1:B2)', 20],
      ['D15', '=COUNTIF(A1:A2,">1")', 1],
      ['D16', '=SUMIFS(B1:B2,A1:A2,">1")', 20],
      ['D17', '=COUNTIFS(A1:A2,">1")', 1],
      ['D18', '=CONCAT("a","b")', 'ab'],
      ['D19', '=CONCATENATE("a","b")', 'ab'],
      ['D20', '=LEFT("abc",2)', 'ab'],
      ['D21', '=RIGHT("abc",2)', 'bc'],
      ['D22', '=MID("abc",2,1)', 'b'],
      ['D23', '=LEN("abc")', 3],
      ['D24', '=TRIM(" a  b ")', 'a b'],
      ['D25', '=TODAY()', 'date'],
      ['D26', '=NOW()', 'date'],
      ['D27', '=DATE(2024,2,29)', 'date'],
      ['D28', '=YEAR(DATE(2024,2,29))', 2024],
      ['D29', '=MONTH(DATE(2024,2,29))', 2],
      ['D30', '=DAY(DATE(2024,2,29))', 29],
      ['D31', '=VLOOKUP(2,A1:B2,2,FALSE)', 20],
      ['D32', '=XLOOKUP(2,A1:A2,B1:B2)', 20],
      ['D33', '=INDEX(B1:B2,2)', 20],
      ['D34', '=MATCH(2,A1:A2,0)', 2],
    ] as const
    expect(formulas.map(([, formula]) => formula.slice(1, formula.indexOf('('))).sort()).toEqual(
      [...SUPPORTED_FORMULA_FUNCTIONS].sort(),
    )
    for (const [address, formula] of formulas) set(mainSheetId, address, formula)

    const response = await recalculate()
    expect(response.warning).toBeUndefined()
    for (const [address, , expected] of formulas) {
      const result = formulaResult(session, mainSheetId, address)
      if (expected === 'date') {
        expect(result.kind).toBe('date')
        if (result.kind === 'date') expect(Number.isFinite(result.serial)).toBe(true)
      } else if (typeof expected === 'number') {
        expect(result.kind).toBe('number')
        if (result.kind === 'number') expect(result.value).toBeCloseTo(expected)
      } else if (typeof expected === 'boolean') {
        expect(result).toEqual({ kind: 'boolean', value: expected })
      } else {
        expect(result).toEqual({ kind: 'string', value: expected })
      }
      expect(session.getCell(mainSheetId, address)?.value).toMatchObject({
        kind: 'formula',
        formula: { calculationStatus: 'fresh' },
      })
    }
  })

  it('recalculates same-sheet and cross-sheet chains incrementally and marks only dependents stale', async () => {
    const fixture = createFormulaFixture()
    const { session, set, mainSheetId, recalculate } = fixture
    const otherSheetId = session.createSheet('Other Data')
    set(mainSheetId, 'A1', 2)
    set(otherSheetId, 'A1', 3)
    set(mainSheetId, 'B1', '=A1+1')
    set(mainSheetId, 'C1', "='Other Data'!A1+B1")
    set(mainSheetId, 'D1', '=C1*2')
    set(mainSheetId, 'Z1', '=100+1')
    await recalculate()

    expect(formulaResult(session, mainSheetId, 'D1')).toEqual({ kind: 'number', value: 12 })
    set(mainSheetId, 'A1', 8)
    expect(session.getCell(mainSheetId, 'B1')?.value).toMatchObject({
      kind: 'formula',
      formula: { calculationStatus: 'stale' },
    })
    expect(session.getCell(mainSheetId, 'C1')?.value).toMatchObject({
      kind: 'formula',
      formula: { calculationStatus: 'stale' },
    })
    expect(session.getCell(mainSheetId, 'D1')?.value).toMatchObject({
      kind: 'formula',
      formula: { calculationStatus: 'stale' },
    })
    expect(session.getCell(mainSheetId, 'Z1')?.value).toMatchObject({
      kind: 'formula',
      formula: { calculationStatus: 'fresh' },
    })

    await recalculate()
    expect(formulaResult(session, mainSheetId, 'B1')).toEqual({ kind: 'number', value: 9 })
    expect(formulaResult(session, mainSheetId, 'C1')).toEqual({ kind: 'number', value: 12 })
    expect(formulaResult(session, mainSheetId, 'D1')).toEqual({ kind: 'number', value: 24 })
  })

  it('handles precedence, mixed absolute references, strings, coercion, and floating-point precision', async () => {
    const fixture = createFormulaFixture()
    const { session, set, mainSheetId, recalculate } = fixture
    set(mainSheetId, 'A1', 2)
    set(mainSheetId, 'A2', 3)
    set(mainSheetId, 'B1', '=1+2*3')
    set(mainSheetId, 'B2', '=$A$1+A$2+$A2')
    set(mainSheetId, 'B3', '=1+"2"')
    set(mainSheetId, 'B4', '=0.1+0.2')
    set(mainSheetId, 'B5', '=IF(TRUE,"text",0)')
    await recalculate()

    expect(formulaResult(session, mainSheetId, 'B1')).toEqual({ kind: 'number', value: 7 })
    expect(formulaResult(session, mainSheetId, 'B2')).toEqual({ kind: 'number', value: 8 })
    expect(formulaResult(session, mainSheetId, 'B3')).toEqual({ kind: 'number', value: 3 })
    expect(formulaResult(session, mainSheetId, 'B4')).toMatchObject({ kind: 'number', value: expect.closeTo(0.3) })
    expect(formulaResult(session, mainSheetId, 'B5')).toEqual({ kind: 'string', value: 'text' })
    const mixedAst = session.getCell(mainSheetId, 'B2')
    expect(mixedAst?.value.kind === 'formula' && mixedAst.value.formula.ast).not.toBeNull()
  })

  it('maps division, numeric, reference and circular errors to workbook errors', async () => {
    const fixture = createFormulaFixture()
    const { session, set, setCachedFormula, mainSheetId, recalculate } = fixture
    set(mainSheetId, 'A1', '=1/0')
    set(mainSheetId, 'B1', '=A1+2')
    set(mainSheetId, 'A2', '=SUM(1E308,1E308)')
    set(mainSheetId, 'A3', "='Missing Sheet'!A1")
    set(mainSheetId, 'A4', '=LEFT("a",-1)')
    set(mainSheetId, 'A5', '=VLOOKUP(9,A1:B2,2,FALSE)')
    setCachedFormula(mainSheetId, 'A6', '=UNKNOWN_NAME', { kind: 'error', code: '#NAME?' })
    set(mainSheetId, 'C1', '=D1+1')
    set(mainSheetId, 'D1', '=C1+1')
    await recalculate()

    expect(formulaResult(session, mainSheetId, 'A1')).toEqual({ kind: 'error', code: '#DIV/0!' })
    expect(formulaResult(session, mainSheetId, 'B1')).toEqual({ kind: 'error', code: '#DIV/0!' })
    expect(formulaResult(session, mainSheetId, 'A2')).toEqual({ kind: 'error', code: '#NUM!' })
    expect(formulaResult(session, mainSheetId, 'A3')).toEqual({ kind: 'error', code: '#REF!' })
    expect(formulaResult(session, mainSheetId, 'A4')).toEqual({ kind: 'error', code: '#VALUE!' })
    expect(formulaResult(session, mainSheetId, 'A5')).toEqual({ kind: 'error', code: '#N/A' })
    expect(formulaResult(session, mainSheetId, 'A6')).toEqual({ kind: 'error', code: '#NAME?' })
    expect(session.getCell(mainSheetId, 'A6')?.value).toMatchObject({
      kind: 'formula',
      formula: { calculationStatus: 'unsupported' },
    })
    expect(formulaResult(session, mainSheetId, 'C1')).toMatchObject({ kind: 'error', code: '#CYCLE!' })
    expect(formulaResult(session, mainSheetId, 'D1')).toMatchObject({ kind: 'error', code: '#CYCLE!' })
  })

  it('keeps unsupported and external functions inert with their cached result', async () => {
    const fixture = createFormulaFixture()
    const { session, set, mainSheetId, recalculate } = fixture
    const fetch = vi.fn(() => {
      throw new Error('Network must not be used by formula calculation.')
    })
    vi.stubGlobal('fetch', fetch)
    set(mainSheetId, 'A1', { kind: 'number', value: 42 })
    set(mainSheetId, 'A2', '=WEBSERVICE("https://example.invalid")')
    set(mainSheetId, 'A3', '=HYPERLINK("https://example.invalid","open")')
    set(mainSheetId, 'A4', "='[Remote.xlsx]Sheet1'!A1")
    await recalculate()

    expect(session.getCell(mainSheetId, 'A2')?.value).toMatchObject({
      kind: 'formula',
      formula: { calculationStatus: 'unsupported', cachedResult: { kind: 'blank' } },
    })
    expect(session.getCell(mainSheetId, 'A3')?.value).toMatchObject({
      kind: 'formula',
      formula: { calculationStatus: 'unsupported' },
    })
    expect(session.getCell(mainSheetId, 'A4')?.value).toMatchObject({
      kind: 'formula',
      formula: { calculationStatus: 'unsupported' },
    })
    expect(fetch).not.toHaveBeenCalled()
    vi.unstubAllGlobals()
  })

  it('keeps dependents of unsupported formulas stale, then calculates them when the unsupported cell is replaced', async () => {
    const fixture = createFormulaFixture()
    const { session, set, setCachedFormula, mainSheetId, recalculate } = fixture
    set(mainSheetId, 'A1', { kind: 'number', value: 9 })
    set(mainSheetId, 'B1', '=MISSING_ADDIN(1)')
    setCachedFormula(mainSheetId, 'C1', '=B1*2', { kind: 'number', value: 18 })
    await recalculate()
    expect(formulaResult(session, mainSheetId, 'B1')).toEqual({ kind: 'blank' })
    expect(session.getCell(mainSheetId, 'B1')?.value).toMatchObject({
      kind: 'formula',
      formula: { calculationStatus: 'unsupported' },
    })
    expect(session.getCell(mainSheetId, 'C1')?.value).toMatchObject({
      kind: 'formula',
      formula: { calculationStatus: 'stale', cachedResult: { kind: 'number', value: 18 } },
    })

    set(mainSheetId, 'B1', 5)
    await recalculate()
    expect(formulaResult(session, mainSheetId, 'C1')).toEqual({ kind: 'number', value: 10 })
  })

  it('respects 1900 and 1904 date serial systems, including the 1900 leap-day serial boundary', async () => {
    const fixture1900 = createFormulaFixture('1900')
    fixture1900.set(fixture1900.mainSheetId, 'A1', '=DATE(1900,3,1)')
    await fixture1900.recalculate()
    expect(formulaResult(fixture1900.session, fixture1900.mainSheetId, 'A1')).toEqual({
      kind: 'date',
      serial: 61,
      numberFormat: 'yyyy-mm-dd',
    })
    expect(formulaDateSerialParts(60, '1900')).toMatchObject({
      year: 1900,
      month: 2,
      day: 29,
      fictitious1900LeapDay: true,
    })

    const fixture1904 = createFormulaFixture('1904')
    fixture1904.set(fixture1904.mainSheetId, 'A1', '=DATE(1904,1,1)')
    fixture1904.set(fixture1904.mainSheetId, 'A2', { kind: 'date', serial: 0, numberFormat: 'yyyy-mm-dd' })
    fixture1904.set(fixture1904.mainSheetId, 'A3', '=A2')
    await fixture1904.recalculate()
    expect(formulaResult(fixture1904.session, fixture1904.mainSheetId, 'A1')).toMatchObject({ kind: 'date', serial: 0 })
    expect(formulaResult(fixture1904.session, fixture1904.mainSheetId, 'A3')).toMatchObject({ kind: 'date', serial: 0 })
  })

  it('calculates Polish localized formula input from its canonical English expression', async () => {
    const fixture = createFormulaFixture()
    const formula = inferCellValue('=SUMA(1,5;2,5)', 'en', fixture.session.workbook.dateSystem)
    expect(formula).toMatchObject({
      kind: 'formula',
      formula: { source: '=SUMA(1,5;2,5)', canonicalExpression: '=SUM(1.5,2.5)' },
    })
    fixture.session.setCell(fixture.mainSheetId, 'A1', formula)
    await fixture.recalculate()
    expect(formulaResult(fixture.session, fixture.mainSheetId, 'A1')).toEqual({ kind: 'number', value: 4 })
    expect(fixture.session.getCell(fixture.mainSheetId, 'A1')?.value).toMatchObject({
      kind: 'formula',
      formula: { source: '=SUMA(1,5;2,5)', canonicalExpression: '=SUM(1.5,2.5)', calculationStatus: 'fresh' },
    })
  })

  it('preserves mixed-reference AST flags and retains oversized ranges as unsupported caches', async () => {
    const fixture = createFormulaFixture()
    const { session, set, setCachedFormula, mainSheetId, recalculate } = fixture
    set(mainSheetId, 'A1', { kind: 'number', value: 3 })
    set(mainSheetId, 'B1', '=$A$1+A$1+$A1')
    setCachedFormula(mainSheetId, 'C1', '=SUM(A1:A100001)', { kind: 'number', value: 14 })
    await recalculate()

    expect(formulaResult(session, mainSheetId, 'B1')).toEqual({ kind: 'number', value: 9 })
    const mixedCell = session.getCell(mainSheetId, 'B1')
    const mixedAst = mixedCell?.value.kind === 'formula' ? mixedCell.value.formula.ast : null
    expect(mixedAst && formulaReferenceFlags(mixedAst)).toEqual([
      { absoluteRow: true, absoluteColumn: true },
      { absoluteRow: true, absoluteColumn: false },
      { absoluteRow: false, absoluteColumn: true },
    ])
    expect(session.getCell(mainSheetId, 'C1')?.value).toMatchObject({
      kind: 'formula',
      formula: { calculationStatus: 'unsupported', cachedResult: { kind: 'number', value: 14 } },
    })
    expect(FORMULA_RESOURCE_LIMITS.rangeCells).toBeLessThan(100_001)
  })

  it('handles a stress fixture with thousands of chained formulas in the worker engine', async () => {
    const fixture = createFormulaFixture()
    const { session, set, mainSheetId, recalculate } = fixture
    set(mainSheetId, 'A1', 1)
    for (let row = 2; row <= 2_500; row += 1) set(mainSheetId, `A${row}`, `=A${row - 1}+1`)

    const response = await recalculate()
    expect(response.warning).toBeUndefined()
    expect(formulaResult(session, mainSheetId, 'A2500')).toEqual({ kind: 'number', value: 2500 })

    set(mainSheetId, 'A1', 5)
    await recalculate()
    expect(formulaResult(session, mainSheetId, 'A2500')).toEqual({ kind: 'number', value: 2504 })
  })
})
