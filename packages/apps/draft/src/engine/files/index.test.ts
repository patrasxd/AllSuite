import { describe, expect, it, vi } from 'vitest'
import { docxName, readDocument, writeToHandle, type FileHandle } from './index'

describe('memory-only file adapters', () => {
  it('reads text documents without a file handle or browser storage', async () => {
    const result = await readDocument({ name: 'notes.md', text: async () => '# Notes\nBody' } as File)
    expect(result.handle).toBeUndefined()
    expect(result.document.content.map((node) => node.content?.[0]?.text)).toEqual(['# Notes', 'Body'])
  })

  it('writes only to the supplied in-memory handle and propagates write failures', async () => {
    const write = vi.fn(async () => {})
    const close = vi.fn(async () => {})
    const handle: FileHandle = {
      kind: 'file',
      name: 'draft.docx',
      getFile: vi.fn(),
      createWritable: async () => ({ write, close }),
    }
    await writeToHandle(handle, new Blob(['document']))
    expect(write).toHaveBeenCalledOnce()
    expect(close).toHaveBeenCalledOnce()
    await expect(
      writeToHandle(
        {
          ...handle,
          createWritable: async () => ({
            write: async () => {
              throw new Error('denied')
            },
            close,
          }),
        },
        new Blob(),
      ),
    ).rejects.toThrow('denied')
  })

  it('uses a docx name without retaining the source extension', () => {
    expect(docxName('report.txt')).toBe('report.docx')
    expect(docxName('')).toBe('Untitled.docx')
  })
})
