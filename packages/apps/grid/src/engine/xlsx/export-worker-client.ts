import type { Workbook } from '../workbook/types'
import type { XlsxExportProgress, XlsxExportResult } from './types'

export interface XlsxExportTask {
  promise: Promise<XlsxExportResult>
  cancel: () => void
}

export function startXlsxExport(
  workbook: Workbook,
  fileName: string,
  onProgress: (progress: XlsxExportProgress) => void,
): XlsxExportTask {
  let settled = false
  let rejectTask: ((reason: Error) => void) | undefined
  const worker = new Worker(new URL('./export-worker.ts', import.meta.url), {
    type: 'module',
    name: 'allsuite-grid-xlsx-export',
  })
  const promise = new Promise<XlsxExportResult>((resolve, reject) => {
    rejectTask = reject
    worker.addEventListener('message', (event: MessageEvent) => {
      if (settled) return
      const response = event.data as { type?: string; progress?: XlsxExportProgress; result?: XlsxExportResult }
      if (response.type === 'progress' && response.progress) onProgress(response.progress)
      else if (response.type === 'result' && response.result) {
        settled = true
        worker.terminate()
        resolve(response.result)
      } else if (response.type === 'error') {
        settled = true
        worker.terminate()
        reject(new Error('The workbook export worker failed.'))
      }
    })
    worker.addEventListener('error', () => {
      if (settled) return
      settled = true
      worker.terminate()
      reject(new Error('The workbook export worker failed.'))
    })
    try {
      worker.postMessage({ type: 'export', workbook: structuredClone(workbook), fileName })
    } catch {
      settled = true
      worker.terminate()
      reject(new Error('The workbook export worker could not start.'))
    }
  })
  return {
    promise,
    cancel: () => {
      if (settled) return
      settled = true
      worker.terminate()
      rejectTask?.(new Error('Workbook export was canceled.'))
    },
  }
}
