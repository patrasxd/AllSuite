import { dateToSerial, serialToDateParts } from '../workbook/dates'
import type { Cell, CellValue, DateSystem, FormulaResult } from '../workbook/types'
import { canonicalizeFormulaInput } from '../formulas/locale'
import type { Locale } from '../../types'
import { formatNumberByPattern, isDateNumberFormat } from './number-format'

const NUMBER_PATTERN = {
  en: /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/,
  pl: /^[+-]?(?:\d+(?:,\d*)?|,\d+)(?:[eE][+-]?\d+)?$/,
} satisfies Record<Locale, RegExp>

function parseDate(text: string, locale: Locale, dateSystem: DateSystem): CellValue | undefined {
  let year: number
  let month: number
  let day: number
  let numberFormat: string

  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text)
  if (iso) {
    year = Number(iso[1])
    month = Number(iso[2])
    day = Number(iso[3])
    numberFormat = 'yyyy-mm-dd'
  } else if (locale === 'pl') {
    const polish = /^(\d{1,2})\.(\d{1,2})\.(\d{4})$/.exec(text)
    if (!polish) return undefined
    day = Number(polish[1])
    month = Number(polish[2])
    year = Number(polish[3])
    numberFormat = 'dd.mm.yyyy'
  } else return undefined

  const date = new Date(0)
  date.setUTCHours(0, 0, 0, 0)
  date.setUTCFullYear(year, month - 1, day)
  if (date.getUTCFullYear() !== year || date.getUTCMonth() + 1 !== month || date.getUTCDate() !== day) return undefined

  try {
    return { kind: 'date', serial: dateToSerial(date, dateSystem), numberFormat }
  } catch {
    return undefined
  }
}

/** Infers only values whose input form is unambiguous; otherwise the exact text is retained. */
export function inferCellValue(text: string, locale: Locale, dateSystem: DateSystem): CellValue {
  if (text === '') return { kind: 'blank' }
  if (text.startsWith("'")) return { kind: 'string', value: text.slice(1) }
  if (text.startsWith('=')) {
    const localized = canonicalizeFormulaInput(text, locale)
    return {
      kind: 'formula',
      formula: {
        source: text,
        canonicalExpression: localized.canonicalExpression,
        ast: null,
        cachedResult: { kind: 'blank' },
        calculationStatus: localized.supportedSyntax ? 'stale' : 'unsupported',
      },
    }
  }

  // Whitespace is user content, including a final newline that regex `$` would otherwise accept.
  if (text.trim() !== text) return { kind: 'string', value: text }
  const booleanTokens = locale === 'pl' ? { true: 'prawda', false: 'fałsz' } : { true: 'true', false: 'false' }
  if (text.toLocaleLowerCase(locale) === booleanTokens.true) return { kind: 'boolean', value: true }
  if (text.toLocaleLowerCase(locale) === booleanTokens.false) return { kind: 'boolean', value: false }

  const date = parseDate(text, locale, dateSystem)
  if (date) return date

  if (NUMBER_PATTERN[locale].test(text)) {
    const normalized = locale === 'pl' ? text.replace(',', '.') : text
    const value = Number(normalized)
    const leadingZeroIdentifier = /^[+-]?0\d/.test(normalized)
    const unsafeInteger = Number.isInteger(value) && !Number.isSafeInteger(value)
    if (Number.isFinite(value) && !leadingZeroIdentifier && !unsafeInteger) return { kind: 'number', value }
  }

  return { kind: 'string', value: text }
}

function formatDate(serial: number, numberFormat: string | undefined, dateSystem: DateSystem, locale: Locale): string {
  const parts = serialToDateParts(serial, dateSystem)
  const defaultDate = () => {
    if (parts.fictitious1900LeapDay) return '29/02/1900'
    return new Intl.DateTimeFormat(locale, { dateStyle: 'short', timeZone: 'UTC' }).format(
      new Date(Date.UTC(parts.year, parts.month - 1, parts.day)),
    )
  }
  const mask = numberFormat?.split(';')[0]
  if (!mask || /^general$/i.test(mask)) return defaultDate()
  if (!/[ydhms]/i.test(mask)) return defaultDate()

  const date = new Date(Date.UTC(parts.year, parts.month - 1, parts.day))
  const totalSeconds = Math.floor(parts.millisecondsOfDay / 1000)
  const hour24 = Math.floor(totalSeconds / 3600)
  const minute = Math.floor((totalSeconds % 3600) / 60)
  const second = totalSeconds % 60
  const hasAmPm = /am\/pm/i.test(mask)
  const monthName = (width: 'short' | 'long') =>
    new Intl.DateTimeFormat(locale, { month: width, timeZone: 'UTC' }).format(date)
  return mask.replace(/am\/pm|yyyy|yy|mmmm|mmm|hh|h|ss|s|mm|m|dd|d/gi, (token, offset: number) => {
    const previousLetters = mask
      .slice(0, offset)
      .match(/[a-z]+/gi)
      ?.at(-1)
      ?.toLowerCase()
    const nextLetters = mask
      .slice(offset + token.length)
      .match(/[a-z]+/gi)?.[0]
      ?.toLowerCase()
    const isMinute = /^(?:mm|m)$/i.test(token) && (/h/.test(previousLetters ?? '') || /s/.test(nextLetters ?? ''))
    switch (token.toLowerCase()) {
      case 'am/pm':
        return hour24 < 12 ? 'AM' : 'PM'
      case 'yyyy':
        return String(parts.year).padStart(4, '0')
      case 'yy':
        return String(parts.year % 100).padStart(2, '0')
      case 'mmmm':
        return parts.fictitious1900LeapDay ? 'February' : monthName('long')
      case 'mmm':
        return parts.fictitious1900LeapDay ? 'Feb' : monthName('short')
      case 'mm':
        if (isMinute) return String(minute).padStart(2, '0')
        return String(parts.month).padStart(2, '0')
      case 'm':
        if (isMinute) return String(minute)
        return String(parts.month)
      case 'hh':
        return String(hasAmPm ? ((hour24 + 11) % 12) + 1 : hour24).padStart(2, '0')
      case 'h':
        return String(hasAmPm ? ((hour24 + 11) % 12) + 1 : hour24)
      case 'ss':
        return String(second).padStart(2, '0')
      case 's':
        return String(second)
      case 'dd':
        return String(parts.day).padStart(2, '0')
      default:
        return String(parts.day)
    }
  })
}

function formatResult(
  value: FormulaResult | CellValue,
  numberFormat: string | undefined,
  locale: Locale,
  dateSystem: DateSystem,
): string {
  switch (value.kind) {
    case 'blank':
      return ''
    case 'number':
      return isDateNumberFormat(numberFormat)
        ? formatDate(value.value, numberFormat, dateSystem, locale)
        : formatNumberByPattern(value.value, numberFormat, locale)
    case 'string':
      return value.value
    case 'boolean':
      return locale === 'pl' ? (value.value ? 'PRAWDA' : 'FAŁSZ') : value.value ? 'TRUE' : 'FALSE'
    case 'error':
      return value.code
    case 'date':
      return formatDate(value.serial, value.numberFormat || numberFormat, dateSystem, locale)
    case 'formula':
      return formatResult(value.formula.cachedResult, numberFormat, locale, dateSystem)
  }
}

/** Cell canvas text is the calculated/displayed value, including formula cache—not its source expression. */
export function formatCellDisplay(cell: Cell | undefined, locale: Locale, dateSystem: DateSystem): string {
  return cell ? formatResult(cell.value, cell.style?.numberFormat, locale, dateSystem) : ''
}

/** The formula bar exposes the entered expression for formulas and formatted values otherwise. */
export function getCellEntryText(cell: Cell | undefined, locale: Locale, dateSystem: DateSystem): string {
  if (!cell) return ''
  return cell.value.kind === 'formula'
    ? cell.value.formula.source
    : formatResult(cell.value, cell.style?.numberFormat, locale, dateSystem)
}

/** Returns an edit-safe representation so re-editing stored text cannot change its inferred type. */
export function getCellEditText(cell: Cell | undefined, locale: Locale, dateSystem: DateSystem): string {
  if (!cell || cell.value.kind === 'formula') return getCellEntryText(cell, locale, dateSystem)
  // Edit numeric storage, never rounded/currency/percent display text.
  if (cell.value.kind === 'number') {
    const text = String(cell.value.value)
    return locale === 'pl' ? text.replace('.', ',') : text
  }
  if (cell.value.kind !== 'string') return getCellEntryText(cell, locale, dateSystem)
  const value = cell.value.value
  const inferred = inferCellValue(value, locale, dateSystem)
  return inferred.kind === 'string' && inferred.value === value ? value : `'${value}`
}
