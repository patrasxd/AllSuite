import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { Button, CloseIcon, IconButton, Input, ReplaceIcon, Text, Toggle } from '@all/ui'
import { DraftIcon } from './DraftIcons'
import type { Editor } from '@tiptap/core'
import type { Locale } from '../types'
import { translations } from '../i18n'
import { findDocumentMatches, setSearchHighlights } from '../editor/search-highlights'
import type { SearchOptions } from '../engine/search'

interface Props {
  editor: Editor
  locale: Locale
  mode: 'find' | 'replace' | 'headings'
  onModeChange: (mode: 'find' | 'replace' | 'headings') => void
  children?: ReactNode
  active?: boolean
  embedded?: boolean
  onClose: () => void
}

const defaultOptions: SearchOptions = { caseSensitive: false, wholeWord: false, regex: false }

export function FindReplacePanel({
  editor,
  locale,
  mode,
  onModeChange,
  onClose,
  active = true,
  embedded = false,
  children,
}: Props) {
  const t = translations[locale]
  const [query, setQuery] = useState('')
  const [replacement, setReplacement] = useState('')
  const [options, setOptions] = useState(defaultOptions)
  const [current, setCurrent] = useState(0)
  const [result, setResult] = useState(() => findDocumentMatches(editor, '', defaultOptions))
  const queryInput = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (active) queryInput.current?.focus()
  }, [active, mode])

  const refresh = useCallback(() => {
    const next = findDocumentMatches(editor, active && mode !== 'headings' ? query : '', options)
    const nextCurrent = next.matches.length ? Math.min(current, next.matches.length - 1) : 0
    setCurrent(nextCurrent)
    setResult(next)
    setSearchHighlights(editor, next.matches, nextCurrent)
  }, [active, current, editor, mode, options, query])

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
            fullWidth
            aria-label={t.find}
            value={query}
            placeholder={locale === 'pl' ? 'Szukaj w dokumencie' : 'Search document'}
            onChange={(event) => {
              setQuery(event.target.value)
              setCurrent(0)
              if (mode === 'headings') onModeChange('find')
            }}
            onKeyDown={(event) => {
              if (event.key !== 'Enter') return
              event.preventDefault()
              move(event.shiftKey ? -1 : 1)
            }}
          />
        </label>
      </div>
      <div className="draft-navigation-modes" role="group" aria-label={locale === 'pl' ? 'Nawigacja' : 'Navigation'}>
        {(['find', 'replace', 'headings'] as const).map((view) => (
          <Button
            key={view}
            size="sm"
            variant={mode === view ? 'secondary' : 'ghost'}
            aria-pressed={mode === view}
            onClick={() => onModeChange(view)}
          >
            {view === 'find' ? t.find : view === 'replace' ? t.replace : locale === 'pl' ? 'Nagłówki' : 'Headings'}
          </Button>
        ))}
      </div>
      <div hidden={mode !== 'headings'}>{children}</div>
      <div hidden={mode === 'headings'} className="draft-find-content">
        {mode === 'replace' && (
          <label>
            <Text as="span" variant="caption">
              {t.replaceWith}
            </Text>
            <Input
              fullWidth
              aria-label={t.replaceWith}
              value={replacement}
              onChange={(event) => setReplacement(event.target.value)}
            />
          </label>
        )}
        <details className="draft-search-options">
          <summary>{locale === 'pl' ? 'Opcje wyszukiwania' : 'Search options'}</summary>
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
        </details>
        <div className="draft-find-actions">
          <Text as="span" variant="secondary" aria-live="polite">
            {result.matches.length
              ? `${current + 1}/${result.matches.length}${result.truncated ? '+' : ''}`
              : t.noMatches}
          </Text>
          <IconButton
            size="sm"
            variant="outline"
            icon={<DraftIcon name="previous" />}
            aria-label={t.previousMatch}
            onClick={() => move(-1)}
            disabled={!result.matches.length}
          />
          <IconButton
            size="sm"
            variant="outline"
            icon={<DraftIcon name="next" />}
            aria-label={t.nextMatch}
            onClick={() => move(1)}
            disabled={!result.matches.length}
          />
          {mode === 'replace' && (
            <>
              <Button
                size="sm"
                variant="outline"
                icon={<ReplaceIcon />}
                onClick={replaceOne}
                disabled={!result.matches.length}
              >
                {t.replaceOne}
              </Button>
              <Button
                size="sm"
                variant="outline"
                icon={<ReplaceIcon />}
                onClick={replaceAll}
                disabled={!result.matches.length}
              >
                {t.replaceAll}
              </Button>
            </>
          )}
          {!embedded && (
            <Button variant="ghost" onClick={onClose} aria-label={t.closeFind}>
              <CloseIcon />
            </Button>
          )}
        </div>
        <ol className="draft-search-results" aria-label={t.find}>
          {result.matches.map((match, index) => (
            <li key={match.from}>
              <Button
                variant={current === index ? 'secondary' : 'ghost'}
                aria-current={current === index ? 'true' : undefined}
                onClick={() => {
                  setCurrent(index)
                  setSearchHighlights(editor, result.matches, index)
                  editor.chain().focus().setTextSelection({ from: match.from, to: match.to }).scrollIntoView().run()
                }}
              >
                <span className="draft-search-result-number">{index + 1}</span>
                <span className="draft-search-context">
                  {editor.state.doc.textBetween(Math.max(0, match.from - 30), match.from, ' ')}
                  <strong>{editor.state.doc.textBetween(match.from, match.to, ' ')}</strong>
                  {editor.state.doc.textBetween(match.to, Math.min(editor.state.doc.content.size, match.to + 45), ' ')}
                </span>
              </Button>
            </li>
          ))}
        </ol>
        {!query && (
          <Text variant="secondary">
            {locale === 'pl' ? 'Wpisz tekst, aby znaleźć go w dokumencie.' : 'Enter text to find it in your document.'}
          </Text>
        )}
        {error && (
          <Text role="alert" variant="secondary">
            {error}
          </Text>
        )}
      </div>
    </section>
  )
}
