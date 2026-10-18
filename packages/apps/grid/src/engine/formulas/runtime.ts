import {
  initializeWasm,
  parse as parseFormualizerFormula,
  Workbook as FormualizerWorkbook,
  type ASTNodeData,
} from 'formualizer'
import { cellAddressKey, parseCellAddress } from '../workbook/address'
import { MAX_COLUMNS, MAX_ROWS, serialToDateParts } from '../workbook'
import { SUPPORTED_FORMULA_FUNCTIONS } from './locale'
import { FORMULA_RESOURCE_LIMITS } from './policy'
export { FORMULA_RESOURCE_LIMITS } from './policy'
import type { CellValue, FormulaAstNode, FormulaResult, Workbook as GridWorkbook } from '../workbook/types'
import type {
  FormulaCalculationResponse,
  FormulaCalculationUpdate,
  FormulaCellSnapshot,
  FormulaWorkbookSnapshot,
} from './types'

const ALLOWED_FUNCTIONS = new Set<string>(SUPPORTED_FORMULA_FUNCTIONS)

const DAY_MS = 86_400_000
const ENGINE_1900_MARCH_1 = Date.UTC(1900, 2, 1)

interface FormulaReference {
  sheetId: string
  range: {
    start: { row: number; column: number }
    end: { row: number; column: number }
  }
}

interface FormulaAnalysis {
  key: string
  sheetId: string
  sheetName: string
  address: string
  source: string
  gridAst: FormulaAstNode | null
  references: FormulaReference[]
  referenceCells: number
  mode: 'supported' | 'unsupported' | 'error'
  reason?: 'external-reference' | 'function-not-supported' | 'resource-limit' | 'parse-failed' | 'engine-rejected'
  errorCode?: string
}

interface EngineCell {
  sheetId: string
  sheetName: string
  row: number
  column: number
  snapshot: FormulaCellSnapshot
}

interface EngineMode {
  mode: 'formula' | 'value'
  source?: string
  valueFingerprint?: string
}

/** Persistent adapter around Formualizer. Its workbook graph survives cell edits so evaluateAll is incremental. */
export class FormulaRuntime {
  private engine?: InstanceType<typeof FormualizerWorkbook>
  private sheetSignature = ''
  private readonly previousInputs = new Map<string, string>()
  private readonly formulaAnalyses = new Map<string, FormulaAnalysis>()
  private readonly engineModes = new Map<string, EngineMode>()
  private readonly engineCells = new Map<string, EngineCell>()
  private analysisStartedAt = 0

  async calculate(snapshot: FormulaWorkbookSnapshot, forceRebuild = false): Promise<FormulaCalculationResponse> {
    try {
      this.analysisStartedAt = Date.now()
      await initializeWasm()

      const formulas = countFormulaCells(snapshot)
      if (formulas.length > FORMULA_RESOURCE_LIMITS.formulaCells) {
        this.reset()
        return this.resourceLimitedResponse(snapshot, formulas)
      }

      if (forceRebuild || !this.engine || this.signature(snapshot) !== this.sheetSignature) {
        await this.rebuild(snapshot)
      } else {
        await this.applyChanges(snapshot)
      }

      return this.evaluate(snapshot)
    } catch (error) {
      const timedOut = /time|budget|work unit/i.test(error instanceof Error ? error.message : String(error))
      this.reset()
      return {
        generation: snapshot.generation,
        warning: timedOut ? 'calculation-timeout' : 'engine-error',
        updates: this.staleUpdates(snapshot),
      }
    }
  }

  reset(): void {
    this.engine?.free()
    this.engine = undefined
    this.sheetSignature = ''
    this.previousInputs.clear()
    this.formulaAnalyses.clear()
    this.engineModes.clear()
    this.engineCells.clear()
  }

  private async rebuild(snapshot: FormulaWorkbookSnapshot): Promise<void> {
    this.reset()
    this.sheetSignature = this.signature(snapshot)
    this.engine = new FormualizerWorkbook({
      cycleDetection: 'runtime',
      cyclePolicy: 'error',
      maxWorkUnits: FORMULA_RESOURCE_LIMITS.maxWorkUnits,
      maxEvalTimeMs: FORMULA_RESOURCE_LIMITS.maxEvalTimeMs,
    })
    for (const sheet of snapshot.sheets) this.engine.addSheet(sheet.name)

    const analysisStartedAt = Date.now()
    let referenceCells = 0
    for (const cell of this.flatten(snapshot)) {
      const { value } = cell.snapshot
      const key = this.key(cell.sheetId, cell.snapshot.address)
      this.engineCells.set(key, cell)
      this.previousInputs.set(key, inputFingerprint(value))
      if (value.kind === 'formula') {
        this.engine.setValue(
          cell.sheetName,
          cell.row,
          cell.column,
          toEngineValue(value.formula.cachedResult, snapshot.dateSystem),
        )
        const analysis =
          Date.now() - analysisStartedAt > FORMULA_RESOURCE_LIMITS.analysisTimeMs
            ? unsupportedAnalysis(cell, 'resource-limit')
            : await this.analyze(cell, snapshot)
        referenceCells += analysis.referenceCells
        if (referenceCells > FORMULA_RESOURCE_LIMITS.referenceCells) {
          analysis.mode = 'unsupported'
          analysis.reason = 'resource-limit'
        }
        this.formulaAnalyses.set(key, analysis)
      } else if (value.kind === 'error') {
        this.engine.setFormula(cell.sheetName, cell.row, cell.column, `=${normalizeErrorCode(value.code)}`)
        this.engineModes.set(key, { mode: 'formula', source: `=${normalizeErrorCode(value.code)}` })
      } else {
        this.writeInputValue(cell, value, snapshot.dateSystem)
      }
    }

    await this.applyFormulaModes(snapshot)
  }

  private async applyChanges(snapshot: FormulaWorkbookSnapshot): Promise<void> {
    const nextCells = new Map(
      this.flatten(snapshot).map((cell) => [this.key(cell.sheetId, cell.snapshot.address), cell]),
    )

    for (const [key, previousFingerprint] of this.previousInputs) {
      const next = nextCells.get(key)
      if (!next) {
        const previous = this.engineCells.get(key)!
        this.engine!.setValue(previous.sheetName, previous.row, previous.column, null)
        this.previousInputs.delete(key)
        this.formulaAnalyses.delete(key)
        this.engineModes.delete(key)
        this.engineCells.delete(key)
        continue
      }

      const nextFingerprint = inputFingerprint(next.snapshot.value)
      if (previousFingerprint === nextFingerprint) continue

      const prior = this.engineCells.get(key)!
      const value = next.snapshot.value
      this.engineCells.set(key, next)
      this.previousInputs.set(key, nextFingerprint)

      if (value.kind === 'formula') {
        this.formulaAnalyses.set(key, await this.analyze(next, snapshot))
      } else {
        this.formulaAnalyses.delete(key)
        this.engineModes.delete(key)
        if (value.kind === 'error') {
          const formula = `=${normalizeErrorCode(value.code)}`
          this.engine!.setFormula(next.sheetName, next.row, next.column, formula)
          this.engineModes.set(key, { mode: 'formula', source: formula })
        } else {
          this.writeInputValue(next, value, snapshot.dateSystem)
        }
      }

      if (prior.sheetName !== next.sheetName) throw new Error('Formula sheet identity changed without a rebuild.')
    }

    for (const [key, next] of nextCells) {
      if (this.previousInputs.has(key)) continue
      const value = next.snapshot.value
      this.engineCells.set(key, next)
      this.previousInputs.set(key, inputFingerprint(value))
      if (value.kind === 'formula') {
        this.formulaAnalyses.set(key, await this.analyze(next, snapshot))
      } else if (value.kind === 'error') {
        const formula = `=${normalizeErrorCode(value.code)}`
        this.engine!.setFormula(next.sheetName, next.row, next.column, formula)
        this.engineModes.set(key, { mode: 'formula', source: formula })
      } else {
        this.writeInputValue(next, value, snapshot.dateSystem)
      }
    }

    await this.applyFormulaModes(snapshot)
  }

  private async analyze(cell: EngineCell, snapshot: FormulaWorkbookSnapshot): Promise<FormulaAnalysis> {
    const value = cell.snapshot.value
    if (value.kind !== 'formula') throw new Error('Only formula values can be parsed.')
    const source = value.formula.canonicalExpression || value.formula.source
    const key = this.key(cell.sheetId, cell.snapshot.address)
    const analysis: FormulaAnalysis = {
      key,
      sheetId: cell.sheetId,
      sheetName: cell.sheetName,
      address: cell.snapshot.address,
      source,
      gridAst: null,
      references: [],
      referenceCells: 0,
      mode: 'supported',
    }

    if (
      source.length > FORMULA_RESOURCE_LIMITS.formulaLength ||
      exceedsNestingBudget(source) ||
      Date.now() - this.analysisStartedAt > FORMULA_RESOURCE_LIMITS.analysisTimeMs
    ) {
      analysis.mode = 'unsupported'
      analysis.reason = 'resource-limit'
      return analysis
    }
    if (hasExternalOrStructuredReference(source)) {
      analysis.mode = 'unsupported'
      analysis.reason = 'external-reference'
      return analysis
    }

    let parsed: ASTNodeData
    try {
      parsed = await parseFormualizerFormula(source.startsWith('=') ? source : `=${source}`)
    } catch {
      analysis.mode = 'unsupported'
      analysis.reason = 'parse-failed'
      return analysis
    }

    const sheetIdsByName = new Map(snapshot.sheets.map((sheet) => [sheet.name.toLocaleLowerCase('en-US'), sheet.id]))
    const validation = validateAndConvertAst(parsed, cell.sheetId, sheetIdsByName, source)
    analysis.gridAst = validation.ast
    analysis.references = validation.references
    analysis.referenceCells = validation.referenceCells
    if (validation.errorCode) {
      analysis.mode = 'error'
      analysis.errorCode = validation.errorCode
      return analysis
    }
    if (validation.unsupported) {
      analysis.mode = 'unsupported'
      analysis.reason = validation.unsupported
    }
    return analysis
  }

  private async applyFormulaModes(snapshot: FormulaWorkbookSnapshot): Promise<void> {
    const analyses = [...this.formulaAnalyses.values()]
    let rejected = false
    let referenceCells = 0
    for (const analysis of analyses) {
      referenceCells += analysis.referenceCells
      if (referenceCells > FORMULA_RESOURCE_LIMITS.referenceCells) {
        analysis.mode = 'unsupported'
        analysis.reason = 'resource-limit'
      }
    }
    const closure = findUnsupportedFormulaDependents(analyses, this.engineCells)

    for (const analysis of analyses) {
      const cell = this.engineCells.get(analysis.key)!
      const value = cell.snapshot.value
      if (value.kind !== 'formula') continue
      const blockedByUnsupported = closure.has(analysis.key) && analysis.mode === 'supported'

      if (analysis.mode === 'supported' && !blockedByUnsupported) {
        const currentMode = this.engineModes.get(analysis.key)
        if (currentMode?.mode === 'formula' && currentMode.source === analysis.source) continue
        try {
          this.engine!.setFormula(cell.sheetName, cell.row, cell.column, analysis.source)
          this.engineModes.set(analysis.key, { mode: 'formula', source: analysis.source })
        } catch {
          rejected = true
          analysis.mode = 'unsupported'
          analysis.reason = 'engine-rejected'
          this.engine!.setValue(
            cell.sheetName,
            cell.row,
            cell.column,
            toEngineValue(value.formula.cachedResult, snapshot.dateSystem),
          )
          this.engineModes.set(analysis.key, {
            mode: 'value',
            valueFingerprint: inputFingerprint(value.formula.cachedResult),
          })
        }
      } else if (analysis.mode === 'error') {
        const errorFormula = `=${normalizeErrorCode(analysis.errorCode ?? '#VALUE!')}`
        const currentMode = this.engineModes.get(analysis.key)
        if (currentMode?.mode !== 'formula' || currentMode.source !== errorFormula) {
          this.engine!.setFormula(cell.sheetName, cell.row, cell.column, errorFormula)
          this.engineModes.set(analysis.key, { mode: 'formula', source: errorFormula })
        }
      } else {
        const currentMode = this.engineModes.get(analysis.key)
        const fingerprint = inputFingerprint(value.formula.cachedResult)
        if (currentMode?.mode !== 'value' || currentMode.valueFingerprint !== fingerprint) {
          this.engine!.setValue(
            cell.sheetName,
            cell.row,
            cell.column,
            toEngineValue(value.formula.cachedResult, snapshot.dateSystem),
          )
          this.engineModes.set(analysis.key, { mode: 'value', valueFingerprint: fingerprint })
        }
      }
    }
    // A rejected formula becomes an unsupported input for its whole dependent closure.
    if (rejected) await this.applyFormulaModes(snapshot)
  }

  private evaluate(snapshot: FormulaWorkbookSnapshot): FormulaCalculationResponse {
    this.engine!.evaluateAll()
    const reports = new Map(
      [...this.formulaAnalyses.values()].map((analysis) => {
        const cell = this.engineCells.get(analysis.key)!
        return [
          analysis.key,
          this.engine!.inspectCell({ sheet: cell.sheetName, row: cell.row, column: cell.column }),
        ] as const
      }),
    )
    const spills = new Set(
      [...reports]
        .filter(([, report]) => report.cell.spill !== null || Array.isArray(report.cell.value))
        .map(([key]) => key),
    )
    if (spills.size) {
      // Grid has no spill ownership model yet. Never publish partial array results or
      // calculations that may have read engine-created cells absent from the workbook.
      this.reset()
      return {
        generation: snapshot.generation,
        updates: this.staleUpdates(snapshot).map((update) => ({
          ...update,
          calculationStatus: spills.has(this.key(update.sheetId, update.address)) ? 'unsupported' : 'stale',
        })),
      }
    }
    const updates: FormulaCalculationUpdate[] = []
    const analysesByKey = new Map([...this.formulaAnalyses.values()].map((analysis) => [analysis.key, analysis]))
    const unsupportedClosure = findUnsupportedFormulaDependents([...this.formulaAnalyses.values()], this.engineCells)

    for (const cell of this.flatten(snapshot)) {
      if (cell.snapshot.value.kind !== 'formula') continue
      const key = this.key(cell.sheetId, cell.snapshot.address)
      const analysis = analysesByKey.get(key)
      if (!analysis) continue

      if (analysis.mode === 'unsupported') {
        updates.push({
          sheetId: cell.sheetId,
          address: cell.snapshot.address,
          ast: analysis.gridAst,
          calculationStatus: 'unsupported',
        })
        continue
      }
      if (analysis.mode === 'supported' && unsupportedClosure.has(key)) {
        updates.push({
          sheetId: cell.sheetId,
          address: cell.snapshot.address,
          ast: analysis.gridAst,
          calculationStatus: 'stale',
        })
        continue
      }

      const facade = this.engine!.sheet(cell.sheetName)
      let raw: unknown
      try {
        const inspected = reports.get(key)!
        const typedValue = inspected.cell.value
        // getValue erases the distinction between literal error-like text and errors.
        // It is still needed for the engine's typed Date conversion.
        raw =
          typedValue && typeof typedValue === 'object' && 'kind' in typedValue && typedValue.kind === 'error'
            ? typedValue
            : facade.getValue(cell.row, cell.column)
      } finally {
        facade.free()
      }
      if (analysis.mode === 'error') raw = { kind: 'error', code: analysis.errorCode }
      const defaultDateFormat = containsFunction(analysis.gridAst, 'NOW') ? 'yyyy-mm-dd hh:mm:ss' : 'yyyy-mm-dd'
      const result = toFormulaResult(raw, snapshot.dateSystem, cell.snapshot.numberFormat, defaultDateFormat)
      updates.push({
        sheetId: cell.sheetId,
        address: cell.snapshot.address,
        ast: analysis.gridAst,
        calculationStatus: result.kind === 'error' ? 'error' : 'fresh',
        result,
      })
    }
    return { generation: snapshot.generation, updates }
  }

  private staleUpdates(snapshot: FormulaWorkbookSnapshot): FormulaCalculationUpdate[] {
    return this.flatten(snapshot)
      .filter((cell) => cell.snapshot.value.kind === 'formula')
      .map((cell) => ({
        sheetId: cell.sheetId,
        address: cell.snapshot.address,
        calculationStatus: 'stale' as const,
      }))
  }

  private resourceLimitedResponse(
    snapshot: FormulaWorkbookSnapshot,
    formulas: Array<{ sheetId: string; address: string }>,
  ): FormulaCalculationResponse {
    return {
      generation: snapshot.generation,
      warning: 'resource-limit',
      updates: formulas.map(({ sheetId, address }) => ({ sheetId, address, calculationStatus: 'stale' })),
    }
  }

  private flatten(snapshot: FormulaWorkbookSnapshot): EngineCell[] {
    return snapshot.sheets.flatMap((sheet) =>
      sheet.cells.map((cell) => {
        const address = parseCellAddress(cell.address)
        return {
          sheetId: sheet.id,
          sheetName: sheet.name,
          row: address.row,
          column: address.column,
          snapshot: cell,
        }
      }),
    )
  }

  private signature(snapshot: FormulaWorkbookSnapshot): string {
    return JSON.stringify([snapshot.dateSystem, snapshot.sheets.map(({ id, name }) => [id, name])])
  }

  private writeInputValue(
    cell: EngineCell,
    value: Exclude<CellValue, { kind: 'formula' }>,
    dateSystem: GridWorkbook['dateSystem'],
  ): void {
    if (value.kind === 'date') {
      const parts = serialToDateParts(value.serial, dateSystem)
      if (!parts.fictitious1900LeapDay) {
        const dayFormula = `=DATE(${parts.year},${parts.month},${parts.day})`
        const fraction = parts.millisecondsOfDay / DAY_MS
        const formula = fraction ? `${dayFormula}+${fraction}` : dayFormula
        this.engine!.setFormula(cell.sheetName, cell.row, cell.column, formula)
        this.engineModes.set(this.key(cell.sheetId, cell.snapshot.address), { mode: 'formula', source: formula })
        return
      }
    }
    this.engine!.setValue(cell.sheetName, cell.row, cell.column, toEngineValue(value, dateSystem))
    this.engineModes.set(this.key(cell.sheetId, cell.snapshot.address), { mode: 'value' })
  }

  private key(sheetId: string, address: string): string {
    return `${sheetId}!${cellAddressKey(parseCellAddress(address))}`
  }
}

function countFormulaCells(snapshot: FormulaWorkbookSnapshot): Array<{ sheetId: string; address: string }> {
  return snapshot.sheets.flatMap((sheet) =>
    sheet.cells
      .filter((cell) => cell.value.kind === 'formula')
      .map((cell) => ({ sheetId: sheet.id, address: cell.address })),
  )
}

function inputFingerprint(value: CellValue | FormulaResult): string {
  if (value.kind === 'formula')
    return JSON.stringify(['formula', value.formula.canonicalExpression || value.formula.source])
  return JSON.stringify(value)
}

function validateAndConvertAst(
  root: ASTNodeData,
  currentSheetId: string,
  sheetIdsByName: Map<string, string>,
  source: string,
): {
  ast: FormulaAstNode | null
  references: FormulaReference[]
  referenceCells: number
  unsupported?: FormulaAnalysis['reason']
  errorCode?: string
} {
  let nodeCount = 0
  let referenceCells = 0
  const references: FormulaReference[] = []
  let unsupported: FormulaAnalysis['reason']
  let errorCode: string | undefined

  const visit = (node: ASTNodeData, depth: number): FormulaAstNode | null => {
    nodeCount += 1
    if (nodeCount > FORMULA_RESOURCE_LIMITS.astNodes || depth > FORMULA_RESOURCE_LIMITS.astDepth) {
      unsupported = 'resource-limit'
      return null
    }

    switch (node.type) {
      case 'number':
        return { type: 'literal', value: Number(node.value) }
      case 'text':
        return { type: 'literal', value: String(node.value ?? '') }
      case 'boolean':
        return { type: 'literal', value: Boolean(node.value) }
      case 'reference': {
        const reference = node.reference
        if (!reference) {
          errorCode = '#REF!'
          return null
        }
        const sheetId = reference.sheet
          ? sheetIdsByName.get(reference.sheet.toLocaleLowerCase('en-US'))
          : currentSheetId
        if (!sheetId) {
          // Let the engine evaluate the original reference inside its expression.
          // Replacing the whole formula with #REF! breaks IFERROR and lazy IF.
          return { type: 'error', code: '#REF!' }
        }
        const { rowStart, rowEnd, colStart, colEnd } = reference
        if (
          rowStart < 1 ||
          colStart < 1 ||
          rowEnd < rowStart ||
          colEnd < colStart ||
          rowEnd > MAX_ROWS ||
          rowStart > MAX_ROWS ||
          colEnd > MAX_COLUMNS ||
          colStart > MAX_COLUMNS
        ) {
          errorCode = '#REF!'
          return null
        }
        const rangeSize = (rowEnd - rowStart + 1) * (colEnd - colStart + 1)
        referenceCells += rangeSize
        if (rangeSize > FORMULA_RESOURCE_LIMITS.rangeCells) {
          unsupported = 'resource-limit'
          return null
        }
        references.push({
          sheetId,
          range: {
            start: { row: rowStart, column: colStart },
            end: { row: rowEnd, column: colEnd },
          },
        })
        const start = {
          row: rowStart,
          column: colStart,
          absoluteRow: reference.rowAbsStart,
          absoluteColumn: reference.colAbsStart,
        }
        const end = {
          row: rowEnd,
          column: colEnd,
          absoluteRow: reference.rowAbsEnd,
          absoluteColumn: reference.colAbsEnd,
        }
        if (rowStart === rowEnd && colStart === colEnd) {
          return { type: 'reference', sheetName: reference.sheet, address: start }
        }
        return { type: 'range', sheetName: reference.sheet, range: { start, end } }
      }
      case 'function': {
        const name = (node.name ?? '').toUpperCase()
        if (!ALLOWED_FUNCTIONS.has(name)) unsupported ??= 'function-not-supported'
        const args = (node.args ?? []).map((argument) => visit(argument, depth + 1))
        if (args.some((argument) => argument === null)) return null
        return { type: 'call', name, arguments: args as FormulaAstNode[] }
      }
      case 'binaryOp': {
        const left = node.left ? visit(node.left, depth + 1) : null
        const right = node.right ? visit(node.right, depth + 1) : null
        if (!left || !right) return null
        return { type: 'binary', operator: node.op ?? '', left, right }
      }
      case 'unaryOp': {
        const operand = node.operand ? visit(node.operand, depth + 1) : null
        return operand ? { type: 'unary', operator: node.op ?? '', operand } : null
      }
      case 'array':
        unsupported ??= 'function-not-supported'
        return null
      case 'error':
        if (node.sourceTokenSubtype === 'Error') {
          return { type: 'error', code: source.slice(node.sourceStart, node.sourceEnd).toUpperCase() }
        }
        unsupported ??= 'parse-failed'
        return null
      default:
        unsupported ??= 'parse-failed'
        return null
    }
  }

  const ast = visit(root, 0)
  return { ast, references, referenceCells, unsupported, errorCode }
}

function unsupportedAnalysis(cell: EngineCell, reason: FormulaAnalysis['reason']): FormulaAnalysis {
  const value = cell.snapshot.value
  if (value.kind !== 'formula') throw new Error('Only formula values can be marked unsupported.')
  return {
    key: `${cell.sheetId}!${cellAddressKey(parseCellAddress(cell.snapshot.address))}`,
    sheetId: cell.sheetId,
    sheetName: cell.sheetName,
    address: cell.snapshot.address,
    source: value.formula.canonicalExpression || value.formula.source,
    gridAst: value.formula.ast,
    references: [],
    referenceCells: 0,
    mode: 'unsupported',
    reason,
  }
}

function findUnsupportedFormulaDependents(analyses: FormulaAnalysis[], cells: Map<string, EngineCell>): Set<string> {
  const formulasBySheet = new Map<string, Array<{ key: string; row: number; column: number }>>()
  const formulasByAddress = new Map<string, string>()
  for (const analysis of analyses) {
    const cell = cells.get(analysis.key)
    if (!cell) continue
    const list = formulasBySheet.get(analysis.sheetId) ?? []
    list.push({ key: analysis.key, row: cell.row, column: cell.column })
    formulasBySheet.set(analysis.sheetId, list)
    formulasByAddress.set(`${analysis.sheetId}!${cell.row}:${cell.column}`, analysis.key)
  }
  for (const list of formulasBySheet.values())
    list.sort((left, right) => left.row - right.row || left.column - right.column)

  const dependents = new Map<string, Set<string>>()
  let dependencyEdges = 0
  for (const analysis of analyses) {
    if (analysis.mode !== 'supported') continue
    for (const reference of analysis.references) {
      const start = reference.range.start
      const end = reference.range.end
      if (start.row === end.row && start.column === end.column) {
        const candidateKey = formulasByAddress.get(`${reference.sheetId}!${start.row}:${start.column}`)
        if (candidateKey) {
          dependencyEdges += 1
          if (dependencyEdges > FORMULA_RESOURCE_LIMITS.dependencyEdges) {
            analysis.mode = 'unsupported'
            analysis.reason = 'resource-limit'
            break
          }
          const targets = dependents.get(candidateKey) ?? new Set<string>()
          targets.add(analysis.key)
          dependents.set(candidateKey, targets)
        }
        continue
      }
      const candidates = formulasBySheet.get(reference.sheetId) ?? []
      for (const candidate of candidates) {
        if (candidate.row < reference.range.start.row || candidate.row > reference.range.end.row) continue
        if (candidate.column < reference.range.start.column || candidate.column > reference.range.end.column) continue
        dependencyEdges += 1
        if (dependencyEdges > FORMULA_RESOURCE_LIMITS.dependencyEdges) {
          analysis.mode = 'unsupported'
          analysis.reason = 'resource-limit'
          break
        }
        const targets = dependents.get(candidate.key) ?? new Set<string>()
        targets.add(analysis.key)
        dependents.set(candidate.key, targets)
      }
      if (analysis.mode !== 'supported') break
    }
  }

  const blocked = new Set(
    analyses.filter((analysis) => analysis.mode === 'unsupported').map((analysis) => analysis.key),
  )
  const queue = [...blocked]
  while (queue.length) {
    const key = queue.shift()!
    for (const dependent of dependents.get(key) ?? []) {
      if (blocked.has(dependent)) continue
      blocked.add(dependent)
      queue.push(dependent)
    }
  }
  return blocked
}

function toEngineValue(value: CellValue | FormulaResult, dateSystem: GridWorkbook['dateSystem']): unknown {
  switch (value.kind) {
    case 'blank':
      return null
    case 'number':
      return value.value
    case 'string':
      return value.value
    case 'boolean':
      return value.value
    case 'error':
      return null
    case 'date':
      return dateSystem === '1904' ? value.serial + 1_462 : value.serial
    case 'formula':
      return toEngineValue(value.formula.cachedResult, dateSystem)
  }
}

function toFormulaResult(
  raw: unknown,
  dateSystem: GridWorkbook['dateSystem'],
  numberFormat?: string,
  defaultDateFormat = 'yyyy-mm-dd',
): FormulaResult {
  if (raw === null || raw === undefined) return { kind: 'blank' }
  if (raw instanceof Date) {
    return {
      kind: 'date',
      serial: dateToSerialUnchecked(raw, dateSystem),
      numberFormat: numberFormat || defaultDateFormat,
    }
  }
  if (typeof raw === 'boolean') return { kind: 'boolean', value: raw }
  if (typeof raw === 'number') {
    if (!Number.isFinite(raw)) return { kind: 'error', code: '#NUM!' }
    if (isDateFormat(numberFormat)) {
      return {
        kind: 'date',
        serial: dateSystem === '1904' ? raw - 1_462 : raw,
        numberFormat: numberFormat!,
      }
    }
    return { kind: 'number', value: raw }
  }
  if (typeof raw === 'string') {
    return { kind: 'string', value: raw }
  }
  if (typeof raw === 'object' && 'kind' in raw && raw.kind === 'error' && 'code' in raw) {
    const code = String(raw.code)
    return code === '#CIRC!' || code === '#CYCLE!'
      ? { kind: 'error', code: '#CYCLE!', message: 'Circular reference.' }
      : { kind: 'error', code }
  }
  return { kind: 'error', code: '#VALUE!', message: 'The formula result type is not supported.' }
}

function containsFunction(node: FormulaAstNode | null, name: string): boolean {
  if (!node) return false
  switch (node.type) {
    case 'call':
      return node.name.toUpperCase() === name || node.arguments.some((argument) => containsFunction(argument, name))
    case 'unary':
      return containsFunction(node.operand, name)
    case 'binary':
      return containsFunction(node.left, name) || containsFunction(node.right, name)
    case 'literal':
    case 'error':
    case 'reference':
    case 'range':
      return false
  }
}

function dateToSerialUnchecked(date: Date, dateSystem: GridWorkbook['dateSystem']): number {
  const timestamp = date.getTime()
  const epoch = dateSystem === '1900' ? Date.UTC(1899, 11, 31) : Date.UTC(1904, 0, 1)
  let serial = (timestamp - epoch) / DAY_MS
  if (dateSystem === '1900' && timestamp >= ENGINE_1900_MARCH_1) serial += 1
  return serial
}

function isDateFormat(format: string | undefined): boolean {
  if (!format) return false
  const cleaned = format
    .split(';')[0]
    .replace(/"[^"]*"|\\./gu, '')
    .toLowerCase()
  return /y|d/.test(cleaned) || (/m/.test(cleaned) && /[/:]/.test(cleaned))
}

function normalizeErrorCode(code: string): string {
  // Imported error cells are untrusted text, too. Only literal error tokens
  // may enter this synthetic formula path; never interpolate arbitrary content.
  if (code === '#CYCLE!' || code === '#CIRC!') return '#CIRC!'
  return new Set(['#REF!', '#DIV/0!', '#NAME?', '#VALUE!', '#N/A', '#NUM!', '#NULL!']).has(code) ? code : '#VALUE!'
}

/** Brackets in string literals are data; elsewhere they denote unsupported references. */
function hasExternalOrStructuredReference(source: string): boolean {
  let quote = ''
  for (let index = 0; index < source.length; index += 1) {
    const character = source[index]
    if ((character === '[' || character === ']') && quote !== '"') return true
    if (quote) {
      if (character === quote) {
        if (source[index + 1] === quote) index += 1
        else quote = ''
      }
    } else if (character === '"' || character === "'") quote = character
  }
  return false
}

/** Guard parser recursion before invoking WASM; quoted strings/sheet names are data. */
function exceedsNestingBudget(source: string): boolean {
  let quote = ''
  let depth = 0
  for (let index = 0; index < source.length; index += 1) {
    const character = source[index]
    if (quote) {
      if (character === quote) {
        if (source[index + 1] === quote) index += 1
        else quote = ''
      }
    } else if (character === '"' || character === "'") quote = character
    else if (character === '(' && ++depth > FORMULA_RESOURCE_LIMITS.astDepth) return true
    else if (character === ')') depth -= 1
  }
  return false
}

/** Date-system validation helper used by engine tests and imported date cells. */
export function formulaDateSerialParts(serial: number, dateSystem: GridWorkbook['dateSystem']) {
  return serialToDateParts(serial, dateSystem)
}
