import { WorkbookSession, createWorkbook } from '../workbook'
import {
  copyValues,
  parseDelimitedValues,
  pasteValues,
  valuesToDelimited,
  type Delimiter,
  type DelimitedTyping,
} from './clipboard'

export const DELIMITED_MAX_BYTES = 4_000_000

export function decodeDelimitedFile(bytes: Uint8Array): string {
  if (bytes.byteLength > DELIMITED_MAX_BYTES) throw new Error('File too large')
  return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
}

export function prepareDelimitedWorkbook(
  text: string,
  delimiter: Delimiter,
  skipHeader: boolean,
  typing: DelimitedTyping,
) {
  const rows = parseDelimitedValues(text.replace(/^\uFEFF/, ''), delimiter, typing)
  if (skipHeader) rows.shift()
  if (!rows.length) throw new Error('No data rows')
  const session = new WorkbookSession(createWorkbook())
  pasteValues(session, session.workbook.activeSheetId, { row: 1, column: 1 }, rows)
  return session.workbook
}

/** Explicit derived values only. Never participates in XLSX checkpoints or native source handles. */
export function exportDelimitedSheet(session: WorkbookSession, sheetId: string, delimiter: Delimiter): Uint8Array {
  const sheet = session.workbook.sheetsById.get(sheetId)
  if (!sheet) throw new Error('Missing sheet')
  const end = sheet.dimensions.usedRange?.end ?? { row: 1, column: 1 }
  const rows = copyValues(session, sheetId, [{ start: { row: 1, column: 1 }, end }])
  const text = valuesToDelimited(rows, delimiter, true)
  return new TextEncoder().encode(text)
}
