import { gridCommand } from './helpers/grid-command'
import { test, expect, type Page } from '@playwright/test'
import { strFromU8, unzipSync } from 'fflate'

for (const capability of ['custom format unavailable', 'read unavailable after copy'] as const) {
  test(`PP11 refuses formula transport when ${capability}`, async ({ page, context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write'])
    await page.goto('./#/grid')
    const grid = page.getByRole('grid')
    const bar = page.getByRole('textbox', { name: 'Formula bar' })
    await bar.fill('=1+2')
    await bar.press('Control+Enter')
    await expect(page.getByRole('gridcell', { name: 'A1, 3', exact: true })).toBeVisible()
    if (capability === 'custom format unavailable')
      await page.evaluate(() => Object.defineProperty(ClipboardItem, 'supports', { value: () => false }))
    await grid.press('Control+Alt+Shift+c')
    await expect(page.getByRole('status')).toContainText(
      capability === 'custom format unavailable' ? 'Clipboard operation refused' : 'Formulas copied',
    )
    if (capability === 'read unavailable after copy')
      await page.evaluate(() => Object.defineProperty(navigator.clipboard, 'read', { value: undefined }))
    await select(page, 'D1')
    await grid.press('Control+Alt+Shift+v')
    await expect(page.getByRole('status')).toContainText('Clipboard operation refused')
    await expect(page.getByRole('gridcell', { name: 'D1, empty', exact: true })).toBeVisible()
    await grid.press('Control+z')
    await expect(page.getByRole('gridcell', { name: 'A1, empty', exact: true })).toBeVisible()
  })
}

async function select(page: Page, range: string) {
  const box = page.getByRole('textbox', { name: 'Name box' })
  await box.fill(range)
  await box.press('Enter')
}

test('PP11 rectangular formula copy, recalculation, history, actual XLSX and values regression', async ({
  page,
  context,
}) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write'])
  await page.addInitScript(() => {
    Object.defineProperty(window, 'showSaveFilePicker', { configurable: true, value: undefined })
    Object.defineProperty(window, 'showOpenFilePicker', { configurable: true, value: undefined })
  })
  await page.goto('./#/grid')
  const grid = page.getByRole('grid')
  const bar = page.getByRole('textbox', { name: 'Formula bar' })
  const enter = async (address: string, value: string) => {
    await select(page, address)
    await bar.fill(value)
    await bar.press('Control+Enter')
  }
  await enter('A1', '2')
  await enter('B1', '=A1+$A$1')
  await enter('A2', "'=literal")
  await enter('B2', '=SUM($A$1:A2)')
  await expect(page.getByRole('gridcell', { name: 'B2, 2', exact: true })).toBeVisible()
  await expect(page.getByRole('gridcell', { name: 'B1, 4', exact: true })).toBeVisible()
  await select(page, 'A1:B2')
  await grid.press('Shift+F10')
  await page.getByRole('menuitem', { name: 'Copy formulas', exact: true }).click()
  await expect(page.getByRole('status')).toContainText('Formulas copied')
  await select(page, 'D3')
  await grid.press('Control+Alt+Shift+v')
  await expect(page.getByRole('status')).toContainText('Formulas pasted')
  await expect(page.getByRole('textbox', { name: 'Name box' })).toHaveValue('D3:E4')
  await select(page, 'E3')
  await bar.click()
  await expect(bar).toHaveValue('=D3+$A$1')
  await bar.press('Escape')
  await expect(page.getByRole('gridcell', { name: 'E3, 4', exact: true })).toBeVisible()
  await grid.press('Control+z')
  await expect(page.getByRole('gridcell', { name: 'D3, empty', exact: true })).toBeVisible()
  await grid.press('Control+y')
  await expect(page.getByRole('gridcell', { name: 'E3, 4', exact: true })).toBeVisible()
  await enter('D3', '7')
  await expect(page.getByRole('gridcell', { name: 'E3, 9', exact: true })).toBeVisible()
  await expect(page.getByRole('gridcell', { name: 'E4, 15', exact: true })).toBeVisible()
  await expect(page.getByRole('gridcell', { name: 'D4, =literal', exact: true })).toBeVisible()
  await select(page, 'E3')
  await grid.press('Control+c')
  await expect(page.getByRole('status')).toContainText('Values copied')
  await select(page, 'G1')
  await grid.press('Control+v')
  await expect(page.getByRole('gridcell', { name: 'G1, 9', exact: true })).toBeVisible()
  await enter('H1', '=1/0+I1')
  await expect(page.getByRole('gridcell', { name: 'H1, #DIV/0!', exact: true })).toBeVisible()
  await grid.press('Control+Alt+Shift+c')
  await expect(page.getByRole('status')).toContainText('Formulas copied')
  await select(page, 'H3')
  await grid.press('Control+Alt+Shift+v')
  await expect(page.getByRole('status')).toContainText('Formulas pasted')
  await expect(page.getByRole('gridcell', { name: 'H3, #DIV/0!', exact: true })).toBeVisible()
  const pending = page.waitForEvent('download')
  await page.getByRole('button', { name: 'File', exact: true }).click()
  await (await gridCommand(page, 'Save As')).click()
  const stream = await (await pending).createReadStream()
  if (!stream) throw new Error('Missing download')
  const chunks: Buffer[] = []
  for await (const chunk of stream) chunks.push(Buffer.from(chunk))
  const bytes = Buffer.concat(chunks)
  const xml = strFromU8(unzipSync(bytes)['xl/worksheets/sheet1.xml'])
  expect(xml).toContain('<c r="E3"><f>D3+$A$1</f><v>9</v></c>')
  expect(xml).toContain('<c r="E4"><f>SUM($A$1:D4)</f><v>15</v></c>')
  expect(xml).toContain('<c r="G1"><v>9</v></c>')
  expect(xml).toContain('<f>1/0+I3</f><v>#DIV/0!</v>')
  const fresh = await context.newPage()
  await fresh.goto('./#/grid')
  await fresh.locator('input[type="file"]').setInputFiles({
    name: 'copy.xlsx',
    mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    buffer: bytes,
  })
  await fresh
    .getByRole('dialog', { name: 'Workbook compatibility check' })
    .getByRole('button', { name: 'Open workbook', exact: true })
    .click()
  await expect(fresh.getByRole('gridcell', { name: 'E3, 9', exact: true })).toBeVisible()
  await expect(fresh.getByRole('gridcell', { name: 'E4, 15', exact: true })).toBeVisible()
  await expect(fresh.getByRole('gridcell', { name: 'D4, =literal', exact: true })).toBeVisible()
  await expect(fresh.getByRole('gridcell', { name: 'H3, #DIV/0!', exact: true })).toBeVisible()
  await select(fresh, 'E3')
  const freshBar = fresh.getByRole('textbox', { name: 'Formula bar' })
  await freshBar.click()
  await expect(freshBar).toHaveValue('=D3+$A$1')
  await freshBar.press('Escape')
  await select(fresh, 'D3')
  await freshBar.fill('10')
  await freshBar.press('Control+Enter')
  await expect(fresh.getByRole('gridcell', { name: 'E3, 12', exact: true })).toBeVisible()
})

test('PP11 toolbar, identical external overwrite, mismatches and denied APIs never authorize formulas', async ({
  page,
  context,
}) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write'])
  await page.goto('./#/grid')
  const grid = page.getByRole('grid')
  const bar = page.getByRole('textbox', { name: 'Formula bar' })
  await bar.fill('=1+2')
  await bar.press('Control+Enter')
  await expect(page.getByRole('gridcell', { name: 'A1, 3', exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'File', exact: true }).click()
  await (await gridCommand(page, 'Copy formulas')).click()
  await expect(page.getByRole('status')).toContainText('Formulas copied')
  await select(page, 'D1')
  await (await gridCommand(page, 'Paste formulas')).click()
  await expect(page.getByRole('gridcell', { name: 'D1, 3', exact: true })).toBeVisible()
  await select(page, 'A1')
  await grid.press('Control+Alt+Shift+c')
  await expect(page.getByRole('status')).toContainText('Formulas copied')
  const original = await page.evaluate(async () => {
    const type = 'web application/x-allsuite-grid-values-token'
    const [item] = await navigator.clipboard.read()
    return { text: await (await item.getType('text/plain')).text(), token: await (await item.getType(type)).text() }
  })
  const external = await context.newPage()
  await external.goto('./')
  await external.evaluate(async () => navigator.clipboard.writeText(await navigator.clipboard.readText()))
  await external.close()
  await page.bringToFront()
  await select(page, 'D2')
  await grid.press('Control+Alt+Shift+v')
  await expect(page.getByRole('status')).toContainText('Clipboard operation refused')
  for (const [text, token] of [
    [original.text, 'wrong-token'],
    ['=9+9', original.token],
  ]) {
    await page.evaluate(
      async ({ text, token }) =>
        navigator.clipboard.write([
          new ClipboardItem({
            'text/plain': new Blob([text], { type: 'text/plain' }),
            'web application/x-allsuite-grid-values-token': new Blob([token], {
              type: 'application/x-allsuite-grid-values-token',
            }),
          }),
        ]),
      { text, token },
    )
    await grid.press('Control+Alt+Shift+v')
    await expect(page.getByRole('status')).toContainText('Clipboard operation refused')
    await expect(page.getByRole('gridcell', { name: 'D2, empty', exact: true })).toBeVisible()
  }
  await page.evaluate(() => navigator.clipboard.writeText('=1+2'))
  await grid.press('Control+v')
  await expect(page.getByRole('gridcell', { name: 'D2, =1+2', exact: true })).toBeVisible()
  await bar.click()
  await expect(bar).toHaveValue("'=1+2")
  await bar.press('Escape')
  await grid.press('Control+z')
  await page.evaluate(() => {
    const denied = async () => {
      throw new DOMException('Denied', 'NotAllowedError')
    }
    Object.defineProperty(navigator, 'clipboard', {
      value: { read: denied, write: denied, readText: denied, writeText: denied },
    })
  })
  await grid.press('Control+Alt+Shift+v')
  await expect(page.getByRole('status')).toContainText('Clipboard operation refused')
  await grid.press('Control+Alt+Shift+c')
  await expect(page.getByRole('status')).toContainText('Clipboard operation refused')
  await expect(page.getByRole('gridcell', { name: 'D2, empty', exact: true })).toBeVisible()
  await grid.press('Control+z')
  await expect(page.getByRole('gridcell', { name: 'D1, empty', exact: true })).toBeVisible()
  await expect(page.getByRole('gridcell', { name: 'A1, 3', exact: true })).toBeVisible()
  await grid.press('Control+y')
  await expect(page.getByRole('gridcell', { name: 'D1, 3', exact: true })).toBeVisible()
})

test('PP11 negative reference overflow refuses atomically and unsupported copy cannot replace payload', async ({
  page,
  context,
}) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write'])
  await page.goto('./#/grid')
  const grid = page.getByRole('grid')
  const bar = page.getByRole('textbox', { name: 'Formula bar' })
  await bar.fill('2')
  await bar.press('Control+Enter')
  await select(page, 'B1')
  await bar.fill('=A1')
  await bar.press('Control+Enter')
  await expect(page.getByRole('gridcell', { name: 'B1, 2', exact: true })).toBeVisible()
  await grid.press('Control+Alt+Shift+c')
  await expect(page.getByRole('status')).toContainText('Formulas copied')
  await select(page, 'A1')
  await grid.press('Control+Alt+Shift+v')
  await expect(page.getByRole('status')).toContainText('Clipboard operation refused')
  await expect(page.getByRole('textbox', { name: 'Name box' })).toHaveValue('A1')
  await expect(page.getByRole('gridcell', { name: 'A1, 2', exact: true })).toBeVisible()
  await grid.press('Control+z')
  await expect(page.getByRole('gridcell', { name: 'B1, empty', exact: true })).toBeVisible()
  await grid.press('Control+y')
  await expect(page.getByRole('gridcell', { name: 'B1, 2', exact: true })).toBeVisible()
  await select(page, 'C1')
  await bar.fill('=UNKNOWN(A1)')
  await bar.press('Control+Enter')
  await grid.press('Control+Alt+Shift+c')
  await expect(page.getByRole('status')).toContainText('Clipboard operation refused')
  await select(page, 'D1')
  await grid.press('Control+Alt+Shift+v')
  await expect(page.getByRole('status')).toContainText('Clipboard operation refused')
  await expect(page.getByRole('gridcell', { name: 'D1, empty', exact: true })).toBeVisible()
})
