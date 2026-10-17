export type DocumentLanguageChoice = 'en' | 'pl' | 'other'

export function normalizeDocumentLanguage(value: string | undefined, fallback?: string) {
  const candidate = value?.trim().replaceAll('_', '-')
  if (candidate && /^[a-z]{2,8}(?:-[a-z0-9]{1,8})*$/i.test(candidate)) return candidate
  return fallback
}

export function documentLanguageChoice(value: string | undefined, fallback: 'en' | 'pl'): DocumentLanguageChoice {
  const language = normalizeDocumentLanguage(value, fallback)!
  if (/^en(?:-|$)/i.test(language)) return 'en'
  if (/^pl(?:-|$)/i.test(language)) return 'pl'
  return 'other'
}
