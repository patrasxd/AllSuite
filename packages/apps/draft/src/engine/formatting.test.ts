import { describe, expect, it } from 'vitest'
import { normalizeHexColor, parseFontSize, plainTextParagraphs, stepFontSize } from './formatting'

describe('formatting helpers', () => {
  it('accepts point sizes and localized decimals, rejects invalid and out-of-range input', () => {
    expect(parseFontSize(' 14pt ')).toBe(14)
    expect(parseFontSize('12,5')).toBe(12.5)
    for (const invalid of ['', 'abc', '12px', 'Infinity', '-8', '5', '145', '12.3.4']) {
      expect(parseFontSize(invalid)).toBeNull()
    }
  })
  it('steps sizes without escaping bounds or accumulating floating-point drift', () => {
    expect(stepFontSize(12.5, 1)).toBe(13.5)
    expect(stepFontSize(6, -1)).toBe(6)
    expect(stepFontSize(144, 1)).toBe(144)
    expect(stepFontSize(Number.NaN, 1)).toBe(13)
  })
  it('creates literal paragraphs, including empty lines, without parsing HTML', () => {
    expect(plainTextParagraphs('<b>Text</b>\r\n\rNext')).toEqual([
      { type: 'paragraph', content: [{ type: 'text', text: '<b>Text</b>' }] },
      { type: 'paragraph', content: [] },
      { type: 'paragraph', content: [{ type: 'text', text: 'Next' }] },
    ])
  })
  it('accepts only normalized six-digit document colors', () => {
    expect(normalizeHexColor('#AABBCC')).toBe('#aabbcc')
    expect(normalizeHexColor('#abc')).toBe('#aabbcc')
    expect(normalizeHexColor('rgb(255, 0, 16)')).toBe('#ff0010')
    expect(normalizeHexColor('url(https://example.com)')).toBeNull()
  })
})
