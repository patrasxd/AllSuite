import { gridCommand } from './helpers/grid-command'
import { test, expect, type Page } from '@playwright/test'
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate'
import { createWorkbook, WorkbookSession } from '../packages/apps/grid/src/engine/workbook'
import { exportXlsxWorkbook } from '../packages/apps/grid/src/engine/xlsx/export'
import { parseXlsxWorkbook } from '../packages/apps/grid/src/engine/xlsx/import'

async function fixture() {
  const workbook = createWorkbook()
  const session = new WorkbookSession(workbook)
  const id = workbook.activeSheetId
  session.setCells(
    id,
    ['Name\tTeam', 'Anna\tA', 'Bob\tB', 'Anna\tB', '\tA', 'Bob\tA'].flatMap((line, i) =>
      line
        .split('\t')
        .map((value, j) => ({ address: `${j ? 'B' : 'A'}${i + 1}`, value: { kind: 'string' as const, value } })),
    ),
  )
  session.setRowMetadata(id, 2, { hidden: true, height: 25 })
  session.formatCells(id, [{ address: 'A4', style: { font: { bold: true }, fill: { color: '#FF0000' } } }])
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
async function range(page: Page) {
  const box = page.getByRole('textbox', { name: 'Name box' })
  await box.fill('A1:B6')
  await box.press('Enter')
}
async function dialog(page: Page, active = false) {
  await page.getByRole('button', { name: 'File', exact: true }).click()
  const trigger = await gridCommand(page, active ? 'AutoFilter active' : 'AutoFilter')
  await trigger.scrollIntoViewIfNeeded()
  await trigger.focus()
  await trigger.press('Enter')
  return page.getByRole('dialog', { name: 'AutoFilter', exact: true })
}
const cell = (page: Page, address: string) => page.locator(`[data-cell-address="${address}"]`)

test('PP05 keyboard values AND blanks navigation cancel history and real XLSX fresh reopen', async ({ page }) => {
  await page.addInitScript(() =>
    Object.defineProperty(window, 'showSaveFilePicker', { configurable: true, value: undefined }),
  )
  await page.goto('./#/grid')
  await open(page, await fixture())
  await range(page)
  let d = await dialog(page)
  await d.getByRole('button', { name: 'Deselect all values', exact: true }).click()
  await d.getByRole('checkbox', { name: 'Anna', exact: true }).focus()
  await d.getByRole('checkbox', { name: 'Anna', exact: true }).press('Space')
  await d.getByRole('button', { name: 'Apply filter', exact: true }).press('Enter')
  await expect(cell(page, 'A2')).toHaveCount(0)
  await expect(cell(page, 'A3')).toHaveCount(0)
  await expect(cell(page, 'A4')).toHaveText('Anna')
  await expect(cell(page, 'A5')).toHaveCount(0)
  await expect(cell(page, 'A6')).toHaveCount(0)
  await cell(page, 'A1').click()
  await page.getByRole('grid').press('ArrowDown')
  await expect(page.getByRole('textbox', { name: 'Name box' })).toHaveValue('A4')
  await page.getByRole('grid').press('ArrowUp')
  await expect(page.getByRole('textbox', { name: 'Name box' })).toHaveValue('A1')
  await page.getByRole('grid').press('Control+z')
  await expect(cell(page, 'A3')).toHaveText('Bob')
  await page.getByRole('grid').press('Control+y')
  await expect(cell(page, 'A3')).toHaveCount(0)
  d = await dialog(page, true)
  await d.getByRole('checkbox', { name: '(Blanks)', exact: true }).check()
  await d.getByRole('button', { name: 'Apply filter', exact: true }).click()
  await expect(cell(page, 'B5')).toHaveText('A')
  d = await dialog(page, true)
  await d.getByRole('combobox', { name: 'Filter column', exact: true }).selectOption('2')
  await d.getByRole('button', { name: 'Deselect all values', exact: true }).click()
  await d.getByRole('checkbox', { name: 'B', exact: true }).check()
  await d.getByRole('button', { name: 'Apply filter', exact: true }).click()
  await expect(cell(page, 'A4')).toHaveText('Anna')
  await expect(cell(page, 'B5')).toHaveCount(0)
  d = await dialog(page, true)
  await d.getByRole('button', { name: 'Deselect all values', exact: true }).click()
  await d.press('Escape')
  await expect(cell(page, 'A4')).toHaveText('Anna')
  const pending = page.waitForEvent('download')
  await (await gridCommand(page, 'Save As')).click()
  const download = await pending
  await download.saveAs('tmp/pp05/filtered.xlsx')
  const stream = await download.createReadStream()
  if (!stream) throw new Error('Missing downloaded XLSX')
  const chunks: Buffer[] = []
  for await (const chunk of stream) chunks.push(Buffer.from(chunk))
  const bytes = Buffer.concat(chunks)
  const parts = unzipSync(bytes)
  const xml = strFromU8(parts['xl/worksheets/sheet1.xml'])
  expect(xml).toContain('<autoFilter ref="A1:B6">')
  expect(xml).toContain('<filters blank="1"><filter val="Anna"')
  expect(xml).toContain('<filterColumn colId="1"><filters><filter val="B"')
  expect(xml).toMatch(/<row[^>]*r="2"[^>]*hidden="1"/)
  expect(strFromU8(parts['xl/_rels/workbook.xml.rels'])).toContain('worksheets/sheet1.xml')
  const parsed = (await parseXlsxWorkbook('filtered.xlsx', bytes)).workbook!
  const sheet = parsed.sheetsById.get(parsed.activeSheetId)!
  expect(sheet.autoFilter?.criteria).toEqual([
    { column: 1, values: ['Anna'], blank: true },
    { column: 2, values: ['B'], blank: false },
  ])
  expect([1, 2, 3, 4, 5, 6].map((r) => sheet.cells.get(`A${r}`)?.value)).toEqual(
    ['Name', 'Anna', 'Bob', 'Anna', '', 'Bob'].map((value) => ({ kind: 'string', value })),
  )
  expect(sheet.cells.get('A4')?.style?.font?.bold).toBe(true)
  expect(sheet.cells.get('A4')?.style?.fill?.color).toBe('#FF0000')
  const fresh = await page.context().newPage()
  await fresh.goto('./#/grid')
  await open(fresh, bytes)
  await expect(cell(fresh, 'A4')).toHaveText('Anna')
  for (const address of ['A2', 'A3', 'A5', 'A6']) await expect(cell(fresh, address)).toHaveCount(0)
  await fresh.getByRole('button', { name: 'File', exact: true }).click()
  await (await gridCommand(fresh, 'Clear filter')).click()
  await expect(cell(fresh, 'A2')).toHaveCount(0)
  await expect(cell(fresh, 'A3')).toHaveText('Bob')
  await expect(cell(fresh, 'A4')).toHaveCSS('font-weight', '700')
  await fresh.close()
})

test('PP05 column chooser has visible keyboard focus and navigation skips a virtualized hidden block', async ({
  page,
}) => {
  await page.goto('./#/grid')
  const parts = unzipSync(await fixture())
  const extra = Array.from({ length: 194 }, (_, i) => i + 7)
    .map(
      (row) =>
        `<row r="${row}"><c r="A${row}" t="inlineStr"><is><t>${row === 200 ? 'Keep' : 'Drop'}</t></is></c></row>`,
    )
    .join('')
  parts['xl/worksheets/sheet1.xml'] = strToU8(
    strFromU8(parts['xl/worksheets/sheet1.xml'])
      .replace('dimension ref="A1:B6"', 'dimension ref="A1:B200"')
      .replace('</sheetData>', `${extra}</sheetData>`),
  )
  await open(page, zipSync(parts))
  const name = page.getByRole('textbox', { name: 'Name box' })
  await name.fill('A1:B200')
  await name.press('Enter')
  const d = await dialog(page)
  const chooser = d.getByRole('combobox', { name: 'Filter column', exact: true })
  await chooser.focus()
  await expect(chooser).toHaveCSS('outline-style', 'solid')
  await d.getByRole('button', { name: 'Deselect all values', exact: true }).click()
  await d.getByRole('checkbox', { name: 'Keep', exact: true }).check()
  await d.getByRole('button', { name: 'Apply filter', exact: true }).click()
  await page.getByRole('grid').press('Control+Home')
  await expect(cell(page, 'A1')).toBeVisible()
  await page.getByRole('grid').press('ArrowDown')
  await expect(name).toHaveValue('A200')
  await expect(cell(page, 'A200')).toHaveText('Keep')
  await expect(cell(page, 'A199')).toHaveCount(0)
  await page.getByRole('grid').press('ArrowUp')
  await expect(name).toHaveValue('A1')
  await name.fill('A50')
  await name.press('Enter')
  await expect(name).toHaveValue('A200')
  await expect(cell(page, 'A200')).toBeVisible()
})

test('PP05 Polish filter controls apply values and clear while preserving manual hiding', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('allsuite:locale', 'pl'))
  await page.goto('./#/grid')
  await page.locator('input[type="file"]').setInputFiles({
    name: 'records.xlsx',
    mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    buffer: Buffer.from(await fixture()),
  })
  await page.getByRole('dialog').getByRole('button', { name: 'Otwórz skoroszyt', exact: true }).click()
  const name = page.locator('.grid-name-box input')
  await name.fill('A1:B6')
  await name.press('Enter')
  await page.getByRole('button', { name: 'Plik', exact: true }).click()
  await (await gridCommand(page, 'Autofiltr')).click()
  const d = page.getByRole('dialog', { name: 'Autofiltr', exact: true })
  await d.getByRole('button', { name: 'Odznacz wszystkie wartości', exact: true }).click()
  await d.getByRole('checkbox', { name: 'Anna', exact: true }).check()
  await d.getByRole('button', { name: 'Zastosuj filtr', exact: true }).click()
  await expect(cell(page, 'A4')).toHaveText('Anna')
  await expect(cell(page, 'A3')).toHaveCount(0)
  await (await gridCommand(page, 'Wyczyść filtr')).click()
  await expect(cell(page, 'A2')).toHaveCount(0)
  await expect(cell(page, 'A3')).toHaveText('Bob')
})

test('PP05 zero results retain clear action; mobile cancel is clean and responsive', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('./#/grid')
  await open(page, await fixture())
  await range(page)
  let d = await dialog(page)
  await expect.poll(async () => (await d.getByRole('combobox').boundingBox())!.height).toBeGreaterThanOrEqual(44)
  const bounds = await d.boundingBox()
  expect(bounds!.x).toBeGreaterThanOrEqual(0)
  expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(390)
  await d.getByRole('button', { name: 'Deselect all values', exact: true }).click()
  await d.getByRole('button', { name: 'Cancel', exact: true }).last().click()
  await expect(page.locator('.grid-app')).not.toHaveAttribute('data-dirty', 'true')
  await expect(cell(page, 'A3')).toHaveText('Bob')
  await expect(page.getByRole('button', { name: 'Clear filter', exact: true })).toHaveCount(0)
  d = await dialog(page)
  await d.getByRole('button', { name: 'Deselect all values', exact: true }).click()
  await d.getByRole('button', { name: 'Apply filter', exact: true }).click()
  await expect(cell(page, 'A1')).toHaveText('Name')
  for (const row of [2, 3, 4, 5, 6]) await expect(cell(page, `A${row}`)).toHaveCount(0)
  const clear = await gridCommand(page, 'Clear filter')
  await clear.scrollIntoViewIfNeeded()
  await clear.click()
  await expect(cell(page, 'A2')).toHaveCount(0)
  await expect(cell(page, 'A3')).toHaveText('Bob')
})
