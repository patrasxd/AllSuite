import type { Editor } from '@tiptap/core'
import { DOMSerializer } from '@tiptap/pm/model'
import { plainTextParagraphs } from '../engine/formatting'
import { sanitizeClipboardHTML } from './paste'

const SUPPORTED_IMAGE_TYPE = /^image\/(png|jpeg|gif|webp|svg\+xml)$/

export async function copySelection(editor: Editor, cut = false): Promise<void> {
  const { doc, selection } = editor.state
  if (selection.empty) return
  const text = doc.textBetween(selection.from, selection.to, '\n')
  const container = document.createElement('div')
  container.appendChild(DOMSerializer.fromSchema(editor.schema).serializeFragment(selection.content().content))
  if (navigator.clipboard?.write && typeof ClipboardItem !== 'undefined') {
    await navigator.clipboard.write([
      new ClipboardItem({
        'text/plain': new Blob([text], { type: 'text/plain' }),
        'text/html': new Blob([container.innerHTML], { type: 'text/html' }),
      }),
    ])
  } else if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text)
  } else throw new Error('Clipboard API unavailable')
  if (cut) {
    // Never delete a newer edit or a different selection after asynchronous permissions.
    if (editor.isDestroyed || editor.state.doc !== doc || !editor.state.selection.eq(selection)) {
      throw new Error('Selection changed during cut')
    }
    editor.chain().focus().deleteSelection().run()
  }
}

export async function pasteFromClipboard(
  editor: Editor,
  plain: boolean,
  onImages?: (source: Blob[] | string) => Promise<void>,
): Promise<void> {
  const selection = editor.state.selection
  const bookmark = selection.getBookmark()
  const doc = editor.state.doc
  let content: string | ReturnType<typeof plainTextParagraphs>
  if (!plain && navigator.clipboard?.read) {
    const items = await navigator.clipboard.read()
    const imageItem = items.find((item) => item.types.some((type) => SUPPORTED_IMAGE_TYPE.test(type)))
    if (imageItem && onImages) {
      const type = imageItem.types.find((type) => SUPPORTED_IMAGE_TYPE.test(type))!
      const blob = await imageItem.getType(type)
      if (editor.isDestroyed || editor.state.doc !== doc || !editor.state.selection.eq(selection))
        throw new Error('Document changed during paste')
      await onImages([blob])
      return
    }
    const htmlItem = items.find((item) => item.types.includes('text/html'))
    const textItem = items.find((item) => item.types.includes('text/plain'))
    if (htmlItem) content = sanitizeClipboardHTML(await (await htmlItem.getType('text/html')).text())
    else if (textItem) {
      const text = await (await textItem.getType('text/plain')).text()
      if (!text) return
      content = plainTextParagraphs(text)
    } else throw new Error('Clipboard has no text')
  } else if (navigator.clipboard?.readText) {
    const text = await navigator.clipboard.readText()
    if (!text) return
    content = plainTextParagraphs(text)
  } else throw new Error('Clipboard API unavailable')
  if (content === '') return
  if (editor.isDestroyed || editor.state.doc !== doc || !editor.state.selection.eq(selection))
    throw new Error('Document changed during paste')
  if (typeof content === 'string' && content.includes('<img') && onImages) {
    await onImages(content)
    return
  }
  editor.view.dispatch(editor.state.tr.setSelection(bookmark.resolve(doc)))
  editor.chain().focus().insertContent(content).run()
}

export async function pasteImageFromClipboard(
  editor: Editor,
  onImages: (source: Blob[] | string) => Promise<void>,
): Promise<boolean> {
  if (!navigator.clipboard?.read) throw new Error('Clipboard read unavailable')
  const selection = editor.state.selection
  const doc = editor.state.doc
  const items = await navigator.clipboard.read()
  const imageItem = items.find((item) => item.types.some((type) => SUPPORTED_IMAGE_TYPE.test(type)))
  if (!imageItem) return false
  const type = imageItem.types.find((itemType) => SUPPORTED_IMAGE_TYPE.test(itemType))!
  const blob = await imageItem.getType(type)
  if (editor.isDestroyed || editor.state.doc !== doc || !editor.state.selection.eq(selection)) {
    throw new Error('Document changed during image paste')
  }
  await onImages([blob])
  return true
}
