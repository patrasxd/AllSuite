import { DOMParser } from '@xmldom/xmldom'
import { strFromU8, unzipSync } from 'fflate'
import type { StructuralOperation, StructuralFormulaCells } from './row-transform'
import { FORMULA_RESOURCE_LIMITS } from './policy'
import { exportXlsxWorkbook } from '../xlsx/export'
import { parseXlsxWorkbook } from '../xlsx/import'
import { applyWorkbookPatch, planWorkbookAction } from '../workbook/commands'
import type { Workbook, CellAddress, CellValue } from '../workbook/types'
import type { FormulaCopy } from '../editing/formula-clipboard'
import { checkClipboardDestination } from '../editing/clipboard'
import type { WorkbookSession } from '../workbook/session'

async function preflightFormulaWorker(
  workbook: Workbook,
  structuralOperation: StructuralOperation,
): Promise<StructuralFormulaCells> {
  // The pure adapter remains executable in Node tests; browsers use the same WASM
  // worker as calculation so the page CSP never needs wasm-unsafe-eval.
  if (typeof Worker === 'undefined')
    return (await import('./row-transform')).planStructuralFormulas(workbook, structuralOperation)
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./worker.ts', import.meta.url), {
      type: 'module',
      name: 'allsuite-grid-structural-preflight',
    })
    const finish = () => {
      clearTimeout(timer)
      worker.terminate()
    }
    const timer = setTimeout(() => {
      finish()
      reject(new Error('Structural preflight exceeded the calculation budget. Keep the original cells.'))
    }, FORMULA_RESOURCE_LIMITS.workerTimeoutMs)
    worker.addEventListener(
      'message',
      (event: MessageEvent<{ structuralFormulaCells?: StructuralFormulaCells; error?: string }>) => {
        finish()
        if (event.data.structuralFormulaCells) resolve(event.data.structuralFormulaCells)
        else reject(new Error(event.data.error || 'Structural formulas could not be checked.'))
      },
    )
    worker.addEventListener('error', () => {
      finish()
      reject(new Error('Structural formulas could not be checked.'))
    })
    try {
      worker.postMessage({ workbook: { ...workbook, preservation: undefined }, structuralOperation })
    } catch (error) {
      finish()
      reject(error)
    }
  })
}

/** Parser and codec orchestration stays outside the framework-independent workbook core. */
export async function editWorkbookRows(
  session: WorkbookSession,
  sheetId: string,
  start: number,
  count = 1,
  insert = true,
): Promise<boolean> {
  return editWorkbookStructure(session, { sheetId, start, count, insert, axis: 'row' })
}

export async function editWorkbookColumns(
  session: WorkbookSession,
  sheetId: string,
  start: number,
  count = 1,
  insert = true,
): Promise<boolean> {
  return editWorkbookStructure(session, { sheetId, start, count, insert, axis: 'column' })
}

async function editWorkbookStructure(session: WorkbookSession, operation: StructuralOperation): Promise<boolean> {
  const revision = session.currentRevision
  const snapshot = structuredClone(session.workbook)
  const command = await prepareStructuralCommand(snapshot, operation)
  return session.applyPreparedCommand(command, revision)
}

/** Conservative imported subset; this does not authorize relocation of opaque OOXML. */
export async function prepareStructuralCommand(workbook: Workbook, operation: StructuralOperation) {
  const bytes = workbook.preservation?.originalArchiveBytes
  const formulaOnlyParts = new Set<string>()
  if (bytes) {
    const source = await parseXlsxWorkbook('row-preflight.xlsx', bytes)
    if (
      !source.report.canOpen ||
      source.report.findings.some((finding) => finding.category !== 'supported' && finding.code !== 'formula-cache')
    )
      throw new Error('Imported workbook features prevent safe structural editing. Keep the original cells.')
    for (const finding of source.report.findings)
      if (finding.code === 'formula-cache') finding.partNames.forEach((path) => formulaOnlyParts.add(path))
  }
  if (
    workbook.preservation?.parts.some(
      (part) =>
        part.classification !== 'supported' &&
        !(part.classification === 'readable-not-editable' && formulaOnlyParts.has(part.partName)),
    )
  )
    throw new Error(
      'Imported objects or unknown workbook parts prevent safe structural editing. Keep the original cells.',
    )
  for (const sheet of workbook.sheetsById.values()) {
    if (
      sheet.tables.length ||
      sheet.comments?.length ||
      sheet.drawings.length ||
      sheet.pivots.length ||
      sheet.validations.length ||
      sheet.conditionalFormats.length ||
      sheet.autoFilter ||
      sheet.hyperlinks?.length ||
      sheet.printSettings ||
      sheet.unsupportedSheetViews
    )
      throw new Error('Tables, notes, objects or range-dependent worksheet features prevent safe structural editing.')
  }
  if (bytes) {
    const worksheetParts = new Set(workbook.preservation?.sheetMappings?.map((mapping) => mapping.partName))
    for (const [path, content] of Object.entries(unzipSync(bytes))) {
      if (!worksheetParts.has(path)) continue
      const xml = new DOMParser().parseFromString(strFromU8(content), 'application/xml')
      const root = xml.documentElement!
      const ownedChildren = new Set(['dimension', 'sheetViews', 'sheetFormatPr', 'cols', 'sheetData', 'mergeCells'])
      for (let index = 0; index < root.childNodes.length; index++) {
        const child = root.childNodes.item(index)!
        if (child.nodeType === 1 && !ownedChildren.has(child.localName ?? ''))
          throw new Error('Imported worksheet structures prevent safe structural editing.')
      }
      for (const [tag, attributes] of [
        ['row', ['r', 'ht', 'hidden', 'outlineLevel', 'customHeight']],
        ['col', ['min', 'max', 'width', 'hidden', 'outlineLevel', 'customWidth']],
        ['c', ['r', 's', 't']],
      ] as const) {
        const elements = xml.getElementsByTagNameNS('http://schemas.openxmlformats.org/spreadsheetml/2006/main', tag)
        for (let index = 0; index < elements.length; index++) {
          const element = elements.item(index)!
          for (let attribute = 0; attribute < element.attributes.length; attribute++)
            if (!(attributes as readonly string[]).includes(element.attributes.item(attribute)!.name))
              throw new Error('Imported row, column or cell metadata prevents safe structural editing.')
        }
      }
      const formulas = xml.getElementsByTagNameNS('http://schemas.openxmlformats.org/spreadsheetml/2006/main', 'f')
      for (let index = 0; index < formulas.length; index++) {
        if (formulas.item(index)!.attributes.length)
          throw new Error('Shared, array, spill or attributed imported formulas prevent safe structural editing.')
      }
    }
  }
  const structuralFormulaCells = await preflightFormulaWorker(workbook, operation)
  const command = planWorkbookAction(
    workbook,
    {
      type:
        operation.axis === 'column'
          ? operation.insert
            ? 'insert-columns'
            : 'delete-columns'
          : operation.insert
            ? 'insert-rows'
            : 'delete-rows',
      sheetId: operation.sheetId,
      start: operation.start,
      count: operation.count,
    },
    {
      createId: () => {
        throw new Error('Structural operations cannot create objects.')
      },
      structuralFormulaCells,
    },
  )
  // Run unchanged export protection/validation on the plan snapshot, never the live workbook.
  for (const patch of command.patches) applyWorkbookPatch(workbook, patch, 'forward')
  const output = await exportXlsxWorkbook(workbook, workbook.name || 'rows.xlsx')
  if (!output.report.canSave || !output.bytes)
    throw new Error(
      'The structural operation cannot preserve this XLSX. Keep the original cells or undo unsupported edits.',
    )
  return command
}

/** Same WASM worker boundary as structural preflight; no relaxed page CSP. */
export async function prepareFormulaPasteInWorker(
  workbook: Workbook,
  sheetId: string,
  start: CellAddress,
  payload: FormulaCopy,
): Promise<CellValue[][]> {
  checkClipboardDestination(workbook, sheetId, {
    start,
    end: { row: start.row + payload.rows.length - 1, column: start.column + (payload.rows[0]?.length ?? 0) - 1 },
  })
  if (typeof Worker === 'undefined')
    return (await import('../editing/formula-clipboard')).prepareFormulaPaste(workbook, sheetId, start, payload)
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./worker.ts', import.meta.url), {
      type: 'module',
      name: 'allsuite-grid-copy-preflight',
    })
    const finish = () => {
      clearTimeout(timer)
      worker.terminate()
    }
    const timer = setTimeout(() => {
      finish()
      reject(new Error('Formula copy exceeded calculation budget.'))
    }, FORMULA_RESOURCE_LIMITS.workerTimeoutMs)
    worker.addEventListener('message', (event: MessageEvent<{ formulaRows?: CellValue[][]; error?: string }>) => {
      finish()
      if (event.data.formulaRows) resolve(event.data.formulaRows)
      else reject(new Error(event.data.error || 'Formula copy failed.'))
    })
    worker.addEventListener('error', () => {
      finish()
      reject(new Error('Formula copy worker failed.'))
    })
    try {
      worker.postMessage({ formulaCopy: payload, workbook: { ...workbook, preservation: undefined }, sheetId, start })
    } catch (error) {
      finish()
      reject(error)
    }
  })
}
