import { useMemo, useState } from 'react'
import { Button, Dialog, Select, Text } from '@all/ui'
import { renderLatex, sanitizeLatexInput } from '../engine/math-render'
import type { Locale } from '../types'
import { translations } from '../i18n'

interface Props {
  open: boolean
  locale: Locale
  onClose: () => void
  onInsert: (latex: string, displayMode: boolean) => void
}

export function EquationDialog({ open, locale, onClose, onInsert }: Props) {
  const t = translations[locale]
  const [latex, setLatex] = useState('\\frac{a}{b}')
  const [layout, setLayout] = useState<'inline' | 'block'>('inline')
  const safeLatex = sanitizeLatexInput(latex)
  const preview = useMemo(
    () => (safeLatex === null ? null : renderLatex(safeLatex, layout === 'block')),
    [safeLatex, layout],
  )
  const canInsert = Boolean(safeLatex?.trim()) && preview !== null

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={t.equation}
      className="draft-equation-dialog"
      footer={
        <div className="draft-dialog-actions">
          <Button variant="secondary" onClick={onClose}>
            {t.cancel}
          </Button>
          <Button
            variant="primary"
            disabled={!canInsert}
            onClick={() => {
              if (safeLatex !== null && canInsert) {
                onInsert(safeLatex, layout === 'block')
                onClose()
              }
            }}
          >
            {t.insert}
          </Button>
        </div>
      }
    >
      <div className="draft-equation-fields">
        <Select
          label={t.equationMode}
          value={layout}
          options={[
            { value: 'inline', label: t.inlineMath },
            { value: 'block', label: t.blockMath },
          ]}
          onChange={(event) => setLayout(event.target.value as 'inline' | 'block')}
        />
        <label className="draft-equation-source-label" htmlFor="draft-latex-source">
          {t.latexSource}
        </label>
        <textarea
          id="draft-latex-source"
          className="draft-equation-source"
          value={latex}
          maxLength={10_000}
          spellCheck={false}
          onChange={(event) => setLatex(event.target.value)}
        />
        <div className="draft-equation-preview" aria-label={t.preview}>
          <Text as="span" variant="caption">
            {t.preview}
          </Text>
          {preview ? (
            <div
              className={
                layout === 'block'
                  ? 'draft-equation-preview__math draft-equation-preview__math--block'
                  : 'draft-equation-preview__math'
              }
              dangerouslySetInnerHTML={{ __html: preview }}
            />
          ) : (
            <Text role="alert" variant="caption">
              {t.invalidLatex}
            </Text>
          )}
        </div>
      </div>
    </Dialog>
  )
}
