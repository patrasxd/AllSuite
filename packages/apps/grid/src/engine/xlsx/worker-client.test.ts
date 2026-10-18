import { afterEach, describe, expect, it, vi } from 'vitest'
import { startXlsxImport } from './worker-client'

afterEach(() => vi.unstubAllGlobals())

describe('XLSX import worker lifecycle', () => {
  function setup() {
    const listeners = new Map<string, (event: MessageEvent) => void>()
    const terminate = vi.fn()
    const postMessage = vi.fn()
    vi.stubGlobal(
      'Worker',
      class {
        terminate = terminate
        postMessage = postMessage
        addEventListener(type: string, listener: (event: MessageEvent) => void) {
          listeners.set(type, listener)
        }
      },
    )
    const progress = vi.fn()
    const bytes = new ArrayBuffer(8)
    const task = startXlsxImport('book.xlsx', bytes, progress)
    const send = (data: unknown) => listeners.get('message')!(new MessageEvent('message', { data }))
    return { task, bytes, progress, terminate, postMessage, send, listeners }
  }

  it('transfers bytes to the worker and terminates it when canceled, ignoring late messages', async () => {
    const { task, bytes, progress, terminate, postMessage, send } = setup()
    expect(postMessage).toHaveBeenCalledWith({ fileName: 'book.xlsx', buffer: bytes }, [bytes])
    const rejected = expect(task.promise).rejects.toThrow('canceled')
    task.cancel()
    send({ type: 'progress', progress: { phase: 'map', percent: 100 } })
    send({ type: 'result', result: { report: { canOpen: true } } })
    await rejected
    expect(progress).not.toHaveBeenCalled()
    expect(terminate).toHaveBeenCalledOnce()
  })

  it('forwards progress and returns a review result without committing a workbook', async () => {
    const { task, progress, terminate, send } = setup()
    const report = { fileName: 'book.xlsx', sheetCount: 0, cellCount: 0, findings: [], canOpen: false }
    send({ type: 'progress', progress: { phase: 'inspect', percent: 3 } })
    send({ type: 'result', result: { report } })
    expect(await task.promise).toEqual({ report })
    expect(progress).toHaveBeenCalledWith({ phase: 'inspect', percent: 3 })
    task.cancel()
    expect(terminate).toHaveBeenCalledOnce()
  })
})
