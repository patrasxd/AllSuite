import { afterEach, expect, it, vi } from 'vitest'
import { Editor } from '@tiptap/core'
import { editorExtensions } from './extensions'
import { pasteImageFromClipboard } from './clipboard'

const editors: Editor[] = []
const clipboardDescriptor = Object.getOwnPropertyDescriptor(navigator, 'clipboard')

afterEach(() => {
  editors.splice(0).forEach((editor) => editor.destroy())
  if (clipboardDescriptor) Object.defineProperty(navigator, 'clipboard', clipboardDescriptor)
  else Reflect.deleteProperty(navigator, 'clipboard')
  vi.restoreAllMocks()
})

function createEditor() {
  const editor = new Editor({
    extensions: editorExtensions({ requestPlainPaste: vi.fn(), requestLink: vi.fn() }),
    content: '<p>Text</p>',
  })
  editors.push(editor)
  return editor
}

it('pastes a supported clipboard image through the editor image insertion handler', async () => {
  const editor = createEditor()
  const image = new Blob(['image bytes'], { type: 'image/png' })
  const item = { types: ['image/png'], getType: vi.fn().mockResolvedValue(image) } as unknown as ClipboardItem
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: { read: vi.fn().mockResolvedValue([item]) },
  })
  const insert = vi.fn().mockResolvedValue(undefined)

  await expect(pasteImageFromClipboard(editor, insert)).resolves.toBe(true)
  expect(insert).toHaveBeenCalledWith([image])
})

it('reports when the clipboard contains no supported image', async () => {
  const editor = createEditor()
  const item = { types: ['text/plain'], getType: vi.fn() } as unknown as ClipboardItem
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: { read: vi.fn().mockResolvedValue([item]) },
  })
  const insert = vi.fn()

  await expect(pasteImageFromClipboard(editor, insert)).resolves.toBe(false)
  expect(insert).not.toHaveBeenCalled()
})
