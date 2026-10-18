import type { XlsxImportPreflight, XlsxImportProgress } from './types'
import { XlsxImportError } from './types'

export interface XlsxImportTask {
  promise: Promise<XlsxImportPreflight>
  cancel: () => void
}

export function startXlsxImport(
  fileName: string,
  bytes: ArrayBuffer,
  onProgress: (progress: XlsxImportProgress) => void,
): XlsxImportTask {
  let settled = false
  let rejectTask: ((reason: Error) => void) | undefined
  const worker = new Worker(new URL('./worker.ts', import.meta.url), {
    type: 'module',
    name: 'allsuite-grid-xlsx-import',
  })
  const promise = new Promise<XlsxImportPreflight>((resolve, reject) => {
    rejectTask = reject
    worker.addEventListener('message', (event: MessageEvent) => {
      if (settled) return
      const response = event.data as { type?: string; progress?: XlsxImportProgress; result?: XlsxImportPreflight }
      if (response.type === 'progress' && response.progress) {
        onProgress(response.progress)
      } else if (response.type === 'result' && response.result) {
        settled = true
        worker.terminate()
        resolve(response.result)
      } else if (response.type === 'error') {
        settled = true
        worker.terminate()
        reject(new XlsxImportError('worker', 'The workbook import worker failed.'))
      }
    })
    worker.addEventListener('error', () => {
      if (settled) return
      settled = true
      worker.terminate()
      reject(new XlsxImportError('worker', 'The workbook import worker failed.'))
    })
    try {
      worker.postMessage({ fileName, buffer: bytes }, [bytes])
    } catch {
      settled = true
      worker.terminate()
      reject(new XlsxImportError('worker', 'The workbook import worker could not start.'))
    }
  })
  return {
    promise,
    cancel: () => {
      if (settled) return
      settled = true
      worker.terminate()
      rejectTask?.(new XlsxImportError('worker', 'Workbook import was canceled.'))
    },
  }
}
