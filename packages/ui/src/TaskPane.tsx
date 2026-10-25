import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Heading, SidePanel } from '@all/ui'
import './task-pane.css'

/** A single docked task surface. Content and document commands belong to the caller. */
export function TaskPane({
  open,
  title,
  closeLabel,
  focusKey,
  onClose,
  children,
}: {
  open: boolean
  title: string
  closeLabel: string
  focusKey: string
  onClose: () => void
  children: ReactNode
}) {
  const host = useRef<HTMLDivElement>(null)
  const close = useRef(onClose)
  const ownsHistoryEntry = useRef(false)
  const dismissingHistoryEntry = useRef(false)
  const [mobile, setMobile] = useState(() => window.matchMedia?.('(max-width: 900px)').matches || false)
  close.current = onClose
  useEffect(() => {
    if (!window.matchMedia) return
    const media = window.matchMedia('(max-width: 900px)')
    const change = () => setMobile(media.matches)
    media.addEventListener('change', change)
    return () => media.removeEventListener('change', change)
  }, [])
  useEffect(() => {
    if (!open) return
    const frame = requestAnimationFrame(() => {
      const elements = host.current?.querySelectorAll<HTMLElement>('input, textarea, button, [tabindex="0"]')
      // Prefer a domain input; the header close button remains reachable with Shift+Tab.
      const visible = Array.from(elements || []).filter(
        (element) => element.getClientRects().length && !element.matches(':disabled'),
      )
      ;(visible.find((element) => element.matches('input, textarea')) || visible[0])?.focus()
    })
    return () => cancelAnimationFrame(frame)
  }, [open, focusKey])
  useEffect(() => {
    if (!open) return
    const escape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented || document.querySelector('[role="dialog"], [role="menu"]'))
        return
      event.preventDefault()
      event.stopImmediatePropagation()
      close.current()
    }
    window.addEventListener('keydown', escape, true)
    return () => window.removeEventListener('keydown', escape, true)
  }, [open])
  useEffect(() => {
    // Register at mount, before a dirty-document navigation guard is installed.
    // Both browser Back and the traversal caused by our close button are local UI.
    const back = (event: PopStateEvent) => {
      if (!ownsHistoryEntry.current && !dismissingHistoryEntry.current) return
      event.stopImmediatePropagation()
      const wasOpen = ownsHistoryEntry.current
      ownsHistoryEntry.current = false
      dismissingHistoryEntry.current = false
      if (wasOpen) close.current()
    }
    window.addEventListener('popstate', back, true)
    return () => window.removeEventListener('popstate', back, true)
  }, [])
  useEffect(() => {
    if (!open || !mobile) return
    // Use the same local history convention as the mobile ribbon. Switching content
    // does not push another entry, so Back dismisses exactly one task surface.
    const state = { ...window.history.state, allsuiteTaskPane: true }
    delete state.draftRibbonMore
    window.history.pushState(state, '')
    ownsHistoryEntry.current = true
    return () => {
      if (!ownsHistoryEntry.current) return
      ownsHistoryEntry.current = false
      if (window.history.state?.allsuiteTaskPane) {
        dismissingHistoryEntry.current = true
        window.history.back()
      }
    }
  }, [open, mobile])
  return (
    <div ref={host} hidden={!open} className="allsuite-task-pane-host">
      <SidePanel
        className="allsuite-task-pane"
        label={title}
        title={<Heading level={2}>{title}</Heading>}
        closeLabel={closeLabel}
        onClose={onClose}
      >
        {children}
      </SidePanel>
    </div>
  )
}
