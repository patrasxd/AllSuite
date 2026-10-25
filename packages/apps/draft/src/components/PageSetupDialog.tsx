import { useState } from 'react'
import { Button, Dialog, Input, Select, SettingsGroup, Text } from '@all/ui'
import type { Locale } from '../types'
import { mmToTwips, twipsToMM, validatePageSetup, PAGE_PRESETS, pagePreset, type PageSetup } from '../engine/page-setup'
import { pageViewLabels } from '../engine/page-view'
import { DialogActions, DialogSections } from './DialogSections'

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
    hint: 'Pages update as you type. Edit rich headers, footers and fields below. Their measured height reserves body space on the sheets. Supported text columns, preview, Print and PDF use the same page layout.',
    columnsHint:
      'This column document contains unsupported body objects. Use one column for measured pages, preview and PDF.',
    pageSetupColumns:
      'Custom column widths, spacing or separators are not supported; the converted copy uses equal-width columns with an 8.47 mm gap.',
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
    hint: 'Strony aktualizują się podczas pisania. Poniżej edytujesz nagłówki, stopki i pola. Ich zmierzona wysokość rezerwuje miejsce na kartkach. Obsługiwane kolumny tekstu, podgląd, druk i PDF używają tego samego układu stron.',
    columnsHint:
      'Ten dokument z kolumnami zawiera nieobsługiwane obiekty treści. Wybierz jedną kolumnę, aby uzyskać podział na strony, podgląd i PDF.',
    pageSetupColumns:
      'Niestandardowe szerokości, odstępy lub separatory kolumn nie są obsługiwane; przekonwertowana kopia ma równe kolumny z odstępem 8,47 mm.',
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
  locale,
  open,
  onClose,
  onApply,
  onEditStories,
}: {
  page: PageSetup
  locale: Locale
  open: boolean
  onClose: () => void
  onApply: (page: PageSetup) => boolean
  onEditStories: () => void
}) {
  const labels = pageLabels[locale],
    view = pageViewLabels[locale]
  const tr = (en: string, pl: string) => (locale === 'pl' ? pl : en)
  const [tab, setTab] = useState('paper')
  const [custom, setCustom] = useState(pagePreset(page) === 'custom')
  const [orientation, setOrientation] = useState(page.orientation)
  const keys = ['width', 'height', 'top', 'right', 'bottom', 'left', 'header', 'footer'] as const
  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(keys.map((key) => [key, String(Math.round(twipsToMM(page[key]) * 100) / 100)])),
  )
  const [invalid, setInvalid] = useState(false)
  const field = (key: (typeof keys)[number]) => (
    <Input
      label={labels[key]}
      density="compact"
      fullWidth
      inputMode="decimal"
      value={values[key]}
      maxLength={12}
      onChange={(event) => setValues((current) => ({ ...current, [key]: event.target.value }))}
    />
  )
  // Preserve exact original twips when a field is untouched (presets include fractional mm).
  const dimension = (key: (typeof keys)[number]) => {
    if (values[key] === String(Math.round(twipsToMM(page[key]) * 100) / 100)) return page[key]
    const text = values[key].trim().replace(',', '.')
    return /^\d+(?:\.\d+)?$/.test(text) ? mmToTwips(Number(text)) : NaN
  }
  const candidate = {
    ...page,
    ...Object.fromEntries(keys.map((key) => [key, dimension(key)])),
    orientation,
  } as PageSetup
  const apply = (edit = false) => {
    candidate.orientation = candidate.width > candidate.height ? 'landscape' : 'portrait'
    const valid = validatePageSetup(candidate)
    if (!valid || !onApply(valid)) {
      setInvalid(true)
      return
    }
    onClose()
    if (edit) onEditStories()
  }
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={labels.title}
      closeLabel={tr('Close dialog', 'Zamknij okno')}
      description={tr(
        'Paper, margins and header/footer positioning. Applies to the document.',
        'Papier, marginesy i położenie nagłówka/stopki. Dotyczy całego dokumentu.',
      )}
      maxWidth="lg"
      className="draft-settings-dialog"
      footer={<DialogActions locale={locale} onClose={onClose} onApply={() => apply()} />}
    >
      <DialogSections
        locale={locale}
        active={tab}
        onChange={setTab}
        tabs={[
          ['paper', tr('Paper', 'Papier')],
          ['margins', tr('Margins', 'Marginesy')],
          ['position', tr('Position', 'Położenie')],
        ]}
      >
        <div className="draft-dialog-page-grid">
          <div className="draft-dialog-stack">
            {tab === 'paper' && (
              <>
                <SettingsGroup label={tr('Paper', 'Papier')}>
                  <div className="draft-dialog-stack">
                    <Select
                      label={tr('Size', 'Rozmiar')}
                      density="compact"
                      fullWidth
                      value={custom ? 'custom' : pagePreset(candidate)}
                      options={[
                        ...Object.keys(PAGE_PRESETS).map((value) => ({
                          value,
                          label: value === 'letter' ? 'Letter' : value === 'legal' ? 'Legal' : value.toUpperCase(),
                        })),
                        { value: 'custom', label: view.custom },
                      ]}
                      onChange={(event) => {
                        const preset = event.target.value as keyof typeof PAGE_PRESETS
                        setCustom(event.target.value === 'custom')
                        if (PAGE_PRESETS[preset]) {
                          const [w, h] = PAGE_PRESETS[preset]
                          setValues((v) => ({
                            ...v,
                            width: String(twipsToMM(orientation === 'landscape' ? h : w)),
                            height: String(twipsToMM(orientation === 'landscape' ? w : h)),
                          }))
                        }
                      }}
                    />
                    <Select
                      label={tr('Orientation', 'Orientacja')}
                      density="compact"
                      fullWidth
                      value={orientation}
                      options={[
                        { value: 'portrait', label: tr('Portrait', 'Pionowa') },
                        { value: 'landscape', label: tr('Landscape', 'Pozioma') },
                      ]}
                      onChange={(event) => {
                        const next = event.target.value as PageSetup['orientation']
                        if (next !== orientation) setValues((v) => ({ ...v, width: v.height, height: v.width }))
                        setOrientation(next)
                      }}
                    />
                  </div>
                </SettingsGroup>
                {custom && (
                  <SettingsGroup label={labels.dimensions}>
                    <div className="draft-dialog-two">
                      {field('width')}
                      {field('height')}
                    </div>
                  </SettingsGroup>
                )}
              </>
            )}
            {tab === 'margins' && (
              <SettingsGroup label={labels.margins}>
                <div className="draft-dialog-stack">
                  <Select
                    label={view.marginPreset}
                    density="compact"
                    fullWidth
                    value={
                      ['20', '12.7', '25.4'].find((value) =>
                        ['top', 'right', 'bottom', 'left'].every(
                          (key) => Math.abs(Number(values[key]) - Number(value)) < 0.02,
                        ),
                      ) || 'custom'
                    }
                    options={[
                      { value: '20', label: view.normal },
                      { value: '12.7', label: view.narrow },
                      { value: '25.4', label: view.wide },
                      { value: 'custom', label: view.custom },
                    ]}
                    onChange={(event) => {
                      const value = event.target.value
                      if (value !== 'custom')
                        setValues((v) => ({
                          ...v,
                          top: value,
                          right: value,
                          bottom: value,
                          left: value,
                          header: String(Math.min(Number(v.header) || 0, Number(value) - 6.35)),
                          footer: String(Math.min(Number(v.footer) || 0, Number(value) - 6.35)),
                        }))
                    }}
                  />
                  <div className="draft-dialog-two">
                    {field('top')}
                    {field('bottom')}
                    {field('left')}
                    {field('right')}
                  </div>
                </div>
              </SettingsGroup>
            )}
            {tab === 'position' && (
              <>
                <SettingsGroup label={tr('Distance from paper edge', 'Odległość od krawędzi papieru')}>
                  <div className="draft-dialog-stack">
                    {field('header')}
                    {field('footer')}
                  </div>
                </SettingsGroup>
                <p className="draft-dialog-muted">
                  {tr(
                    'Measures the header from the top edge and the footer from the bottom edge of the paper. Body margins are set in Margins. Content and page numbers have their own editor.',
                    'Odległość nagłówka od górnej i stopki od dolnej krawędzi papieru. Marginesy treści ustawisz w zakładce Marginesy. Treść i numery stron mają osobny edytor.',
                  )}
                </p>
                <Button size="sm" variant="outline" onClick={() => apply(true)}>
                  {tr('Apply & edit header / footer', 'Zastosuj i edytuj nagłówek / stopkę')}
                </Button>
              </>
            )}
          </div>
          <figure className="draft-paper-diagram">
            <figcaption>{tr('Page proportions · schematic', 'Proporcje strony · schemat')}</figcaption>
            <div style={{ aspectRatio: Number(values.width) / Number(values.height) || 0.707 }}>
              <span
                style={{
                  inset: [values.top, values.right, values.bottom, values.left]
                    .map(
                      (v, i) =>
                        Math.min(
                          45,
                          Math.max(0, (Number(v) / (Number(i % 2 ? values.width : values.height) || 1)) * 100),
                        ) + '%',
                    )
                    .join(' '),
                }}
              >
                <i />
                <i />
                <i />
                <i />
              </span>
            </div>
          </figure>
        </div>
      </DialogSections>
      {invalid && <Text role="alert">{labels.invalid}</Text>}
    </Dialog>
  )
}
