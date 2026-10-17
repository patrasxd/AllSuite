import { useState } from 'react'
import { Button, Dialog, Select } from '@all/ui'
import { codeLanguages, type CodeLanguage } from '../editor/code-block'
import type { Locale } from '../types'
import { translations } from '../i18n'

interface Props {
  open: boolean
  locale: Locale
  onClose: () => void
  onInsert: (language: CodeLanguage | null) => void
}

const languageLabels: Record<CodeLanguage, string> = {
  bash: 'Bash',
  css: 'CSS',
  javascript: 'JavaScript',
  json: 'JSON',
  markup: 'HTML / XML',
  python: 'Python',
  sql: 'SQL',
  typescript: 'TypeScript',
  yaml: 'YAML',
}

export function CodeBlockDialog({ open, locale, onClose, onInsert }: Props) {
  const t = translations[locale]
  const [language, setLanguage] = useState('')
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={t.codeBlock}
      className="draft-code-dialog"
      footer={
        <div className="draft-dialog-actions">
          <Button variant="secondary" onClick={onClose}>
            {t.cancel}
          </Button>
          <Button
            variant="primary"
            onClick={() => {
              onInsert((language || null) as CodeLanguage | null)
              onClose()
            }}
          >
            {t.insert}
          </Button>
        </div>
      }
    >
      <Select
        label={t.codeLanguage}
        value={language}
        options={[
          { value: '', label: t.noCodeLanguage },
          ...codeLanguages.map((item) => ({ value: item, label: languageLabels[item] })),
        ]}
        onChange={(event) => setLanguage(event.target.value)}
      />
    </Dialog>
  )
}
