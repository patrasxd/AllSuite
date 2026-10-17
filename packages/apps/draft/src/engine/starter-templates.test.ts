import { Editor } from '@tiptap/core'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { DraftDocument, DraftNode } from './document-model'
import { getStarterTemplates, starterTemplateIds } from './starter-templates'
import { exportDocxArrayBuffer } from './docx/export'
import { importDocx } from './docx/import'
import { editorExtensions } from '../editor/extensions'

const editors: Editor[] = []
afterEach(() => editors.splice(0).forEach((editor) => editor.destroy()))

function textParts(node: DraftNode): string[] {
  if (node.type === 'text') return [node.text || '']
  return (node.content || []).flatMap(textParts)
}

describe.each(['en', 'pl'] as const)('starter templates in %s', (locale) => {
  it('provides all five templates with localized names, content, and named styles', () => {
    const templates = getStarterTemplates(locale)
    expect(templates.map(({ id }) => id)).toEqual(starterTemplateIds)
    for (const template of templates) {
      expect(template.label).toBeTruthy()
      expect(template.description).toBeTruthy()
      expect(template.document.attrs?.styleDefinitions).toContain('Title')
      expect(template.document.content.some((node) => node.attrs?.styleId === 'Title')).toBe(true)
      expect(textParts(template.document).join(' ').trim()).not.toBe('')
    }
    expect(templates.find((template) => template.id === 'cv')?.document.content[0].content?.[0].text).toBe(
      locale === 'en' ? 'Name Surname' : 'Imię i nazwisko',
    )
  })

  it.each(starterTemplateIds)('%s opens in the editor and round-trips through DOCX', async (id) => {
    const template = getStarterTemplates(locale).find((entry) => entry.id === id)!
    const editor = new Editor({
      content: template.document,
      extensions: editorExtensions({ requestPlainPaste: vi.fn(), requestLink: vi.fn(), getLocale: () => locale }),
    })
    editors.push(editor)

    const opened = editor.getJSON() as DraftDocument
    expect(editor.view.dom.textContent).toContain(template.document.content[0].content?.[0].text)
    expect(opened.content.some((node) => node.type === 'heading')).toBe(true)
    expect(opened.attrs?.styleDefinitions).toBeTruthy()

    const bytes = await exportDocxArrayBuffer(opened, locale === 'pl' ? 'pl-PL' : 'en-US')
    const imported = importDocx(bytes)
    expect(imported.unsupported).toEqual([])
    expect(imported.language).toBe(locale === 'pl' ? 'pl-PL' : 'en-US')
    expect(textParts(imported.document).join('')).toBe(textParts(opened).join(''))
    expect(imported.document.content.some((node) => node.type === 'heading')).toBe(true)
    expect(imported.document.content.some((node) => node.type === 'bulletList' || node.type === 'orderedList')).toBe(
      opened.content.some((node) => node.type === 'bulletList' || node.type === 'orderedList'),
    )
    expect(imported.document.attrs?.styleDefinitions).toContain('Title')
  })
})
