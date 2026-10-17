import { useEditorState } from '@tiptap/react'
import type { Editor } from '@tiptap/core'
import { Button, IconButton } from '@all/ui'
import type { Locale } from '../types'
import { translations } from '../i18n'
import { stepIndent } from '../engine/paragraph'
import { updateSelectedParagraphs } from '../editor/paragraph-commands'

interface Props {
  editor: Editor
  locale: Locale
  widthPt?: number
}

export function DocumentRuler({ editor, locale, widthPt = 482 }: Props) {
  const rulerWidthPt = widthPt
  const t = translations[locale]
  const attrs = useEditorState({
    editor,
    selector: ({ editor: current }) => ({ ...current.state.selection.$from.parent.attrs }),
  })
  const tabs = Array.isArray(attrs.tabStops) ? (attrs.tabStops as number[]) : []
  const marker = (
    key: 'indentLeft' | 'indentRight' | 'indentFirstLine',
    label: string,
    symbol: string,
    fromRight = false,
  ) => {
    const value = Number(attrs[key]) || 0
    const position = Math.min(100, (value / rulerWidthPt) * 100)
    return (
      <IconButton
        className={`draft-ruler-marker draft-ruler-marker--${key}`}
        variant="ghost"
        icon={<span aria-hidden="true">{symbol}</span>}
        style={fromRight ? { right: `${position}%` } : { left: `${position}%` }}
        aria-label={`${label}: ${value} pt`}
        title={`${label}: ${value} pt`}
        onClick={(event) => event.stopPropagation()}
        onPointerDown={(event) => event.currentTarget.setPointerCapture(event.pointerId)}
        onPointerMove={(event) => {
          if (!event.currentTarget.hasPointerCapture(event.pointerId)) return
          const bounds = event.currentTarget.parentElement!.getBoundingClientRect()
          const ratio = fromRight
            ? (bounds.right - event.clientX) / bounds.width
            : (event.clientX - bounds.left) / bounds.width
          updateSelectedParagraphs(editor, { [key]: Math.round(Math.max(0, Math.min(1, ratio)) * rulerWidthPt) })
        }}
        onKeyDown={(event) => {
          if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
          event.preventDefault()
          updateSelectedParagraphs(editor, { [key]: stepIndent(value, event.key === 'ArrowRight' ? 1 : -1) })
        }}
      />
    )
  }
  return (
    <div className="draft-ruler" role="toolbar" aria-label={t.ruler}>
      <Button
        className="draft-ruler-track"
        variant="ghost"
        aria-label={t.addTabStop}
        onClick={(event) => {
          const bounds = event.currentTarget.getBoundingClientRect()
          const ratio = event.detail === 0 ? 0.15 : (event.clientX - bounds.left) / bounds.width
          const value = Math.round(Math.max(0, Math.min(1, ratio)) * rulerWidthPt)
          updateSelectedParagraphs(editor, { tabStops: [...new Set([...tabs, value])].sort((a, b) => a - b) })
        }}
      />
      <div className="draft-ruler-scale" aria-hidden="true">
        {Array.from({ length: Math.ceil(rulerWidthPt / 72) }, (_, i) => i * 72).map((value) => (
          <span key={value} style={{ left: `${(value / rulerWidthPt) * 100}%` }}>
            {Math.round(value / 72)}
          </span>
        ))}
      </div>
      {tabs.map((value) => (
        <IconButton
          key={value}
          className="draft-ruler-tab"
          variant="ghost"
          icon={<span aria-hidden="true">⌞</span>}
          style={{ left: `${(value / rulerWidthPt) * 100}%` }}
          aria-label={`${t.tabStop}: ${value} pt`}
          title={`${t.tabStop}: ${value} pt`}
          onClick={(event) => {
            event.stopPropagation()
            updateSelectedParagraphs(editor, { tabStops: tabs.filter((item) => item !== value) })
          }}
        />
      ))}
      {marker('indentLeft', t.indentLeft, '◢')}
      {marker('indentFirstLine', t.indentFirstLine, '▼')}
      {marker('indentRight', t.indentRight, '◣', true)}
    </div>
  )
}
