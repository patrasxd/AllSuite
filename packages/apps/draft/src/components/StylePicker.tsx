import { Button, Select } from '@all/ui'
import { RibbonMenuButton } from '../../../../ui/src/RibbonMenuButton'
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

export function StylePicker({
  editor,
  locale,
  gallery = false,
}: {
  editor: Editor
  locale: Locale
  gallery?: boolean
}) {
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
  if (gallery)
    return (
      <div className="draft-style-gallery">
        {['Normal', 'Heading1'].map((id) => (
          <Button
            key={id}
            size="sm"
            variant="outline"
            className={`draft-style-preview draft-style-preview--${id}`}
            aria-pressed={state.id === id}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => applyDocumentStyle(editor, id)}
          >
            <span aria-hidden="true">Aa</span>
            <small>{options.find((option) => option.value === id)?.label}</small>
          </Button>
        ))}
        <RibbonMenuButton
          label={
            !['Normal', 'Heading1'].includes(state.id)
              ? options.find((option) => option.value === state.id)?.label || state.id
              : ''
          }
          optionsLabel={locale === 'pl' ? 'Styl tekstu' : 'Text style'}
          variant="outline"
        >
          {options.map((option) => (
            <Button
              key={option.value}
              size="sm"
              variant="ghost"
              aria-pressed={state.id === option.value}
              onClick={() => applyDocumentStyle(editor, option.value)}
            >
              {option.label}
            </Button>
          ))}
        </RibbonMenuButton>
      </div>
    )
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
