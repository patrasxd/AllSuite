import { MAX_COLUMNS, MAX_ROWS, type CellAddress, type CellRange } from './types'

export class AddressError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'AddressError'
  }
}

export interface SheetQualifiedAddress {
  sheetName: string
  range: CellRange
}

export function assertCellAddress(address: CellAddress): void {
  if (!Number.isInteger(address.row) || address.row < 1 || address.row > MAX_ROWS) {
    throw new AddressError(`Row must be an integer between 1 and ${MAX_ROWS}.`)
  }
  if (!Number.isInteger(address.column) || address.column < 1 || address.column > MAX_COLUMNS) {
    throw new AddressError(`Column must be an integer between 1 and ${MAX_COLUMNS}.`)
  }
}

export function columnNumberToName(column: number): string {
  if (!Number.isInteger(column) || column < 1 || column > MAX_COLUMNS) {
    throw new AddressError(`Column must be an integer between 1 and ${MAX_COLUMNS}.`)
  }
  let value = column
  let result = ''
  while (value > 0) {
    const remainder = (value - 1) % 26
    result = String.fromCharCode(65 + remainder) + result
    value = Math.floor((value - 1) / 26)
  }
  return result
}

export function columnNameToNumber(name: string): number {
  if (!/^[A-Za-z]{1,3}$/.test(name)) throw new AddressError(`Invalid column name: ${name}`)
  let result = 0
  for (const character of name.toUpperCase()) result = result * 26 + character.charCodeAt(0) - 64
  if (result > MAX_COLUMNS) throw new AddressError(`Column must not exceed ${MAX_COLUMNS}.`)
  return result
}

export function parseCellAddress(input: string): CellAddress {
  const match = /^(\$?)([A-Za-z]{1,3})(\$?)([1-9]\d*)$/.exec(input.trim())
  if (!match) throw new AddressError(`Invalid cell address: ${input}`)
  const address: CellAddress = {
    column: columnNameToNumber(match[2]),
    row: Number(match[4]),
    absoluteColumn: match[1] === '$',
    absoluteRow: match[3] === '$',
  }
  assertCellAddress(address)
  return address
}

export function formatCellAddress(address: CellAddress): string {
  assertCellAddress(address)
  return `${address.absoluteColumn ? '$' : ''}${columnNumberToName(address.column)}${address.absoluteRow ? '$' : ''}${address.row}`
}

export function cellAddressKey(address: CellAddress): string {
  assertCellAddress(address)
  return `${columnNumberToName(address.column)}${address.row}`
}

export function parseRangeAddress(input: string): CellRange {
  const parts = input.trim().split(':')
  if (parts.length < 1 || parts.length > 2 || parts.some((part) => !part)) {
    throw new AddressError(`Invalid cell range: ${input}`)
  }
  const start = parseCellAddress(parts[0])
  const end = parts.length === 2 ? parseCellAddress(parts[1]) : { ...start }
  if (start.row > end.row || start.column > end.column) {
    throw new AddressError('Range start must be above and to the left of its end.')
  }
  return { start, end }
}

export function formatRangeAddress(range: CellRange): string {
  assertCellAddress(range.start)
  assertCellAddress(range.end)
  if (range.start.row > range.end.row || range.start.column > range.end.column) {
    throw new AddressError('Range start must be above and to the left of its end.')
  }
  const start = formatCellAddress(range.start)
  const end = formatCellAddress(range.end)
  return start === end ? start : `${start}:${end}`
}

function findUnquotedBang(input: string): number {
  let quoted = false
  let bang = -1
  for (let index = 0; index < input.length; index += 1) {
    const character = input[index]
    if (character === "'") {
      if (quoted && input[index + 1] === "'") {
        index += 1
        continue
      }
      quoted = !quoted
    } else if (character === '!' && !quoted) {
      if (bang !== -1) throw new AddressError(`Invalid sheet-qualified address: ${input}`)
      bang = index
    }
  }
  if (quoted) throw new AddressError('Unclosed quoted sheet name.')
  return bang
}

export function parseSheetQualifiedAddress(input: string): SheetQualifiedAddress {
  const bang = findUnquotedBang(input)
  if (bang <= 0 || bang === input.length - 1 || input.indexOf('!', bang + 1) !== -1) {
    throw new AddressError(`Invalid sheet-qualified address: ${input}`)
  }
  const rawSheet = input.slice(0, bang)
  let sheetName: string
  if (rawSheet.startsWith("'")) {
    if (!/^'(?:[^']|'')*'$/.test(rawSheet)) throw new AddressError('Invalid quoted sheet name.')
    sheetName = rawSheet.slice(1, -1).replace(/''/g, "'")
  } else {
    if (!/^[A-Za-z_][A-Za-z0-9_.]*$/.test(rawSheet))
      throw new AddressError('Sheet names with spaces or punctuation must be quoted.')
    sheetName = rawSheet
  }
  assertSheetName(sheetName)
  return { sheetName, range: parseRangeAddress(input.slice(bang + 1)) }
}

export function formatSheetQualifiedAddress(sheetName: string, range: CellRange): string {
  assertSheetName(sheetName)
  const sheetPart = /^[A-Za-z_][A-Za-z0-9_.]*$/.test(sheetName) ? sheetName : `'${sheetName.replace(/'/g, "''")}'`
  return `${sheetPart}!${formatRangeAddress(range)}`
}

function assertSheetName(name: string): void {
  if (
    !name.trim() ||
    [...name].some((character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127) ||
    name.length > 31 ||
    /[:\\/?*]/.test(name) ||
    name.includes('[') ||
    name.includes(']') ||
    name.startsWith("'") ||
    name.endsWith("'")
  ) {
    throw new AddressError('Sheet names must be 1–31 characters and cannot contain : \\ / ? * [ ] or edge apostrophes.')
  }
}

export function compareCellAddresses(left: CellAddress, right: CellAddress): number {
  return left.row === right.row ? left.column - right.column : left.row - right.row
}

export function isAddressInRange(address: CellAddress, range: CellRange): boolean {
  return (
    address.row >= range.start.row &&
    address.row <= range.end.row &&
    address.column >= range.start.column &&
    address.column <= range.end.column
  )
}

export function rangesOverlap(left: CellRange, right: CellRange): boolean {
  return !(
    left.end.row < right.start.row ||
    right.end.row < left.start.row ||
    left.end.column < right.start.column ||
    right.end.column < left.start.column
  )
}
