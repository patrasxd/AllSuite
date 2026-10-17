import type { DraftDocument, ImportResult } from '../document-model'
import { textDocument } from '../document-model'
import { importDocxInWorker } from '../docx/import/worker-client'
import { prepareImportedImages } from '../image-processing'

export type FileHandle = {
  kind: 'file'
  name: string
  getFile: () => Promise<File>
  createWritable: () => Promise<{ write: (data: Blob) => Promise<void>; close: () => Promise<void> }>
}

export type OpenedDocument = {
  document: DraftDocument
  language?: string
  unsupported: ImportResult['unsupported']
  name: string
  handle?: FileHandle
}

type PickerWindow = Window & {
  showOpenFilePicker?: (options: {
    multiple: boolean
    types: Array<{ description: string; accept: Record<string, string[]> }>
  }) => Promise<FileHandle[]>
  showSaveFilePicker?: (options: {
    suggestedName: string
    types: Array<{ description: string; accept: Record<string, string[]> }>
  }) => Promise<FileHandle>
}

const types = [
  {
    description: 'Draft documents',
    accept: {
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document': ['.docx'],
      'text/plain': ['.txt', '.md'],
    },
  },
]

function fallbackInput(): Promise<File | undefined> {
  return new Promise((resolve) => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = '.docx,.txt,.md'
    input.hidden = true
    input.addEventListener(
      'change',
      () => {
        const [file] = Array.from(input.files || [])
        input.remove()
        resolve(file)
      },
      { once: true },
    )
    input.addEventListener(
      'cancel',
      () => {
        input.remove()
        resolve(undefined)
      },
      { once: true },
    )
    document.body.append(input)
    input.click()
  })
}

export async function chooseFile(): Promise<{ file: File; handle?: FileHandle } | undefined> {
  const picker = window as PickerWindow
  try {
    if (picker.showOpenFilePicker) {
      const [handle] = await picker.showOpenFilePicker({ multiple: false, types })
      return handle ? { file: await handle.getFile(), handle } : undefined
    }
  } catch (error) {
    if ((error as DOMException).name === 'AbortError') return undefined
    throw error
  }
  const file = await fallbackInput()
  return file ? { file } : undefined
}

export async function readDocument(
  file: File,
  handle?: FileHandle,
  onProgress?: (value: number) => void,
): Promise<OpenedDocument> {
  const extension = file.name.split('.').pop()?.toLowerCase()
  if (extension === 'docx') {
    const result = await importDocxInWorker(await file.arrayBuffer(), onProgress)
    await prepareImportedImages(result.document, result.unsupported)
    return { ...result, name: file.name, handle }
  }
  if (extension === 'txt' || extension === 'md')
    return { document: textDocument(await file.text()), name: file.name, handle, unsupported: [] }
  throw new Error('Choose a .docx, .txt or .md file.')
}

export async function chooseSaveHandle(suggestedName: string): Promise<FileHandle | undefined> {
  const picker = window as PickerWindow
  if (!picker.showSaveFilePicker) return undefined
  try {
    return await picker.showSaveFilePicker({ suggestedName, types: [types[0]] })
  } catch (error) {
    if ((error as DOMException).name === 'AbortError') return undefined
    throw error
  }
}

export async function writeToHandle(handle: FileHandle, blob: Blob) {
  const writable = await handle.createWritable()
  await writable.write(blob)
  await writable.close()
}

export function download(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = name
  anchor.hidden = true
  document.body.append(anchor)
  anchor.click()
  anchor.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 0)
}

export function docxName(name?: string) {
  const base = (name || 'Untitled').replace(/\.(docx|txt|md)$/i, '') || 'Untitled'
  return `${base}.docx`
}
