import { useRef, useState } from 'react'
import { EditorContent, useEditor } from '@tiptap/react'
import { Button, Input, Select } from '@all/ui'
import type { DraftNode } from '../engine/document-model'
import type { Locale } from '../types'
import { editorExtensions } from '../editor/extensions'
import { StoryField } from '../editor/story-field'
import { prepareImage } from '../engine/image-processing'
import { IMAGE_ACCEPT } from '../engine/images'
import { DOCUMENT_FONTS, loadDocumentFonts } from '../engine/fonts'
import { safeLink } from '../engine/references'

export const storyLabels = {
  en: {
    edit: 'Edit rich headers and footers',
    first: 'Different first page',
    even: 'Different odd/even pages',
    default: 'Default / odd pages',
    firstPage: 'First page',
    evenPages: 'Even pages',
    header: 'Header',
    footer: 'Footer',
    title: 'Document title',
    start: 'Starting page number',
    format: 'Page number format',
    page: 'Page number',
    total: 'Total pages',
    date: 'Insert date',
    image: 'Insert image',
    font: 'Font',
    size: 'Font size (pt)',
    color: 'Text color',
    bold: 'Bold',
    italic: 'Italic',
    underline: 'Underline',
    strike: 'Strikethrough',
    sub: 'Subscript',
    sup: 'Superscript',
    highlight: 'Highlight',
    left: 'Align left',
    center: 'Align center',
    right: 'Align right',
    error: 'The image could not be inserted.',
    hint: 'Edits apply to every page of the selected kind. Fields resolve on each sheet. The tallest enabled header and footer reserve space on every page. Very tall content is scaled to leave room for the body.',
  },
  pl: {
    edit: 'Edytuj nagłówki i stopki',
    first: 'Inna pierwsza strona',
    even: 'Inne strony parzyste i nieparzyste',
    default: 'Domyślne / nieparzyste',
    firstPage: 'Pierwsza strona',
    evenPages: 'Strony parzyste',
    header: 'Nagłówek',
    footer: 'Stopka',
    title: 'Tytuł dokumentu',
    start: 'Początkowy numer strony',
    format: 'Format numeru strony',
    page: 'Numer strony',
    total: 'Liczba stron',
    date: 'Wstaw datę',
    image: 'Wstaw obraz',
    font: 'Czcionka',
    size: 'Rozmiar czcionki (pkt)',
    color: 'Kolor tekstu',
    bold: 'Pogrubienie',
    italic: 'Kursywa',
    underline: 'Podkreślenie',
    strike: 'Przekreślenie',
    sub: 'Indeks dolny',
    sup: 'Indeks górny',
    highlight: 'Wyróżnienie',
    left: 'Do lewej',
    center: 'Wyśrodkuj',
    right: 'Do prawej',
    error: 'Nie udało się wstawić obrazu.',
    hint: 'Zmiany dotyczą wszystkich stron wybranego rodzaju. Pola są wyliczane na każdej kartce. Najwyższy aktywny nagłówek i stopka rezerwują miejsce na każdej stronie. Bardzo wysoka treść jest skalowana, aby zostawić miejsce na tekst.',
  },
} as const

export function StoryEditor({
  content,
  styleDefinitions,
  onChange,
  locale,
  isEink = false,
}: {
  content: DraftNode[]
  styleDefinitions?: string
  onChange: (content: DraftNode[]) => void
  locale: Locale
  isEink?: boolean
}) {
  const t = storyLabels[locale],
    input = useRef<HTMLInputElement>(null)
  const [error, setError] = useState(false)
  const [link, setLink] = useState('')
  const changed = useRef(onChange)
  changed.current = onChange
  const editor = useEditor({
    extensions: [
      ...editorExtensions({ requestPlainPaste: () => {}, requestLink: () => {} })
        .filter((extension) =>
          [
            'starterKit',
            'draftImage',
            'image',
            'textStyle',
            'color',
            'fontFamily',
            'fontSize',
            'highlight',
            'subscript',
            'superscript',
            'textAlign',
            'paragraphLayout',
            'documentStyles',
            'characterStyle',
            'link',
          ].includes(extension.name),
        )
        .map((extension) =>
          extension.name === 'starterKit'
            ? extension.configure({
                heading: false,
                blockquote: false,
                bulletList: false,
                orderedList: false,
                listItem: false,
                listKeymap: false,
                horizontalRule: false,
              })
            : extension,
        ),
      StoryField,
    ],
    content: { type: 'doc', attrs: { styleDefinitions }, content },
    editorProps: {
      attributes: { 'aria-label': t.edit, class: 'draft-story-input', spellcheck: 'true' },
      handlePaste: (_view, event) => {
        // Header/footer paste is text-only: no remote resources or unsupported block nodes.
        const text = event.clipboardData?.getData('text/plain')
        if (text === undefined) return true
        event.preventDefault()
        editor?.commands.insertContent(
          text
            .split(/\r?\n/)
            .flatMap((line, i) => [
              ...(i ? [{ type: 'hardBreak' }] : []),
              ...(line ? [{ type: 'text', text: line }] : []),
            ]),
        )
        return true
      },
      handleDrop: () => true,
    },
    onUpdate: ({ editor: current }) => {
      changed.current(current.getJSON().content as DraftNode[])
      void loadDocumentFonts(current.getJSON() as { type: 'doc'; content: DraftNode[] })
    },
  })
  if (!editor) return null
  const button = (label: string, text: string, action: () => void) => (
    <Button
      size="sm"
      variant="secondary"
      aria-label={label}
      onMouseDown={(event) => event.preventDefault()}
      onClick={action}
    >
      {text}
    </Button>
  )
  return (
    <div className="draft-story-editor">
      <div className="draft-story-tools">
        <Input
          aria-label={locale === 'pl' ? 'Adres łącza' : 'Link address'}
          value={link}
          maxLength={2048}
          onChange={(event) => setLink(event.target.value)}
        />
        <Button
          size="sm"
          variant="secondary"
          disabled={!!link && !safeLink(link)}
          onMouseDown={(event) => event.preventDefault()}
          onClick={() =>
            link
              ? editor
                  .chain()
                  .focus()
                  .setLink({ href: safeLink(link)! })
                  .run()
              : editor.chain().focus().unsetLink().run()
          }
        >
          {locale === 'pl' ? 'Zastosuj łącze' : 'Apply link'}
        </Button>
      </div>
      <div className="draft-story-tools" role="group" aria-label={t.edit}>
        {button(t.bold, 'B', () => editor.chain().focus().toggleBold().run())}
        {button(t.italic, 'I', () => editor.chain().focus().toggleItalic().run())}
        {button(t.underline, 'U', () => editor.chain().focus().toggleUnderline().run())}
        {button(t.strike, 'S', () => editor.chain().focus().toggleStrike().run())}
        {button(t.sub, 'x₂', () => editor.chain().focus().toggleSubscript().run())}
        {button(t.sup, 'x²', () => editor.chain().focus().toggleSuperscript().run())}
        {button(t.highlight, '▧', () => editor.chain().focus().toggleHighlight().run())}
        {(['left', 'center', 'right'] as const).map((align) => (
          <span key={align}>
            {button(t[align], align === 'left' ? '⇤' : align === 'right' ? '⇥' : '↔', () =>
              editor.chain().focus().setTextAlign(align).run(),
            )}
          </span>
        ))}
        <Select
          aria-label={t.font}
          options={DOCUMENT_FONTS.map((font) => ({ value: font.family, label: font.family }))}
          onChange={(event) => editor.chain().focus().setFontFamily(event.target.value).run()}
        />
        <Input
          aria-label={t.size}
          type="number"
          min={6}
          max={96}
          defaultValue="12"
          onChange={(event) => {
            const n = Number(event.target.value)
            if (n >= 6 && n <= 96) editor.chain().focus().setFontSize(`${n}pt`).run()
          }}
        />
        <Input
          aria-label={t.color}
          type="color"
          defaultValue="#202020"
          onChange={(event) => editor.chain().focus().setColor(event.target.value).run()}
        />
      </div>
      <div className="draft-story-tools">
        {(['PAGE', 'NUMPAGES', 'TITLE'] as const).map((field, i) => (
          <span key={field}>
            {button([t.page, t.total, t.title][i], [t.page, t.total, t.title][i], () =>
              editor.chain().focus().insertContent({ type: 'storyField', attrs: { field } }).run(),
            )}
          </span>
        ))}
        {button(t.date, t.date, () =>
          editor
            .chain()
            .focus()
            .insertContent({ type: 'text', text: new Date().toLocaleDateString(locale === 'pl' ? 'pl-PL' : 'en-GB') })
            .run(),
        )}
        <Button size="sm" variant="secondary" onClick={() => input.current?.click()}>
          {t.image}
        </Button>
        <input
          ref={input}
          type="file"
          hidden
          accept={IMAGE_ACCEPT}
          onChange={async (event) => {
            const file = event.target.files?.[0]
            event.target.value = ''
            if (!file) return
            const target = editor.state.selection.from
            setError(false)
            try {
              const attrs = await prepareImage(file, { maxEdge: 1024, keepOriginal: false }, file.name)
              if (!editor.isDestroyed)
                editor
                  .chain()
                  .focus()
                  .insertContentAt(target, {
                    type: 'image',
                    attrs: {
                      ...attrs,
                      width: Math.min(160, attrs.width),
                      height: attrs.height * Math.min(1, 160 / attrs.width),
                    },
                  })
                  .run()
            } catch {
              setError(true)
            }
          }}
        />
      </div>
      <div data-theme={isEink ? undefined : 'light'}>
        <EditorContent editor={editor} />
      </div>
      {error && <p role="alert">{t.error}</p>}
    </div>
  )
}
