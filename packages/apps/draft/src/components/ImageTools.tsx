import { useEffect, useRef, useState } from 'react'
import {
  Button,
  CheckIcon,
  Dialog,
  Input,
  PhotoIcon,
  Select,
  SettingsGroup,
  Text,
  TrashIcon,
  UploadIcon,
} from '@all/ui'
import { DraftIcon } from './DraftIcons'
import { useEditorState } from '@tiptap/react'
import type { Editor } from '@tiptap/core'
import { NodeSelection } from '@tiptap/pm/state'
import { updateImageAttributes } from '../editor/image-node'
import { IMAGE_ACCEPT, type ImageOptions, type ImageAttributes } from '../engine/images'
import type { Locale } from '../types'

export const imageLabels = {
  en: {
    insert: 'Insert image',
    tools: 'Image tools',
    alt: 'Alt text',
    hint: 'Describe what the image communicates. Leave blank only for decorative images.',
    file: 'Image files',
    choose: 'Choose images',
    noFiles: 'No images selected',
    selectedFiles: 'images selected',
    options: 'Image insertion settings',
    max: 'Maximum image edge (px)',
    original: 'Keep original',
    supported:
      'PNG, JPEG, GIF, WebP or SVG. Larger images are reduced before insertion unless you keep the original. Reduced animations become a still image.',
    alignment: 'Image alignment',
    inline: 'Inline',
    left: 'Left',
    center: 'Centre',
    right: 'Right',
    wrap: 'Text wrapping',
    squareLeft: 'Square left',
    squareRight: 'Square right',
    topBottom: 'Top and bottom',
    apply: 'Apply',
    processing: 'Processing image…',
    error: 'The image could not be inserted. Choose a valid PNG, JPEG, GIF, WebP or SVG up to 50 MB.',
    keyboard:
      'Resize: Alt + arrow keys (Shift for larger steps). Edit alt text: Ctrl/⌘ + Alt + A. Hold Shift while dragging a handle to resize freely.',
    width: 'Image width (px)',
    height: 'Image height (px)',
    remove: 'Remove image',
  },
  pl: {
    insert: 'Wstaw obraz',
    tools: 'Narzędzia obrazu',
    alt: 'Tekst alternatywny',
    hint: 'Opisz, co przekazuje obraz. Pozostaw puste tylko dla obrazów dekoracyjnych.',
    file: 'Pliki obrazów',
    choose: 'Wybierz obrazy',
    noFiles: 'Nie wybrano obrazów',
    selectedFiles: 'wybranych obrazów',
    options: 'Ustawienia wstawiania obrazów',
    max: 'Maksymalny bok obrazu (px)',
    original: 'Zachowaj oryginał',
    supported:
      'PNG, JPEG, GIF, WebP lub SVG. Większe obrazy są zmniejszane, chyba że zachowasz oryginał. Zmniejszona animacja staje się obrazem statycznym.',
    alignment: 'Wyrównanie obrazu',
    inline: 'W tekście',
    left: 'Do lewej',
    center: 'Wyśrodkowane',
    right: 'Do prawej',
    wrap: 'Zawijanie tekstu',
    squareLeft: 'Kwadrat po lewej',
    squareRight: 'Kwadrat po prawej',
    topBottom: 'Góra i dół',
    apply: 'Zastosuj',
    processing: 'Przetwarzanie obrazu…',
    error: 'Nie można wstawić obrazu. Wybierz poprawny plik PNG, JPEG, GIF, WebP lub SVG do 50 MB.',
    keyboard:
      'Rozmiar: Alt + strzałki (Shift zwiększa krok). Tekst alternatywny: Ctrl/⌘ + Alt + A. Przytrzymaj Shift podczas przeciągania uchwytu, aby zmieniać proporcje.',
    width: 'Szerokość obrazu (px)',
    height: 'Wysokość obrazu (px)',
    remove: 'Usuń obraz',
  },
}

export function ImageInsertDialog({
  open,
  onClose,
  locale,
  options,
  onOptions,
  onInsert,
  busy,
}: {
  open: boolean
  onClose: () => void
  locale: Locale
  options: ImageOptions
  onOptions: (options: ImageOptions) => void
  onInsert: (files: File[], alt: string) => Promise<void>
  busy: boolean
}) {
  const t = imageLabels[locale]
  const [files, setFiles] = useState<File[]>([])
  const [alt, setAlt] = useState('')
  const fileInput = useRef<HTMLInputElement>(null)
  useEffect(() => {
    if (!open) {
      setFiles([])
      setAlt('')
    }
  }, [open])
  return (
    <Dialog open={open} onClose={onClose} title={t.insert} maxWidth="sm" className="draft-image-modal">
      <div className="draft-image-dialog">
        <div className="draft-image-file-picker">
          <Text as="span" variant="caption">
            {t.file}
          </Text>
          <Button size="sm" variant="outline" icon={<UploadIcon />} onClick={() => fileInput.current?.click()}>
            {t.choose}
          </Button>
          <Text as="span" variant="caption" role="status">
            {files.length ? (files.length === 1 ? files[0].name : `${files.length} ${t.selectedFiles}`) : t.noFiles}
          </Text>
          <input
            ref={fileInput}
            type="file"
            hidden
            accept={IMAGE_ACCEPT}
            multiple
            aria-label={t.file}
            onChange={(e) => {
              setFiles(Array.from(e.target.files || []))
              e.target.value = ''
            }}
          />
        </div>
        <Input
          label={t.alt}
          aria-label={t.alt}
          value={alt}
          density="compact"
          onChange={(e) => setAlt(e.target.value)}
          helperText={t.hint}
        />
        <SettingsGroup label={t.options}>
          <div className="draft-image-dialog-fields">
            <Input
              type="number"
              label={t.max}
              aria-label={t.max}
              value={options.maxEdge}
              min={64}
              max={16384}
              density="compact"
              onChange={(e) =>
                onOptions({ ...options, maxEdge: Math.max(64, Math.min(16384, Number(e.target.value) || 2560)) })
              }
            />
            <Button
              size="sm"
              icon={<DraftIcon name="original" />}
              variant="outline"
              aria-pressed={options.keepOriginal}
              onClick={() => onOptions({ ...options, keepOriginal: !options.keepOriginal })}
            >
              {t.original}
            </Button>
            <Text variant="caption">{t.supported}</Text>
          </div>
        </SettingsGroup>
        <div className="draft-dialog-actions">
          <Button
            size="sm"
            icon={<PhotoIcon />}
            disabled={!files.length || busy}
            onClick={() => {
              void onInsert(files, alt).then(onClose)
            }}
          >
            {busy ? t.processing : t.insert}
          </Button>
        </div>
      </div>
    </Dialog>
  )
}

export function ImageTools({
  editor,
  locale,
  editAlt,
  onEditAlt,
}: {
  editor: Editor
  locale: Locale
  editAlt: boolean
  onEditAlt: (value: boolean) => void
}) {
  const t = imageLabels[locale]
  const selected = useEditorState({
    editor,
    selector: ({ editor: e }) =>
      e.state.selection instanceof NodeSelection && e.state.selection.node.type.name === 'image'
        ? { pos: e.state.selection.from, ...(e.state.selection.node.attrs as ImageAttributes) }
        : null,
  })
  const [alt, setAlt] = useState('')
  useEffect(() => {
    if (editAlt) setAlt(selected?.alt || '')
    else setAlt('')
  }, [editAlt, selected?.pos, selected?.alt])
  const update = (attrs: Record<string, string | number>) => updateImageAttributes(editor, attrs, selected?.pos)
  return (
    <>
      {selected && (
        <div role="toolbar" aria-label={t.tools} className="draft-image-tools">
          <Button size="sm" variant="outline" icon={<DraftIcon name="alt" />} onClick={() => onEditAlt(true)}>
            {t.alt}
          </Button>
          <Select
            aria-label={t.alignment}
            density="compact"
            value={selected.alignment}
            options={(['inline', 'left', 'center', 'right'] as const).map((value) => ({ value, label: t[value] }))}
            onChange={(e) => update({ alignment: e.target.value })}
          />
          <Select
            aria-label={t.wrap}
            density="compact"
            value={selected.wrap}
            options={[
              { value: 'inline', label: t.inline },
              { value: 'square-left', label: t.squareLeft },
              { value: 'square-right', label: t.squareRight },
              { value: 'top-bottom', label: t.topBottom },
            ]}
            onChange={(e) => update({ wrap: e.target.value })}
          />
          <Input
            type="number"
            aria-label={t.width}
            density="compact"
            min={16}
            max={16384}
            value={selected.width}
            onChange={(e) => {
              const width = Math.max(16, Math.min(16384, Number(e.target.value) || 16))
              update({ width, height: Math.max(16, Math.round((width * selected.height) / selected.width)) })
            }}
          />
          <Input
            type="number"
            aria-label={t.height}
            density="compact"
            min={16}
            max={16384}
            value={selected.height}
            onChange={(e) => {
              const height = Math.max(16, Math.min(16384, Number(e.target.value) || 16))
              update({ height, width: Math.max(16, Math.round((height * selected.width) / selected.height)) })
            }}
          />
          <Button
            size="sm"
            variant="outline"
            icon={<TrashIcon />}
            onClick={() => editor.chain().focus().deleteSelection().run()}
          >
            {t.remove}
          </Button>
        </div>
      )}
      <Dialog
        open={editAlt && Boolean(selected)}
        onClose={() => onEditAlt(false)}
        title={t.alt}
        maxWidth="sm"
        className="draft-image-modal"
      >
        <div className="draft-image-dialog">
          <Input
            label={t.alt}
            aria-label={t.alt}
            value={alt}
            onChange={(e) => setAlt(e.target.value)}
            density="compact"
            helperText={t.hint}
          />
          <Text variant="caption">{t.keyboard}</Text>
          <div className="draft-dialog-actions">
            <Button
              size="sm"
              icon={<CheckIcon />}
              onClick={() => {
                if (selected) update({ alt })
                onEditAlt(false)
              }}
            >
              {t.apply}
            </Button>
          </div>
        </div>
      </Dialog>
    </>
  )
}
