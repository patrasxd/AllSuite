import { describe, expect, it } from 'vitest'
import { autoformatReplacement, isBlockAutoformatTrigger } from './autoformat'
import {
  lineSpacingToTwips,
  parseParagraphValue,
  parseTabStops,
  pointsToTwips,
  stepIndent,
  twipsToLineSpacing,
  twipsToPoints,
} from './paragraph'

describe('paragraph formatting helpers', () => {
  it('maps point spacing and indents to OOXML twips in both directions', () => {
    expect(pointsToTwips(12.5)).toBe(250)
    expect(twipsToPoints(250)).toBe(12.5)
    expect(lineSpacingToTwips(1.15)).toBe(276)
    expect(twipsToLineSpacing(276)).toBe(1.15)
    expect(stepIndent(18, 1)).toBe(27)
    expect(stepIndent(0, -1)).toBe(0)
  })

  it('validates custom paragraph values and sorted tab stops', () => {
    expect(parseParagraphValue(' 12,5 ')).toBe(12.5)
    expect(parseParagraphValue('-1')).toBeNull()
    expect(parseTabStops('144, 72, 144')).toEqual([72, 144])
    expect(parseTabStops('72, wrong')).toBeNull()
  })
})

describe('language-aware autoformat', () => {
  it('creates language-aware quotes', () => {
    expect(autoformatReplacement('', '"', 'pl')).toEqual({ deleteBefore: 0, insert: '„' })
    expect(autoformatReplacement('tekst', '"', 'pl')).toEqual({ deleteBefore: 0, insert: '”' })
    expect(autoformatReplacement('', '"', 'en')).toEqual({ deleteBefore: 0, insert: '“' })
    expect(autoformatReplacement('text', '"', 'en')).toEqual({ deleteBefore: 0, insert: '”' })
  })

  it('creates en/em dashes and ellipses and recognizes structural triggers', () => {
    expect(autoformatReplacement('-', '-', 'en')).toEqual({ deleteBefore: 1, insert: '–' })
    expect(autoformatReplacement('–', '-', 'en')).toEqual({ deleteBefore: 1, insert: '—' })
    expect(autoformatReplacement('..', '.', 'en')).toEqual({ deleteBefore: 2, insert: '…' })
    expect(isBlockAutoformatTrigger('1.', ' ')).toBe(true)
    expect(isBlockAutoformatTrigger('-', ' ')).toBe(true)
    expect(isBlockAutoformatTrigger('###', ' ')).toBe(true)
    expect(isBlockAutoformatTrigger('text', ' ')).toBe(false)
  })
})
