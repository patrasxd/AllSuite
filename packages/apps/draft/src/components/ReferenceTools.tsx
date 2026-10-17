import { useEffect, useRef, useState } from 'react'
import { useEditorState } from '@tiptap/react'
import type { Editor } from '@tiptap/core'
import {
  Button,
  CheckIcon,
  CloseIcon,
  ControlsBar,
  Dialog,
  ExternalLinkIcon,
  Input,
  Select,
  Text,
  TrashIcon,
} from '@all/ui'
import type { Locale } from '../types'
import type { DraftDocument } from '../engine/document-model'
import {
  referenceTargets,
  safeLink,
  captionLabels,
  validCaptionLabel,
  captionSequence,
  nodeText,
} from '../engine/references'
import {
  insertBookmark,
  insertNote,
  insertTOC,
  jumpToTarget,
  updatePagedFields,
  insertCaption,
} from '../editor/references'
import { DraftIcon } from './DraftIcons'

export const referenceLabels = {
  en: {
    link: 'Link',
    edit: 'Edit link',
    remove: 'Remove link',
    open: 'Open link',
    address: 'Address',
    text: 'Link text',
    apply: 'Apply',
    cancel: 'Cancel',
    invalid: 'Use http, https, mailto, tel, or an internal target.',
    references: 'References',
    kind: 'Reference type',
    bookmark: 'Bookmark',
    internal: 'Internal link',
    toc: 'Table of contents',
    footnote: 'Footnote',
    endnote: 'Endnote',
    cross: 'Cross-reference',
    name: 'Bookmark name',
    target: 'Target',
    first: 'First heading level',
    last: 'Last heading level',
    insert: 'Insert',
    update: 'Update table',
    updateRef: 'Update reference',
    tools: 'Reference tools',
    empty: 'No headings or bookmarks yet.',
    invalidBookmark:
      'Use a unique name: start with a letter or underscore, then letters, numbers, underscores or hyphens (up to 40 characters). Select text within one paragraph.',
    notes: 'Notes appear at the end of the document.',
    caption: 'Caption',
    figures: 'List of figures',
    tables: 'List of tables',
    labels: 'Caption labels',
    label: 'Label',
    labelList: 'Labels (comma-separated)',
    captionText: 'Caption text',
    position: 'Caption position',
    above: 'Above',
    below: 'Below',
    format: 'Reference result',
    textResult: 'Full text',
    numberResult: 'Label and number',
    pageResult: 'Page number',
    numberPage: 'Label and number on page',
    onPage: ' on page ',
    updating: 'Updating fields…',
    updateError: 'Fields were not updated. Use one column and retry after editing stops.',
    invalidLabels:
      'Use up to 50 labels: letters, numbers, spaces, underscores or hyphens; start with a letter (64 characters maximum). Labels in use are retained.',
  },
  pl: {
    link: 'Link',
    edit: 'Edytuj link',
    remove: 'Usuń link',
    open: 'Otwórz link',
    address: 'Adres',
    text: 'Tekst linku',
    apply: 'Zastosuj',
    cancel: 'Anuluj',
    invalid: 'Użyj http, https, mailto, tel lub celu wewnętrznego.',
    references: 'Odwołania',
    kind: 'Typ odwołania',
    bookmark: 'Zakładka',
    internal: 'Link wewnętrzny',
    toc: 'Spis treści',
    footnote: 'Przypis dolny',
    endnote: 'Przypis końcowy',
    cross: 'Odsyłacz',
    name: 'Nazwa zakładki',
    target: 'Cel',
    first: 'Pierwszy poziom nagłówków',
    last: 'Ostatni poziom nagłówków',
    insert: 'Wstaw',
    update: 'Aktualizuj spis',
    updateRef: 'Aktualizuj odsyłacz',
    tools: 'Narzędzia odwołań',
    empty: 'Brak nagłówków i zakładek.',
    invalidBookmark:
      'Podaj unikatową nazwę: litera lub podkreślenie na początku, potem litery, cyfry, podkreślenia lub łączniki (do 40 znaków). Zaznacz tekst w jednym akapicie.',
    notes: 'Przypisy są na końcu dokumentu.',
    caption: 'Podpis',
    figures: 'Spis rysunków',
    tables: 'Spis tabel',
    labels: 'Etykiety podpisów',
    label: 'Etykieta',
    labelList: 'Etykiety (oddzielone przecinkami)',
    captionText: 'Tekst podpisu',
    position: 'Położenie podpisu',
    above: 'Nad',
    below: 'Pod',
    format: 'Wynik odsyłacza',
    textResult: 'Pełny tekst',
    numberResult: 'Etykieta i numer',
    pageResult: 'Numer strony',
    numberPage: 'Etykieta i numer ze stroną',
    onPage: ' na stronie ',
    updating: 'Aktualizowanie pól…',
    updateError: 'Nie zaktualizowano pól. Ustaw jedną kolumnę i spróbuj ponownie po zakończeniu edycji.',
    invalidLabels:
      'Podaj do 50 etykiet: litery, cyfry, spacje, podkreślenia lub łączniki; zacznij literą (maks. 64 znaki). Używane etykiety zostaną zachowane.',
  },
}
export function LinkDialog({
  editor,
  locale,
  open,
  onClose,
}: {
  editor: Editor
  locale: Locale
  open: boolean
  onClose: () => void
}) {
  const t = referenceLabels[locale]
  const [href, setHref] = useState('')
  const [text, setText] = useState('')
  const [invalid, setInvalid] = useState(false)
  const addressRef = useRef<HTMLInputElement>(null)
  const returnToEditor = useRef(false)
  useEffect(() => {
    if (!open && returnToEditor.current) {
      returnToEditor.current = false
      editor.view.focus()
    }
  }, [open, editor])
  useEffect(() => {
    if (!open) return
    const frame = requestAnimationFrame(() => addressRef.current?.focus())
    return () => cancelAnimationFrame(frame)
  }, [open])
  useEffect(() => {
    if (open) {
      setHref(editor.getAttributes('link').href || '')
      setText(editor.state.doc.textBetween(editor.state.selection.from, editor.state.selection.to))
      setInvalid(false)
    } else {
      setHref('')
      setText('')
    }
  }, [open, editor])
  const targets = referenceTargets(editor.getJSON() as DraftDocument)
  function apply() {
    const safe = safeLink(href)
    if (!safe) {
      setInvalid(true)
      return
    }
    const attrs = { href: safe, target: safe.startsWith('#') ? null : '_blank', rel: 'noopener noreferrer' }
    const chain = editor.chain().focus().extendMarkRange('link')
    if (editor.state.selection.empty && !editor.isActive('link'))
      chain.insertContent({ type: 'text', text: text || safe, marks: [{ type: 'link', attrs }] })
    else chain.setLink(attrs)
    chain.run()
    returnToEditor.current = true
    onClose()
  }
  return (
    <Dialog open={open} onClose={onClose} title={t.link} className="draft-reference-dialog">
      <div className="draft-reference-fields">
        <Input
          ref={addressRef}
          density="compact"
          label={t.address}
          value={href}
          onChange={(event) => setHref(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') apply()
          }}
        />
        {editor.state.selection.empty && !editor.isActive('link') && (
          <Input density="compact" label={t.text} value={text} onChange={(event) => setText(event.target.value)} />
        )}
        {targets.length > 0 && (
          <Select
            density="compact"
            label={t.target}
            value={href.startsWith('#') ? href.slice(1) : ''}
            options={[
              { value: '', label: '—' },
              ...targets.map((target) => ({ value: target.id, label: target.label })),
            ]}
            onChange={(event) => setHref(`#${event.target.value}`)}
          />
        )}
        {invalid && <Text role="alert">{t.invalid}</Text>}
        <div className="draft-dialog-actions">
          {editor.isActive('link') && (
            <Button
              size="sm"
              variant="outline"
              icon={<TrashIcon />}
              onClick={() => {
                editor.chain().focus().extendMarkRange('link').unsetLink().run()
                returnToEditor.current = true
                onClose()
              }}
            >
              {t.remove}
            </Button>
          )}
          <Button size="sm" variant="outline" icon={<CloseIcon />} onClick={onClose}>
            {t.cancel}
          </Button>
          <Button size="sm" icon={<CheckIcon />} onClick={apply}>
            {t.apply}
          </Button>
        </div>
      </div>
    </Dialog>
  )
}
export function ReferencesDialog({
  editor,
  locale,
  open,
  onClose,
}: {
  editor: Editor
  locale: Locale
  open: boolean
  onClose: () => void
}) {
  const t = referenceLabels[locale]
  const [kind, setKind] = useState('bookmark')
  const [name, setName] = useState('')
  const [target, setTarget] = useState('')
  const [first, setFirst] = useState(1)
  const [last, setLast] = useState(3)
  const [labelList, setLabelList] = useState('')
  const [captionLabel, setCaptionLabel] = useState('Figure')
  const [captionText, setCaptionText] = useState('')
  const [position, setPosition] = useState<'above' | 'below'>('below')
  const [format, setFormat] = useState('text')
  const [updating, setUpdating] = useState(false)
  const [updateError, setUpdateError] = useState(false)
  const [invalid, setInvalid] = useState(false)
  const returnToEditor = useRef(false)
  useEffect(() => {
    if (!open && returnToEditor.current) {
      returnToEditor.current = false
      editor.view.focus()
    }
  }, [open, editor])
  const targets = referenceTargets(editor.getJSON() as DraftDocument)
  useEffect(() => {
    if (open) {
      setInvalid(false)
      setTarget(referenceTargets(editor.getJSON() as DraftDocument)[0]?.id || '')
      const labels = captionLabels(editor.getJSON() as DraftDocument, locale)
      setLabelList(labels.join(', '))
      const paragraph = editor.state.selection.$from.parent
      setCaptionLabel(paragraph.attrs.captionLabel || labels[0] || '')
      const sequence = captionSequence(paragraph.toJSON())
      const rendered = nodeText(paragraph.toJSON())
      const prefix = sequence ? `${sequence.attrs!.label} ${sequence.attrs!.number}` : ''
      const number = sequence ? nodeText(sequence) : ''
      const title =
        prefix && rendered.startsWith(prefix)
          ? rendered.slice(prefix.length)
          : number && rendered.startsWith(number)
            ? rendered.slice(number.length)
            : rendered
      setCaptionText(paragraph.attrs.captionLabel ? title.replace(/^:\s*/, '') : '')
      setPosition(paragraph.attrs.captionPosition === 'above' ? 'above' : 'below')
      setUpdateError(false)
    } else {
      setName('')
      setTarget('')
    }
  }, [open, editor, locale])
  async function insert() {
    if (kind === 'labels') {
      const labels = labelList
        .split(',')
        .map((value) => value.trim())
        .filter(Boolean)
      if (labels.length > 50 || !labels.every(validCaptionLabel)) {
        setInvalid(true)
        return
      }
      editor.view.dispatch(editor.state.tr.setDocAttribute('captionLabels', JSON.stringify([...new Set(labels)])))
    }
    if (kind === 'caption' && !insertCaption(editor, captionLabel, captionText, position)) {
      setInvalid(true)
      return
    }
    if (kind === 'figures' || kind === 'tables') insertTOC(editor, 1, 6, captionLabel)
    if (kind === 'bookmark' && !insertBookmark(editor, name)) {
      setInvalid(true)
      return
    }
    if (kind === 'toc') insertTOC(editor, first, Math.max(first, last))
    if (kind === 'footnote' || kind === 'endnote') insertNote(editor, kind)
    if (kind === 'internal' || kind === 'cross') {
      const found = targets.find((item) => item.id === target)
      if (!found) return
      if (kind === 'cross')
        editor
          .chain()
          .focus()
          .insertContent(
            format === 'numberPage'
              ? [
                  {
                    type: 'crossReference',
                    attrs: { targetId: found.id, format: 'number', label: found.number || found.label },
                  },
                  { type: 'text', text: t.onPage },
                  { type: 'crossReference', attrs: { targetId: found.id, format: 'page', label: '?' } },
                ]
              : {
                  type: 'crossReference',
                  attrs: {
                    targetId: found.id,
                    format,
                    label: format === 'page' ? '?' : format === 'number' ? found.number || found.label : found.label,
                  },
                },
          )
          .run()
      else
        editor
          .chain()
          .focus()
          .insertContent({
            type: 'text',
            text: found.label,
            marks: [{ type: 'link', attrs: { href: `#${found.id}` } }],
          })
          .run()
    }
    if (['toc', 'figures', 'tables'].includes(kind) || (kind === 'cross' && ['page', 'numberPage'].includes(format))) {
      setUpdating(true)
      setUpdateError(false)
      try {
        if (!(await updatePagedFields(editor))) throw new Error('Document changed')
      } catch {
        setUpdateError(true)
        return
      } finally {
        setUpdating(false)
      }
    }
    returnToEditor.current = true
    onClose()
  }
  return (
    <Dialog open={open} onClose={onClose} title={t.references} className="draft-reference-dialog">
      <div className="draft-reference-fields">
        <Select
          density="compact"
          label={t.kind}
          value={kind}
          options={(
            [
              'bookmark',
              'internal',
              'toc',
              'caption',
              'figures',
              'tables',
              'labels',
              'footnote',
              'endnote',
              'cross',
            ] as const
          ).map((key) => ({
            value: key,
            label: t[key],
          }))}
          onChange={(event) => {
            setKind(event.target.value)
            setInvalid(false)
            const labels = captionLabels(editor.getJSON() as DraftDocument, locale)
            if (event.target.value === 'figures') setCaptionLabel(labels[0] || '')
            if (event.target.value === 'tables') setCaptionLabel(labels[1] || labels[0] || '')
          }}
        />
        {kind === 'bookmark' && (
          <Input density="compact" label={t.name} value={name} onChange={(event) => setName(event.target.value)} />
        )}
        {(kind === 'internal' || kind === 'cross') && (
          <>
            {targets.length ? (
              <Select
                density="compact"
                label={t.target}
                value={target}
                options={targets.map((item) => ({
                  value: item.id,
                  label: `${item.kind === 'heading' ? 'H' + item.level : item.kind === 'caption' ? t.caption : item.kind === 'note' ? t[item.noteKind || 'footnote'] : t.bookmark}: ${item.label}`,
                }))}
                onChange={(event) => setTarget(event.target.value)}
              />
            ) : (
              <Text>{t.empty}</Text>
            )}
          </>
        )}
        {kind === 'toc' && (
          <>
            <Select
              density="compact"
              label={t.first}
              value={String(first)}
              options={[1, 2, 3, 4, 5, 6].map((level) => ({ value: String(level), label: `H${level}` }))}
              onChange={(event) => setFirst(Number(event.target.value))}
            />
            <Select
              density="compact"
              label={t.last}
              value={String(Math.max(first, last))}
              options={[1, 2, 3, 4, 5, 6]
                .filter((level) => level >= first)
                .map((level) => ({ value: String(level), label: `H${level}` }))}
              onChange={(event) => setLast(Number(event.target.value))}
            />
          </>
        )}
        {kind === 'cross' && (
          <Select
            density="compact"
            label={t.format}
            value={format}
            options={[
              { value: 'text', label: t.textResult },
              { value: 'number', label: t.numberResult },
              { value: 'page', label: t.pageResult },
              { value: 'numberPage', label: t.numberPage },
            ]}
            onChange={(event) => setFormat(event.target.value)}
          />
        )}
        {['caption', 'figures', 'tables'].includes(kind) && (
          <Select
            label={t.label}
            density="compact"
            value={captionLabel}
            options={captionLabels(editor.getJSON() as DraftDocument, locale).map((label) => ({ value: label, label }))}
            onChange={(event) => setCaptionLabel(event.target.value)}
          />
        )}
        {kind === 'caption' && (
          <>
            <Input
              label={t.captionText}
              value={captionText}
              maxLength={10000}
              onChange={(event) => setCaptionText(event.target.value)}
            />
            <Select
              label={t.position}
              value={position}
              options={[
                { value: 'above', label: t.above },
                { value: 'below', label: t.below },
              ]}
              onChange={(event) => setPosition(event.target.value as 'above' | 'below')}
            />
          </>
        )}
        {kind === 'labels' && (
          <>
            <Input
              label={t.labelList}
              value={labelList}
              maxLength={3250}
              onChange={(event) => setLabelList(event.target.value)}
            />
            <Text variant="caption">{t.invalidLabels}</Text>
          </>
        )}
        {(kind === 'footnote' || kind === 'endnote') && <Text variant="caption">{t.notes}</Text>}
        {invalid && (
          <Text role="alert">{kind === 'labels' || kind === 'caption' ? t.invalidLabels : t.invalidBookmark}</Text>
        )}
        {updateError && <Text role="alert">{t.updateError}</Text>}
        <div className="draft-dialog-actions">
          <Button
            size="sm"
            variant="outline"
            icon={<DraftIcon name="references" />}
            disabled={updating}
            onClick={async () => {
              setUpdating(true)
              setUpdateError(false)
              try {
                if (!(await updatePagedFields(editor))) throw new Error('Document changed')
                returnToEditor.current = true
                onClose()
              } catch {
                setUpdateError(true)
              } finally {
                setUpdating(false)
              }
            }}
          >
            {updating ? t.updating : t.updateRef}
          </Button>
          <Button size="sm" variant="outline" icon={<CloseIcon />} onClick={onClose}>
            {t.cancel}
          </Button>
          <Button
            size="sm"
            icon={<CheckIcon />}
            disabled={
              updating ||
              (['caption', 'figures', 'tables'].includes(kind) && !captionLabel) ||
              ((kind === 'internal' || kind === 'cross') && !target) ||
              ((kind === 'footnote' || kind === 'endnote') && editor.isActive('note'))
            }
            onClick={insert}
          >
            {kind === 'labels' ? t.apply : t.insert}
          </Button>
        </div>
      </div>
    </Dialog>
  )
}
export function ReferenceTools({
  editor,
  locale,
  onEditLink,
}: {
  editor: Editor
  locale: Locale
  onEditLink: () => void
}) {
  const t = referenceLabels[locale]
  const [updating, setUpdating] = useState(false)
  const [error, setError] = useState(false)
  const state = useEditorState({
    editor,
    selector: ({ editor: current }) => ({
      link: current.isActive('link'),
      href: current.getAttributes('link').href as string | undefined,
      toc: current.isActive('tableOfContents'),
      cross: current.isActive('crossReference'),
    }),
  })
  if (!state.link && !state.toc && !state.cross) return null
  const href = safeLink(state.href)
  return (
    <ControlsBar className="draft-toolbar" role="toolbar" aria-label={t.tools}>
      {state.link && (
        <>
          <Button
            size="sm"
            variant="outline"
            icon={<DraftIcon name="link" />}
            onMouseDown={(event) => event.preventDefault()}
            onClick={onEditLink}
          >
            {t.edit}
          </Button>
          <Button
            size="sm"
            variant="outline"
            icon={<TrashIcon />}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => editor.chain().focus().extendMarkRange('link').unsetLink().run()}
          >
            {t.remove}
          </Button>
          {href && (
            <Button
              size="sm"
              variant="outline"
              icon={<ExternalLinkIcon />}
              onClick={() =>
                href.startsWith('#')
                  ? jumpToTarget(editor, href.slice(1))
                  : window.open(href, '_blank', 'noopener,noreferrer')
              }
            >
              {t.open}
            </Button>
          )}
        </>
      )}
      {(state.toc || state.cross) && (
        <Button
          size="sm"
          variant="outline"
          icon={<DraftIcon name="references" />}
          disabled={updating}
          onClick={async () => {
            setUpdating(true)
            setError(false)
            try {
              if (!(await updatePagedFields(editor))) setError(true)
            } catch {
              setError(true)
            } finally {
              setUpdating(false)
            }
          }}
        >
          {updating ? t.updating : state.toc ? t.update : t.updateRef}
        </Button>
      )}
      {error && <Text role="alert">{t.updateError}</Text>}
    </ControlsBar>
  )
}
