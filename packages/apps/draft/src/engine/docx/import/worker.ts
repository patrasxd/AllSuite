import { importDocx } from './index'

self.onmessage = (event: MessageEvent<{ bytes: ArrayBuffer }>) => {
  try {
    self.postMessage({ phase: 'parsing' })
    const result = importDocx(event.data.bytes)
    self.postMessage({ phase: 'complete', result })
  } catch (error) {
    self.postMessage({
      phase: 'error',
      error: error instanceof Error ? error.message : 'Unable to read the DOCX file.',
    })
  }
}
