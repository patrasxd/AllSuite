import { gridCommand } from './helpers/grid-command'
import { test, expect, type Page } from '@playwright/test'
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate'
import { createWorkbook, WorkbookSession } from '../packages/apps/grid/src/engine/workbook'
import { exportXlsxWorkbook } from '../packages/apps/grid/src/engine/xlsx/export'
import { parseXlsxWorkbook } from '../packages/apps/grid/src/engine/xlsx/import'

async function select(page: Page, range: string) {
  const box = page.getByRole('textbox', { name: 'Name box' })
  await box.fill(range)
  await box.press('Enter')
}

async function fixture(firstAmount = 30) {
  const workbook = createWorkbook()
  const session = new WorkbookSession(workbook)
  const sheetId = workbook.activeSheetId
  session.setCells(sheetId, [
    { address: 'A1', value: { kind: 'string', value: 'Name' } },
    { address: 'B1', value: { kind: 'string', value: 'Amount' } },
    { address: 'A2', value: { kind: 'string', value: 'Żaneta' } },
    { address: 'B2', value: { kind: 'number', value: firstAmount } },
    { address: 'A3', value: { kind: 'string', value: 'Łucja' } },
    { address: 'B3', value: { kind: 'number', value: 10 } },
    { address: 'A4', value: { kind: 'string', value: 'Anna' } },
    { address: 'B4', value: { kind: 'number', value: 10 } },
  ])
  session.formatCells(sheetId, [
    { address: 'A3', style: { font: { bold: true }, fill: { color: '#FF0000' } } },
    { address: 'B3', style: { numberFormat: '0.00' } },
  ])
  const result = await exportXlsxWorkbook(workbook)
  expect(result.report.canSave).toBe(true)
  // Ordinary explicit-RGB fixture. The existing importer conservatively flags
  // theme/indexed colors; PP04 intentionally refuses those imported workbooks.
  const parts = unzipSync(result.bytes!)
  parts['xl/styles.xml'] = strToU8(
    strFromU8(parts['xl/styles.xml'])
      .replace(/theme="1"/g, 'rgb="FF000000"')
      .replace(/indexed="64"/g, 'rgb="FF000000"'),
  )
  return zipSync(parts)
}

async function open(page: Page, bytes: Uint8Array) {
  await page.locator('input[type="file"]').setInputFiles({
    name: 'records.xlsx',
    mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    buffer: Buffer.from(bytes),
  })
  await page
    .getByRole('dialog', { name: 'Workbook compatibility check' })
    .getByRole('button', { name: 'Open workbook', exact: true })
    .click()
}

test('PP04 keyboard range dialog sort undo redo actual XLSX bytes and fresh reopen', async ({ page }) => {
  await page.addInitScript(() =>
    Object.defineProperty(window, 'showSaveFilePicker', { configurable: true, value: undefined }),
  )
  await page.goto('./#/grid')
  await open(page, await fixture())
  await page.getByRole('button', { name: 'File', exact: true }).click()
  await select(page, 'A1:B4')
  const trigger = await gridCommand(page, 'Sort range')
  await trigger.focus()
  await trigger.press('Enter')
  const dialog = page.getByRole('dialog', { name: 'Sort range', exact: true })
  await expect(dialog).toBeVisible()
  await dialog.getByRole('combobox', { name: 'Sort column', exact: true }).selectOption('2')
  await dialog.getByRole('combobox', { name: 'First row contains headers', exact: true }).selectOption('yes')
  await dialog.getByRole('button', { name: 'Apply sort', exact: true }).press('Enter')
  await expect(page.getByRole('gridcell', { name: 'A2, Łucja', exact: true })).toBeVisible()
  const grid = page.getByRole('grid')
  await grid.press('Control+z')
  await expect(page.getByRole('gridcell', { name: 'A2, Żaneta', exact: true })).toBeVisible()
  await grid.press('Control+y')
  await expect(page.getByRole('gridcell', { name: 'A3, Anna', exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'File', exact: true }).click()
  const pending = page.waitForEvent('download')
  await (await gridCommand(page, 'Save As')).click()
  const stream = await (await pending).createReadStream()
  if (!stream) throw new Error('Missing download')
  const chunks: Buffer[] = []
  for await (const chunk of stream) chunks.push(Buffer.from(chunk))
  const bytes = Buffer.concat(chunks)
  const parts = unzipSync(bytes)
  const worksheetXml = strFromU8(parts['xl/worksheets/sheet1.xml'])
  expect(worksheetXml).toContain('Łucja')
  expect(worksheetXml).toMatch(/<row r="2"[^>]*>.*?<c r="A2"[^>]*s="\d+"[^>]*>.*?Łucja.*?<c r="B2"[^>]*>\s*<v>10<\/v>/)
  expect(worksheetXml).toMatch(/<row r="3"[^>]*>.*?Anna.*?<c r="B3"[^>]*>\s*<v>10<\/v>/)
  expect(worksheetXml).toMatch(/<row r="4"[^>]*>.*?Żaneta.*?<c r="B4"[^>]*>\s*<v>30<\/v>/)
  expect(strFromU8(parts['xl/styles.xml'])).toContain('FFFF0000')
  const parsed = await parseXlsxWorkbook('sorted.xlsx', bytes)
  const sheet = parsed.workbook!.sheetsById.get(parsed.workbook!.activeSheetId)!
  expect([1, 2, 3, 4].map((row) => sheet.cells.get(`A${row}`)?.value)).toEqual(
    ['Name', 'Łucja', 'Anna', 'Żaneta'].map((value) => ({ kind: 'string', value })),
  )
  expect([2, 3, 4].map((row) => sheet.cells.get(`B${row}`)?.value)).toEqual(
    [10, 10, 30].map((value) => ({ kind: 'number', value })),
  )
  expect(sheet.cells.get('A2')?.style?.font?.bold).toBe(true)
  expect(sheet.cells.get('A2')?.style?.fill?.color).toBe('#FF0000')
  expect(sheet.cells.get('B2')?.style?.numberFormat).toBe('0.00')
  expect(sheet.cells.get('A3')?.style?.font?.bold).not.toBe(true)
  const fresh = await page.context().newPage()
  await fresh.goto('./#/grid')
  await open(fresh, bytes)
  await expect(fresh.getByRole('gridcell', { name: 'A2, Łucja', exact: true })).toBeVisible()
  await expect(fresh.locator('[data-cell-address="A2"]')).toHaveCSS('font-weight', '700')
  await fresh.close()
})

test('PP04 cancel, descending without headers and touch-sized responsive dialog', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('./#/grid')
  await open(page, await fixture(5))
  await select(page, 'A2:B4')
  await page.getByRole('button', { name: 'File', exact: true }).click()
  // Existing toolbar pages whole groups; scroll the workbook group to reach sort on a phone.
  const trigger = await gridCommand(page, 'Sort range')
  await trigger.scrollIntoViewIfNeeded()
  await trigger.click()
  const dialog = page.getByRole('dialog', { name: 'Sort range', exact: true })
  const bounds = await dialog.boundingBox()
  expect(bounds!.x).toBeGreaterThanOrEqual(0)
  expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(390)
  for (const control of await dialog.getByRole('combobox').all()) {
    // AllUI animates dialog scale; measure the settled touch target.
    await expect.poll(async () => (await control.boundingBox())!.height).toBeGreaterThanOrEqual(44)
    const box = await control.boundingBox()
    expect(box!.height).toBeGreaterThanOrEqual(44)
    expect(box!.x + box!.width).toBeLessThanOrEqual(390)
  }
  await dialog.press('Escape')
  await expect(dialog).toBeHidden()
  await expect(page.locator('.grid-app')).not.toHaveAttribute('data-dirty', 'true')
  await expect(page.getByRole('textbox', { name: 'Name box' })).toHaveValue('A2:B4')
  await trigger.click()
  // Dialog initializes focus in requestAnimationFrame. Wait for that visible
  // contract before moving it, so initialization cannot steal the next key.
  await expect(dialog.getByRole('button', { name: 'Cancel', exact: true }).first()).toBeFocused()
  await dialog.getByRole('combobox', { name: 'Sort column', exact: true }).focus()
  await expect(dialog.getByRole('combobox', { name: 'Sort column', exact: true })).toBeFocused()
  await page.keyboard.press('End')
  await page.keyboard.press('Tab')
  await expect(dialog.getByRole('combobox', { name: 'Sort column', exact: true })).toHaveValue('2')
  await expect(dialog.getByRole('combobox', { name: 'Sort order', exact: true })).toBeFocused()
  await page.keyboard.press('End')
  await page.keyboard.press('Tab')
  await expect(dialog.getByRole('combobox', { name: 'Sort order', exact: true })).toHaveValue('descending')
  await expect(dialog.getByRole('combobox', { name: 'First row contains headers' })).toBeFocused()
  const focus = await page.locator(':focus').evaluate((element) => getComputedStyle(element).outlineStyle)
  expect(focus).not.toBe('none')
  await dialog.getByRole('button', { name: 'Apply sort', exact: true }).press('Enter')
  await expect(page.getByRole('gridcell', { name: 'A2, Łucja', exact: true })).toBeVisible()
  await expect(page.getByRole('gridcell', { name: 'A3, Anna', exact: true })).toBeVisible()
  await expect(page.getByRole('gridcell', { name: 'A4, Żaneta', exact: true })).toBeVisible()
  await expect(page.locator('.grid-app')).toHaveAttribute('data-dirty', 'true')
})

test('PP04 formulas outside range and filtered inputs refuse without mutation or history', async ({ page }) => {
  await page.addInitScript(() =>
    Object.defineProperty(window, 'showSaveFilePicker', { configurable: true, value: undefined }),
  )
  await page.goto('./#/grid')
  for (const unsafe of ['formula', 'filter']) {
    const parts = unzipSync(await fixture())
    const xml = strFromU8(parts['xl/worksheets/sheet1.xml'])
    parts['xl/worksheets/sheet1.xml'] = strToU8(
      unsafe === 'filter'
        ? xml.replace('</worksheet>', '<autoFilter ref="A1:B4"/></worksheet>')
        : xml.replace('</sheetData>', '<row r="8"><c r="Z8"><f>1+1</f><v>2</v></c></row></sheetData>'),
    )
    const bytes = zipSync(parts)
    await open(page, bytes)
    await select(page, 'A1:B4')
    await page.getByRole('button', { name: 'File', exact: true }).click()
    await (await gridCommand(page, 'Sort range')).click()
    await expect(page.getByRole('dialog', { name: 'Sort range', exact: true })).toBeHidden()
    await expect(page.getByRole('status')).toContainText('Cannot sort')
    await expect(page.getByRole('textbox', { name: 'Name box' })).toHaveValue('A1:B4')
    await expect(page.locator('.grid-app')).not.toHaveAttribute('data-dirty', 'true')
    await page.getByRole('grid').press('Control+z')
    await expect(page.getByRole('gridcell', { name: 'A2, Żaneta', exact: true })).toBeVisible()
    const pending = page.waitForEvent('download')
    await (await gridCommand(page, 'Save As')).click()
    const stream = await (await pending).createReadStream()
    if (!stream) throw new Error('Missing actual saved bytes')
    const chunks: Buffer[] = []
    for await (const chunk of stream) chunks.push(Buffer.from(chunk))
    const saved = Buffer.concat(chunks)
    // Unedited imported package takes the existing byte-exact save path.
    expect(saved).toEqual(Buffer.from(bytes))
    const parsed = await parseXlsxWorkbook('refused.xlsx', saved)
    const sheet = parsed.workbook!.sheetsById.get(parsed.workbook!.activeSheetId)!
    expect(sheet.cells.get('A2')?.value).toEqual({ kind: 'string', value: 'Żaneta' })
    expect(sheet.cells.get('A3')?.style?.font?.bold).toBe(true)
    if (unsafe === 'filter') expect(sheet.autoFilter).toBeDefined()
    else expect(sheet.cells.get('Z8')?.value.kind).toBe('formula')
  }
})

test('PP04 disjoint selection refuses and pending draft is not committed', async ({ page }) => {
  await page.goto('./#/grid')
  await open(page, await fixture())
  const grid = page.getByRole('grid')
  await page.locator('[data-cell-address="A2"]').click()
  await page.locator('[data-cell-address="B4"]').click({ modifiers: ['Control'] })
  await page.getByRole('button', { name: 'File', exact: true }).click()
  await (await gridCommand(page, 'Sort range')).click()
  await expect(page.getByRole('status')).toContainText('Cannot sort')
  await expect(page.locator('.grid-app')).not.toHaveAttribute('data-dirty', 'true')
  await select(page, 'A1:B4')
  const bar = page.getByRole('textbox', { name: 'Formula bar' })
  await bar.fill('uncommitted')
  await (await gridCommand(page, 'Sort range')).click()
  await expect(page.getByRole('dialog', { name: 'Sort range', exact: true })).toBeHidden()
  await expect(bar).toHaveValue('uncommitted')
  await bar.press('Escape')
  await expect(page.locator('.grid-app')).not.toHaveAttribute('data-dirty', 'true')
  await grid.press('Control+z')
  await expect(page.getByRole('gridcell', { name: 'B4, 10', exact: true })).toBeVisible()
})
