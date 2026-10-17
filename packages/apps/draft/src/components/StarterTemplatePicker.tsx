import { Button, Dialog, PillGroup } from '@all/ui'
import { useMemo, useState } from 'react'
import type { Locale } from '../types'
import { translations } from '../i18n'
import { getStarterTemplates, type StarterTemplateCategory, type StarterTemplateId } from '../engine/starter-templates'
import { StarterTemplatePreview } from './StarterTemplatePreview'

interface Props {
  open: boolean
  locale: Locale
  onClose: () => void
  onBlank: () => void
  onSelect: (id: StarterTemplateId) => void
}

export function StarterTemplatePicker({ open, locale, onClose, onBlank, onSelect }: Props) {
  const t = translations[locale]
  const [category, setCategory] = useState<'all' | StarterTemplateCategory>('all')
  const templates = useMemo(() => getStarterTemplates(locale), [locale])
  const visibleTemplates = useMemo(
    () => templates.filter((template) => category === 'all' || template.category === category),
    [category, templates],
  )
  const categories = [
    { value: 'all' as const, label: t.allTemplates },
    { value: 'cv' as const, label: t.cvTemplates },
    { value: 'work' as const, label: t.workTemplates },
    { value: 'academic' as const, label: t.academicTemplates },
  ]

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={t.newDocument}
      description={t.newDocumentDescription}
      maxWidth="full"
      className="draft-template-dialog"
      footer={
        <Button variant="secondary" onClick={onClose}>
          {t.cancel}
        </Button>
      }
    >
      <div className="draft-template-browser">
        <PillGroup
          label={t.templateCategories}
          options={categories}
          value={category}
          onChange={setCategory}
          size="md"
          className="draft-template-categories"
        />
        <div className="draft-template-grid" role="group" aria-label={t.starterTemplates}>
          {category === 'all' && (
            <Button variant="outline" className="draft-template-card draft-template-card--blank" onClick={onBlank}>
              <span className="draft-template-preview draft-template-preview--blank" aria-hidden="true">
                <span className="draft-template-preview__sheet">
                  <span className="draft-template-blank-mark">+</span>
                </span>
              </span>
              <span className="draft-template-card__copy">
                <span className="draft-template-card__title">{t.blankDocument}</span>
                <span className="draft-template-card__description">{t.blankDocumentDescription}</span>
              </span>
            </Button>
          )}
          {visibleTemplates.map((template) => (
            <Button
              key={template.id}
              variant="outline"
              className="draft-template-card"
              onClick={() => onSelect(template.id)}
            >
              <StarterTemplatePreview template={template} />
              <span className="draft-template-card__copy">
                <span className="draft-template-card__title">{template.label}</span>
                <span className="draft-template-card__description">{template.description}</span>
              </span>
            </Button>
          ))}
        </div>
      </div>
    </Dialog>
  )
}
