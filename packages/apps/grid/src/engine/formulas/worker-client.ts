import type { WorkbookChangeEvent } from '../workbook/types'
import { WorkbookSession } from '../workbook/session'
import { createFormulaWorkbookSnapshot, type FormulaCalculationResponse } from './types'
import { FORMULA_RESOURCE_LIMITS } from './policy'

/** Owns a lazy calculation worker. Generation checks prevent stale results from replacing newer edits. */
export class FormulaCalculationClient {
  private worker: Worker | null = null
  private generation = 0
  private timer: ReturnType<typeof setTimeout> | null = null
  private watchdog: ReturnType<typeof setTimeout> | null = null
  private calculationActive = false
  private disposed = false
  private readonly unsubscribe: () => void

  constructor(private readonly session: WorkbookSession) {
    this.unsubscribe = session.subscribe((event) => this.onWorkbookChange(event))
    this.schedule(false)
  }

  cancel(): void {
    this.generation += 1
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
    this.clearWatchdog()
    this.worker?.terminate()
    this.worker = null
    this.calculationActive = false
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    this.cancel()
    this.unsubscribe()
  }

  private onWorkbookChange(event: WorkbookChangeEvent): void {
    if (this.disposed || event.kind === 'calculation' || event.kind === 'dirty-state') return
    if (event.kind !== 'replace' && event.impacts.length === 0) return
    if (event.kind === 'replace') this.cancel()
    const rebuild =
      event.kind === 'replace' ||
      event.impacts.some(
        (impact) =>
          impact === 'cell-addresses' ||
          impact === 'sheet-names' ||
          impact === 'sheet-order' ||
          impact === 'sheet-structure' ||
          impact === 'all',
      )
    this.schedule(rebuild)
  }

  private schedule(forceRebuild: boolean): void {
    const generation = ++this.generation
    if (this.timer) clearTimeout(this.timer)
    if (this.calculationActive) {
      this.clearWatchdog()
      this.worker?.terminate()
      this.worker = null
      this.calculationActive = false
    }
    this.timer = setTimeout(() => {
      this.timer = null
      if (this.disposed || generation !== this.generation) return
      const workbook = this.session.workbook
      const hasFormulas = [...workbook.sheetsById.values()].some((sheet) =>
        [...sheet.cells.values()].some((cell) => cell.value.kind === 'formula'),
      )
      if (!hasFormulas) {
        this.worker?.terminate()
        this.worker = null
        this.calculationActive = false
        return
      }

      const worker = this.ensureWorker()
      const snapshot = createFormulaWorkbookSnapshot(workbook, generation)
      this.calculationActive = true
      this.watchdog = setTimeout(() => this.failWorker(worker, generation), FORMULA_RESOURCE_LIMITS.workerTimeoutMs)
      try {
        worker.postMessage({ snapshot, forceRebuild })
      } catch {
        this.failWorker(worker, generation)
      }
    }, 24)
  }

  private ensureWorker(): Worker {
    if (this.worker) return this.worker
    const worker = new Worker(new URL('./worker.ts', import.meta.url), {
      type: 'module',
      name: 'allsuite-grid-formula-calculation',
    })
    worker.addEventListener('message', (event: MessageEvent<FormulaCalculationResponse>) => {
      const response = event.data
      if (this.disposed || this.worker !== worker || response.generation !== this.generation) return
      this.calculationActive = false
      this.clearWatchdog()
      this.session.applyCalculationResults(response.updates)
    })
    worker.addEventListener('error', () => {
      this.failWorker(worker, this.generation)
    })
    this.worker = worker
    return worker
  }

  private clearWatchdog(): void {
    if (this.watchdog) clearTimeout(this.watchdog)
    this.watchdog = null
  }

  private failWorker(worker: Worker, generation: number): void {
    if (this.disposed || this.worker !== worker || generation !== this.generation) return
    this.clearWatchdog()
    this.calculationActive = false
    worker.terminate()
    this.worker = null
    const updates = [...this.session.workbook.sheetsById.values()].flatMap((sheet) =>
      [...sheet.cells].flatMap(([address, cell]) =>
        cell.value.kind === 'formula' ? [{ sheetId: sheet.id, address, calculationStatus: 'stale' as const }] : [],
      ),
    )
    this.session.applyCalculationResults(updates)
  }
}
