import { describe, expect, it } from 'vitest'
import { findTextMatches, isLikelyUnsafeRegex, MAX_SEARCH_MATCHES } from './search'

const defaults = { caseSensitive: false, wholeWord: false, regex: false }

describe('safe find engine', () => {
  it('supports case sensitivity and Unicode whole-word boundaries', () => {
    expect(findTextMatches('Żółw żółw żółwik', 'żółw', defaults).matches).toHaveLength(3)
    expect(findTextMatches('Żółw żółw żółwik', 'żółw', { ...defaults, wholeWord: true }).matches).toHaveLength(2)
    expect(findTextMatches('Żółw żółw', 'żółw', { ...defaults, caseSensitive: true }).matches).toHaveLength(1)
  })

  it('reports invalid and potentially catastrophic regular expressions safely', () => {
    expect(findTextMatches('text', '[', { ...defaults, regex: true }).error).toBe('invalid')
    expect(isLikelyUnsafeRegex('(a+)+$')).toBe(true)
    expect(findTextMatches('a'.repeat(10000), '(a+)+$', { ...defaults, regex: true }).error).toBe('unsafe')
  })

  it('limits the number of matches and handles zero-length regex matches', () => {
    const limited = findTextMatches('a '.repeat(MAX_SEARCH_MATCHES + 20), 'a', defaults)
    expect(limited.matches).toHaveLength(MAX_SEARCH_MATCHES)
    expect(limited.truncated).toBe(true)
    expect(findTextMatches('abc', '^|$', { ...defaults, regex: true }).matches).toHaveLength(2)
  })
})
