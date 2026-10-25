import { useEffect, useState } from 'react'
import { Dialog, Input, Select, SettingsGroup, Text, Toggle } from '@all/ui'
import type { Editor } from '@tiptap/core'
import type { Locale } from '../types'
import { translations } from '../i18n'
import { defaultParagraphAttributes, parseParagraphValue, parseTabStops } from '../engine/paragraph'
import { selectedParagraphAttributes, updateSelectedParagraphs } from '../editor/paragraph-commands'
import { DialogActions, DialogSections } from './DialogSections'
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
  const tr = (en: string, pl: string) => (locale === 'pl' ? pl : en)
  const [tab, setTab] = useState('spacing')
  const [special, setSpecial] = useState('none')
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
    setSpecial(attrs.indentFirstLine ? 'first' : attrs.indentHanging ? 'hanging' : 'none')
    setTab('spacing')
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
      indentFirstLine: special === 'first' ? parseParagraphValue(values.indentFirstLine || '') : 0,
      indentHanging: special === 'hanging' ? parseParagraphValue(values.indentHanging || '') : 0,
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
    <Dialog
      open={open}
      onClose={onClose}
      title={t.paragraphDialog}
      description={t.paragraphDialogDescription}
      closeLabel={tr('Close dialog', 'Zamknij okno')}
      maxWidth="lg"
      className="draft-settings-dialog draft-paragraph-settings-dialog"
      footer={<DialogActions locale={locale} onClose={onClose} onApply={apply} />}
    >
      <DialogSections
        locale={locale}
        active={tab}
        onChange={setTab}
        tabs={[
          ['spacing', tr('Indents & spacing', 'Wcięcia i odstępy')],
          ['flow', tr('Page flow', 'Podział stron')],
          ['tabs', tr('Tab stops', 'Tabulatory')],
        ]}
      >
        <div className="draft-paragraph-dialog">
          {tab === 'spacing' && (
            <div className="draft-dialog-two draft-dialog-top">
              {' '}
              <SettingsGroup label={t.indentationGroup}>
                <div className="draft-dialog-two">
                  {field('indentLeft', t.indentLeft)}
                  {field('indentRight', t.indentRight)}
                  <Select
                    fullWidth
                    density="compact"
                    label={tr('Special', 'Specjalne')}
                    value={special}
                    options={[
                      { value: 'none', label: tr('None', 'Brak') },
                      { value: 'first', label: tr('First line', 'Pierwszy wiersz') },
                      { value: 'hanging', label: tr('Hanging', 'Wysunięcie') },
                    ]}
                    onChange={(e) => setSpecial(e.target.value)}
                  />
                  {special !== 'none' &&
                    field(
                      special === 'first' ? 'indentFirstLine' : 'indentHanging',
                      special === 'first' ? t.indentFirstLine : t.indentHanging,
                    )}
                </div>
              </SettingsGroup>
              <SettingsGroup label={t.spacingGroup}>
                <div className="draft-paragraph-fields draft-dialog-two">
                  {field('spacingBefore', t.spacingBefore)}
                  {field('spacingAfter', t.spacingAfter)}
                  <Select
                    label={t.lineSpacing}
                    density="compact"
                    fullWidth
                    value={lineMode}
                    options={[
                      ...linePresets.map((value) => ({ value: String(value), label: String(value) + ' ×' })),
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
            </div>
          )}
          {tab === 'flow' && (
            <>
              <SettingsGroup label={pageViewLabels[locale].pagination}>
                <div className="draft-dialog-stack">
                  {(['keepNext', 'keepLines', 'widowControl'] as const).map((name, i) => (
                    <Toggle
                      key={name}
                      checked={values[name] === 'true'}
                      onChange={(checked) => set(name, String(checked))}
                      label={pageViewLabels[locale][name]}
                      description={
                        [
                          tr('Keep this paragraph with the next paragraph.', 'Zachowaj akapit razem z następnym.'),
                          tr(
                            'Keep the paragraph on one page when it fits.',
                            'Zachowaj akapit na jednej stronie, jeśli się mieści.',
                          ),
                          tr(
                            'Avoid a single line at the top or bottom of a page.',
                            'Unikaj pojedynczego wiersza na początku lub końcu strony.',
                          ),
                        ][i]
                      }
                    />
                  ))}
                </div>
              </SettingsGroup>
            </>
          )}
          {tab === 'tabs' && (
            <>
              {' '}
              <SettingsGroup>
                <Input
                  label={t.tabStops}
                  helperText={tr(
                    'Separate positions with commas, e.g. 36, 72, 108. Use a dot for decimals.',
                    'Oddziel pozycje przecinkami, np. 36, 72, 108. Ułamki zapisuj z kropką.',
                  )}
                  density="compact"
                  fullWidth
                  value={values.tabStops || ''}
                  placeholder={t.tabStopsHint}
                  onChange={(event) => set('tabStops', event.target.value)}
                />
              </SettingsGroup>
            </>
          )}
          <figure className="draft-paragraph-preview">
            <figcaption>{tr('Spacing preview · schematic', 'Podgląd odstępów · schemat')}</figcaption>
            <div
              style={{
                paddingTop: Math.min(16, Number(values.spacingBefore) || 0),
                paddingBottom: Math.min(16, Number(values.spacingAfter) || 0),
                paddingLeft: Math.min(60, Number(values.indentLeft) || 0),
                paddingRight: Math.min(60, Number(values.indentRight) || 0),
                lineHeight: Math.min(2.5, Number(values.lineSpacing) || 1.15),
                textIndent:
                  special === 'first'
                    ? Math.min(40, Number(values.indentFirstLine) || 0)
                    : special === 'hanging'
                      ? -Math.min(20, Number(values.indentHanging) || 0)
                      : 0,
              }}
            >
              {tr(
                'A clear paragraph gives each idea room to breathe. Consistent spacing helps your reader follow the text.',
                'Czytelny akapit daje myślom przestrzeń. Spójne odstępy pomagają czytelnikowi śledzić tekst.',
              )}
            </div>
          </figure>
          {invalid && (
            <Text role="alert" variant="secondary">
              {t.invalidParagraphValue}
            </Text>
          )}
        </div>
      </DialogSections>
    </Dialog>
  )
}
