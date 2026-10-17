import type { Editor, JSONContent } from '@tiptap/core'
import { NodeSelection, type Transaction } from '@tiptap/pm/state'
import { prepareImage, prepareImageHTML } from '../engine/image-processing'
import type { ImageOptions } from '../engine/images'

export async function insertImageContent(
  editor: Editor,
  source: Blob[] | string,
  options: ImageOptions,
  signal: AbortSignal,
  alt = '',
  position?: number,
) {
  let bookmark = position === undefined ? editor.state.selection.getBookmark() : undefined
  let mappedPosition = position
  const map = ({ transaction }: { transaction: Transaction }) => {
    bookmark = bookmark?.map(transaction.mapping)
    if (mappedPosition !== undefined) mappedPosition = transaction.mapping.map(mappedPosition)
  }
  editor.on('transaction', map)
  try {
    let content: string | JSONContent[]
    if (typeof source === 'string') content = await prepareImageHTML(source, options, signal)
    else {
      content = []
      for (const file of source) content.push({ type: 'image', attrs: await prepareImage(file, options, alt, signal) })
    }
    if (signal.aborted || editor.isDestroyed) return
    const selection = bookmark?.resolve(editor.state.doc)
    const insertionStart = selection?.from ?? mappedPosition
    editor
      .chain()
      .focus()
      .insertContentAt(selection ? { from: selection.from, to: selection.to } : mappedPosition!, content)
      .run()

    if (insertionStart !== undefined) {
      const end = Math.min(editor.state.doc.content.size, Math.max(insertionStart + 1, editor.state.selection.to))
      let imagePosition: number | undefined
      editor.state.doc.nodesBetween(insertionStart, end, (node, position) => {
        if (imagePosition === undefined && node.type.name === 'image') imagePosition = position
      })
      if (imagePosition !== undefined) {
        editor.view.dispatch(editor.state.tr.setSelection(NodeSelection.create(editor.state.doc, imagePosition)))
      }
    }
  } finally {
    editor.off('transaction', map)
  }
}
