export const DEFAULT_FONT_SIZE = 12
export const MIN_FONT_SIZE = 6
export const MAX_FONT_SIZE = 144
export const HEADING_LEVELS = [1, 2, 3, 4, 5, 6] as const
export const ALIGNMENTS = ['left', 'center', 'right', 'justify'] as const

export function parseFontSize(value: string): number | null {
  const normalized = value.trim().replace(',', '.').replace(/pt$/i, '').trim()
  if (!/^\d+(?:\.\d+)?$/.test(normalized)) return null
  const size = Number(normalized)
  return Number.isFinite(size) && size >= MIN_FONT_SIZE && size <= MAX_FONT_SIZE ? size : null
}

export function stepFontSize(current: number, direction: -1 | 1): number {
  const size = Number.isFinite(current) ? current : DEFAULT_FONT_SIZE
  return Math.min(MAX_FONT_SIZE, Math.max(MIN_FONT_SIZE, Math.round((size + direction) * 10) / 10))
}

// Normalize CRLF without ever interpreting clipboard text as HTML.
export function plainTextParagraphs(text: string) {
  return text
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((line) => ({
      type: 'paragraph',
      content: line ? [{ type: 'text', text: line }] : [],
    }))
}

export function normalizeHexColor(value: string): string | null {
  if (/^#[\da-f]{6}$/i.test(value)) return value.toLowerCase()
  if (/^#[\da-f]{3}$/i.test(value))
    return `#${value
      .slice(1)
      .split('')
      .map((part) => part + part)
      .join('')}`.toLowerCase()
  const rgb = /^rgb\(\s*(\d+),\s*(\d+),\s*(\d+)\s*\)$/i.exec(value)
  if (rgb && rgb.slice(1).every((part) => Number(part) <= 255)) {
    return `#${rgb
      .slice(1)
      .map((part) => Number(part).toString(16).padStart(2, '0'))
      .join('')}`
  }
  return null
}
