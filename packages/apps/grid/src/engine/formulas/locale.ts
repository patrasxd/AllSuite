import type { Locale } from '../../types'

/** Functions verified by the Grid calculation adapter. Keep aliases in sync with its allowlist. */
export const SUPPORTED_FORMULA_FUNCTIONS = [
  'ABS',
  'AND',
  'AVERAGE',
  'CONCAT',
  'CONCATENATE',
  'COUNT',
  'COUNTA',
  'COUNTIF',
  'COUNTIFS',
  'DATE',
  'DAY',
  'IF',
  'IFERROR',
  'INDEX',
  'LEFT',
  'LEN',
  'MATCH',
  'MAX',
  'MID',
  'MIN',
  'MONTH',
  'NOT',
  'NOW',
  'OR',
  'RIGHT',
  'ROUND',
  'SUM',
  'SUMIF',
  'SUMIFS',
  'TODAY',
  'TRIM',
  'VLOOKUP',
  'XLOOKUP',
  'YEAR',
] as const

export type SupportedFormulaFunction = (typeof SUPPORTED_FORMULA_FUNCTIONS)[number]

const POLISH_NAMES: Record<SupportedFormulaFunction, string> = {
  ABS: 'MODUŁ.LICZBY',
  AND: 'ORAZ',
  AVERAGE: 'ŚREDNIA',
  CONCAT: 'ZŁĄCZ.TEKST',
  CONCATENATE: 'ZŁĄCZ.TEKSTY',
  COUNT: 'ILE.LICZB',
  COUNTA: 'ILE.NIEPUSTYCH',
  COUNTIF: 'LICZ.JEŻELI',
  COUNTIFS: 'LICZ.WARUNKI',
  DATE: 'DATA',
  DAY: 'DZIEŃ',
  IF: 'JEŻELI',
  IFERROR: 'JEŻELI.BŁĄD',
  INDEX: 'INDEKS',
  LEFT: 'LEWY',
  LEN: 'DŁ',
  MATCH: 'PODAJ.POZYCJĘ',
  MAX: 'MAX',
  MID: 'FRAGMENT.TEKSTU',
  MIN: 'MIN',
  MONTH: 'MIESIĄC',
  NOT: 'NIE',
  NOW: 'TERAZ',
  OR: 'LUB',
  RIGHT: 'PRAWY',
  ROUND: 'ZAOKR',
  SUM: 'SUMA',
  SUMIF: 'SUMA.JEŻELI',
  SUMIFS: 'SUMA.WARUNKÓW',
  TODAY: 'DZIŚ',
  TRIM: 'USUŃ.ZBĘDNE.ODSTĘPY',
  VLOOKUP: 'WYSZUKAJ.PIONOWO',
  XLOOKUP: 'X.WYSZUKAJ',
  YEAR: 'ROK',
}

const ALIAS_TO_CANONICAL = new Map<string, SupportedFormulaFunction>()
for (const canonical of SUPPORTED_FORMULA_FUNCTIONS) {
  ALIAS_TO_CANONICAL.set(canonical, canonical)
  ALIAS_TO_CANONICAL.set(POLISH_NAMES[canonical].toLocaleUpperCase('pl-PL'), canonical)
}

export interface FormulaFunctionHelp {
  canonicalName: SupportedFormulaFunction
  localizedName: string
  signature: string
  description: string
}

const SIGNATURES: Record<SupportedFormulaFunction, string> = {
  ABS: '(number)',
  AND: '(logical1, …)',
  AVERAGE: '(number1, …)',
  CONCAT: '(text1, …)',
  CONCATENATE: '(text1, …)',
  COUNT: '(value1, …)',
  COUNTA: '(value1, …)',
  COUNTIF: '(range, criteria)',
  COUNTIFS: '(criteria_range1, criteria1, …)',
  DATE: '(year, month, day)',
  DAY: '(serial_number)',
  IF: '(logical_test, value_if_true, value_if_false)',
  IFERROR: '(value, value_if_error)',
  INDEX: '(array, row_num, [column_num])',
  LEFT: '(text, [num_chars])',
  LEN: '(text)',
  MATCH: '(lookup_value, lookup_array, [match_type])',
  MAX: '(number1, …)',
  MID: '(text, start_num, num_chars)',
  MIN: '(number1, …)',
  MONTH: '(serial_number)',
  NOT: '(logical)',
  NOW: '()',
  OR: '(logical1, …)',
  RIGHT: '(text, [num_chars])',
  ROUND: '(number, num_digits)',
  SUM: '(number1, …)',
  SUMIF: '(range, criteria, [sum_range])',
  SUMIFS: '(sum_range, criteria_range1, criteria1, …)',
  TODAY: '()',
  TRIM: '(text)',
  VLOOKUP: '(lookup_value, table_array, col_index_num, [range_lookup])',
  XLOOKUP: '(lookup_value, lookup_array, return_array, …)',
  YEAR: '(serial_number)',
}

const DESCRIPTIONS: Record<Locale, Record<SupportedFormulaFunction, string>> = {
  en: {
    ABS: 'Returns a number without its sign.',
    AND: 'Returns TRUE only if every condition is true.',
    AVERAGE: 'Calculates the arithmetic mean of numbers.',
    CONCAT: 'Joins text from multiple values or ranges.',
    CONCATENATE: 'Joins text strings into one string.',
    COUNT: 'Counts cells that contain numbers.',
    COUNTA: 'Counts non-empty cells.',
    COUNTIF: 'Counts cells that match one condition.',
    COUNTIFS: 'Counts rows where all conditions match.',
    DATE: 'Builds a date from year, month, and day.',
    DAY: 'Returns the day of the month from a date.',
    IF: 'Chooses a value based on whether a condition is true or false.',
    IFERROR: 'Returns a fallback value when a formula produces an error.',
    INDEX: 'Returns the value at a specified row and column in a range.',
    LEFT: 'Returns characters from the start of text.',
    LEN: 'Counts the characters in text.',
    MATCH: 'Returns the position of a value in a range.',
    MAX: 'Returns the largest number.',
    MID: 'Returns characters from text starting at a chosen position.',
    MIN: 'Returns the smallest number.',
    MONTH: 'Returns the month number from a date.',
    NOT: 'Reverses TRUE and FALSE.',
    NOW: 'Returns the current date and time.',
    OR: 'Returns TRUE if at least one condition is true.',
    RIGHT: 'Returns characters from the end of text.',
    ROUND: 'Rounds a number to the specified number of digits.',
    SUM: 'Adds numbers.',
    SUMIF: 'Adds values that match one condition.',
    SUMIFS: 'Adds values that match multiple conditions.',
    TODAY: 'Returns the current date.',
    TRIM: 'Removes extra spaces, leaving single spaces between words.',
    VLOOKUP: 'Looks in the first column and returns a value from another column in the same row.',
    XLOOKUP: 'Finds a value in one range and returns its match from another range.',
    YEAR: 'Returns the year from a date.',
  },
  pl: {
    ABS: 'Zwraca liczbę bez znaku.',
    AND: 'Zwraca PRAWDA tylko wtedy, gdy każdy warunek jest spełniony.',
    AVERAGE: 'Oblicza średnią arytmetyczną liczb.',
    CONCAT: 'Łączy tekst z wielu wartości lub zakresów.',
    CONCATENATE: 'Łączy ciągi tekstowe w jeden.',
    COUNT: 'Zlicza komórki zawierające liczby.',
    COUNTA: 'Zlicza niepuste komórki.',
    COUNTIF: 'Zlicza komórki spełniające jeden warunek.',
    COUNTIFS: 'Zlicza wiersze spełniające wszystkie podane warunki.',
    DATE: 'Tworzy datę z roku, miesiąca i dnia.',
    DAY: 'Zwraca dzień miesiąca z podanej daty.',
    IF: 'Wybiera wartość zależnie od tego, czy warunek jest spełniony.',
    IFERROR: 'Zwraca wartość zastępczą, gdy formuła zwróci błąd.',
    INDEX: 'Zwraca wartość z podanego wiersza i kolumny zakresu.',
    LEFT: 'Zwraca znaki z początku tekstu.',
    LEN: 'Zwraca liczbę znaków w tekście.',
    MATCH: 'Zwraca pozycję wartości w zakresie.',
    MAX: 'Zwraca największą liczbę.',
    MID: 'Zwraca fragment tekstu od wskazanej pozycji.',
    MIN: 'Zwraca najmniejszą liczbę.',
    MONTH: 'Zwraca numer miesiąca z daty.',
    NOT: 'Odwraca wartość logiczną PRAWDA lub FAŁSZ.',
    NOW: 'Zwraca bieżącą datę i godzinę.',
    OR: 'Zwraca PRAWDA, gdy spełniony jest co najmniej jeden warunek.',
    RIGHT: 'Zwraca znaki z końca tekstu.',
    ROUND: 'Zaokrągla liczbę do wskazanej liczby cyfr.',
    SUM: 'Dodaje liczby.',
    SUMIF: 'Dodaje wartości spełniające jeden warunek.',
    SUMIFS: 'Dodaje wartości spełniające wiele warunków.',
    TODAY: 'Zwraca bieżącą datę.',
    TRIM: 'Usuwa nadmiarowe spacje, pozostawiając pojedyncze między wyrazami.',
    VLOOKUP: 'Szuka w pierwszej kolumnie i zwraca wartość z innej kolumny tego samego wiersza.',
    XLOOKUP: 'Wyszukuje wartość w jednym zakresie i zwraca odpowiadającą jej wartość z innego.',
    YEAR: 'Zwraca rok z daty.',
  },
}

export function getFormulaFunctionHelp(locale: Locale): FormulaFunctionHelp[] {
  return SUPPORTED_FORMULA_FUNCTIONS.map((canonicalName) => ({
    canonicalName,
    localizedName: locale === 'pl' ? POLISH_NAMES[canonicalName] : canonicalName,
    signature: SIGNATURES[canonicalName],
    description: DESCRIPTIONS[locale][canonicalName],
  }))
}

type TokenKind = 'space' | 'string' | 'sheet' | 'error' | 'number' | 'identifier' | 'punctuation'
interface Token {
  kind: TokenKind
  text: string
}

export interface FormulaLocaleResult {
  canonicalExpression: string
  supportedSyntax: boolean
  detectedLocale: Locale
  unsupportedReason?: 'unknown-function' | 'array-constant' | 'opaque-reference' | 'malformed-token'
}

/**
 * Converts only lexed function-name, argument-separator and numeric-literal tokens.
 * Quoted strings/sheets and every unsupported expression are returned byte-for-byte.
 */
export function canonicalizeFormulaInput(source: string, uiLocale: Locale): FormulaLocaleResult {
  const initialTokens = tokenize(source, false)
  if (!initialTokens) return unchanged(source, uiLocale, 'malformed-token')

  const hasSemicolon = initialTokens.some((token) => token.kind === 'punctuation' && token.text === ';')
  const hasPolishFunction = findFunctionTokens(initialTokens).some((token) => {
    const alias = ALIAS_TO_CANONICAL.get(token.text.toLocaleUpperCase('pl-PL'))
    return alias !== undefined && token.text.toLocaleUpperCase('pl-PL') !== alias
  })
  const hasFunction = findFunctionTokens(initialTokens).length > 0
  const decimalFormula = !hasFunction && /\d,\d/u.test(source)
  const detectedLocale: Locale =
    hasSemicolon || hasPolishFunction || (decimalFormula && uiLocale === 'pl') ? 'pl' : 'en'
  const tokens = detectedLocale === 'pl' ? tokenize(source, true) : initialTokens
  if (!tokens) return unchanged(source, detectedLocale, 'malformed-token')

  if (tokens.some((token) => token.kind === 'punctuation' && (token.text === '{' || token.text === '}'))) {
    return unchanged(source, detectedLocale, 'array-constant')
  }
  if (tokens.some((token) => token.kind === 'punctuation' && (token.text === '[' || token.text === ']'))) {
    return unchanged(source, detectedLocale, 'opaque-reference')
  }
  if (!hasBalancedParentheses(tokens)) return unchanged(source, detectedLocale, 'malformed-token')

  const functionIndexes = new Set(findFunctionTokenIndexes(tokens))
  const replacements = new Map<number, string>()
  for (const index of functionIndexes) {
    const token = tokens[index]
    const canonical = ALIAS_TO_CANONICAL.get(token.text.toLocaleUpperCase('pl-PL'))
    if (!canonical) return unchanged(source, detectedLocale, 'unknown-function')
    replacements.set(index, canonical)
  }

  const canonicalExpression = tokens
    .map((token, index) => {
      if (replacements.has(index)) return replacements.get(index)!
      if (detectedLocale === 'pl' && token.kind === 'punctuation' && token.text === ';') return ','
      if (detectedLocale === 'pl' && token.kind === 'number') return token.text.replace(',', '.')
      return token.text
    })
    .join('')

  return { canonicalExpression, supportedSyntax: true, detectedLocale }
}

function unchanged(
  source: string,
  detectedLocale: Locale,
  unsupportedReason: FormulaLocaleResult['unsupportedReason'],
): FormulaLocaleResult {
  return { canonicalExpression: source, supportedSyntax: false, detectedLocale, unsupportedReason }
}

function findFunctionTokens(tokens: Token[]): Token[] {
  return findFunctionTokenIndexes(tokens).map((index) => tokens[index])
}

function findFunctionTokenIndexes(tokens: Token[]): number[] {
  const indexes: number[] = []
  for (let index = 0; index < tokens.length; index += 1) {
    if (tokens[index].kind !== 'identifier') continue
    let next = index + 1
    while (tokens[next]?.kind === 'space') next += 1
    if (tokens[next]?.kind === 'punctuation' && tokens[next].text === '(') indexes.push(index)
  }
  return indexes
}

function hasBalancedParentheses(tokens: Token[]): boolean {
  let depth = 0
  for (const token of tokens) {
    if (token.kind !== 'punctuation') continue
    if (token.text === '(') depth += 1
    if (token.text === ')') {
      depth -= 1
      if (depth < 0) return false
    }
  }
  return depth === 0
}

function tokenize(source: string, decimalComma: boolean): Token[] | null {
  const tokens: Token[] = []
  let index = 0
  while (index < source.length) {
    const rest = source.slice(index)
    const character = source[index]
    if (/\s/u.test(character)) {
      const match = /^\s+/u.exec(rest)![0]
      tokens.push({ kind: 'space', text: match })
      index += match.length
      continue
    }
    if (character === '"' || character === "'") {
      const quote = character
      const kind = quote === '"' ? 'string' : 'sheet'
      let cursor = index + 1
      let closed = false
      while (cursor < source.length) {
        if (source[cursor] !== quote) {
          cursor += 1
          continue
        }
        if (source[cursor + 1] === quote) {
          cursor += 2
          continue
        }
        cursor += 1
        closed = true
        break
      }
      if (!closed) return null
      tokens.push({ kind, text: source.slice(index, cursor) })
      index = cursor
      continue
    }
    const error = /^#[\p{L}\d]+(?:\/[\p{L}\d]+)*[!?]?/iu.exec(rest)
    if (character === '#' && error) {
      tokens.push({ kind: 'error', text: error[0] })
      index += error[0].length
      continue
    }
    if (/\d/u.test(character) || (character === '.' && /\d/u.test(source[index + 1] ?? ''))) {
      let cursor = index
      if (character !== '.') while (/\d/u.test(source[cursor] ?? '')) cursor += 1
      if (source[cursor] === '.' && /\d/u.test(source[cursor + 1] ?? '')) {
        cursor += 1
        while (/\d/u.test(source[cursor] ?? '')) cursor += 1
      } else if (decimalComma && source[cursor] === ',' && /\d/u.test(source[cursor + 1] ?? '')) {
        cursor += 1
        while (/\d/u.test(source[cursor] ?? '')) cursor += 1
      }
      if (/[eE]/u.test(source[cursor] ?? '') && /[+-]?\d/u.test(source.slice(cursor + 1, cursor + 3))) {
        cursor += 1
        if (/[+-]/u.test(source[cursor] ?? '')) cursor += 1
        while (/\d/u.test(source[cursor] ?? '')) cursor += 1
      }
      tokens.push({ kind: 'number', text: source.slice(index, cursor) })
      index = cursor
      continue
    }
    if (/[\p{L}_\\]/u.test(character)) {
      const match = /^[\p{L}_\\][\p{L}\p{M}\p{N}_.\\]*/u.exec(rest)![0]
      tokens.push({ kind: 'identifier', text: match })
      index += match.length
      continue
    }
    const operator = /^(?:<=|>=|<>|!=|==)/u.exec(rest)?.[0]
    const punctuation = operator ?? character
    tokens.push({ kind: 'punctuation', text: punctuation })
    index += punctuation.length
  }
  return tokens
}
