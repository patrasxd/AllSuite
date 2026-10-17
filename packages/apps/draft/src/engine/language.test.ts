import { describe, expect, it } from 'vitest'
import { documentLanguageChoice, normalizeDocumentLanguage } from './language'

describe('document language', () => {
  it('normalizes valid document language tags', () => {
    expect(normalizeDocumentLanguage(' pl_PL ')).toBe('pl-PL')
    expect(normalizeDocumentLanguage('en-US')).toBe('en-US')
    expect(normalizeDocumentLanguage('de-DE')).toBe('de-DE')
  })

  it('rejects invalid tags and uses the provided fallback', () => {
    expect(normalizeDocumentLanguage('en; onclick=x', 'pl')).toBe('pl')
    expect(normalizeDocumentLanguage('', 'en')).toBe('en')
  })

  it('groups English, Polish and other languages for the picker', () => {
    expect(documentLanguageChoice('en-GB', 'pl')).toBe('en')
    expect(documentLanguageChoice('pl-PL', 'en')).toBe('pl')
    expect(documentLanguageChoice('de-DE', 'en')).toBe('other')
  })
})
