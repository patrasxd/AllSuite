import { Select } from '@all/ui'
import { useEditorState } from '@tiptap/react'
import type { Editor } from '@tiptap/core'
import type { Locale } from '../types'
import { defaultStyles } from '../engine/styles'
import { applyDocumentStyle, editorStyles, selectedStyleId } from '../editor/styles'

const names: Record<string, Record<Locale, string>> = {
  Normal: { en: 'Paragraph', pl: 'Akapit' },
  Title: { en: 'Title', pl: 'Tytuł' },
  Subtitle: { en: 'Subtitle', pl: 'Podtytuł' },
  Quote: { en: 'Quote', pl: 'Cytat' },
  Code: { en: 'Code', pl: 'Kod' },
  ListParagraph: { en: 'List paragraph', pl: 'Akapit listy' },
}

export function StylePicker({ editor, locale }: { editor: Editor; locale: Locale }) {
  const state = useEditorState({
    editor,
    selector: ({ editor: current }) => ({
      id: selectedStyleId(current),
      definitions: current.state.doc.attrs.styleDefinitions,
    }),
  })
  const options = defaultStyles.map((style) => ({
    value: style.id,
    label: names[style.id]?.[locale] || `${locale === 'pl' ? 'Nagłówek' : 'Heading'} ${style.heading}`,
  }))
  // Show the current imported style without turning the picker into a style-management UI.
  if (!options.some((option) => option.value === state.id))
    options.push({
      value: state.id,
      label: editorStyles(editor).find((style) => style.id === state.id)?.name || state.id,
    })
  return (
    <Select
      density="compact"
      aria-label={locale === 'pl' ? 'Styl tekstu' : 'Text style'}
      value={state.id}
      options={options}
      onChange={(event) => applyDocumentStyle(editor, event.target.value)}
    />
  )
}
