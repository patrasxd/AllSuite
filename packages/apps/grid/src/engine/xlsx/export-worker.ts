import { exportXlsxWorkbook } from './export'
import type { XlsxExportProgress, XlsxExportResult } from './types'
import type { Workbook } from '../workbook/types'

type WorkerRequest = { type: 'export'; workbook: Workbook; fileName: string }
type WorkerResponse =
  { type: 'progress'; progress: XlsxExportProgress } | { type: 'result'; result: XlsxExportResult } | { type: 'error' }

const scope = self as unknown as {
  addEventListener: (type: 'message', listener: (event: MessageEvent<WorkerRequest>) => void) => void
  postMessage: (message: WorkerResponse, transfer?: Transferable[]) => void
}

scope.addEventListener('message', async (event: MessageEvent<WorkerRequest>) => {
  try {
    const { workbook, fileName } = event.data
    const result = await exportXlsxWorkbook(workbook, fileName, (progress) => {
      scope.postMessage({ type: 'progress', progress } satisfies WorkerResponse)
    })
    const transfer = result.bytes ? [result.bytes.buffer] : []
    scope.postMessage({ type: 'result', result } satisfies WorkerResponse, transfer)
  } catch {
    scope.postMessage({ type: 'error' } satisfies WorkerResponse)
  }
})
