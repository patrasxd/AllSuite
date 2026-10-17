import { afterEach, describe, expect, it, vi } from 'vitest'
import { Editor } from '@tiptap/core'
import { editorExtensions } from './extensions'
import { copySelection, pasteFromClipboard } from './clipboard'

const instances: Editor[] = []
const originalClipboard = Object.getOwnPropertyDescriptor(navigator, 'clipboard')
afterEach(() => {
  for (const editor of instances.splice(0)) editor.destroy()
  if (originalClipboard) Object.defineProperty(navigator, 'clipboard', originalClipboard)
  else Reflect.deleteProperty(navigator, 'clipboard')
  vi.restoreAllMocks()
})
function setup() {
  const editor = new Editor({
    content: '<p>Hello</p>',
    extensions: editorExtensions({ requestPlainPaste: vi.fn(), requestLink: vi.fn() }),
  })
  instances.push(editor)
  editor.commands.setTextSelection({ from: 1, to: 6 })
  return editor
}
describe('clipboard adapter', () => {
  it('cuts only after a successful clipboard write', async () => {
    const editor = setup()
    const writeText = vi.fn().mockRejectedValue(new Error('Denied'))
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } })
    await expect(copySelection(editor, true)).rejects.toThrow('Denied')
    expect(editor.getText()).toBe('Hello')
    writeText.mockResolvedValue(undefined)
    await copySelection(editor, true)
    expect(writeText).toHaveBeenCalledWith('Hello')
    expect(editor.getText()).toBe('')
  })
  it('does not cut a selection that changed during clipboard access', async () => {
    const editor = setup()
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {
        writeText: async () => {
          editor.commands.setTextSelection(1)
        },
      },
    })
    await expect(copySelection(editor, true)).rejects.toThrow('Selection changed')
    expect(editor.getText()).toBe('Hello')
  })
  it('pastes clipboard text literally instead of interpreting markup', async () => {
    const editor = setup()
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { readText: async () => '<b>Literal</b>\nNext' },
    })
    await pasteFromClipboard(editor, true)
    expect(editor.getText()).toContain('<b>Literal</b>')
    expect(editor.getHTML()).not.toContain('<strong>')
  })
  it('does not erase selected text when the clipboard is empty', async () => {
    const editor = setup()
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { readText: async () => '' } })
    await pasteFromClipboard(editor, true)
    expect(editor.getText()).toBe('Hello')
  })
  it('routes clipboard image items through the image insertion pipeline', async () => {
    const editor = setup()
    const blob = new Blob(['synthetic'], { type: 'image/png' })
    const onImages = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { read: async () => [{ types: ['image/png'], getType: async () => blob }] },
    })
    await pasteFromClipboard(editor, false, onImages)
    expect(onImages).toHaveBeenCalledWith([blob])
  })
})
