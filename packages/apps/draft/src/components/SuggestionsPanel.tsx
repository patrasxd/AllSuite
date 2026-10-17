import type { Editor } from '@tiptap/core'
import { Button, Heading, SidePanel, Text } from '@all/ui'
import type { Locale } from '../types'
import { translations } from '../i18n'
import type { SuggestionDecision, SuggestionSummary } from '../editor/suggestions'

function selectSuggestion(editor: Editor, suggestion: SuggestionSummary) {
  editor.commands.setTextSelection({ from: suggestion.from, to: suggestion.to })
  editor.commands.focus()
  editor.commands.scrollIntoView()
}

export function SuggestionsPanel({
  editor,
  locale,
  suggestions,
  author,
  tracking,
  onAuthorChange,
  onTrackingChange,
  onResolve,
  onClose,
}: {
  editor: Editor
  locale: Locale
  suggestions: SuggestionSummary[]
  author: string
  tracking: boolean
  onAuthorChange: (value: string) => void
  onTrackingChange: (enabled: boolean) => void
  onResolve: (ids: string[], decision: SuggestionDecision) => void
  onClose: () => void
}) {
  const t = translations[locale]
  const label = (suggestion: SuggestionSummary) => {
    if (suggestion.kind === 'insert') return t.insertion
    if (suggestion.kind === 'delete') return t.deletion
    return t.formatChange
  }
  const date = (value: string) => {
    const parsed = new Date(value)
    return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleString(locale === 'pl' ? 'pl-PL' : 'en-US')
  }
  return (
    <SidePanel
      className="draft-suggestions-panel"
      label={t.suggestions}
      title={<Heading level={2}>{t.suggestions}</Heading>}
      closeLabel={t.closeSuggestions}
      onClose={onClose}
    >
      <div className="draft-suggestions-compose">
        <label htmlFor="draft-suggestion-author">{t.suggestionAuthor}</label>
        <input
          id="draft-suggestion-author"
          className="draft-comment-input"
          value={author}
          onChange={(event) => onAuthorChange(event.target.value)}
          maxLength={200}
          autoComplete="off"
        />
        <label className="draft-suggestion-tracking">
          <input type="checkbox" checked={tracking} onChange={(event) => onTrackingChange(event.target.checked)} />
          {t.trackChanges}
        </label>
        <div className="draft-suggestion-actions">
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={!suggestions.length}
            onClick={() =>
              onResolve(
                suggestions.map((item) => item.id),
                'accept',
              )
            }
          >
            {t.acceptAll}
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={!suggestions.length}
            onClick={() =>
              onResolve(
                suggestions.map((item) => item.id),
                'reject',
              )
            }
          >
            {t.rejectAll}
          </Button>
        </div>
      </div>
      <div className="draft-suggestion-list" aria-live="polite">
        {suggestions.length === 0 ? (
          <Text as="p" variant="body">
            {t.noSuggestions}
          </Text>
        ) : (
          suggestions.map((suggestion) => (
            <article className={`draft-suggestion-card draft-suggestion-card--${suggestion.kind}`} key={suggestion.id}>
              <button
                type="button"
                className="draft-suggestion-anchor"
                title={t.goToSuggestion}
                onClick={() => selectSuggestion(editor, suggestion)}
              >
                <span className="draft-suggestion-meta">
                  <strong>{label(suggestion)}</strong>
                  <span>{suggestion.author}</span>
                  <time dateTime={suggestion.timestamp}>{date(suggestion.timestamp)}</time>
                </span>
                <span className="draft-suggestion-quote">{suggestion.text || t.formatChange}</span>
              </button>
              <div className="draft-suggestion-actions">
                <Button type="button" size="sm" variant="outline" onClick={() => onResolve([suggestion.id], 'accept')}>
                  {t.accept}
                </Button>
                <Button type="button" size="sm" variant="outline" onClick={() => onResolve([suggestion.id], 'reject')}>
                  {t.reject}
                </Button>
              </div>
            </article>
          ))
        )}
      </div>
    </SidePanel>
  )
}
