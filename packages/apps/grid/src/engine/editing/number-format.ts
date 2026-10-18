import type { Locale } from '../../types'

export type NumberFormatKey =
  'general' | 'integer' | 'number' | 'pln' | 'eur' | 'usd' | 'accounting' | 'percent' | 'date' | 'time'

/** OOXML format codes are locale neutral; Intl supplies the active display separators. */
export const NUMBER_FORMAT_PRESETS: Record<NumberFormatKey, string | undefined> = {
  general: undefined,
  integer: '#,##0',
  number: '#,##0.00',
  pln: '"PLN" #,##0.00;("PLN" #,##0.00)',
  eur: '€ #,##0.00;(€ #,##0.00)',
  usd: '$#,##0.00;($#,##0.00)',
  accounting: '"PLN" #,##0.00;("PLN" #,##0.00);–',
  percent: '0.00%',
  date: 'yyyy-mm-dd',
  time: 'hh:mm:ss',
}

export function isDateNumberFormat(format: string | undefined): boolean {
  if (!format) return false
  const section = splitSections(format)[0] ?? format
  const placeholders = stripLiterals(section).replace(/\[[^\]]*\]/gu, '')
  return /[ymdhs]/iu.test(placeholders)
}

/** Formats a numeric value without changing the stored number. Unrecognized masks safely use General. */
export function formatNumberByPattern(value: number, format: string | undefined, locale: Locale): string {
  if (!Number.isFinite(value)) return String(value)
  const sections = format ? splitSections(format) : []
  const section = sections[0]
  if (!section || /^general$/iu.test(section.trim())) {
    return new Intl.NumberFormat(locale, { maximumSignificantDigits: 15, useGrouping: false }).format(value)
  }

  const formatSection = value < 0 ? (sections[1] ?? section) : value === 0 ? (sections[2] ?? section) : section
  const unquoted = stripLiterals(formatSection)
  if (/\[(?:>=|<=|>|<|=)/u.test(formatSection) || /E[+-]?0/iu.test(unquoted) || /,\s*$/u.test(unquoted)) {
    return generalNumber(value, locale)
  }
  if (!/[0#?]/u.test(unquoted)) {
    if (value === 0 && sections[2] === formatSection) return cleanLiteral(formatSection) || generalNumber(value, locale)
    return generalNumber(value, locale)
  }

  const positivePattern = stripLiterals(formatSection)
  if (!/^[0#?,.%+\-()€$£zł\s]*$/iu.test(positivePattern)) return generalNumber(value, locale)
  const decimal = /\.([0#?]+)/u.exec(positivePattern)?.[1]
  const minFractionDigits = decimal ? [...decimal].filter((digit) => digit === '0').length : 0
  const maxFractionDigits = decimal?.length ?? 0
  const integerPattern = positivePattern.split('.')[0]
  const minimumIntegerDigits = [...integerPattern].filter((digit) => digit === '0').length
  const grouping = /#,##|0,0/u.test(integerPattern)
  const percent = /%/u.test(positivePattern)
  const currency = findCurrency(formatSection)
  const useCurrency = Boolean(currency)
  const options: Intl.NumberFormatOptions = {
    useGrouping: grouping,
    minimumIntegerDigits: Math.max(1, Math.min(21, minimumIntegerDigits)),
    minimumFractionDigits: minFractionDigits,
    maximumFractionDigits: Math.max(minFractionDigits, Math.min(20, maxFractionDigits)),
    ...(percent ? { style: 'percent' as const } : {}),
    ...(useCurrency && !percent ? { style: 'currency' as const, currency: currency! } : {}),
  }

  let output: string
  try {
    output = new Intl.NumberFormat(locale, options).format(Math.abs(value))
  } catch {
    return generalNumber(value, locale)
  }

  const [prefix, suffix] = literalsAroundPlaceholders(formatSection)
  if (prefix && !currency) output = `${prefix}${output}`
  if (suffix && !percent) output = `${output}${suffix}`
  if (value < 0) {
    const negativePattern = sections[1] ?? formatSection
    const parenthesized = negativePattern.includes('(') && negativePattern.includes(')')
    output = parenthesized ? `(${output})` : `-${output}`
  }
  return output
}

export function adjustDecimalPlaces(format: string | undefined, delta: -1 | 1): string {
  const current = format && !/^general$/iu.test(format.trim()) ? format : '#,##0'
  const sections = splitSections(current)
  const next = sections.map((section) => {
    const decimal = /(\.)([0#?]+)/u.exec(section)
    if (delta > 0) {
      if (!decimal) return `${section}.0`
      return section.replace(decimal[0], `${decimal[1]}${decimal[2]}0`)
    }
    if (!decimal) return section
    const digits = decimal[2].slice(0, -1)
    return section.replace(decimal[0], digits ? `${decimal[1]}${digits}` : '')
  })
  return next.join(';')
}

function generalNumber(value: number, locale: Locale): string {
  return new Intl.NumberFormat(locale, { maximumSignificantDigits: 15, useGrouping: false }).format(value)
}

function splitSections(format: string): string[] {
  const sections: string[] = []
  let start = 0
  let quoted = false
  let bracketed = false
  for (let index = 0; index < format.length; index += 1) {
    const character = format[index]
    if (character === '"' && format[index - 1] !== '\\') quoted = !quoted
    if (!quoted && character === '[') bracketed = true
    if (!quoted && character === ']') bracketed = false
    if (character === ';' && !quoted && !bracketed) {
      sections.push(format.slice(start, index))
      start = index + 1
    }
  }
  sections.push(format.slice(start))
  return sections
}

function stripLiterals(format: string): string {
  return format
    .replace(/"(?:[^"]|"")*"/gu, '')
    .replace(/\\./gu, '')
    .replace(/\[[^\]]*\]/gu, '')
    .replace(/_.|\*./gu, '')
}

function findCurrency(format: string): 'PLN' | 'EUR' | 'USD' | undefined {
  const currencyMatch = /(?:PLN|EUR|USD)/iu.exec(format)
  if (currencyMatch) return currencyMatch[0].toUpperCase() as 'PLN' | 'EUR' | 'USD'
  if (/€|\u20ac/u.test(format)) return 'EUR'
  if (format.includes('$')) return 'USD'
  if (/zł/iu.test(format)) return 'PLN'
  return undefined
}

function literalsAroundPlaceholders(section: string): [string, string] {
  const first = section.search(/[0#?]/u)
  const last = Math.max(section.lastIndexOf('0'), section.lastIndexOf('#'), section.lastIndexOf('?'))
  if (first < 0 || last < first) return ['', '']
  return [cleanLiteral(section.slice(0, first)), cleanLiteral(section.slice(last + 1))]
}

function cleanLiteral(value: string): string {
  return value
    .replace(/\[[^\]]*\]/gu, '')
    .replace(/_.|\*./gu, '')
    .replace(/\\(.)/gu, '$1')
    .replace(/"([^"]*)"/gu, '$1')
}
