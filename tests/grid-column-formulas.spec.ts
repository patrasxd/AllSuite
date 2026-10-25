import { gridCommand } from './helpers/grid-command'
import { expect, test, type Page, type Download } from '@playwright/test'
import { strFromU8, unzipSync } from 'fflate'
import { tableAndNoteFixture } from '../packages/apps/grid/src/engine/xlsx/fixtures/safety-corpus'
import { WorkbookSession } from '../packages/apps/grid/src/engine/workbook/session'
import { createWorkbook } from '../packages/apps/grid/src/engine/workbook/model'
import { inferCellValue } from '../packages/apps/grid/src/engine/editing/cell-input'
import { exportXlsxWorkbook } from '../packages/apps/grid/src/engine/xlsx/export'

const cell = (page: Page, address: string) => page.locator(`[data-cell-address="${address}"]`)
async function jump(page: Page, address: string) {
  const box = page.getByRole('textbox', { name: 'Name box' })
  await box.fill(address)
  await box.press('Enter')
  await expect(box).toHaveValue(address)
  await expect(page.getByRole('grid')).toHaveAttribute('aria-activedescendant', `grid-cell-${address}`)
}
async function edit(page: Page, address: string, value: string) {
  await jump(page, address)
  const bar = page.getByRole('textbox', { name: 'Formula bar' })
  await bar.fill(value)
  await bar.press('Control+Enter')
}
async function structure(page: Page, address: string, name: string) {
  await jump(page, address)
  await page.getByRole('grid').press('Shift+F10')
  await page.getByRole('menuitem', { name, exact: true }).click()
}
async function formula(page: Page, address: string, expression: string, value: string) {
  await expect(cell(page, address)).toHaveText(value)
  await jump(page, address)
  await expect(page.getByRole('textbox', { name: 'Formula bar' })).toHaveValue(expression)
}
async function bytes(download: Download) {
  const chunks: Buffer[] = []
  for await (const chunk of (await download.createReadStream())!) chunks.push(Buffer.from(chunk))
  return Buffer.concat(chunks)
}
async function open(page: Page, buffer: Buffer) {
  await page.locator('input[type="file"]').setInputFiles({
    name: 'columns.xlsx',
    mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    buffer,
  })
  await page
    .getByRole('dialog', { name: 'Workbook compatibility check' })
    .getByRole('button', { name: 'Open workbook', exact: true })
    .click()
}

test('PP03 insert, precedent edits, delete, both axes/history, actual XLSX and fresh input', async ({
  page,
  context,
}) => {
  await page.addInitScript(() =>
    Object.defineProperty(window, 'showSaveFilePicker', { configurable: true, value: undefined }),
  )
  await page.goto('./#/grid')
  const source = new WorkbookSession(createWorkbook({ firstSheetName: 'Sheet1' }))
  const first = source.workbook.activeSheetId
  const second = source.createSheet('Other data')
  for (const [id, address, text] of [
    [second, 'B2', '7'],
    [second, 'D2', '3'],
    [second, 'F4', '=Sheet1!A2+1'],
    [first, 'A1', "=SUM('Other data'!$B2:D$2)"],
    [first, 'A2', '=A1*2'],
    [first, 'A3', "='Other data'!$D$2"],
  ])
    source.setCell(id, address, inferCellValue(text, 'en', '1900'))
  await open(page, Buffer.from((await exportXlsxWorkbook(source.workbook, 'source.xlsx')).bytes!))
  await page.getByRole('tab', { name: 'Sheet1', exact: true }).click()
  await formula(page, 'A2', '=A1*2', '20')
  await page.getByRole('tab', { name: 'Other data', exact: true }).click()
  await structure(page, 'C2', 'Insert column before')
  await formula(page, 'G4', '=Sheet1!A2+1', '21')
  await edit(page, 'C2', '5')
  await formula(page, 'G4', '=Sheet1!A2+1', '31')
  await page.getByRole('tab', { name: 'Sheet1', exact: true }).click()
  await formula(page, 'A1', "=SUM('Other data'!$B2:E$2)", '15')
  await formula(page, 'A3', "='Other data'!$E$2", '3')
  await page.getByRole('tab', { name: 'Other data', exact: true }).click()
  await structure(page, 'E2', 'Delete column')
  await formula(page, 'F4', '=Sheet1!A2+1', '25')
  await page.getByRole('tab', { name: 'Sheet1', exact: true }).click()
  await formula(page, 'A1', "=SUM('Other data'!$B2:D$2)", '12')
  await formula(page, 'A3', '=#REF!', '#REF!')
  await page.getByRole('grid').press('Control+z')
  await formula(page, 'A3', "='Other data'!$E$2", '3')
  await page.getByRole('grid').press('Control+y')
  await formula(page, 'A3', '=#REF!', '#REF!')
  await page.getByRole('tab', { name: 'Other data', exact: true }).click()
  await structure(page, 'B2', 'Insert row above')
  await formula(page, 'F5', '=Sheet1!A2+1', '25')
  await page.getByRole('grid').press('Control+z')
  await formula(page, 'F4', '=Sheet1!A2+1', '25')
  await page.getByRole('grid').press('Control+y')
  await formula(page, 'F5', '=Sheet1!A2+1', '25')
  await page.getByRole('tab', { name: 'Sheet1', exact: true }).click()
  const transformed = "=SUM('Other data'!$B3:D$3)"
  await formula(page, 'A1', transformed, '12')
  await page.getByRole('button', { name: 'File', exact: true }).click()
  const pending = page.waitForEvent('download')
  await (await gridCommand(page, 'Save')).click()
  const download = await pending
  const buffer = await bytes(download)
  await download.saveAs('tmp/pp03/browser-combined.xlsx')
  const parts = unzipSync(buffer)
  expect(strFromU8(parts['xl/worksheets/sheet1.xml'])).toContain(
    `<c r="A1"><f>${transformed.slice(1)}</f><v>12</v></c>`,
  )
  expect(strFromU8(parts['xl/worksheets/sheet1.xml'])).toContain('<c r="A3" t="e"><f>#REF!</f><v>#REF!</v></c>')
  expect(strFromU8(parts['xl/worksheets/sheet2.xml'])).toContain('<c r="F5"><f>Sheet1!A2+1</f><v>25</v></c>')
  expect(strFromU8(parts['xl/worksheets/sheet2.xml'])).toContain('<c r="C3"><v>5</v></c>')
  expect(strFromU8(parts['xl/_rels/workbook.xml.rels'])).toContain('worksheets/sheet2.xml')
  await expect(page.locator('.grid-app')).not.toHaveAttribute('data-dirty', 'true')
  const fresh = await context.newPage()
  await fresh.goto('./#/grid')
  await open(fresh, buffer)
  await fresh.getByRole('tab', { name: 'Sheet1', exact: true }).click()
  await formula(fresh, 'A1', transformed, '12')
  await formula(fresh, 'A2', '=A1*2', '24')
  await formula(fresh, 'A3', '=#REF!', '#REF!')
  await fresh.getByRole('tab', { name: 'Other data', exact: true }).click()
  await formula(fresh, 'F5', '=Sheet1!A2+1', '25')
  await edit(fresh, 'C3', '10')
  await formula(fresh, 'F5', '=Sheet1!A2+1', '35')
  await fresh.close()
})

test('PP03 unsupported formulas and opaque objects refuse atomically with no download', async ({ page }) => {
  await page.goto('./#/grid')
  await edit(page, 'B2', 'keep')
  await edit(page, 'A1', '=NotAName+1')
  await structure(page, 'B2', 'Insert column before')
  await expect(page.getByRole('status')).toContainText('could not be changed safely')
  await expect(cell(page, 'B2')).toHaveText('keep')
  await expect(page.getByRole('textbox', { name: 'Name box' })).toHaveValue('B2')
  await jump(page, 'A1')
  await expect(page.getByRole('textbox', { name: 'Formula bar' })).toHaveValue('=NotAName+1')
  let downloads = 0
  page.on('download', () => downloads++)
  page.once('dialog', (dialog) => dialog.accept())
  await open(page, Buffer.from(tableAndNoteFixture()))
  await structure(page, 'B2', 'Delete column')
  await expect(page.getByRole('status')).toContainText('could not be changed safely')
  await expect(cell(page, 'B2')).toHaveText('5')
  await expect(page.getByRole('textbox', { name: 'Name box' })).toHaveValue('B2')
  await expect(page.locator('.grid-app')).not.toHaveAttribute('data-dirty', 'true')
  await page.getByRole('grid').press('Escape')
  await page.getByRole('grid').press('Control+z')
  await expect(cell(page, 'B2')).toHaveText('5')
  expect(downloads).toBe(0)
})
