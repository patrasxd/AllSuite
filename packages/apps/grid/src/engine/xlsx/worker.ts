import { parseXlsxWorkbook } from './import'
import type { XlsxImportPreflight, XlsxImportProgress } from './types'

type WorkerRequest = { fileName: string; buffer: ArrayBuffer }
type WorkerResponse =
  | { type: 'progress'; progress: XlsxImportProgress }
  | { type: 'result'; result: XlsxImportPreflight }
  | { type: 'error' }

const scope = self as unknown as {
  addEventListener: (type: 'message', listener: (event: MessageEvent<WorkerRequest>) => void) => void
  postMessage: (message: WorkerResponse, transfer?: Transferable[]) => void
}

scope.addEventListener('message', async (event: MessageEvent<WorkerRequest>) => {
  try {
    const { fileName, buffer } = event.data
    const result = await parseXlsxWorkbook(fileName, new Uint8Array(buffer), (progress) => {
      scope.postMessage({ type: 'progress', progress } satisfies WorkerResponse)
    })
    const original = result.workbook?.preservation?.originalArchiveBytes
    const transfers = original ? [original.buffer] : []
    scope.postMessage({ type: 'result', result } satisfies WorkerResponse, transfers)
  } catch {
    scope.postMessage({ type: 'error' } satisfies WorkerResponse)
  }
})
