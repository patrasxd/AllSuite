import { FormulaRuntime } from './runtime'
import type { FormulaCalculationResponse, FormulaWorkbookSnapshot } from './types'

interface FormulaWorkerRequest {
  snapshot: FormulaWorkbookSnapshot
  forceRebuild: boolean
}

const scope = self as unknown as {
  addEventListener: (type: 'message', listener: (event: MessageEvent<FormulaWorkerRequest>) => void) => void
  postMessage: (message: FormulaCalculationResponse) => void
}

const runtime = new FormulaRuntime()
let latestGeneration = 0
let queued = Promise.resolve()

scope.addEventListener('message', (event: MessageEvent<FormulaWorkerRequest>) => {
  const { snapshot, forceRebuild } = event.data
  latestGeneration = Math.max(latestGeneration, snapshot.generation)
  queued = queued.then(async () => {
    const response = await runtime.calculate(snapshot, forceRebuild)
    if (snapshot.generation === latestGeneration) scope.postMessage(response)
  })
})
