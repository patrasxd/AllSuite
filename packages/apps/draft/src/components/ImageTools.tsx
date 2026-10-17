import { useEffect, useRef, useState } from 'react'
import { Button, CheckIcon, Dialog, Input, PhotoIcon, SettingsGroup, Text, UploadIcon } from '@all/ui'
import { DraftIcon } from './DraftIcons'
import { imageLabels } from './image-labels'
import { useEditorState } from '@tiptap/react'
import type { Editor } from '@tiptap/core'
import { NodeSelection } from '@tiptap/pm/state'
import { updateImageAttributes } from '../editor/image-node'
import { IMAGE_ACCEPT, type ImageOptions, type ImageAttributes } from '../engine/images'
import type { Locale } from '../types'

export { imageLabels } from './image-labels'

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
    <Dialog
      open={open}
      onClose={onClose}
      title={t.insert}
      maxWidth="sm"
      className="draft-image-modal"
      footer={
        <Button
          icon={<PhotoIcon />}
          disabled={!files.length || busy}
          onClick={() => {
            void onInsert(files, alt).then(onClose)
          }}
        >
          {busy ? t.processing : t.insert}
        </Button>
      }
    >
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
    <Dialog
      open={editAlt && Boolean(selected)}
      onClose={() => onEditAlt(false)}
      title={t.alt}
      maxWidth="sm"
      className="draft-image-modal"
      footer={
        <Button
          icon={<CheckIcon />}
          onClick={() => {
            if (selected) update({ alt })
            onEditAlt(false)
          }}
        >
          {t.apply}
        </Button>
      }
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
      </div>
    </Dialog>
  )
}
