import { useLayoutEffect, useRef, useState } from 'react'
import { Button, ControlsBar, FullBleedLayout, Select, Text } from '@all/ui'
import type { Locale } from '../types'
import type { PrintLayout } from '../engine/print-layout'
import type { ExportFont } from '../engine/export/model'
import { printLayoutHTML } from '../engine/print-layout'
import { DraftIcon } from './DraftIcons'
import { translations } from '../i18n'

export const printLabels = {
  en: {
    preview: 'Print preview',
    print: 'Print',
    back: 'Back to editor',
    pdf: 'Download PDF',
    zoom: 'Preview zoom',
    fit: 'Fit width',
    columns: 'Print preview requires a single-column document.',
  },
  pl: {
    preview: 'Podgląd wydruku',
    print: 'Drukuj',
    back: 'Wróć do edytora',
    pdf: 'Pobierz PDF',
    zoom: 'Powiększenie podglądu',
    fit: 'Dopasuj szerokość',
    columns: 'Podgląd wydruku wymaga dokumentu z jedną kolumną.',
  },
}
export type PreviewDocument = { layout: PrintLayout; fonts: ExportFont[]; license: string }
export function PrintPreview({
  value,
  locale,
  busy,
  error,
  onClose,
  onPrint,
  onPDF,
  includeCommentsInPDF,
  onToggleCommentsInPDF,
}: {
  value: PreviewDocument
  locale: Locale
  busy: boolean
  error?: string
  onClose: () => void
  onPrint: () => void
  onPDF: () => void
  includeCommentsInPDF: boolean
  onToggleCommentsInPDF: () => void
}) {
  const t = printLabels[locale],
    pane = useRef<HTMLDivElement>(null),
    back = useRef<HTMLButtonElement>(null)
  const [zoom, setZoom] = useState('fit'),
    [available, setAvailable] = useState(800)
  const [canvasColor, setCanvasColor] = useState('#ddd')
  useLayoutEffect(() => {
    back.current?.focus()
    const observer = new ResizeObserver(() => setAvailable(pane.current!.clientWidth))
    setCanvasColor(getComputedStyle(pane.current!).backgroundColor)
    observer.observe(pane.current!)
    return () => observer.disconnect()
  }, [])
  const scale = zoom === 'fit' ? Math.min(1, Math.max(0.1, (available - 32) / value.layout.width)) : Number(zoom) / 100
  const html = printLayoutHTML(value.layout, value.fonts, value.license).replace(
    '</style>',
    `@media screen{body{zoom:${scale};background:${canvasColor}}.print-sheet{outline:1px solid #808080}}</style>`,
  )
  return (
    <FullBleedLayout
      className="draft-workspace draft-print-preview"
      footer={
        <div className="draft-status-bar">
          <Text as="span" variant="caption">
            {locale === 'pl' ? 'Strony' : 'Pages'}: {value.layout.pages.length}
          </Text>
        </div>
      }
    >
      <ControlsBar className="draft-preview-tools" role="toolbar" aria-label={t.preview}>
        <Button ref={back} size="sm" variant="outline" icon={<DraftIcon name="undo" />} onClick={onClose}>
          {t.back}
        </Button>
        <Button size="sm" variant="outline" icon={<DraftIcon name="print" />} onClick={onPrint} disabled={busy}>
          {t.print}
        </Button>
        <Button size="sm" variant="outline" icon={<DraftIcon name="export" />} onClick={onPDF} disabled={busy}>
          {t.pdf}
        </Button>
        <label className="draft-pdf-comments-toggle">
          <input type="checkbox" checked={includeCommentsInPDF} onChange={onToggleCommentsInPDF} />
          {translations[locale].includeCommentsInPDF}
        </label>
        <Select
          density="compact"
          label={t.zoom}
          value={zoom}
          onChange={(event) => setZoom(event.target.value)}
          options={[
            { value: 'fit', label: t.fit },
            ...[50, 75, 100, 125, 150, 200].map((value) => ({ value: String(value), label: `${value}%` })),
          ]}
        />
      </ControlsBar>
      {error && <Text role="alert">{error}</Text>}
      <div ref={pane} className="draft-preview-pages">
        <iframe title={t.preview} srcDoc={html} sandbox="allow-same-origin" />
      </div>
    </FullBleedLayout>
  )
}
