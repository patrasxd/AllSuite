import { useState } from 'react'
import { Dialog, Input, Select, SettingsGroup, Toggle, Text } from '@all/ui'
import type { Locale } from '../types'
import type { PageSetup } from '../engine/page-setup'
import { storiesFor, type Stories, type StoryKind, type StoryVariant } from '../engine/stories'
import { StoryEditor, storyLabels } from './StoryEditor'
import { DialogActions, DialogSections } from './DialogSections'

export function HeaderFooterDialog({
  page,
  locale,
  initialTarget = 'header:default',
  isEink,
  styleDefinitions,
  onClose,
  onApply,
}: {
  page: PageSetup
  locale: Locale
  initialTarget?: string
  isEink?: boolean
  styleDefinitions?: string
  onClose: () => void
  onApply: (page: PageSetup) => boolean
}) {
  const tr = (en: string, pl: string) => (locale === 'pl' ? pl : en)
  const t = storyLabels[locale]
  const [tab, setTab] = useState('content')
  const [stories, setStories] = useState(() => structuredClone(storiesFor(page)))
  const [start, setStart] = useState(String(stories.start))
  const [target, setTarget] = useState(initialTarget)
  const [invalid, setInvalid] = useState(false)
  const [kind, variant] = target.split(':') as [StoryKind, StoryVariant]
  const variantLabel = (v: StoryVariant) => t[v === 'default' ? 'default' : v === 'first' ? 'firstPage' : 'evenPages']
  const apply = () => {
    const n = /^\d+$/.test(start.trim()) ? Number(start) : NaN
    if (
      !Number.isInteger(n) ||
      n < 1 ||
      n > 32767 ||
      !onApply({ ...page, stories: { ...stories, start: n }, headerText: '', footerText: '', pageNumbers: false })
    ) {
      setInvalid(true)
      return
    }
    onClose()
  }
  return (
    <Dialog
      open
      onClose={onClose}
      title={tr('Header & footer', 'Nagłówek i stopka')}
      closeLabel={tr('Close dialog', 'Zamknij okno')}
      description={tr(
        'Edit one page variant. Apply updates every matching page.',
        'Edytuj wariant strony. Zastosuj zmienia wszystkie pasujące strony.',
      )}
      maxWidth="xl"
      className="draft-settings-dialog draft-header-footer-dialog"
      footer={<DialogActions locale={locale} onClose={onClose} onApply={apply} />}
    >
      <DialogSections
        locale={locale}
        active={tab}
        onChange={setTab}
        tabs={[
          ['content', tr('Content', 'Treść')],
          ['variants', tr('Page variants', 'Warianty stron')],
          ['numbering', tr('Numbering & title', 'Numeracja i tytuł')],
        ]}
      >
        <div hidden={tab !== 'content'}>
          <Select
            label={tr('Editing', 'Edytujesz')}
            fullWidth
            density="compact"
            value={target}
            options={(['header', 'footer'] as const).flatMap((k) =>
              (['default', 'first', 'even'] as const).map((v) => ({
                value: k + ':' + v,
                label: t[k] + ' · ' + variantLabel(v),
              })),
            )}
            onChange={(e) => setTarget(e.target.value)}
          />
          {((variant === 'first' && !stories.differentFirst) || (variant === 'even' && !stories.differentEven)) && (
            <p className="draft-dialog-muted">
              {tr(
                'This variant is inactive. Enable it in Page variants to show it in the document.',
                'Ten wariant jest nieaktywny. Włącz go w zakładce Warianty stron, aby był widoczny w dokumencie.',
              )}
            </p>
          )}
          <p className="draft-story-caption">
            {t[kind]} · {variantLabel(variant)}{' '}
            <span>
              {tr('Rich text · fields resolve on each page', 'Tekst sformatowany · pola wyliczane na każdej stronie')}
            </span>
          </p>
          <StoryEditor
            key={target}
            content={stories[kind][variant]}
            locale={locale}
            isEink={isEink}
            styleDefinitions={styleDefinitions}
            onChange={(content) => setStories((s) => ({ ...s, [kind]: { ...s[kind], [variant]: content } }))}
          />
        </div>
        {tab === 'variants' && (
          <SettingsGroup label={tr('Page variants', 'Warianty stron')}>
            <div className="draft-dialog-stack">
              <Toggle
                checked={stories.differentFirst}
                onChange={(differentFirst) => setStories((s) => ({ ...s, differentFirst }))}
                label={t.first}
                description={tr(
                  'Use a separate header and footer on physical page 1.',
                  'Osobny nagłówek i stopka na pierwszej stronie fizycznej.',
                )}
              />
              <Toggle
                checked={stories.differentEven}
                onChange={(differentEven) => setStories((s) => ({ ...s, differentEven }))}
                label={t.even}
                description={tr(
                  'Use a separate variant on even physical pages, independent of numbering.',
                  'Osobny wariant na parzystych stronach fizycznych, niezależnie od numeracji.',
                )}
              />
              <p className="draft-dialog-muted">
                {tr(
                  'Inactive content is retained. Choose any variant in Content → Editing.',
                  'Treść nieaktywnych wariantów jest zachowana. Wybierz wariant w Treść → Edytujesz.',
                )}
              </p>
              <p className="draft-dialog-muted">{t.hint}</p>
            </div>
          </SettingsGroup>
        )}
        {tab === 'numbering' && (
          <div className="draft-dialog-stack">
            <SettingsGroup label={tr('Page numbering', 'Numeracja stron')}>
              <div className="draft-dialog-stack">
                <div className="draft-dialog-two">
                  <Select
                    label={t.format}
                    fullWidth
                    density="compact"
                    value={stories.format}
                    options={[
                      { value: 'decimal', label: '1, 2, 3' },
                      { value: 'lowerRoman', label: 'i, ii, iii' },
                      { value: 'upperRoman', label: 'I, II, III' },
                    ]}
                    onChange={(e) => setStories((s) => ({ ...s, format: e.target.value as Stories['format'] }))}
                  />
                  <Input
                    label={t.start}
                    inputMode="numeric"
                    fullWidth
                    density="compact"
                    value={start}
                    error={
                      invalid && (!/^\d+$/.test(start) || Number(start) < 1 || Number(start) > 32767)
                        ? tr('Use 1–32767', 'Podaj 1–32767')
                        : undefined
                    }
                    onChange={(e) => setStart(e.target.value)}
                  />
                </div>
                <p className="draft-dialog-muted">
                  {tr(
                    'Insert Page number and Total pages at the caret in Content.',
                    'Wstaw Numer strony i Liczbę stron przy kursorze w zakładce Treść.',
                  )}
                </p>
              </div>
            </SettingsGroup>
            <SettingsGroup label={tr('Title field', 'Pole tytułu')}>
              <Input
                label={t.title}
                fullWidth
                density="compact"
                maxLength={1000}
                value={stories.title}
                onChange={(e) => setStories((s) => ({ ...s, title: e.target.value }))}
              />
            </SettingsGroup>
          </div>
        )}
      </DialogSections>
      {invalid && (
        <Text role="alert">
          {tr(
            'Check the starting number (1–32767), title and header/footer content.',
            'Sprawdź numer początkowy (1–32767), tytuł i treść nagłówka/stopki.',
          )}
        </Text>
      )}
    </Dialog>
  )
}
