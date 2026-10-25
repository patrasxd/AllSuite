import type { DateSystem } from './types'

/** Shared by XLSX decoding and literal-operation preflight. */
export function isDateFormat(format: string, id = 0): boolean {
  if (
    [
      14, 15, 16, 17, 18, 19, 20, 21, 22, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 45, 46, 47, 50, 51, 52, 53, 54, 55,
      56, 57, 58,
    ].includes(id)
  )
    return true
  const clean = format
    .replace(/"[^"]*"/g, '')
    .replace(/\\./g, '')
    .replace(/\[[^\]]*\]/g, (part) => (/^\[(?:h+|m+|s+)\]$/i.test(part) ? part : ''))
  return /[ydhs]/i.test(clean) || /m{1,4}/i.test(clean)
}

const DAY_MS = 86_400_000
const EXCEL_1900_EPOCH_UTC = Date.UTC(1899, 11, 31)
const EXCEL_1904_EPOCH_UTC = Date.UTC(1904, 0, 1)
const MARCH_1_1900_UTC = Date.UTC(1900, 2, 1)

export interface DateSerialParts {
  year: number
  month: number
  day: number
  millisecondsOfDay: number
  /** Excel's 1900 date system includes the nonexistent 1900-02-29 at serial 60. */
  fictitious1900LeapDay: boolean
}

export function dateToSerial(date: Date, dateSystem: DateSystem): number {
  const timestamp = date.getTime()
  if (!Number.isFinite(timestamp)) throw new RangeError('Date must be valid.')
  const epoch = dateSystem === '1900' ? EXCEL_1900_EPOCH_UTC : EXCEL_1904_EPOCH_UTC
  if (timestamp < epoch) throw new RangeError(`Date precedes the ${dateSystem} workbook date system.`)
  let serial = (timestamp - epoch) / DAY_MS
  if (dateSystem === '1900' && timestamp >= MARCH_1_1900_UTC) serial += 1
  return serial
}

export function serialToDateParts(serial: number, dateSystem: DateSystem): DateSerialParts {
  if (!Number.isFinite(serial) || serial < 0) throw new RangeError('Date serial must be a finite non-negative number.')
  const wholeDays = Math.floor(serial)
  const fractionalDay = serial - wholeDays
  const millisecondsOfDay = Math.floor(fractionalDay * DAY_MS)
  if (dateSystem === '1900' && wholeDays === 60) {
    return { year: 1900, month: 2, day: 29, millisecondsOfDay, fictitious1900LeapDay: true }
  }
  const adjustedDays = dateSystem === '1900' && wholeDays > 60 ? wholeDays - 1 : wholeDays
  const epoch = dateSystem === '1900' ? EXCEL_1900_EPOCH_UTC : EXCEL_1904_EPOCH_UTC
  const date = new Date(epoch + adjustedDays * DAY_MS)
  if (!Number.isFinite(date.getTime())) throw new RangeError('Date serial exceeds the supported calendar range.')
  return {
    year: date.getUTCFullYear(),
    month: date.getUTCMonth() + 1,
    day: date.getUTCDate(),
    millisecondsOfDay,
    fictitious1900LeapDay: false,
  }
}
