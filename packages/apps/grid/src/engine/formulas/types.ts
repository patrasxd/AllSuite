import type { CellValue, FormulaResult, FormulaAstNode, Workbook } from '../workbook/types'

export interface FormulaCellSnapshot {
  address: string
  value: CellValue
  numberFormat?: string
}

export interface FormulaSheetSnapshot {
  id: string
  name: string
  cells: FormulaCellSnapshot[]
}

export interface FormulaWorkbookSnapshot {
  generation: number
  dateSystem: Workbook['dateSystem']
  sheets: FormulaSheetSnapshot[]
}

export interface FormulaCalculationUpdate {
  sheetId: string
  address: string
  calculationStatus: 'fresh' | 'stale' | 'unsupported' | 'error'
  ast?: FormulaAstNode | null
  result?: FormulaResult
}

export interface FormulaCalculationResponse {
  generation: number
  updates: FormulaCalculationUpdate[]
  warning?: 'resource-limit' | 'calculation-timeout' | 'engine-error'
}

export function createFormulaWorkbookSnapshot(workbook: Workbook, generation: number): FormulaWorkbookSnapshot {
  return {
    generation,
    dateSystem: workbook.dateSystem,
    sheets: workbook.sheetOrder.map((sheetId) => {
      const sheet = workbook.sheetsById.get(sheetId)!
      return {
        id: sheet.id,
        name: sheet.name,
        cells: [...sheet.cells].map(([address, cell]) => ({
          address,
          value: cell.value,
          numberFormat: cell.style?.numberFormat,
        })),
      }
    }),
  }
}
