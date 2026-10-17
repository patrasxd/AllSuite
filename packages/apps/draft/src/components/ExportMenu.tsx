import { useEffect, useId, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Button } from '@all/ui'
import type { ExportFormat } from '../engine/export/model'
import type { Locale } from '../types'
import { DraftIcon } from './DraftIcons'
import { translations } from '../i18n'

export const exportLabels = {
  en: {
    title: 'Export',
    markdown: 'Markdown',
    html: 'HTML',
    text: 'Plain text',
    pdf: 'PDF',
    odt: 'OpenDocument text (.odt)',
    preparing: 'Preparing export…',
    error: 'The document could not be exported. Please try again.',
    blocked: 'Allow a print window to open, then choose Print again.',
  },
  pl: {
    title: 'Eksportuj',
    markdown: 'Markdown',
    html: 'HTML',
    text: 'Zwykły tekst',
    pdf: 'PDF',
    odt: 'OpenDocument text (.odt)',
    preparing: 'Przygotowywanie eksportu…',
    error: 'Nie udało się wyeksportować dokumentu. Spróbuj ponownie.',
    blocked: 'Zezwól na otwarcie okna drukowania, a następnie wybierz ponownie Drukuj.',
  },
}
const formats: ExportFormat[] = ['markdown', 'html', 'text', 'odt', 'pdf']
export function ExportMenu({
  locale,
  busy = false,
  onExport,
  includeCommentsInPDF = false,
  onToggleCommentsInPDF,
}: {
  locale: Locale
  busy?: boolean
  onExport: (format: ExportFormat) => void
  includeCommentsInPDF?: boolean
  onToggleCommentsInPDF?: () => void
}) {
  const t = exportLabels[locale]
  const appText = translations[locale]
  const id = useId()
  const trigger = useRef<HTMLButtonElement>(null)
  const menu = useRef<HTMLDivElement>(null)
  const first = useRef(0)
  const [open, setOpen] = useState(false)
  const [position, setPosition] = useState({ left: 0, top: 0 })
  const close = (focus = false) => {
    setOpen(false)
    if (focus) trigger.current?.focus()
  }
  useEffect(() => {
    if (!open) return
    const locate = () => {
      const rect = trigger.current!.getBoundingClientRect()
      const width = menu.current?.offsetWidth || 220
      const height = menu.current?.offsetHeight || 232
      setPosition({
        left: Math.max(8, Math.min(rect.left, window.innerWidth - width - 8)),
        top: Math.max(8, Math.min(rect.bottom + 4, window.innerHeight - height - 8)),
      })
    }
    locate()
    menu.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')[first.current]?.focus()
    const outside = (event: PointerEvent) => {
      if (!menu.current?.contains(event.target as Node) && !trigger.current?.contains(event.target as Node))
        setOpen(false)
    }
    document.addEventListener('pointerdown', outside)
    window.addEventListener('resize', locate)
    window.addEventListener('scroll', locate, true)
    return () => {
      document.removeEventListener('pointerdown', outside)
      window.removeEventListener('resize', locate)
      window.removeEventListener('scroll', locate, true)
    }
  }, [open])
  return (
    <>
      <Button
        ref={trigger}
        id={id}
        size="sm"
        variant="outline"
        icon={<DraftIcon name="export" />}
        disabled={busy}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? `${id}-menu` : undefined}
        onClick={() => {
          first.current = 0
          setOpen(!open)
        }}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault()
            first.current = event.key === 'ArrowUp' ? formats.length - 1 : 0
            setOpen(true)
          }
        }}
      >
        {t.title}
      </Button>
      {open &&
        createPortal(
          <div
            ref={menu}
            id={`${id}-menu`}
            className="draft-export-menu"
            role="menu"
            tabIndex={-1}
            aria-labelledby={id}
            style={position}
            onKeyDown={(event) => {
              const items = Array.from(menu.current!.querySelectorAll<HTMLButtonElement>('button'))
              const index = items.indexOf(document.activeElement as HTMLButtonElement)
              if (event.key === 'Escape') {
                event.preventDefault()
                event.stopPropagation()
                close(true)
              }
              if (event.key === 'Tab') {
                close(true)
                return
              }
              const next =
                event.key === 'ArrowDown'
                  ? (index + 1) % items.length
                  : event.key === 'ArrowUp'
                    ? (index + items.length - 1) % items.length
                    : event.key === 'Home'
                      ? 0
                      : event.key === 'End'
                        ? items.length - 1
                        : undefined
              if (next !== undefined) {
                event.preventDefault()
                items[next].focus()
              }
              if (event.key.length === 1 && /[a-z]/i.test(event.key))
                items
                  .find((item) => item.textContent?.trim().toLowerCase().startsWith(event.key.toLowerCase()))
                  ?.focus()
            }}
          >
            <Button
              role="menuitemcheckbox"
              aria-checked={includeCommentsInPDF}
              tabIndex={-1}
              size="sm"
              variant="ghost"
              onClick={onToggleCommentsInPDF}
            >
              <span aria-hidden="true">{includeCommentsInPDF ? '☑' : '☐'}</span>
              {appText.includeCommentsInPDF}
            </Button>
            {formats.map((format) => (
              <Button
                key={format}
                role="menuitem"
                tabIndex={-1}
                size="sm"
                variant="ghost"
                icon={<DraftIcon name={format === 'odt' ? 'export' : format} />}
                onClick={() => {
                  close(true)
                  onExport(format)
                }}
              >
                {t[format]}
              </Button>
            ))}
          </div>,
          document.body,
        )}
    </>
  )
}
