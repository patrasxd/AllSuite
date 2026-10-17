import { describe, expect, it } from 'vitest'
import { Editor } from '@tiptap/core'
import { editorExtensions } from '../editor/extensions'
import {
  SYSTEM_FONT_STACK,
  documentFontFamilies,
  fontPickerValue,
  renderFontFamily,
  substituteFontFamily,
} from './fonts'

describe('document font mapping', () => {
  it.each([
    ['Calibri', 'Carlito'],
    ['Cambria', 'Caladea'],
    ['Arial', 'Arimo'],
    ['Times New Roman', 'Tinos'],
    ['Courier New', 'Cousine'],
  ])('maps %s to its metric-compatible local family', (original, substitute) => {
    expect(substituteFontFamily(original)).toBe(substitute)
    expect(renderFontFamily(original)).toContain(`"${substitute}"`)
    expect(fontPickerValue(original)).toBe(substitute)
  })

  it('keeps original font names in the document model while collecting local assets', () => {
    const document = {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            { type: 'text', text: 'A', marks: [{ type: 'textStyle', attrs: { fontFamily: 'Calibri' } }] },
            { type: 'text', text: 'B', marks: [{ type: 'textStyle', attrs: { fontFamily: 'Times New Roman' } }] },
          ],
        },
      ],
    }

    expect(documentFontFamilies(document)).toEqual(['Carlito', 'Tinos'])
    expect(document.content[0].content[0].marks[0].attrs.fontFamily).toBe('Calibri')
  })

  it('falls back safely for unknown and empty families', () => {
    expect(renderFontFamily('Unknown Font')).toBe(`"Unknown Font", ${SYSTEM_FONT_STACK}`)
    expect(renderFontFamily('"; color:red')).toBe('"colorred", system-ui, sans-serif')
    expect(fontPickerValue('Unknown Font')).toBe(SYSTEM_FONT_STACK)
  })

  it('renders a local substitute without replacing the original model value', () => {
    const editor = new Editor({
      content: '<p>Text</p>',
      extensions: editorExtensions({ requestPlainPaste: () => undefined, requestLink: () => undefined }),
    })
    editor.commands.selectAll()
    editor.commands.setFontFamily('Calibri')

    expect(editor.getJSON().content?.[0].content?.[0].marks?.[0].attrs?.fontFamily).toBe('Calibri')
    expect(editor.getHTML()).toContain('font-family: &quot;Carlito&quot;, sans-serif')
    editor.destroy()
  })
})
