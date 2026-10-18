import { describe, expect, it } from 'vitest'
import { getDraftButtonTooltip, getDraftTabTooltip } from './button-tooltips'

describe('Draft button tooltips', () => {
  it('describes formatting actions in both supported locales', () => {
    expect(getDraftButtonTooltip('en', 'Bold')).toBe('Make selected text bold')
    expect(getDraftButtonTooltip('en', 'Italic')).toBe('Italicize the selected text')
    expect(getDraftButtonTooltip('en', 'Underline')).toBe('Underline the selected text')
    expect(getDraftButtonTooltip('pl', 'Pogrubienie')).toBe('Pogrub zaznaczony tekst')
    expect(getDraftButtonTooltip('pl', 'Kursywa')).toBe('Pochyl zaznaczony tekst')
    expect(getDraftButtonTooltip('pl', 'Podkreślenie')).toBe('Podkreśl zaznaczony tekst')
  })

  it('adds useful descriptions for dynamic toolbar actions', () => {
    expect(getDraftButtonTooltip('en', 'Insert Ω')).toBe('Insert the selected symbol')
    expect(getDraftButtonTooltip('pl', 'Przenieś wyżej Heading')).toBe('Przenieś tę sekcję wcześniej')
  })

  it('describes toolbar tabs in both supported locales', () => {
    expect(getDraftTabTooltip('en', 'format')).toBe('Show text and paragraph formatting')
    expect(getDraftTabTooltip('pl', 'review')).toBe('Pokaż komentarze i przegląd zmian')
  })

  it('describes comment and review panel controls', () => {
    expect(getDraftButtonTooltip('en', 'Close comments')).toBe('Close the comments panel')
    expect(getDraftButtonTooltip('pl', 'Przejdź do sugerowanego tekstu')).toBe(
      'Przejdź do sugerowanego fragmentu w dokumencie',
    )
  })
})
