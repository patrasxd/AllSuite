import type { DateSystem } from './types'

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
