import { useEffect, useState } from 'react'
import { Button, Dialog, Input, Select, SettingsGroup, Text } from '@all/ui'
import type { Locale } from '../types'
import { translations } from '../i18n'
import { mmToTwips, twipsToMM, validatePageSetup, type PageSetup } from '../engine/page-setup'
import { pageViewLabels } from '../engine/page-view'
import { storiesFor, type Stories, type StoryKind, type StoryVariant } from '../engine/stories'
import { StoryEditor, storyLabels } from './StoryEditor'

export const pageLabels = {
  en: {
    title: 'Page setup',
    dimensions: 'Paper dimensions (mm)',
    width: 'Width (mm)',
    height: 'Height (mm)',
    margins: 'Margins (mm)',
    top: 'Top (mm)',
    right: 'Right (mm)',
    bottom: 'Bottom (mm)',
    left: 'Left (mm)',
    bands: 'Header and footer',
    headerText: 'Header text',
    footerText: 'Footer text',
    header: 'Header distance from top (mm)',
    footer: 'Footer distance from bottom (mm)',
    numbers: 'Page numbers',
    none: 'None',
    pageTotal: 'Page / total',
    break: 'Page break',
    hint: 'Pages update as you type. Edit rich headers, footers and fields below. Their measured height reserves body space on the sheets. Single-column preview, Print and PDF use the same page layout.',
    columnsHint:
      'Multiple columns use continuous editing. Switch to one column to see page divisions and a live page count.',
    invalid:
      'Enter valid dimensions and margins with at least 25.4 mm of body space. Leave at least 6.35 mm between a printed header/footer and the body. Text is limited to 200 characters on one line.',
    pageSetupMultipleSections: 'Multiple sections: only the first page setup is retained.',
    pageSetupGutter: 'Binding gutter is not supported.',
    pageSetupMirrored: 'Mirrored margins are not supported.',
    pageSetupSectionBreak: 'Section break type is not supported.',
    pageSetupNumbering: 'This numbering format, chapter prefix or starting value is not supported.',
    pageSetupVariants: 'An unknown header/footer variant was omitted.',
    pageSetupStories: 'A header/footer part or item is missing, external or unsupported; some content was omitted.',
    pageSetupInvalid: 'Invalid page setup: default dimensions and margins were used.',
  },
  pl: {
    title: 'Ustawienia strony',
    dimensions: 'Wymiary papieru (mm)',
    width: 'Szerokość (mm)',
    height: 'Wysokość (mm)',
    margins: 'Marginesy (mm)',
    top: 'Górny (mm)',
    right: 'Prawy (mm)',
    bottom: 'Dolny (mm)',
    left: 'Lewy (mm)',
    bands: 'Nagłówek i stopka',
    headerText: 'Tekst nagłówka',
    footerText: 'Tekst stopki',
    header: 'Odległość nagłówka od góry (mm)',
    footer: 'Odległość stopki od dołu (mm)',
    numbers: 'Numery stron',
    none: 'Brak',
    pageTotal: 'Strona / liczba stron',
    break: 'Podział strony',
    hint: 'Strony aktualizują się podczas pisania. Poniżej edytujesz nagłówki, stopki i pola. Ich zmierzona wysokość rezerwuje miejsce na kartkach. Podgląd, druk i PDF dokumentów jednokolumnowych używają tego samego układu stron.',
    columnsHint:
      'Przy wielu kolumnach edycja jest ciągła. Wybierz jedną kolumnę, aby zobaczyć podział na strony i aktualną liczbę stron.',
    invalid:
      'Podaj poprawne wymiary i marginesy z obszarem treści co najmniej 25,4 mm. Zostaw co najmniej 6,35 mm między drukowanym nagłówkiem/stopką a treścią. Tekst może mieć 200 znaków w jednym wierszu.',
    pageSetupMultipleSections: 'Wiele sekcji: zachowano tylko ustawienia pierwszej sekcji.',
    pageSetupGutter: 'Margines na oprawę nie jest obsługiwany.',
    pageSetupMirrored: 'Marginesy lustrzane nie są obsługiwane.',
    pageSetupSectionBreak: 'Ten rodzaj podziału sekcji nie jest obsługiwany.',
    pageSetupNumbering: 'Ten format numeracji, przedrostek rozdziału lub numer początkowy nie jest obsługiwany.',
    pageSetupVariants: 'Pominięto nieznany wariant nagłówka lub stopki.',
    pageSetupStories:
      'Brakuje części nagłówka/stopki lub zawiera ona zewnętrzną albo nieobsługiwaną treść; pominięto część zawartości.',
    pageSetupInvalid: 'Niepoprawne ustawienia strony: użyto domyślnych wymiarów i marginesów.',
  },
} as const

export function PageSetupDialog({
  page,
  isEink,
  styleDefinitions,
  initialStoryTarget,
  locale,
  open,
  onClose,
  onApply,
}: {
  page: PageSetup
  isEink?: boolean
  styleDefinitions?: string
  initialStoryTarget?: string
  locale: Locale
  open: boolean
  onClose: () => void
  onApply: (page: PageSetup) => boolean
}) {
  const t = translations[locale],
    labels = pageLabels[locale]
  const [values, setValues] = useState<Record<string, string>>({})
  const [numbers, setNumbers] = useState(false)
  const [invalid, setInvalid] = useState(false)
  const [stories, setStories] = useState<Stories | undefined>()
  const [storyTarget, setStoryTarget] = useState('header:default')
  useEffect(() => {
    if (!open) return
    setValues(
      Object.fromEntries(
        Object.entries(page).map(([key, value]) => [
          key,
          typeof value === 'number'
            ? String(
                mmToTwips(Math.round(twipsToMM(value))) === value
                  ? Math.round(twipsToMM(value))
                  : Math.round(twipsToMM(value) * 100) / 100,
              )
            : String(value),
        ]),
      ),
    )
    setNumbers(page.pageNumbers)
    setStories(initialStoryTarget ? storiesFor(page) : page.stories)
    setStoryTarget(initialStoryTarget || 'header:default')
    setInvalid(false)
  }, [open, page, initialStoryTarget])
  const field = (
    key: 'width' | 'height' | 'top' | 'right' | 'bottom' | 'left' | 'header' | 'footer' | 'headerText' | 'footerText',
  ) => (
    <Input
      label={labels[key]}
      density="compact"
      fullWidth
      inputMode={key.endsWith('Text') ? 'text' : 'decimal'}
      value={values[key] || ''}
      maxLength={key.endsWith('Text') ? 200 : 12}
      onChange={(event) => setValues((current) => ({ ...current, [key]: event.target.value }))}
    />
  )
  function apply() {
    const candidate = {
      ...page,
      headerText: values.headerText || '',
      footerText: values.footerText || '',
      pageNumbers: numbers,
      ...(stories ? { stories, headerText: '', footerText: '', pageNumbers: false } : {}),
    }
    for (const key of ['width', 'height', 'top', 'right', 'bottom', 'left', 'header', 'footer'] as const) {
      const value = (values[key] || '').trim().replace(',', '.')
      candidate[key] = /^\d+(?:\.\d+)?$/.test(value) ? mmToTwips(Number(value)) : NaN
    }
    candidate.orientation = candidate.width > candidate.height ? 'landscape' : 'portrait'
    const valid = validatePageSetup(candidate)
    if (!valid || !onApply(valid)) {
      setInvalid(true)
      return
    }
    onClose()
  }
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={labels.title}
      description={labels.hint}
      className="draft-page-setup-modal"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {t.cancel}
          </Button>
          <Button onClick={apply}>{t.apply}</Button>
        </>
      }
    >
      <div className="draft-paragraph-dialog">
        <SettingsGroup label={labels.dimensions}>
          <div className="draft-paragraph-fields draft-paragraph-fields--two">
            {field('width')}
            {field('height')}
          </div>
        </SettingsGroup>
        <SettingsGroup label={labels.margins}>
          <div className="draft-page-setup-margins">
            <Select
              aria-label={pageViewLabels[locale].marginPreset}
              fullWidth
              density="compact"
              value={
                ['20', '12.7', '25.4'].find((value) =>
                  ['top', 'right', 'bottom', 'left'].every((key) => Number(values[key]) === Number(value)),
                ) || 'custom'
              }
              options={[
                { value: '20', label: pageViewLabels[locale].normal },
                { value: '12.7', label: pageViewLabels[locale].narrow },
                { value: '25.4', label: pageViewLabels[locale].wide },
                { value: 'custom', label: pageViewLabels[locale].custom },
              ]}
              onChange={(event) => {
                const value = event.target.value
                if (value !== 'custom')
                  setValues((current) => ({
                    ...current,
                    top: value,
                    right: value,
                    bottom: value,
                    left: value,
                    header: String(Math.min(Number(current.header) || 0, Number(value) - 6.35)),
                    footer: String(Math.min(Number(current.footer) || 0, Number(value) - 6.35)),
                  }))
              }}
            />
            <div className="draft-paragraph-fields draft-paragraph-fields--two">
              {field('top')}
              {field('right')}
              {field('bottom')}
              {field('left')}
            </div>
          </div>
        </SettingsGroup>
        <SettingsGroup label={labels.bands}>
          <div className="draft-page-setup-bands">
            {!stories && (
              <>
                {field('headerText')}
                {field('footerText')}
              </>
            )}
            <div className="draft-paragraph-fields draft-paragraph-fields--two">
              {field('header')}
              {field('footer')}
            </div>
            {!stories && (
              <Select
                label={labels.numbers}
                density="compact"
                fullWidth
                value={numbers ? 'yes' : 'no'}
                options={[
                  { value: 'no', label: labels.none },
                  { value: 'yes', label: labels.pageTotal },
                ]}
                onChange={(event) => setNumbers(event.target.value === 'yes')}
              />
            )}
            {!stories && (
              <Button
                variant="secondary"
                onClick={() =>
                  setStories(
                    storiesFor({
                      ...page,
                      headerText: values.headerText || '',
                      footerText: values.footerText || '',
                      pageNumbers: numbers,
                    }),
                  )
                }
              >
                {storyLabels[locale].edit}
              </Button>
            )}
            {stories && (
              <>
                <p>{storyLabels[locale].hint}</p>
                <Input
                  label={storyLabels[locale].title}
                  value={stories.title}
                  maxLength={1000}
                  onChange={(event) => setStories({ ...stories, title: event.target.value })}
                />
                <div className="draft-paragraph-fields draft-paragraph-fields--two">
                  <label className="draft-story-option">
                    <input
                      type="checkbox"
                      checked={stories.differentFirst}
                      onChange={(event) => setStories({ ...stories, differentFirst: event.target.checked })}
                    />
                    {storyLabels[locale].first}
                  </label>
                  <label className="draft-story-option">
                    <input
                      type="checkbox"
                      checked={stories.differentEven}
                      onChange={(event) => setStories({ ...stories, differentEven: event.target.checked })}
                    />
                    {storyLabels[locale].even}
                  </label>
                  <Input
                    label={storyLabels[locale].start}
                    type="number"
                    min={1}
                    max={32767}
                    value={stories.start}
                    onChange={(event) => setStories({ ...stories, start: Number(event.target.value) })}
                  />
                  <Select
                    label={storyLabels[locale].format}
                    value={stories.format}
                    options={[
                      { value: 'decimal', label: '1, 2, 3' },
                      { value: 'lowerRoman', label: 'i, ii, iii' },
                      { value: 'upperRoman', label: 'I, II, III' },
                    ]}
                    onChange={(event) => setStories({ ...stories, format: event.target.value as Stories['format'] })}
                  />
                </div>
                <Select
                  aria-label={storyLabels[locale].edit}
                  value={storyTarget}
                  options={(['header', 'footer'] as const).flatMap((kind) =>
                    (['default', 'first', 'even'] as const).map((variant) => ({
                      value: `${kind}:${variant}`,
                      label: `${storyLabels[locale][kind]} — ${storyLabels[locale][variant === 'default' ? 'default' : variant === 'first' ? 'firstPage' : 'evenPages']}`,
                    })),
                  )}
                  onChange={(event) => setStoryTarget(event.target.value)}
                />
                <StoryEditor
                  isEink={isEink}
                  styleDefinitions={styleDefinitions}
                  key={`${open}:${storyTarget}`}
                  locale={locale}
                  content={stories[storyTarget.split(':')[0] as StoryKind][storyTarget.split(':')[1] as StoryVariant]}
                  onChange={(content) =>
                    setStories((current) => {
                      if (!current) return current
                      const [kind, variant] = storyTarget.split(':') as [StoryKind, StoryVariant]
                      return { ...current, [kind]: { ...current[kind], [variant]: content } }
                    })
                  }
                />
              </>
            )}
          </div>
        </SettingsGroup>
        {invalid && <Text role="alert">{labels.invalid}</Text>}
      </div>
    </Dialog>
  )
}
