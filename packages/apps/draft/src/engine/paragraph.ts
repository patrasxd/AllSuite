export const DEFAULT_LINE_SPACING = 1.15
export const PARAGRAPH_STEP_PT = 9
export const MAX_PARAGRAPH_VALUE_PT = 720

export type ParagraphAttributes = {
  keepNext: boolean | null
  keepLines: boolean | null
  widowControl: boolean | null
  spacingBefore: number | null
  spacingAfter: number | null
  lineSpacing: number | null
  indentLeft: number | null
  indentRight: number | null
  indentFirstLine: number | null
  indentHanging: number | null
  tabStops: number[]
}

export const defaultParagraphAttributes: ParagraphAttributes = {
  keepNext: null,
  keepLines: null,
  widowControl: null,
  spacingBefore: null,
  spacingAfter: null,
  lineSpacing: null,
  indentLeft: null,
  indentRight: null,
  indentFirstLine: null,
  indentHanging: null,
  tabStops: [],
}

export function pointsToTwips(points: number | null | undefined) {
  return Number.isFinite(points) ? Math.round(Number(points) * 20) : undefined
}

export function twipsToPoints(twips: number | null | undefined) {
  return Number.isFinite(twips) ? Math.round((Number(twips) / 20) * 100) / 100 : undefined
}

export function lineSpacingToTwips(multiplier: number | null | undefined) {
  return Number.isFinite(multiplier) ? Math.round(Number(multiplier) * 240) : undefined
}

export function twipsToLineSpacing(twips: number | null | undefined) {
  return Number.isFinite(twips) ? Math.round((Number(twips) / 240) * 100) / 100 : undefined
}

export function parseParagraphValue(value: string, minimum = 0): number | null {
  const normalized = value.trim().replace(',', '.')
  if (!normalized) return 0
  if (!/^\d+(?:\.\d+)?$/.test(normalized)) return null
  const parsed = Number(normalized)
  if (!Number.isFinite(parsed) || parsed < minimum || parsed > MAX_PARAGRAPH_VALUE_PT) return null
  return Math.round(parsed * 100) / 100
}

export function parseTabStops(value: string): number[] | null {
  if (!value.trim()) return []
  const values = value.split(',').map((part) => parseParagraphValue(part))
  if (values.some((item) => item === null)) return null
  return [...new Set(values as number[])].sort((a, b) => a - b)
}

export function stepIndent(value: unknown, direction: -1 | 1) {
  const current = Number(value) || 0
  return Math.max(0, Math.min(MAX_PARAGRAPH_VALUE_PT, current + direction * PARAGRAPH_STEP_PT))
}
