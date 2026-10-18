import { describe, expect, it, vi } from 'vitest'
import { inferCellValue } from '../editing/cell-input'
import { createWorkbook } from '../workbook/model'
import { WorkbookSession } from '../workbook/session'
import type { FormulaCalculationResponse, FormulaWorkbookSnapshot } from './types'
import { FormulaCalculationClient } from './worker-client'
import { FORMULA_RESOURCE_LIMITS } from './policy'

interface WorkerRequest {
  snapshot: FormulaWorkbookSnapshot
  forceRebuild: boolean
}

class MockWorker {
  readonly requests: WorkerRequest[] = []
  readonly listeners = new Map<string, Set<EventListenerOrEventListenerObject>>()
  terminated = false

  postMessage(request: WorkerRequest): void {
    this.requests.push(request)
  }

  terminate(): void {
    this.terminated = true
  }

  addEventListener(type: string, listener: EventListenerOrEventListenerObject): void {
    const listeners = this.listeners.get(type) ?? new Set()
    listeners.add(listener)
    this.listeners.set(type, listeners)
  }

  emitMessage(response: FormulaCalculationResponse): void {
    for (const listener of this.listeners.get('message') ?? []) {
      const event = { data: response } as MessageEvent<FormulaCalculationResponse>
      if (typeof listener === 'function') listener(event)
      else listener.handleEvent(event)
    }
  }

  emitError(): void {
    for (const listener of this.listeners.get('error') ?? []) {
      if (typeof listener === 'function') listener(new Event('error'))
      else listener.handleEvent(new Event('error'))
    }
  }
}

describe('FormulaCalculationClient', () => {
  it('cancels in-flight work on edits and ignores a stale generation response', async () => {
    vi.useFakeTimers()
    const workers: MockWorker[] = []
    vi.stubGlobal(
      'Worker',
      class extends MockWorker {
        constructor() {
          super()
          workers.push(this)
        }
      },
    )

    const workbook = createWorkbook()
    const session = new WorkbookSession(workbook)
    const sheetId = workbook.activeSheetId
    session.setCell(sheetId, 'A1', { kind: 'number', value: 1 })
    session.setCell(sheetId, 'B1', inferCellValue('=A1+1', 'en', workbook.dateSystem))
    const client = new FormulaCalculationClient(session)

    try {
      await vi.advanceTimersByTimeAsync(24)
      expect(workers).toHaveLength(1)
      const oldGeneration = workers[0]!.requests[0]!.snapshot.generation

      session.setCell(sheetId, 'A1', { kind: 'number', value: 4 })
      expect(workers[0]!.terminated).toBe(true)
      await vi.advanceTimersByTimeAsync(24)
      expect(workers).toHaveLength(2)
      const currentGeneration = workers[1]!.requests[0]!.snapshot.generation
      expect(currentGeneration).toBeGreaterThan(oldGeneration)

      workers[0]!.emitMessage({
        generation: oldGeneration,
        updates: [{ sheetId, address: 'B1', calculationStatus: 'fresh', result: { kind: 'number', value: 2 } }],
      })
      expect(session.getCell(sheetId, 'B1')?.value).toMatchObject({
        kind: 'formula',
        formula: { cachedResult: { kind: 'blank' }, calculationStatus: 'stale' },
      })

      workers[1]!.emitMessage({
        generation: currentGeneration,
        updates: [{ sheetId, address: 'B1', calculationStatus: 'fresh', result: { kind: 'number', value: 5 } }],
      })
      expect(session.getCell(sheetId, 'B1')?.value).toMatchObject({
        kind: 'formula',
        formula: { cachedResult: { kind: 'number', value: 5 }, calculationStatus: 'fresh' },
      })

      workers[0]!.emitError()
      expect(session.getCell(sheetId, 'B1')?.value).toMatchObject({
        kind: 'formula',
        formula: { calculationStatus: 'fresh' },
      })
      session.activateSheet(session.createSheet('Other'))
      await vi.advanceTimersByTimeAsync(24)
      const last = workers.at(-1)!
      await vi.advanceTimersByTimeAsync(FORMULA_RESOURCE_LIMITS.workerTimeoutMs)
      expect(last.terminated).toBe(true)
      expect(session.getCell(sheetId, 'B1')?.value).toMatchObject({
        kind: 'formula',
        formula: { calculationStatus: 'stale', cachedResult: { kind: 'number', value: 5 } },
      })

      client.cancel()
      expect(last.terminated).toBe(true)
    } finally {
      client.dispose()
      vi.useRealTimers()
      vi.unstubAllGlobals()
    }
  })
})
