import { useEffect, useState } from 'react'
import { Button, CheckIcon, CloseIcon, Dialog, Input, Select, SettingsGroup, Text } from '@all/ui'
import type { Editor } from '@tiptap/core'
import type { Locale } from '../types'
import { translations } from '../i18n'
import { defaultParagraphAttributes, parseParagraphValue, parseTabStops } from '../engine/paragraph'
import { selectedParagraphAttributes, updateSelectedParagraphs } from '../editor/paragraph-commands'
import { pageViewLabels } from '../engine/page-view'

interface Props {
  editor: Editor
  locale: Locale
  open: boolean
  onClose: () => void
}

const linePresets = [1, 1.15, 1.5, 2]

export function ParagraphDialog({ editor, locale, open, onClose }: Props) {
  const t = translations[locale]
  const [values, setValues] = useState<Record<string, string>>({})
  const [lineMode, setLineMode] = useState('1.15')
  const [invalid, setInvalid] = useState(false)

  useEffect(() => {
    if (!open) return
    const attrs = { ...defaultParagraphAttributes, ...selectedParagraphAttributes(editor) }
    const line = Number(attrs.lineSpacing) || 1.15
    setLineMode(linePresets.includes(line) ? String(line) : 'custom')
    setValues({
      spacingBefore: String(attrs.spacingBefore || 0),
      spacingAfter: String(attrs.spacingAfter || 0),
      lineSpacing: String(line),
      indentLeft: String(attrs.indentLeft || 0),
      indentRight: String(attrs.indentRight || 0),
      indentFirstLine: String(attrs.indentFirstLine || 0),
      indentHanging: String(attrs.indentHanging || 0),
      tabStops: (attrs.tabStops || []).join(', '),
      keepNext: String(attrs.keepNext ?? editor.isActive('heading')),
      keepLines: String(attrs.keepLines ?? false),
      widowControl: String(attrs.widowControl ?? true),
    })
    setInvalid(false)
  }, [editor, open])

  const set = (name: string, value: string) => setValues((current) => ({ ...current, [name]: value }))
  const field = (name: string, label: string) => (
    <Input
      label={label}
      density="compact"
      fullWidth
      inputMode="decimal"
      value={values[name] || ''}
      onChange={(event) => set(name, event.target.value)}
    />
  )

  function apply() {
    const parsed = {
      spacingBefore: parseParagraphValue(values.spacingBefore || ''),
      spacingAfter: parseParagraphValue(values.spacingAfter || ''),
      lineSpacing: parseParagraphValue(values.lineSpacing || '', 0.5),
      indentLeft: parseParagraphValue(values.indentLeft || ''),
      indentRight: parseParagraphValue(values.indentRight || ''),
      indentFirstLine: parseParagraphValue(values.indentFirstLine || ''),
      indentHanging: parseParagraphValue(values.indentHanging || ''),
      tabStops: parseTabStops(values.tabStops || ''),
    }
    if (Object.values(parsed).some((value) => value === null)) {
      setInvalid(true)
      return
    }
    const firstLine = Number(parsed.indentFirstLine) || 0
    const hanging = Number(parsed.indentHanging) || 0
    updateSelectedParagraphs(editor, {
      spacingBefore: Number(parsed.spacingBefore),
      spacingAfter: Number(parsed.spacingAfter),
      lineSpacing: Number(parsed.lineSpacing) || null,
      indentLeft: Number(parsed.indentLeft),
      indentRight: Number(parsed.indentRight),
      indentFirstLine: firstLine,
      indentHanging: firstLine ? 0 : hanging,
      tabStops: parsed.tabStops || [],
      keepNext: values.keepNext === 'true',
      keepLines: values.keepLines === 'true',
      widowControl: values.widowControl === 'true',
    })
    onClose()
  }

  return (
    <Dialog open={open} onClose={onClose} title={t.paragraphDialog} description={t.paragraphDialogDescription}>
      <div className="draft-paragraph-dialog">
        <SettingsGroup label={t.spacingGroup}>
          <div className="draft-paragraph-fields draft-paragraph-fields--three">
            {field('spacingBefore', t.spacingBefore)}
            {field('spacingAfter', t.spacingAfter)}
            <Select
              label={t.lineSpacing}
              density="compact"
              fullWidth
              value={lineMode}
              options={[
                ...linePresets.map((value) => ({ value: String(value), label: String(value) })),
                { value: 'custom', label: t.custom },
              ]}
              onChange={(event) => {
                setLineMode(event.target.value)
                if (event.target.value !== 'custom') set('lineSpacing', event.target.value)
              }}
            />
            {lineMode === 'custom' && field('lineSpacing', t.customLineSpacing)}
          </div>
        </SettingsGroup>
        <SettingsGroup label={t.indentationGroup}>
          <div className="draft-paragraph-fields draft-paragraph-fields--two">
            {field('indentLeft', t.indentLeft)}
            {field('indentRight', t.indentRight)}
            {field('indentFirstLine', t.indentFirstLine)}
            {field('indentHanging', t.indentHanging)}
          </div>
        </SettingsGroup>
        <SettingsGroup label={t.tabStops}>
          <Input
            aria-label={t.tabStops}
            density="compact"
            fullWidth
            value={values.tabStops || ''}
            placeholder={t.tabStopsHint}
            onChange={(event) => set('tabStops', event.target.value)}
          />
        </SettingsGroup>
        <SettingsGroup label={pageViewLabels[locale].pagination} className="draft-paragraph-flow">
          {(['keepNext', 'keepLines', 'widowControl'] as const).map((name) => (
            <label key={name} className="draft-flow-option">
              <input
                type="checkbox"
                checked={values[name] === 'true'}
                onChange={(event) => set(name, String(event.target.checked))}
              />
              {pageViewLabels[locale][name]}
            </label>
          ))}
        </SettingsGroup>
        {invalid && (
          <Text role="alert" variant="secondary">
            {t.invalidParagraphValue}
          </Text>
        )}
        <div className="draft-dialog-actions">
          <Button variant="secondary" size="sm" icon={<CloseIcon />} onClick={onClose}>
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
