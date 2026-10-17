import { isValidElement } from 'react'
import { describe, expect, it } from 'vitest'
import { metadata } from './metadata'

describe('Draft metadata', () => {
  it('provides an identifiable, bilingual catalog entry', () => {
    expect(metadata.slug).toBe('draft')
    expect(metadata.category).toBe('documents')
    expect(isValidElement(metadata.icon)).toBe(true)
    for (const locale of ['en', 'pl'] as const) {
      expect(metadata.name[locale]).toBe('Draft')
      expect(metadata.description[locale].length).toBeGreaterThan(0)
      expect(metadata.tags[locale]).not.toHaveLength(0)
    }
  })
})
