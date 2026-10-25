import type { Editor } from '@tiptap/core'
import { Badge, Button, Card, Heading, Input, Text } from '@all/ui'
import type { Locale } from '../types'
import { translations } from '../i18n'
import type { SuggestionDecision, SuggestionSummary } from '../editor/suggestions'
import { getDraftButtonTooltip } from '../button-tooltips'

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
  onResolve,
}: {
  editor: Editor
  locale: Locale
  suggestions: SuggestionSummary[]
  author: string
  tracking: boolean
  onAuthorChange: (value: string) => void
  onResolve: (ids: string[], decision: SuggestionDecision) => void
}) {
  const t = translations[locale]
  const label = (suggestion: SuggestionSummary) => {
    if (suggestion.kind === 'insert') return t.insertion
    if (suggestion.kind === 'delete') return t.deletion
    return t.formatChange
  }
  const date = (value: string) => {
    const parsed = new Date(value)
    return Number.isNaN(parsed.getTime())
      ? value
      : parsed.toLocaleString(locale === 'pl' ? 'pl-PL' : 'en-US', {
          month: 'short',
          day: 'numeric',
          hour: '2-digit',
          minute: '2-digit',
        })
  }
  const badgeVariant = (suggestion: SuggestionSummary) => {
    if (suggestion.kind === 'insert') return 'success' as const
    if (suggestion.kind === 'delete') return 'danger' as const
    return 'warning' as const
  }
  return (
    <div className="draft-suggestions-content">
      <section className="draft-review-controls" aria-label={t.reviewChanges}>
        {suggestions.length > 0 && (
          <div className="draft-review-bulk-actions" role="group" aria-label={t.reviewChanges}>
            <Button
              type="button"
              size="sm"
              variant="outline"
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
        )}
      </section>
      <div className="draft-suggestion-list" aria-live="polite">
        {suggestions.length === 0 ? (
          <Card className="draft-suggestion-empty" role="status" variant="flat" padding="sm">
            <Heading level={5}>{t.noSuggestions}</Heading>
            <Text variant="secondary">{tracking ? t.trackedChangesWillAppear : t.enableTrackingToReview}</Text>
          </Card>
        ) : (
          suggestions.map((suggestion) => (
            <Card
              className={`draft-suggestion-card draft-suggestion-card--${suggestion.kind}`}
              key={suggestion.id}
              role="article"
              aria-label={`${label(suggestion)} — ${suggestion.author}`}
              variant="outlined"
              padding="sm"
            >
              <Button
                type="button"
                variant="ghost"
                size="md"
                className="draft-suggestion-jump"
                tooltip={getDraftButtonTooltip(locale, t.goToSuggestion)}
                onClick={() => selectSuggestion(editor, suggestion)}
              >
                <span className="draft-suggestion-meta">
                  <Badge size="sm" variant={badgeVariant(suggestion)}>
                    {label(suggestion)}
                  </Badge>
                  <span className="draft-suggestion-byline">
                    <Text as="span" variant="secondary">
                      {suggestion.author}
                    </Text>
                    <span className="draft-suggestion-separator" aria-hidden="true">
                      ·
                    </span>
                    <time className="all-text-elem all-text--caption" dateTime={suggestion.timestamp}>
                      {date(suggestion.timestamp)}
                    </time>
                  </span>
                </span>
                <Text as="span" variant="secondary" className="draft-suggestion-quote">
                  {suggestion.text || t.formatChange}
                </Text>
              </Button>
              <div className="draft-suggestion-card-actions">
                <Button type="button" size="sm" variant="outline" onClick={() => onResolve([suggestion.id], 'accept')}>
                  {t.accept}
                </Button>
                <Button type="button" size="sm" variant="outline" onClick={() => onResolve([suggestion.id], 'reject')}>
                  {t.reject}
                </Button>
              </div>
            </Card>
          ))
        )}
      </div>
      <details className="draft-pane-settings">
        <summary>{t.suggestionAuthor}</summary>
        <Input
          fullWidth
          label={t.suggestionAuthor}
          value={author}
          onChange={(event) => onAuthorChange(event.target.value)}
          maxLength={200}
          autoComplete="off"
        />
      </details>
    </div>
  )
}
