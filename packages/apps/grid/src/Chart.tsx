import { useState } from 'react'
import { Button, Dialog, Input, Select } from '@all/ui'
import { chartData, ChartError, defaultChart, type ChartErrorCode } from './engine/workbook/chart'
import { formatRangeAddress, parseRangeAddress } from './engine/workbook/address'
import type { CellRange, SimpleColumnChart, Worksheet } from './engine/workbook/types'
import type { Locale } from './types'
import './chart.css'

export const CHART_COPY = {
  en: {
    command: 'Chart',
    create: 'Create chart',
    edit: 'Edit chart',
    remove: 'Remove chart',
    select: 'Select chart',
    title: 'Chart title',
    source: 'Source range',
    type: 'Chart type',
    column: 'Column · one series',
    headers: 'First row contains headers',
    cancel: 'Cancel',
    apply: 'Apply changes',
    data: 'Chart data',
    category: 'Category',
    value: 'Value',
    blank: 'Blank',
    help: 'Select two adjacent columns: categories, then numbers. Up to 24 data rows, one chart per sheet. Charts move and resize with worksheet cells. All source rows are included, even hidden rows.',
    errors: {
      range: 'Use two adjacent columns and 1–24 data rows, without merged cells. Categories must be text or numbers.',
      empty: 'The selected range is empty. Select categories and numeric values.',
      numeric:
        'The second column needs at least one number. Use only numbers or empty cells below its optional header.',
      stale: 'A source formula is stale or unsupported. Wait for calculation or choose fresh numeric data.',
      context:
        'Finish cell editing and select one range. A sheet with an existing drawing or pivot cannot receive another chart. Structural edits require removing the chart first.',
      title: 'Enter a chart title of 1–120 characters without control characters.',
    },
  },
  pl: {
    command: 'Wykres',
    create: 'Utwórz wykres',
    edit: 'Edytuj wykres',
    remove: 'Usuń wykres',
    select: 'Zaznacz wykres',
    title: 'Tytuł wykresu',
    source: 'Zakres źródłowy',
    type: 'Typ wykresu',
    column: 'Kolumnowy · jedna seria',
    headers: 'Pierwszy wiersz zawiera nagłówki',
    cancel: 'Anuluj',
    apply: 'Zastosuj zmiany',
    data: 'Dane wykresu',
    category: 'Kategoria',
    value: 'Wartość',
    blank: 'Pusta',
    help: 'Zaznacz dwie sąsiednie kolumny: kategorie, następnie liczby. Do 24 wierszy danych, jeden wykres na arkusz. Wykres ma stały rozmiar. Uwzględniane są także ukryte wiersze.',
    errors: {
      range:
        'Użyj dwóch sąsiednich kolumn i 1–24 wierszy danych, bez scalonych komórek. Kategorie muszą być tekstem lub liczbami.',
      empty: 'Zaznaczony zakres jest pusty. Zaznacz kategorie i wartości liczbowe.',
      numeric:
        'Druga kolumna wymaga co najmniej jednej liczby. Poniżej opcjonalnego nagłówka używaj tylko liczb lub pustych komórek.',
      stale:
        'Formuła źródłowa jest nieaktualna lub nieobsługiwana. Poczekaj na obliczenia lub wybierz aktualne dane liczbowe.',
      context:
        'Zakończ edycję komórki i zaznacz jeden zakres. Arkusz z rysunkiem lub tabelą przestawną nie może otrzymać kolejnego wykresu. Przed zmianą struktury usuń wykres.',
      title: 'Wprowadź tytuł od 1 do 120 znaków bez znaków sterujących.',
    },
  },
}

export function chartErrorMessage(error: unknown, locale: Locale) {
  return CHART_COPY[locale].errors[error instanceof ChartError ? error.code : 'range']
}

export function ColumnChart({ sheet, chart, locale }: { sheet: Worksheet; chart: SimpleColumnChart; locale: Locale }) {
  const copy = CHART_COPY[locale]
  const [dataOpen, setDataOpen] = useState(false)
  try {
    const { categoryTitle, seriesTitle, points } = chartData(sheet, chart)
    // Scale before subtracting to keep even very large finite numbers drawable.
    const magnitude = Math.max(1, ...points.map((point) => Math.abs(point.value ?? 0)))
    const min = Math.min(0, ...points.map((point) => (point.value ?? 0) / magnitude))
    const max = Math.max(0, ...points.map((point) => (point.value ?? 0) / magnitude)) || 1
    const y = (value: number) => 32 + ((max - value) / (max - min)) * 188
    const zero = y(0)
    const step = 440 / points.length
    const number = new Intl.NumberFormat(locale, { maximumSignificantDigits: 4 })
    return (
      <>
        <svg
          className="grid-column-chart"
          viewBox="0 0 540 300"
          role="img"
          aria-label={`${chart.title} · ${seriesTitle || copy.value} · ${points.length} ${copy.category}`}
        >
          <title>{chart.title}</title>
          {[0, 1, 2, 3, 4].map((index) => {
            const value = min + ((max - min) * index) / 4
            return (
              <g key={index}>
                <line className="grid-chart-guide" x1="76" x2="516" y1={y(value)} y2={y(value)} />
                <text x="68" y={y(value) + 4} textAnchor="end">
                  {number.format(value * magnitude)}
                </text>
              </g>
            )
          })}
          <line className="grid-chart-axis" x1="76" x2="516" y1={zero} y2={zero} />
          {points.map((point, index) => {
            const x = 76 + step * (index + 0.5)
            const top = y((point.value ?? 0) / magnitude)
            return (
              <g key={index}>
                {point.value !== null &&
                  (point.value === 0 ? (
                    <line className="grid-chart-zero" x1={x - step * 0.3} x2={x + step * 0.3} y1={zero} y2={zero} />
                  ) : (
                    <rect
                      className="grid-chart-bar"
                      x={x - step * 0.3}
                      y={Math.min(top, zero)}
                      width={step * 0.6}
                      height={Math.abs(top - zero)}
                    >
                      <title>
                        {point.category}: {point.value}
                      </title>
                    </rect>
                  ))}
                {index % Math.ceil(points.length / 6) === 0 && (
                  <text
                    x={x}
                    y="240"
                    textAnchor={points.length > 6 ? 'end' : 'middle'}
                    transform={points.length > 6 ? `rotate(-35 ${x} 240)` : undefined}
                  >
                    {point.category.length > 10 ? `${point.category.slice(0, 9)}…` : point.category}
                  </text>
                )}
              </g>
            )
          })}
          <text x="76" y="18">
            {seriesTitle || copy.value}
          </text>
          <text x="516" y="292" textAnchor="end">
            {categoryTitle || copy.category}
          </text>
        </svg>
        <details
          className="grid-chart-data"
          open={dataOpen}
          onToggle={(event) => setDataOpen(event.currentTarget.open)}
        >
          <summary>{copy.data}</summary>
          <table>
            <caption>{chart.title}</caption>
            <thead>
              <tr>
                <th scope="col">{categoryTitle || copy.category}</th>
                <th scope="col">{seriesTitle || copy.value}</th>
              </tr>
            </thead>
            <tbody>
              {points.map((point, index) => (
                <tr key={index}>
                  <th scope="row">{point.category || copy.blank}</th>
                  <td>
                    {point.value === null
                      ? copy.blank
                      : new Intl.NumberFormat(locale, { maximumSignificantDigits: 15 }).format(point.value)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </details>
      </>
    )
  } catch (error) {
    return <p role="alert">{chartErrorMessage(error, locale)}</p>
  }
}

export function ChartDialog({
  sheet,
  range,
  chart,
  locale,
  onCancel,
  onApply,
}: {
  sheet: Worksheet
  range: CellRange
  chart?: SimpleColumnChart
  locale: Locale
  onCancel: () => void
  onApply: (chart: SimpleColumnChart) => boolean
}) {
  const copy = CHART_COPY[locale]
  const [initial] = useState(() => {
    try {
      return chart ?? defaultChart(sheet, range)
    } catch {
      return { type: 'column' as const, title: sheet.name, headers: false, sourceRange: range }
    }
  })
  const [title, setTitle] = useState(initial.title)
  const [source, setSource] = useState(formatRangeAddress(initial.sourceRange))
  const [headers, setHeaders] = useState(initial.headers)
  const [applyError, setApplyError] = useState(false)
  let preview: SimpleColumnChart | undefined
  let error: ChartErrorCode | undefined
  try {
    preview = { type: 'column', title, headers, sourceRange: parseRangeAddress(source) }
    chartData(sheet, preview)
  } catch (reason) {
    error = reason instanceof ChartError ? reason.code : 'range'
  }
  return (
    <Dialog
      open
      title={chart ? copy.edit : copy.create}
      closeLabel={copy.cancel}
      onClose={onCancel}
      maxWidth="lg"
      className="grid-delimited-dialog grid-chart-dialog"
      description={copy.help}
      footer={
        <>
          <Button variant="outline" onClick={onCancel}>
            {copy.cancel}
          </Button>
          <Button disabled={Boolean(error)} onClick={() => preview && setApplyError(!onApply(preview))}>
            {chart ? copy.apply : copy.create}
          </Button>
        </>
      }
    >
      <div className="grid-dialog-fields">
        <Select
          label={copy.type}
          aria-label={copy.type}
          value="column"
          options={[{ value: 'column', label: copy.column }]}
          onChange={() => {}}
        />
        <Input
          label={copy.title}
          aria-label={copy.title}
          value={title}
          maxLength={120}
          onChange={(event) => {
            setTitle(event.currentTarget.value)
            setApplyError(false)
          }}
        />
        <Input
          label={copy.source}
          aria-label={copy.source}
          value={source}
          onChange={(event) => {
            setSource(event.currentTarget.value)
            setApplyError(false)
          }}
        />
        <label className="grid-chart-header-option">
          <input type="checkbox" checked={headers} onChange={(event) => setHeaders(event.currentTarget.checked)} />
          {copy.headers}
        </label>
      </div>
      {error ? (
        <p role="alert">{copy.errors[error]}</p>
      ) : (
        preview && <ColumnChart sheet={sheet} chart={preview} locale={locale} />
      )}
      {applyError && <p role="alert">{copy.errors.context}</p>}
    </Dialog>
  )
}
