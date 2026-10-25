import { useId, type ReactNode } from 'react'
import { Button, WorkspaceTabs } from '@all/ui'
import type { Locale } from '../types'
import { translations } from '../i18n'

/** Domain dialog composition; AllUI owns tab keyboard handling and controls. */
export function DialogSections({
  tabs,
  active,
  onChange,
  children,
  locale,
}: {
  tabs: [string, string][]
  active: string
  onChange: (id: string) => void
  children: ReactNode
  locale: Locale
}) {
  const id = useId()
  return (
    <>
      <WorkspaceTabs
        label={locale === 'pl' ? 'Sekcje ustawień' : 'Settings sections'}
        items={tabs.map(([key, label]) => ({ id: key, label, tabId: `${id}-${key}`, panelId: `${id}-panel` }))}
        activeId={active}
        onChange={onChange}
      />
      <section id={`${id}-panel`} role="tabpanel" aria-labelledby={`${id}-${active}`} className="draft-dialog-panel">
        {children}
      </section>
    </>
  )
}

export function DialogActions({
  locale,
  onClose,
  onApply,
}: {
  locale: Locale
  onClose: () => void
  onApply: () => void
}) {
  const t = translations[locale]
  return (
    <>
      <Button size="sm" variant="outline" onClick={onClose}>
        {t.cancel}
      </Button>
      <Button size="sm" variant="primary" onClick={onApply}>
        {t.apply}
      </Button>
    </>
  )
}
