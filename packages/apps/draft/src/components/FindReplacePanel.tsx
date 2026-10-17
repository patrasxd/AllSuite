import { useCallback, useEffect, useRef, useState } from 'react'
import { Button, CloseIcon, Input, ReplaceIcon, Text, Toggle } from '@all/ui'
import { DraftIcon } from './DraftIcons'
import type { Editor } from '@tiptap/core'
import type { Locale } from '../types'
import { translations } from '../i18n'
import { findDocumentMatches, setSearchHighlights } from '../editor/search-highlights'
import type { SearchOptions } from '../engine/search'

interface Props {
  editor: Editor
  locale: Locale
  mode: 'find' | 'replace'
  onModeChange: (mode: 'find' | 'replace') => void
  onClose: () => void
}

const defaultOptions: SearchOptions = { caseSensitive: false, wholeWord: false, regex: false }

export function FindReplacePanel({ editor, locale, mode, onModeChange, onClose }: Props) {
  const t = translations[locale]
  const [query, setQuery] = useState('')
  const [replacement, setReplacement] = useState('')
  const [options, setOptions] = useState(defaultOptions)
  const [current, setCurrent] = useState(0)
  const [result, setResult] = useState(() => findDocumentMatches(editor, '', defaultOptions))
  const queryInput = useRef<HTMLInputElement>(null)

  useEffect(() => {
    queryInput.current?.focus()
  }, [])

  const refresh = useCallback(() => {
    const next = findDocumentMatches(editor, query, options)
    const nextCurrent = next.matches.length ? Math.min(current, next.matches.length - 1) : 0
    setCurrent(nextCurrent)
    setResult(next)
    setSearchHighlights(editor, next.matches, nextCurrent)
  }, [current, editor, options, query])

  useEffect(() => {
    refresh()
  }, [refresh])

  useEffect(() => {
    editor.on('update', refresh)
    return () => {
      editor.off('update', refresh)
    }
  }, [editor, refresh])

  useEffect(
    () => () => {
      if (!editor.isDestroyed) setSearchHighlights(editor, [], 0)
    },
    [editor],
  )

  function move(direction: -1 | 1) {
    if (!result.matches.length) return
    const next = (current + direction + result.matches.length) % result.matches.length
    const match = result.matches[next]
    setCurrent(next)
    setSearchHighlights(editor, result.matches, next)
    editor.chain().focus().setTextSelection({ from: match.from, to: match.to }).scrollIntoView().run()
  }

  function replaceOne() {
    const match = result.matches[current]
    if (!match) return
    editor.chain().focus().insertContentAt({ from: match.from, to: match.to }, replacement).run()
  }

  function replaceAll() {
    if (!result.matches.length) return
    let transaction = editor.state.tr
    for (const match of [...result.matches].reverse())
      transaction = transaction.insertText(replacement, match.from, match.to)
    editor.view.dispatch(transaction.scrollIntoView())
  }

  const error = result.error ? t[`searchError_${result.error}`] : undefined
  return (
    <section className="draft-find-panel" role="search" aria-label={t.findReplace}>
      <div className="draft-find-fields">
        <label>
          <Text as="span" variant="caption">
            {t.find}
          </Text>
          <Input
            ref={queryInput}
            aria-label={t.find}
            value={query}
            onChange={(event) => {
              setQuery(event.target.value)
              setCurrent(0)
            }}
            onKeyDown={(event) => {
              if (event.key !== 'Enter') return
              event.preventDefault()
              move(event.shiftKey ? -1 : 1)
            }}
          />
        </label>
        {mode === 'replace' && (
          <label>
            <Text as="span" variant="caption">
              {t.replaceWith}
            </Text>
            <Input
              aria-label={t.replaceWith}
              value={replacement}
              onChange={(event) => setReplacement(event.target.value)}
            />
          </label>
        )}
      </div>
      <div className="draft-find-options">
        <Toggle
          checked={options.caseSensitive}
          onChange={(caseSensitive) => setOptions((value) => ({ ...value, caseSensitive }))}
          label={t.caseSensitive}
        />
        <Toggle
          checked={options.wholeWord}
          onChange={(wholeWord) => setOptions((value) => ({ ...value, wholeWord }))}
          label={t.wholeWord}
        />
        <Toggle
          checked={options.regex}
          onChange={(regex) => setOptions((value) => ({ ...value, regex }))}
          label={t.regularExpression}
        />
      </div>
      <div className="draft-find-actions">
        <Text as="span" variant="secondary" aria-live="polite">
          {result.matches.length
            ? `${current + 1}/${result.matches.length}${result.truncated ? '+' : ''}`
            : t.noMatches}
        </Text>
        <Button
          variant="secondary"
          icon={<DraftIcon name="previous" />}
          onClick={() => move(-1)}
          disabled={!result.matches.length}
        >
          {t.previousMatch}
        </Button>
        <Button
          variant="secondary"
          icon={<DraftIcon name="next" />}
          onClick={() => move(1)}
          disabled={!result.matches.length}
        >
          {t.nextMatch}
        </Button>
        {mode === 'find' ? (
          <Button variant="secondary" icon={<ReplaceIcon />} onClick={() => onModeChange('replace')}>
            {t.replace}
          </Button>
        ) : (
          <>
            <Button variant="secondary" icon={<ReplaceIcon />} onClick={replaceOne} disabled={!result.matches.length}>
              {t.replaceOne}
            </Button>
            <Button variant="secondary" icon={<ReplaceIcon />} onClick={replaceAll} disabled={!result.matches.length}>
              {t.replaceAll}
            </Button>
          </>
        )}
        <Button variant="ghost" onClick={onClose} aria-label={t.closeFind}>
          <CloseIcon />
        </Button>
      </div>
      {error && (
        <Text role="alert" variant="secondary">
          {error}
        </Text>
      )}
    </section>
  )
}
