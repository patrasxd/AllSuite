import { FormulaRuntime } from './runtime'
import type { FormulaCalculationResponse, FormulaWorkbookSnapshot } from './types'
import { planStructuralFormulas, type StructuralOperation, type StructuralFormulaCells } from './row-transform'
import type { Workbook, CellAddress, CellValue } from '../workbook/types'
import { prepareFormulaPaste, type FormulaCopy } from '../editing/formula-clipboard'

interface FormulaWorkerRequest {
  snapshot: FormulaWorkbookSnapshot
  forceRebuild: boolean
}
interface StructuralWorkerRequest {
  workbook: Workbook
  structuralOperation: StructuralOperation
}
interface CopyWorkerRequest {
  workbook: Workbook
  formulaCopy: FormulaCopy
  sheetId: string
  start: CellAddress
}
type WorkerRequest = FormulaWorkerRequest | StructuralWorkerRequest | CopyWorkerRequest

const scope = self as unknown as {
  addEventListener: (type: 'message', listener: (event: MessageEvent<WorkerRequest>) => void) => void
  postMessage: (
    message:
      | FormulaCalculationResponse
      | { structuralFormulaCells?: StructuralFormulaCells; formulaRows?: CellValue[][]; error?: string },
  ) => void
}

const runtime = new FormulaRuntime()
let latestGeneration = 0
let queued = Promise.resolve()

scope.addEventListener('message', (event: MessageEvent<WorkerRequest>) => {
  if ('formulaCopy' in event.data) {
    const { workbook, sheetId, start, formulaCopy } = event.data
    void prepareFormulaPaste(workbook, sheetId, start, formulaCopy).then(
      (formulaRows) => scope.postMessage({ formulaRows }),
      (error) => scope.postMessage({ error: error instanceof Error ? error.message : 'Unsupported formula copy.' }),
    )
    return
  }
  if ('structuralOperation' in event.data) {
    const { workbook, structuralOperation } = event.data
    void planStructuralFormulas(workbook, structuralOperation).then(
      (structuralFormulaCells) => scope.postMessage({ structuralFormulaCells }),
      (error) =>
        scope.postMessage({ error: error instanceof Error ? error.message : 'Unsupported structural operation.' }),
    )
    return
  }
  const { snapshot, forceRebuild } = event.data
  latestGeneration = Math.max(latestGeneration, snapshot.generation)
  queued = queued.then(async () => {
    const response = await runtime.calculate(snapshot, forceRebuild)
    if (snapshot.generation === latestGeneration) scope.postMessage(response)
  })
})
