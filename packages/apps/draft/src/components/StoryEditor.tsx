import { useRef, useState } from 'react'
import { EditorContent, useEditor } from '@tiptap/react'
import { Button, IconButton, Input, Select } from '@all/ui'
import type { DraftNode } from '../engine/document-model'
import type { Locale } from '../types'
import { editorExtensions } from '../editor/extensions'
import { StoryField } from '../editor/story-field'
import { prepareImage } from '../engine/image-processing'
import { IMAGE_ACCEPT } from '../engine/images'
import { DOCUMENT_FONTS, loadDocumentFonts } from '../engine/fonts'
import { RibbonMenuButton } from '../../../../ui/src/RibbonMenuButton'
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
  const [, render] = useState(0)
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
    onTransaction: () => render((n) => n + 1),
    onUpdate: ({ editor: current }) => {
      changed.current(current.getJSON().content as DraftNode[])
      void loadDocumentFonts(current.getJSON() as { type: 'doc'; content: DraftNode[] })
    },
  })
  if (!editor) return null
  const tr = (en: string, pl: string) => (locale === 'pl' ? pl : en)
  const button = (label: string, text: string, action: () => void, active?: boolean) => (
    <Button
      size="sm"
      variant={active ? 'secondary' : 'outline'}
      aria-label={label}
      aria-pressed={active}
      onMouseDown={(e) => e.preventDefault()}
      onClick={action}
    >
      {text}
    </Button>
  )
  const mark = (label: string, icon: React.ReactNode, name: string, action: () => void) => (
    <IconButton
      size="sm"
      icon={icon}
      aria-label={label}
      aria-pressed={editor.isActive(name)}
      variant={editor.isActive(name) ? 'secondary' : 'outline'}
      onMouseDown={(e) => e.preventDefault()}
      onClick={action}
    />
  )
  return (
    <div className="draft-story-editor">
      <div className="draft-rich-toolbar" role="group" aria-label={t.edit}>
        <Select
          aria-label={t.font}
          density="compact"
          value={editor.getAttributes('textStyle').fontFamily || DOCUMENT_FONTS[0].family}
          options={DOCUMENT_FONTS.map((font) => ({ value: font.family, label: font.family }))}
          onChange={(e) => editor.chain().focus().setFontFamily(e.target.value).run()}
        />
        <Input
          aria-label={t.size}
          density="compact"
          type="number"
          min={6}
          max={96}
          value={parseFloat(editor.getAttributes('textStyle').fontSize) || 12}
          onChange={(e) => {
            const n = Number(e.target.value)
            if (n >= 6 && n <= 96)
              editor
                .chain()
                .focus()
                .setFontSize(n + 'pt')
                .run()
          }}
        />
        {mark(t.bold, <b>B</b>, 'bold', () => editor.chain().focus().toggleBold().run())}
        {mark(t.italic, <i>I</i>, 'italic', () => editor.chain().focus().toggleItalic().run())}
        {mark(t.underline, <u>U</u>, 'underline', () => editor.chain().focus().toggleUnderline().run())}
        <RibbonMenuButton variant="outline" label={tr('Alignment', 'Wyrównanie')}>
          {(['left', 'center', 'right'] as const).map((align) => (
            <Button
              key={align}
              size="sm"
              variant={editor.isActive({ textAlign: align }) ? 'secondary' : 'outline'}
              aria-pressed={editor.isActive({ textAlign: align })}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => editor.chain().focus().setTextAlign(align).run()}
            >
              {t[align]}
            </Button>
          ))}
        </RibbonMenuButton>
        <RibbonMenuButton variant="outline" label={tr('More formatting', 'Więcej formatowania')} keepOpen>
          {button(t.strike, t.strike, () => editor.chain().focus().toggleStrike().run(), editor.isActive('strike'))}
          {button(t.sub, t.sub, () => editor.chain().focus().toggleSubscript().run(), editor.isActive('subscript'))}
          {button(t.sup, t.sup, () => editor.chain().focus().toggleSuperscript().run(), editor.isActive('superscript'))}
          {button(
            t.highlight,
            t.highlight,
            () => editor.chain().focus().toggleHighlight().run(),
            editor.isActive('highlight'),
          )}
          <Input
            type="color"
            label={t.color}
            value={editor.getAttributes('textStyle').color || '#202020'}
            onChange={(e) => editor.chain().focus().setColor(e.target.value).run()}
          />
        </RibbonMenuButton>
        <RibbonMenuButton variant="outline" label={tr('Insert', 'Wstaw')}>
          {button(tr('Page / total', 'Strona / liczba stron'), tr('Page / total', 'Strona / liczba stron'), () =>
            editor
              .chain()
              .focus()
              .insertContent([
                { type: 'storyField', attrs: { field: 'PAGE' } },
                { type: 'text', text: ' / ' },
                { type: 'storyField', attrs: { field: 'NUMPAGES' } },
              ])
              .run(),
          )}
          {(['PAGE', 'NUMPAGES', 'TITLE'] as const).map((field, i) => (
            <Button
              key={field}
              size="sm"
              variant="outline"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => editor.chain().focus().insertContent({ type: 'storyField', attrs: { field } }).run()}
            >
              {[t.page, t.total, t.title][i]}
            </Button>
          ))}
          {button(t.date, t.date, () =>
            editor
              .chain()
              .focus()
              .insertContent({ type: 'text', text: new Date().toLocaleDateString(locale === 'pl' ? 'pl-PL' : 'en-GB') })
              .run(),
          )}
          <Button size="sm" variant="outline" onClick={() => input.current?.click()}>
            {t.image}
          </Button>
        </RibbonMenuButton>
        <RibbonMenuButton variant="outline" label={tr('Link', 'Łącze')} keepOpen>
          <Input
            label={tr('Link address', 'Adres łącza')}
            value={link}
            maxLength={2048}
            onChange={(e) => setLink(e.target.value)}
          />
          <Button
            size="sm"
            variant="outline"
            disabled={!!link && !safeLink(link)}
            onMouseDown={(e) => e.preventDefault()}
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
            {tr('Apply link', 'Zastosuj łącze')}
          </Button>
        </RibbonMenuButton>
      </div>
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
      <div data-theme={isEink ? undefined : 'light'}>
        <EditorContent editor={editor} />
      </div>
      {error && <p role="alert">{t.error}</p>}
    </div>
  )
}
