import type { ImportResult } from '../../document-model'

export async function importDocxInWorker(
  bytes: ArrayBuffer,
  onProgress?: (value: number) => void,
): Promise<ImportResult> {
  if (typeof Worker === 'undefined') {
    const { importDocx } = await import('./index')
    return importDocx(bytes)
  }
  onProgress?.(0)
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' })
    worker.onmessage = (event: MessageEvent<{ phase: string; result?: ImportResult; error?: string }>) => {
      if (event.data.phase === 'parsing') onProgress?.(45)
      if (event.data.phase === 'complete' && event.data.result) {
        onProgress?.(100)
        worker.terminate()
        resolve(event.data.result)
      }
      if (event.data.phase === 'error') {
        worker.terminate()
        reject(new Error(event.data.error))
      }
    }
    worker.onerror = () => {
      worker.terminate()
      reject(new Error('Unable to start the DOCX reader.'))
    }
    worker.postMessage({ bytes }, [bytes])
  })
}
