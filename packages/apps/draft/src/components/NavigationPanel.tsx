import { useEffect, useState, type DragEvent } from 'react'
import { useEditorState } from '@tiptap/react'
import type { Editor } from '@tiptap/core'
import { Button, Dialog, Heading, IconButton, SidePanel, Text } from '@all/ui'
import type { Locale } from '../types'
import type { DraftDocument } from '../engine/document-model'
import { referenceTargets, type ReferenceTarget } from '../engine/references'
import { jumpToTarget } from '../editor/references'
import { moveOutlineSection, moveOutlineSectionBefore, outlineSectionMoves } from '../editor/outline'
import { DraftIcon } from './DraftIcons'

export function NavigationPanel({
  editor,
  locale,
  open,
  embedded = false,
  onClose,
}: {
  editor: Editor
  locale: Locale
  open: boolean
  embedded?: boolean
  onClose: () => void
}) {
  const t =
    locale === 'pl'
      ? {
          title: 'Konspekt',
          empty: 'Zastosuj style nagłówków na karcie Narzędzia główne, aby utworzyć konspekt dokumentu.',
          collapse: 'Zwiń',
          expand: 'Rozwiń',
          close: 'Zamknij konspekt',
          moveUp: 'Przenieś wyżej',
          moveDown: 'Przenieś niżej',
          reorderHint: 'Przeciągnij nagłówki lub użyj przycisków przenoszenia.',
        }
      : {
          title: 'Outline',
          empty: 'Apply heading styles from Home to build your document outline.',
          collapse: 'Collapse',
          expand: 'Expand',
          close: 'Close outline',
          moveUp: 'Move up',
          moveDown: 'Move down',
          reorderHint: 'Drag headings or use the move buttons.',
        }
  const [phone, setPhone] = useState(() => window.matchMedia?.('(max-width: 599px)').matches || false)
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())
  const [active, setActive] = useState('')
  const [dragging, setDragging] = useState<string | null>(null)
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
  const moves = outlineSectionMoves(editor)
  const dropHeading = (event: DragEvent<HTMLLIElement>, targetId: string) => {
    event.preventDefault()
    const sourceId = dragging || event.dataTransfer.getData('text/plain')
    if (sourceId && sourceId !== targetId) moveOutlineSectionBefore(editor, sourceId, targetId)
    setDragging(null)
  }
  const moveHeading = (target: ReferenceTarget, direction: -1 | 1) => {
    if (!moveOutlineSection(editor, target.id, direction)) return
    const nextDirection = direction < 0 ? 'down' : 'up'
    requestAnimationFrame(() => {
      document
        .querySelector<HTMLButtonElement>(
          `[data-outline-move-id="${target.id}"][data-outline-move-direction="${nextDirection}"]`,
        )
        ?.focus()
    })
  }
  const content = (
    <nav aria-label={t.title} className="draft-navigation-list">
      {!visible.length && <Text variant="caption">{t.empty}</Text>}
      {visible.length > 0 && (
        <Text variant="caption" className="draft-outline-hint">
          {t.reorderHint}
        </Text>
      )}
      <ol role="tree" aria-label={t.title}>
        {visible.map((target) => {
          const index = state.targets.indexOf(target)
          const children = state.targets[index + 1]?.level > target.level
          const canMove = moves.get(target.id)
          return (
            <li
              key={target.id}
              role="treeitem"
              aria-selected={active === target.id}
              aria-level={target.level}
              aria-expanded={children ? !collapsed.has(target.id) : undefined}
              draggable={Boolean(canMove?.up || canMove?.down)}
              onDragStart={(event) => {
                setDragging(target.id)
                event.dataTransfer.effectAllowed = 'move'
                event.dataTransfer.setData('text/plain', target.id)
              }}
              onDragEnd={() => setDragging(null)}
              onDragOver={(event) => {
                if (dragging && dragging !== target.id) event.preventDefault()
              }}
              onDrop={(event) => dropHeading(event, target.id)}
              className={dragging === target.id ? 'draft-outline-item--dragging' : undefined}
              style={{ paddingInlineStart: Math.min(5, target.level - 1) * 12 }}
            >
              <div className="draft-outline-row">
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
                  variant={active === target.id ? 'secondary' : 'ghost'}
                  aria-current={active === target.id ? 'location' : undefined}
                  tooltip={
                    locale === 'pl' ? `Przejdź do sekcji „${target.label}”.` : `Jump to the “${target.label}” section.`
                  }
                  onClick={() => {
                    if (phone) {
                      onClose()
                      requestAnimationFrame(() => jumpToTarget(editor, target.id))
                    } else jumpToTarget(editor, target.id)
                  }}
                >
                  {target.label}
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  className="draft-outline-move"
                  data-outline-move-id={target.id}
                  data-outline-move-direction="up"
                  aria-label={`${t.moveUp} ${target.label}`}
                  disabled={!canMove?.up}
                  onClick={() => moveHeading(target, -1)}
                >
                  ↑
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  className="draft-outline-move"
                  data-outline-move-id={target.id}
                  data-outline-move-direction="down"
                  aria-label={`${t.moveDown} ${target.label}`}
                  disabled={!canMove?.down}
                  onClick={() => moveHeading(target, 1)}
                >
                  ↓
                </Button>
              </div>
            </li>
          )
        })}
      </ol>
    </nav>
  )
  if (embedded) return content
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
