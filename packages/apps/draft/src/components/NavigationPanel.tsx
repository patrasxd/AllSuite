import { useEffect, useState } from 'react'
import { useEditorState } from '@tiptap/react'
import type { Editor } from '@tiptap/core'
import { Button, Dialog, Heading, IconButton, SidePanel, Text } from '@all/ui'
import type { Locale } from '../types'
import type { DraftDocument } from '../engine/document-model'
import { referenceTargets } from '../engine/references'
import { jumpToTarget } from '../editor/references'
import { DraftIcon } from './DraftIcons'

export function NavigationPanel({
  editor,
  locale,
  open,
  onClose,
}: {
  editor: Editor
  locale: Locale
  open: boolean
  onClose: () => void
}) {
  const t =
    locale === 'pl'
      ? {
          title: 'Nawigacja',
          empty: 'Nagłówki dokumentu pojawią się tutaj.',
          collapse: 'Zwiń',
          expand: 'Rozwiń',
          close: 'Zamknij nawigację',
        }
      : {
          title: 'Navigation',
          empty: 'Document headings will appear here.',
          collapse: 'Collapse',
          expand: 'Expand',
          close: 'Close navigation',
        }
  const [phone, setPhone] = useState(() => window.matchMedia?.('(max-width: 599px)').matches || false)
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())
  const [active, setActive] = useState('')
  const state = useEditorState({
    editor,
    selector: ({ editor: current }) => ({
      targets: referenceTargets(current.getJSON() as DraftDocument).filter((target) => target.kind === 'heading'),
      from: current.state.selection.from,
    }),
  })
  useEffect(() => {
    if (!window.matchMedia) return
    const media = window.matchMedia('(max-width: 599px)')
    const change = () => setPhone(media.matches)
    media.addEventListener('change', change)
    return () => media.removeEventListener('change', change)
  }, [])
  useEffect(() => {
    let id = state.targets[0]?.id || ''
    editor.state.doc.descendants((node, pos) => {
      if (node.attrs.anchorId && pos <= state.from && state.targets.some((target) => target.id === node.attrs.anchorId))
        id = node.attrs.anchorId
    })
    setActive(id)
  }, [editor, state.from, state.targets])
  useEffect(() => {
    if (!open) return
    const pane = editor.view.dom.closest('.draft-workspace')?.querySelector('.draft-document-area')
    if (!pane) return
    const onScroll = () => {
      const top = pane.getBoundingClientRect().top + 24
      const atBottom = pane.scrollTop + pane.clientHeight >= pane.scrollHeight - 2
      const bottom = pane.getBoundingClientRect().bottom
      let id = state.targets[0]?.id || ''
      for (const target of state.targets) {
        const element = editor.view.dom.querySelector<HTMLElement>(`[id="${target.id}"]`)
        if (element && element.getBoundingClientRect().top <= (atBottom ? bottom : top)) id = target.id
      }
      setActive(id)
    }
    pane.addEventListener('scroll', onScroll, { passive: true })
    return () => pane.removeEventListener('scroll', onScroll)
  }, [editor, open, state.targets])
  let hiddenBelow = 7
  const visible = state.targets.filter((target) => {
    if (target.level > hiddenBelow) return false
    hiddenBelow = collapsed.has(target.id) ? target.level : 7
    return true
  })
  const content = (
    <nav aria-label={t.title} className="draft-navigation-list">
      {!visible.length && <Text variant="caption">{t.empty}</Text>}
      <ol>
        {visible.map((target) => {
          const index = state.targets.indexOf(target)
          const children = state.targets[index + 1]?.level > target.level
          return (
            <li key={target.id} style={{ paddingInlineStart: Math.min(5, target.level - 1) * 12 }}>
              {children ? (
                <IconButton
                  size="sm"
                  variant="ghost"
                  icon={<DraftIcon name={collapsed.has(target.id) ? 'next' : 'down'} />}
                  aria-label={`${collapsed.has(target.id) ? t.expand : t.collapse} ${target.label}`}
                  aria-expanded={!collapsed.has(target.id)}
                  onClick={() =>
                    setCollapsed((old) => {
                      const next = new Set(old)
                      if (next.has(target.id)) next.delete(target.id)
                      else next.add(target.id)
                      return next
                    })
                  }
                />
              ) : (
                <span className="draft-navigation-spacer" />
              )}
              <Button
                size="sm"
                variant={active === target.id ? 'primary' : 'ghost'}
                aria-current={active === target.id ? 'location' : undefined}
                title={target.label}
                onClick={() => {
                  if (phone) {
                    onClose()
                    requestAnimationFrame(() => jumpToTarget(editor, target.id))
                  } else jumpToTarget(editor, target.id)
                }}
              >
                {target.label}
              </Button>
            </li>
          )
        })}
      </ol>
    </nav>
  )
  if (phone)
    return (
      <Dialog open={open} onClose={onClose} title={t.title} className="draft-navigation-drawer">
        {content}
      </Dialog>
    )
  return open ? (
    <SidePanel
      className="draft-navigation-panel"
      label={t.title}
      title={<Heading level={2}>{t.title}</Heading>}
      closeLabel={t.close}
      onClose={onClose}
    >
      {content}
    </SidePanel>
  ) : null
}
