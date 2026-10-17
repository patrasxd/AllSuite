import { describe, expect, it } from 'vitest'
import { countText } from './stats'

describe('text statistics', () => {
  it('counts Polish words, diacritics and hyphenated compounds', () => {
    expect(countText('Zażółć gęślą jaźń i biało-czerwony sztandar.')).toEqual({
      words: 6,
      charactersWithSpaces: 44,
      charactersWithoutSpaces: 39,
    })
  })

  it('counts Unicode code points with and without whitespace', () => {
    expect(countText('Ala\nma 🐈')).toEqual({ words: 2, charactersWithSpaces: 8, charactersWithoutSpaces: 6 })
    expect(countText('')).toEqual({ words: 0, charactersWithSpaces: 0, charactersWithoutSpaces: 0 })
  })
})
