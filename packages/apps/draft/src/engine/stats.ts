export type TextStatistics = {
  words: number
  charactersWithSpaces: number
  charactersWithoutSpaces: number
}

const wordPattern = /[\p{L}\p{M}\p{N}]+(?:[-‐‑‒–—'][\p{L}\p{M}\p{N}]+)*/gu

export function countText(text: string): TextStatistics {
  return {
    words: text.match(wordPattern)?.length || 0,
    charactersWithSpaces: Array.from(text).length,
    charactersWithoutSpaces: Array.from(text).filter((character) => !/\s/u.test(character)).length,
  }
}
