export interface SearchOptions {
  caseSensitive: boolean
  wholeWord: boolean
  regex: boolean
}

export interface TextMatch {
  from: number
  to: number
  text: string
}

export interface SearchResult {
  matches: TextMatch[]
  error?: 'invalid' | 'unsafe' | 'timeout'
  truncated: boolean
}

export const MAX_SEARCH_MATCHES = 1000
const MAX_PATTERN_LENGTH = 256
const SEARCH_BUDGET_MS = 40

function escapeRegex(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function isWordCharacter(value: string | undefined) {
  return Boolean(value && /[\p{L}\p{M}\p{N}_]/u.test(value))
}

export function isLikelyUnsafeRegex(pattern: string) {
  if (pattern.length > MAX_PATTERN_LENGTH || /\\[1-9]/u.test(pattern)) return true
  if (/\([^)]*(?:[+*]|\{\d+,?\d*\})[^)]*\)\s*(?:[+*]|\{\d+,?\d*\})/u.test(pattern)) return true
  if (/(?:\.\*|\.\+)(?:[^|]{0,64})(?:\.\*|\.\+)/u.test(pattern)) return true
  return false
}

export function findTextMatches(text: string, query: string, options: SearchOptions): SearchResult {
  if (!query) return { matches: [], truncated: false }
  if (options.regex && isLikelyUnsafeRegex(query)) return { matches: [], error: 'unsafe', truncated: false }
  let expression: RegExp
  try {
    expression = new RegExp(options.regex ? query : escapeRegex(query), options.caseSensitive ? 'gu' : 'giu')
  } catch {
    return { matches: [], error: 'invalid', truncated: false }
  }
  const matches: TextMatch[] = []
  const deadline = Date.now() + SEARCH_BUDGET_MS
  let match: RegExpExecArray | null
  while ((match = expression.exec(text))) {
    if (Date.now() > deadline) return { matches, error: 'timeout', truncated: true }
    const from = match.index
    const to = from + match[0].length
    const wholeWord = !options.wholeWord || (!isWordCharacter(text[from - 1]) && !isWordCharacter(text[to]))
    if (wholeWord) matches.push({ from, to, text: match[0] })
    if (matches.length >= MAX_SEARCH_MATCHES) return { matches, truncated: true }
    if (!match[0].length) expression.lastIndex += 1
  }
  return { matches, truncated: false }
}
