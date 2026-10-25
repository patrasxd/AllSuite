import { expectGridTableContext, gridCommand } from './helpers/grid-command'
import { test, expect, type Page } from '@playwright/test'
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate'
import { createWorkbook, WorkbookSession } from '../packages/apps/grid/src/engine/workbook'
import { exportXlsxWorkbook } from '../packages/apps/grid/src/engine/xlsx/export'
import { parseXlsxWorkbook } from '../packages/apps/grid/src/engine/xlsx/import'
import { tableAndNoteFixture } from '../packages/apps/grid/src/engine/xlsx/fixtures/safety-corpus'

async function fixture(badHeader = false) {
  const workbook = createWorkbook()
  const session = new WorkbookSession(workbook)
  const id = workbook.activeSheetId
  session.setCells(
    id,
    [`Name\t${badHeader ? 'name' : 'Team'}`, 'Anna\tA', 'Bob\tB', 'Anna\tB'].flatMap((line, r) =>
      line
        .split('\t')
        .map((value, c) => ({ address: `${c ? 'B' : 'A'}${r + 1}`, value: { kind: 'string' as const, value } })),
    ),
  )
  session.formatCells(id, [{ address: 'B4', style: { font: { bold: true }, fill: { color: '#FF0000' } } }])
  session.setRowMetadata(id, 2, { hidden: true })
  const saved = await exportXlsxWorkbook(workbook, 'records.xlsx')
  expect(saved.report.canSave).toBe(true)
  const parts = unzipSync(saved.bytes!)
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
async function select(page: Page, range = 'A1:B4') {
  const box = page.getByRole('textbox', { name: 'Name box' })
  await box.fill(range)
  await box.press('Enter')
}
const cell = (page: Page, address: string) => page.locator(`[data-cell-address="${address}"]`)
async function createDialog(page: Page) {
  await page.getByRole('button', { name: 'File', exact: true }).click()
  const trigger = await gridCommand(page, 'Create Table')
  await trigger.scrollIntoViewIfNeeded()
  await trigger.focus()
  await trigger.press('Enter')
  return page.getByRole('dialog', { name: 'Create Table', exact: true })
}
async function download(page: Page, path: string) {
  const pending = page.waitForEvent('download')
  await (await gridCommand(page, 'Save As')).click()
  const file = await pending
  await file.saveAs(path)
  const chunks: Buffer[] = []
  for await (const chunk of (await file.createReadStream())!) chunks.push(Buffer.from(chunk))
  return Buffer.concat(chunks)
}
test('PP06 native create filter edit download fresh reopen convert and history', async ({ page }) => {
  await page.addInitScript(() =>
    Object.defineProperty(window, 'showSaveFilePicker', { configurable: true, value: undefined }),
  )
  await page.goto('./#/grid')
  await open(page, await fixture())
  await select(page)
  const d = await createDialog(page)
  const name = d.getByRole('textbox', { name: 'Table name' })
  await name.fill('Records')
  await d.getByRole('button', { name: 'Create Table', exact: true }).focus()
  await d.getByRole('button', { name: 'Create Table', exact: true }).press('Enter')
  await expect(page.getByRole('grid')).toBeFocused()
  await expect(cell(page, 'A1')).toHaveAttribute('data-table-role', 'header')
  await expect(cell(page, 'A4')).toHaveAttribute('data-table-role', 'band')
  await expectGridTableContext(page, 'Records', 'A1:B4')
  await page.getByRole('grid').press('Control+z')
  await expect(cell(page, 'A1')).not.toHaveAttribute('data-table-role', 'header')
  await page.getByRole('grid').press('Control+y')
  await expectGridTableContext(page, 'Records', 'A1:B4')
  await (await gridCommand(page, 'AutoFilter')).click()
  const f = page.getByRole('dialog', { name: 'AutoFilter', exact: true })
  await f.getByRole('button', { name: 'Deselect all values', exact: true }).click()
  await f.getByRole('checkbox', { name: 'Anna', exact: true }).check()
  await f.getByRole('button', { name: 'Apply filter', exact: true }).click()
  await expect(cell(page, 'A3')).toHaveCount(0)
  await cell(page, 'B4').dblclick()
  await page.getByRole('textbox', { name: 'Edit cell B4', exact: true }).fill('Changed')
  await page.getByRole('textbox', { name: 'Edit cell B4', exact: true }).press('Enter')
  const bytes = await download(page, 'tmp/pp06/table.xlsx')
  const parts = unzipSync(bytes)
  const table = strFromU8(parts['xl/tables/table1.xml'])
  expect(table).toContain('displayName="Records"')
  expect(table).toContain('ref="A1:B4"')
  expect(table).toContain('<tableColumn id="1" name="Name"')
  expect(table).toContain('<filter val="Anna"')
  expect(table).toContain('tableStyleInfo')
  expect(strFromU8(parts['xl/worksheets/sheet1.xml'])).toContain('tableParts')
  expect(strFromU8(parts['xl/worksheets/sheet1.xml'])).not.toContain('<autoFilter')
  expect(strFromU8(parts['xl/worksheets/_rels/sheet1.xml.rels'])).toContain('Target="../tables/table1.xml"')
  expect(strFromU8(parts['[Content_Types].xml'])).toContain('spreadsheetml.table+xml')
  const reopened = (await parseXlsxWorkbook('table.xlsx', bytes)).workbook!
  expect(reopened.sheetsById.get(reopened.activeSheetId)!.tables[0]).toMatchObject({
    name: 'Records',
    ownership: 'simple',
  })
  const fresh = await page.context().newPage()
  await fresh.addInitScript(() =>
    Object.defineProperty(window, 'showSaveFilePicker', { configurable: true, value: undefined }),
  )
  await fresh.goto('./#/grid')
  await open(fresh, bytes)
  await expect(cell(fresh, 'A1')).toHaveAttribute('data-table-role', 'header')
  await expect(cell(fresh, 'B4')).toHaveText('Changed')
  await expect(cell(fresh, 'A2')).toHaveCount(0)
  await expect(cell(fresh, 'A3')).toHaveCount(0)
  await select(fresh)
  await expect(fresh.getByRole('textbox', { name: 'Name box' })).toHaveValue('A1:B4')
  await fresh.getByRole('button', { name: 'File', exact: true }).click()
  await expect(fresh.getByRole('textbox', { name: 'Name box' })).toHaveValue('A1:B4')
  await fresh.getByRole('tab', { name: 'Table', exact: true }).click()
  await expectGridTableContext(fresh, 'Records', 'A1:B4')
  await (await gridCommand(fresh, 'Convert to Range')).click()
  await expect(cell(fresh, 'A3')).toHaveText('Bob')
  await expect(cell(fresh, 'A2')).toHaveCount(0)
  await expect(cell(fresh, 'B4')).toHaveText('Changed')
  await expect(cell(fresh, 'B4')).toHaveCSS('font-weight', '700')
  await expect(cell(fresh, 'B4')).toHaveCSS('background-color', 'rgb(255, 0, 0)')
  await fresh.getByRole('grid').press('Control+z')
  await expect(cell(fresh, 'A1')).toHaveAttribute('data-table-role', 'header')
  await expect(cell(fresh, 'A3')).toHaveCount(0)
  await fresh.getByRole('grid').press('Control+y')
  await expect(cell(fresh, 'A1')).not.toHaveAttribute('data-table-role', 'header')
  const plain = unzipSync(await download(fresh, 'tmp/pp06/plain.xlsx'))
  expect(plain['xl/tables/table1.xml']).toBeUndefined()
  expect(plain['xl/worksheets/_rels/sheet1.xml.rels']).toBeUndefined()
  expect(strFromU8(plain['[Content_Types].xml'])).not.toContain('spreadsheetml.table+xml')
  expect(strFromU8(plain['xl/worksheets/sheet1.xml'])).not.toContain('tableParts')
  await fresh.close()
})
test('PP06 invalid headers names overlap cancellation and keyboard focus', async ({ page }) => {
  await page.goto('./#/grid')
  await open(page, await fixture(true))
  await select(page)
  let d = await createDialog(page)
  await d.getByRole('textbox', { name: 'Table name' }).fill('Records')
  await d.getByRole('button', { name: 'Create Table', exact: true }).click()
  await expect(d.getByRole('alert')).toBeVisible()
  await d.press('Escape')
  await expect(page.getByRole('grid')).toBeFocused()
  await expect(page.getByRole('textbox', { name: 'Name box' })).toHaveValue('A1:B4')
  await open(page, await fixture())
  await select(page)
  d = await createDialog(page)
  await d.getByRole('textbox', { name: 'Table name' }).fill('A1')
  await d.getByRole('button', { name: 'Create Table', exact: true }).click()
  await expect(d.getByRole('alert')).toBeVisible()
  await d.getByRole('textbox', { name: 'Table name' }).fill('Records')
  await d.getByRole('button', { name: 'Create Table', exact: true }).click()
  d = await createDialog(page)
  await d.getByRole('textbox', { name: 'Table name' }).fill('Other')
  await d.getByRole('button', { name: 'Create Table', exact: true }).click()
  await expect(d.getByRole('alert')).toBeVisible()
  await d.press('Escape')
  await expectGridTableContext(page, 'Records', 'A1:B4')
})
test('PP06 protects imported complex table and note from authoring or conversion', async ({ page }) => {
  await page.goto('./#/grid')
  await open(page, tableAndNoteFixture())
  await select(page)
  const d = await createDialog(page)
  await d.getByRole('textbox', { name: 'Table name' }).fill('Records')
  await d.getByRole('button', { name: 'Create Table', exact: true }).click()
  await expect(d.getByRole('alert')).toBeVisible()
  await d.press('Escape')
  await expect(d).toHaveCount(0)
  await expect(page.getByRole('grid')).toBeFocused()
  await select(page, 'A1')
  await (await gridCommand(page, 'Convert to Range')).click()
  await expect(page.getByRole('button', { name: 'Convert to Range', exact: true })).toBeVisible()
  await expect(cell(page, 'A1')).not.toHaveAttribute('data-table-role', 'header')
})

test('PP06 Polish table dialog keyboard navigation and focus restoration', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('allsuite:locale', 'pl'))
  await page.goto('./#/grid')
  await page.locator('input[type="file"]').setInputFiles({
    name: 'records.xlsx',
    mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    buffer: Buffer.from(await fixture()),
  })
  await page.getByRole('dialog').getByRole('button', { name: 'Otwórz skoroszyt', exact: true }).click()
  const box = page.locator('.grid-name-box input')
  await box.fill('A1:B4')
  await box.press('Enter')
  await page.getByRole('button', { name: 'Plik', exact: true }).click()
  await (await gridCommand(page, 'Utwórz tabelę')).click()
  const d = page.getByRole('dialog', { name: 'Utwórz tabelę', exact: true })
  await expect(d.getByRole('button', { name: 'Anuluj', exact: true }).first()).toBeFocused()
  await page.keyboard.press('Tab')
  await expect(d.getByRole('textbox', { name: 'Nazwa tabeli', exact: true })).toBeFocused()
  await d.getByRole('textbox', { name: 'Nazwa tabeli', exact: true }).fill('Dane')
  const confirm = d.getByRole('button', { name: 'Utwórz tabelę', exact: true })
  for (let step = 0; step < 8 && !(await confirm.evaluate((el) => el === document.activeElement)); step++)
    await page.keyboard.press('Tab')
  await expect(confirm).toBeFocused()
  await page.keyboard.press('Enter')
  await expect(cell(page, 'A1')).toHaveAttribute('data-table-role', 'header')
  await expect(page.getByRole('grid')).toBeFocused()
  await page.getByRole('tab', { name: 'Tabela', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Konwertuj na zakres', exact: true })).toBeVisible()
})
