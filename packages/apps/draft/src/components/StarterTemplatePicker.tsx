import { Button, Dialog } from '@all/ui'
import { useMemo } from 'react'
import type { Locale } from '../types'
import { translations } from '../i18n'
import { getStarterTemplates, type StarterTemplateId } from '../engine/starter-templates'

interface Props {
  open: boolean
  locale: Locale
  onClose: () => void
  onBlank: () => void
  onSelect: (id: StarterTemplateId) => void
}

export function StarterTemplatePicker({ open, locale, onClose, onBlank, onSelect }: Props) {
  const t = translations[locale]
  const templates = useMemo(() => getStarterTemplates(locale), [locale])

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={t.newDocument}
      description={t.newDocumentDescription}
      maxWidth="xl"
      showCloseButton={false}
      className="draft-template-dialog"
      footer={
        <div className="draft-template-dialog__footer">
          <Button variant="secondary" onClick={onClose}>
            {t.cancel}
          </Button>
          <Button variant="outline" onClick={onBlank}>
            {t.blankDocument}
          </Button>
        </div>
      }
    >
      <div className="draft-template-grid" role="group" aria-label={t.starterTemplates}>
        {templates.map((template) => (
          <Button
            key={template.id}
            variant="outline"
            className="draft-template-card"
            onClick={() => onSelect(template.id)}
          >
            <span className={`draft-template-preview draft-template-preview--${template.id}`} aria-hidden="true">
              <span className="draft-template-preview__title" />
              <span className="draft-template-preview__meta" />
              <span className="draft-template-preview__section" />
              <span className="draft-template-preview__line" />
              <span className="draft-template-preview__line draft-template-preview__line--short" />
              <span className="draft-template-preview__section draft-template-preview__section--second" />
              <span className="draft-template-preview__line" />
            </span>
            <span className="draft-template-card__copy">
              <span className="draft-template-card__title">{template.label}</span>
              <span className="draft-template-card__description">{template.description}</span>
            </span>
          </Button>
        ))}
      </div>
    </Dialog>
  )
}
