import { gridCommand } from './helpers/grid-command'
import { expect, test, type Page } from '@playwright/test'
import { strFromU8, unzipSync } from 'fflate'
import { tableAndNoteFixture } from '../packages/apps/grid/src/engine/xlsx/fixtures/safety-corpus'

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
async function row(page: Page, address: string, insert: boolean) {
  await jump(page, address)
  await page.getByRole('grid').press('Shift+F10')
  await page.getByRole('menuitem', { name: insert ? 'Insert row above' : 'Delete row', exact: true }).click()
}
async function formula(page: Page, address: string, expression: string, value: string) {
  await expect(cell(page, address)).toHaveText(value)
  await jump(page, address)
  await expect(page.getByRole('textbox', { name: 'Formula bar' })).toHaveValue(expression)
}
async function open(page: Page, bytes: Buffer, name = 'rows.xlsx') {
  await page.locator('input[type="file"]').setInputFiles({
    name,
    mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    buffer: bytes,
  })
  await page
    .getByRole('dialog', { name: 'Workbook compatibility check' })
    .getByRole('button', { name: 'Open workbook', exact: true })
    .click()
}

for (const insert of [true, false])
  test(`PP02 ${insert ? 'insert' : 'delete'} rows: cross-sheet mixed references, recalculation, history, real XLSX/fresh input`, async ({
    page,
    context,
  }) => {
    await page.addInitScript(() =>
      Object.defineProperty(window, 'showSaveFilePicker', { configurable: true, value: undefined }),
    )
    await page.goto('./#/grid')
    await page.getByRole('button', { name: 'Add sheet', exact: true }).click()
    await page.getByRole('tab', { name: 'Sheet2', exact: true }).dblclick()
    await page.getByRole('textbox', { name: 'Sheet name', exact: true }).fill('Other data')
    await page.getByRole('button', { name: 'Rename', exact: true }).click()
    await edit(page, 'A2', '7')
    await edit(page, 'A3', '3')
    await edit(page, 'D5', '=Sheet1!C1+1')
    await page.getByRole('tab', { name: 'Sheet1', exact: true }).click()
    await edit(page, 'B1', "=SUM('Other data'!$A2:A$3)")
    await edit(page, 'C1', '=B1*2')
    await formula(page, 'C1', '=B1*2', '20')
    await page.getByRole('tab', { name: 'Other data', exact: true }).click()
    await formula(page, 'D5', '=Sheet1!C1+1', '21')
    await row(page, insert ? 'A2' : 'A1', insert)
    const moved = insert ? 'D6' : 'D4'
    const precedent = insert ? 'A3' : 'A1'
    const transformed = insert ? "=SUM('Other data'!$A3:A$4)" : "=SUM('Other data'!$A1:A$2)"
    await formula(page, moved, '=Sheet1!C1+1', '21')
    await page.getByRole('tab', { name: 'Sheet1', exact: true }).click()
    await formula(page, 'B1', transformed, '10')
    await page.getByRole('grid').press('Control+z')
    await formula(page, 'B1', "=SUM('Other data'!$A2:A$3)", '10')
    await page.getByRole('grid').press('Control+y')
    await formula(page, 'B1', transformed, '10')
    await page.getByRole('tab', { name: 'Other data', exact: true }).click()
    await edit(page, precedent, '12')
    await formula(page, moved, '=Sheet1!C1+1', '31')
    await page.getByRole('tab', { name: 'Sheet1', exact: true }).click()
    await formula(page, 'B1', transformed, '15')
    await formula(page, 'C1', '=B1*2', '30')
    await page.getByRole('button', { name: 'File', exact: true }).click()
    const pending = page.waitForEvent('download')
    await (await gridCommand(page, 'Save')).click()
    const download = await pending
    const stream = await download.createReadStream()
    const chunks: Buffer[] = []
    for await (const chunk of stream!) chunks.push(Buffer.from(chunk))
    const bytes = Buffer.concat(chunks)
    await download.saveAs(`tmp/pp02/browser-${insert ? 'insert' : 'delete'}.xlsx`)
    const parts = unzipSync(bytes)
    const xml = strFromU8(parts['xl/worksheets/sheet1.xml'])
    expect(xml).toContain(`<f>${transformed.slice(1)}</f><v>15</v>`)
    expect(xml).toContain('<c r="C1"><f>B1*2</f><v>30</v></c>')
    expect(strFromU8(parts['xl/worksheets/sheet2.xml'])).toContain(`<c r="${moved}"><f>Sheet1!C1+1</f><v>31</v></c>`)
    expect(strFromU8(parts['xl/worksheets/sheet2.xml'])).toContain(`<c r="${precedent}"><v>12</v></c>`)
    await expect(page.locator('.grid-app')).not.toHaveAttribute('data-dirty', 'true')
    const fresh = await context.newPage()
    await fresh.goto('./#/grid')
    await open(fresh, bytes)
    await fresh.getByRole('tab', { name: 'Sheet1', exact: true }).click()
    await formula(fresh, 'B1', transformed, '15')
    await formula(fresh, 'C1', '=B1*2', '30')
    await fresh.getByRole('tab', { name: 'Other data', exact: true }).click()
    await formula(fresh, moved, '=Sheet1!C1+1', '31')
    await edit(fresh, precedent, '20')
    await formula(fresh, moved, '=Sheet1!C1+1', '47')
    await fresh.close()
  })

test('PP02 deletion produces #REF! in the saved formula and error cache, including undo/redo', async ({ page }) => {
  await page.addInitScript(() =>
    Object.defineProperty(window, 'showSaveFilePicker', { configurable: true, value: undefined }),
  )
  await page.goto('./#/grid')
  await edit(page, 'A2', '7')
  await edit(page, 'B1', '=$A$2+1')
  await edit(page, 'C1', '=IFERROR("żółć 👋"&$A$2,"ok")')
  await formula(page, 'B1', '=$A$2+1', '8')
  await row(page, 'A2', false)
  await formula(page, 'B1', '=#REF!+1', '#REF!')
  await formula(page, 'C1', '=IFERROR("żółć 👋"&#REF!,"ok")', 'ok')
  await page.getByRole('grid').press('Control+z')
  await formula(page, 'B1', '=$A$2+1', '8')
  await page.getByRole('grid').press('Control+y')
  await formula(page, 'B1', '=#REF!+1', '#REF!')
  await page.getByRole('button', { name: 'File', exact: true }).click()
  const pending = page.waitForEvent('download')
  await (await gridCommand(page, 'Save')).click()
  const download = await pending
  const stream = await download.createReadStream()
  const chunks: Buffer[] = []
  for await (const chunk of stream!) chunks.push(Buffer.from(chunk))
  const bytes = Buffer.concat(chunks)
  expect(strFromU8(unzipSync(bytes)['xl/worksheets/sheet1.xml'])).toContain(
    '<c r="B1" t="e"><f>#REF!+1</f><v>#REF!</v></c>',
  )
  expect(strFromU8(unzipSync(bytes)['xl/worksheets/sheet1.xml'])).toContain('IFERROR("żółć 👋"&amp;#REF!,"ok")')
  await open(page, bytes)
  await formula(page, 'B1', '=#REF!+1', '#REF!')
  await formula(page, 'C1', '=IFERROR("żółć 👋"&#REF!,"ok")', 'ok')
})

test('PP02 unsupported syntax and opaque anchors refuse before moving any cells', async ({ page }) => {
  await page.goto('./#/grid')
  await edit(page, 'A2', 'keep')
  await edit(page, 'B1', '=NotAName+1')
  await row(page, 'A2', true)
  await expect(page.getByRole('status')).toContainText('could not be changed safely')
  await expect(cell(page, 'A2')).toHaveText('keep')
  await jump(page, 'B1')
  await expect(page.getByRole('textbox', { name: 'Formula bar' })).toHaveValue('=NotAName+1')
  let downloads = 0
  page.on('download', () => downloads++)
  page.once('dialog', (dialog) => dialog.accept())
  await open(page, Buffer.from(tableAndNoteFixture()), 'opaque.xlsx')
  await row(page, 'A4', true)
  await expect(page.getByRole('status')).toContainText('could not be changed safely')
  await expect(cell(page, 'B2')).toHaveText('5')
  await expect(page.locator('.grid-app')).not.toHaveAttribute('data-dirty', 'true')
  expect(downloads).toBe(0)
})
