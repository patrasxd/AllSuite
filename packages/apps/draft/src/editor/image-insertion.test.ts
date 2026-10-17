import { afterEach, expect, it, vi } from 'vitest'
import { Editor } from '@tiptap/core'
import { editorExtensions } from './extensions'
import { insertImageContent } from './image-insertion'
import { prepareImage } from '../engine/image-processing'
import { bytesToDataURL } from '../engine/images'
import { generatedPNG } from '../../../../../tests/fixtures/png'

vi.mock('../engine/image-processing', () => ({ prepareImage: vi.fn(), prepareImageHTML: vi.fn() }))
const editors: Editor[] = []
afterEach(() => {
  editors.splice(0).forEach((e) => e.destroy())
  vi.clearAllMocks()
})
function setup() {
  const editor = new Editor({
    extensions: editorExtensions({ requestPlainPaste: vi.fn(), requestLink: vi.fn() }),
    content: '<p>AB</p>',
  })
  editors.push(editor)
  editor.commands.setTextSelection(2)
  return editor
}
it('maps an asynchronous image insertion through intervening edits', async () => {
  const editor = setup()
  let resolve!: (value: Awaited<ReturnType<typeof prepareImage>>) => void
  vi.mocked(prepareImage).mockReturnValue(
    new Promise((done) => {
      resolve = done
    }),
  )
  const pending = insertImageContent(
    editor,
    [new Blob()],
    { maxEdge: 2560, keepOriginal: false },
    new AbortController().signal,
  )
  editor.commands.insertContent('typed')
  resolve({
    src: bytesToDataURL(generatedPNG(), 'image/png'),
    width: 80,
    height: 40,
    alt: '',
    alignment: 'inline',
    wrap: 'inline',
  })
  await pending
  expect(editor.getText()).toContain('AtypedB')
  expect(editor.getJSON().content?.[0].content?.map((node) => node.type)).toEqual(['text', 'image', 'text'])
})
it('discards a cancelled insertion rather than writing into a replacement document', async () => {
  const editor = setup()
  const controller = new AbortController()
  const before = editor.getJSON()
  vi.mocked(prepareImage).mockImplementation(async () => {
    controller.abort()
    return { src: '', width: 80, height: 40, alt: '', alignment: 'inline', wrap: 'inline' }
  })
  await insertImageContent(editor, [new Blob()], { maxEdge: 2560, keepOriginal: false }, controller.signal)
  expect(editor.getJSON()).toEqual(before)
})
