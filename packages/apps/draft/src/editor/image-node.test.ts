import { afterEach, expect, it, vi } from 'vitest'
import { Editor } from '@tiptap/core'
import { editorExtensions } from './extensions'
import { resizedImage } from './image-node'
import { bytesToDataURL } from '../engine/images'
import { generatedPNG } from '../../../../../tests/fixtures/png'

const instances: Editor[] = []
afterEach(() => instances.splice(0).forEach((e) => e.destroy()))
it('resizes selected images with modifier keys and opens alt text from the keyboard', () => {
  const onEdit = vi.fn()
  const editor = new Editor({
    extensions: editorExtensions({ requestPlainPaste: vi.fn(), requestLink: vi.fn(), requestImageEdit: onEdit }),
    content: {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            {
              type: 'image',
              attrs: {
                src: bytesToDataURL(generatedPNG(), 'image/png'),
                width: 160,
                height: 80,
                alt: 'Blue rectangle',
              },
            },
          ],
        },
      ],
    },
  })
  instances.push(editor)
  editor.commands.setNodeSelection(1)
  editor.view.dom.dispatchEvent(
    new KeyboardEvent('keydown', { key: 'ArrowRight', altKey: true, shiftKey: true, bubbles: true, cancelable: true }),
  )
  expect(editor.getAttributes('image')).toMatchObject({ width: 170, height: 85 })
  editor.view.dom.dispatchEvent(
    new KeyboardEvent('keydown', { key: 'a', ctrlKey: true, altKey: true, bubbles: true, cancelable: true }),
  )
  expect(onEdit).toHaveBeenCalledTimes(1)
  expect(editor.commands.undo()).toBe(true)
  expect(editor.getAttributes('image')).toMatchObject({ width: 160, height: 80 })
})
it('keeps aspect ratio by default and allows free resizing with Shift', () => {
  expect(resizedImage(160, 80, 240, 200)).toEqual({ width: 240, height: 120 })
  expect(resizedImage(160, 80, 240, 200, true)).toEqual({ width: 240, height: 200 })
})
