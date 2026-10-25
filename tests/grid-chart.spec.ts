import { expect, test, type Page } from '@playwright/test'
import { strFromU8, unzipSync } from 'fflate'
import { createWorkbook, WorkbookSession } from '../packages/apps/grid/src/engine/workbook'
import { exportXlsxWorkbook } from '../packages/apps/grid/src/engine/xlsx/export'
import { parseXlsxWorkbook } from '../packages/apps/grid/src/engine/xlsx/import'
import { gridCommand } from './helpers/grid-command'

async function fixture() {
  const workbook = createWorkbook({ firstSheetName: 'Monthly plan' })
  const session = new WorkbookSession(workbook)
  const rows = [
    ['Month', 'Revenue'],
    ['Jan', 120],
    ['Feb', -45],
    ['Mar', null],
    ['Apr', 0],
    ['May', 180],
  ]
  session.setCells(
    workbook.activeSheetId,
    rows.flatMap((row, r) =>
      row.map((value, c) => ({
        address: `${c ? 'B' : 'A'}${r + 1}`,
        value:
          value === null
            ? { kind: 'blank' as const }
            : typeof value === 'number'
              ? { kind: 'number' as const, value }
              : { kind: 'string' as const, value },
      })),
    ),
  )
  const saved = await exportXlsxWorkbook(workbook, 'monthly.xlsx')
  expect(saved.report.canSave).toBe(true)
  return saved.bytes!
}
async function open(page: Page, bytes: Uint8Array, polish = false) {
  await page.locator('input[type="file"]').setInputFiles({
    name: 'monthly.xlsx',
    mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    buffer: Buffer.from(bytes),
  })
  await page
    .getByRole('dialog')
    .getByRole('button', { name: polish ? 'Otwórz skoroszyt' : 'Open workbook', exact: true })
    .click()
}
async function select(page: Page, range = 'A1:B6') {
  const box = page.getByRole('textbox', { name: 'Name box', exact: true })
  await box.fill(range)
  await box.press('Enter')
}
async function edit(page: Page, address: string, value: string) {
  await select(page, address)
  await page.getByRole('grid').press('F2')
  const input = page.getByRole('textbox', { name: `Edit cell ${address}`, exact: true })
  await input.fill(value)
  await input.press('Enter')
}
async function create(page: Page) {
  await page.getByRole('tab', { name: 'Insert', exact: true }).click()
  await page.getByRole('button', { name: 'Chart', exact: true }).focus()
  await page.keyboard.press('Enter')
  const dialog = page.getByRole('dialog', { name: 'Create chart', exact: true })
  await expect(dialog.getByRole('img')).toBeVisible()
  await dialog.getByRole('button', { name: 'Create chart', exact: true }).click()
  await expect(page.getByRole('grid')).toBeFocused()
}

test('@smoke PP07 native chart create edit source delete history download and fresh reopen', async ({ page }) => {
  await page.addInitScript(() =>
    Object.defineProperty(window, 'showSaveFilePicker', { configurable: true, value: undefined }),
  )
  await page.goto('./#/grid')
  await open(page, await fixture())
  await select(page)
  await create(page)
  const panel = page.locator('.grid-chart-panel')
  await expect(panel.getByRole('img')).toHaveAccessibleName(/Revenue/)
  await page.getByRole('grid').press('Control+z')
  await expect(panel).toHaveCount(0)
  await page.getByRole('grid').press('Control+y')
  await expect(panel).toBeVisible()
  await panel.getByRole('button', { name: 'Select chart: Revenue', exact: true }).click()
  await panel.getByRole('button', { name: 'Edit chart', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'Edit chart', exact: true })
  await dialog.getByRole('textbox', { name: 'Chart title', exact: true }).fill('Net revenue')
  await dialog.getByRole('textbox', { name: 'Source range', exact: true }).fill('A1:B5')
  await dialog.getByRole('button', { name: 'Apply changes', exact: true }).click()
  await panel.locator('summary').click()
  await expect(panel.getByRole('row', { name: 'May 180', exact: true })).toHaveCount(0)
  await page.getByRole('grid').press('Control+z')
  await expect(panel.getByRole('row', { name: 'May 180', exact: true })).toBeVisible()
  await page.getByRole('grid').press('Control+y')
  await edit(page, 'B2', '-240')
  await edit(page, 'B3', '')
  await expect(panel.getByRole('row', { name: 'Jan -240', exact: true })).toBeVisible()
  await expect(panel.getByRole('row', { name: 'Feb Blank', exact: true })).toBeVisible()
  await expect(panel.getByRole('row', { name: 'Apr 0', exact: true })).toBeVisible()
  await edit(page, 'D2', '100')
  await edit(page, 'B2', '=D2*2')
  await expect(panel.getByRole('row', { name: 'Jan 200', exact: true })).toBeVisible()
  await edit(page, 'D2', '120')
  await expect(panel.getByRole('row', { name: 'Jan 240', exact: true })).toBeVisible()
  await panel.getByRole('button', { name: 'Select chart: Net revenue', exact: true }).click()
  await panel.getByRole('button', { name: 'Remove chart', exact: true }).focus()
  await page.keyboard.press('Enter')
  await expect(panel).toHaveCount(0)
  await page.getByRole('grid').press('Control+z')
  await expect(panel).toBeVisible()
  await page.getByRole('grid').press('Control+y')
  await expect(panel).toHaveCount(0)
  await page.getByRole('grid').press('Control+z')
  await expect(panel).toBeVisible()
  const pending = page.waitForEvent('download')
  await (await gridCommand(page, 'Save As')).click()
  const download = await pending
  await download.saveAs('tmp/pp07/browser-chart.xlsx')
  const chunks: Buffer[] = []
  for await (const chunk of (await download.createReadStream())!) chunks.push(Buffer.from(chunk))
  const bytes = Buffer.concat(chunks)
  const chart = strFromU8(unzipSync(bytes)['xl/charts/chart1.xml'])
  expect(chart).toContain('<c:v>240</c:v>')
  expect(chart).toContain('$B$2:$B$5')
  expect(chart).toContain('Net revenue')
  const parsed = await parseXlsxWorkbook('chart.xlsx', bytes)
  expect(parsed.workbook!.sheetsById.get(parsed.workbook!.activeSheetId)!.drawings[0].chart?.title).toBe('Net revenue')
  const fresh = await page.context().newPage()
  await fresh.goto('./#/grid')
  await open(fresh, bytes)
  await expect(fresh.locator('.grid-chart-panel').getByRole('img')).toHaveAccessibleName(/Net revenue/)
  await fresh.locator('.grid-chart-panel summary').click()
  await expect(fresh.locator('.grid-chart-panel').getByRole('row', { name: 'Jan 240', exact: true })).toBeVisible()
})

test('PP07 rejects invalid data and cancel leaves workbook history clean', async ({ page }) => {
  await page.goto('./#/grid')
  await open(page, await fixture())
  await select(page, 'D1:E5')
  await page.getByRole('tab', { name: 'Insert', exact: true }).click()
  await page.getByRole('button', { name: 'Chart', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'Create chart', exact: true })
  await expect(dialog.getByRole('alert')).toContainText('empty')
  await expect(dialog.getByRole('button', { name: 'Create chart', exact: true })).toBeDisabled()
  await dialog.getByRole('textbox', { name: 'Source range', exact: true }).fill('A1:B6')
  await expect(dialog.getByRole('alert')).toContainText('number')
  await dialog.getByRole('checkbox').check()
  await expect(dialog.getByRole('img')).toBeVisible()
  await dialog.getByRole('textbox', { name: 'Source range', exact: true }).fill('A1:C6')
  await expect(dialog.getByRole('alert')).toContainText('two adjacent columns')
  await dialog.press('Escape')
  await expect(dialog).toHaveCount(0)
  await expect(page.locator('.grid-chart-panel')).toHaveCount(0)
  await expect(page.getByRole('button', { name: /^Undo \(/ })).toBeDisabled()
  await expect(page.getByRole('textbox', { name: 'Name box', exact: true })).toHaveValue('D1:E5')
})

test.describe('touch phone', () => {
  test.use({ hasTouch: true })
  test('PP07 Polish phone workflow keeps chart keyboard controls and sheet usable in E-ink', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await page.addInitScript(() => {
      localStorage.setItem('allsuite:locale', 'pl')
      localStorage.setItem('allsuite:theme', 'e-ink-light')
    })
    await page.goto('./#/grid')
    await open(page, await fixture(), true)
    const box = page.getByRole('textbox', { name: 'Pole nazwy', exact: true })
    await box.fill('A1:B6')
    await box.press('Enter')
    await page.getByRole('tab', { name: 'Wstaw', exact: true }).click()
    await page.getByRole('button', { name: 'Wykres', exact: true }).click()
    const dialog = page.getByRole('dialog', { name: 'Utwórz wykres', exact: true })
    await expect(dialog.getByRole('img')).toBeVisible()
    await dialog.getByRole('button', { name: 'Utwórz wykres', exact: true }).click()
    const panel = page.locator('.grid-chart-panel')
    await panel.getByRole('button', { name: 'Zaznacz wykres: Revenue', exact: true }).focus()
    await page.keyboard.press('Enter')
    await expect(panel.getByRole('button', { name: 'Edytuj wykres', exact: true })).toBeEnabled()
    await panel.getByRole('button', { name: 'Usuń wykres', exact: true }).focus()
    await page.keyboard.press('Enter')
    await expect(panel).toHaveCount(0)
    await page.getByRole('grid').press('Control+z')
    await expect(panel.getByRole('img')).toBeVisible()
    await page.screenshot({ path: 'docs/verification/assets/PP07-CHARTS-02/mobile-polish.png' })
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await expect(page.getByRole('grid')).toBeFocused()
    await panel.getByRole('button', { name: 'Zaznacz wykres: Revenue', exact: true }).click()
    await panel.getByRole('button', { name: 'Pozycja i rozmiar', exact: true }).click()
    const placement = page.getByRole('dialog', { name: 'Pozycja i rozmiar', exact: true })
    await placement.getByRole('textbox', { name: 'Pozycja i rozmiar', exact: true }).fill('D1:G11')
    await placement.getByRole('button', { name: 'Zastosuj zmiany', exact: true }).click()
    await expect(panel).toHaveAttribute('data-anchor', 'D1:G11')
    await panel.getByRole('button', { name: 'Zaznacz wykres: Revenue', exact: true }).tap()
    await expect(panel).toHaveAttribute('data-selected', 'true')
    const beforeTouch = await panel.getAttribute('data-anchor')
    const session = await page.context().newCDPSession(page)
    const touchTitle = (await panel
      .getByRole('button', { name: 'Zaznacz wykres: Revenue', exact: true })
      .boundingBox())!
    const x = touchTitle.x + touchTitle.width / 2,
      y = touchTitle.y + 22
    await session.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] })
    for (let step = 1; step <= 5; step++)
      await session.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x - step * 12, y }] })
    await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
    await expect.poll(async () => page.getByRole('grid').evaluate((el) => el.scrollLeft)).toBeGreaterThan(336)
    await expect(panel).toHaveAttribute('data-anchor', beforeTouch!)
    await page.getByRole('grid').evaluate((el) => {
      el.scrollLeft = 336
    })
    await page.screenshot({ path: 'docs/verification/assets/PP07-CHARTS-02/mobile-positioned.png' })
  })
})

test('PP07 embedded drawing geometry, drag resize scroll zoom history and XLSX reopen', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 })
  await page.addInitScript(() =>
    Object.defineProperty(window, 'showSaveFilePicker', { configurable: true, value: undefined }),
  )
  await page.goto('./#/grid')
  await open(page, await fixture())
  await select(page)
  const grid = page.getByRole('grid')
  const sheetWidth = (await grid.boundingBox())!.width
  await create(page)
  const object = page.locator('.grid-chart-object')
  await expect(object).toHaveAttribute('data-anchor', 'D1:I11')
  expect((await grid.boundingBox())!.width).toBe(sheetWidth)
  await page.setViewportSize({ width: 1280, height: 720 })
  await page.screenshot({ path: 'docs/verification/assets/PP07-CHARTS-02/after.png' })
  await page.setViewportSize({ width: 1440, height: 1000 })
  await page.screenshot({ path: 'docs/verification/assets/PP07-CHARTS-02/embedded.png' })
  await object.getByRole('img').click()
  await expect(object).toHaveAttribute('data-selected', 'true')
  await expect(object.getByRole('button', { name: 'Resize chart se', exact: true })).toBeVisible()
  await page.screenshot({ path: 'docs/verification/assets/PP07-CHARTS-02/selected.png' })
  const title = object.getByRole('button', { name: 'Select chart: Revenue', exact: true })
  await object.getByRole('button', { name: 'Position and size', exact: true }).click()
  const placement = page.getByRole('dialog', { name: 'Position and size', exact: true })
  const positionInput = placement.getByRole('textbox', { name: 'Position and size', exact: true })
  await positionInput.fill('F4:L18')
  await positionInput.press('Control+z')
  await expect(object).toHaveAttribute('data-anchor', 'D1:I11')
  await expect(placement).toBeVisible()
  await positionInput.press('Escape')
  await expect(placement).toHaveCount(0)
  await title.click()
  const shortcutDownload = page.waitForEvent('download')
  await title.press('Control+s')
  const savedByShortcut = await shortcutDownload
  expect(savedByShortcut.suggestedFilename()).toMatch(/\.xlsx$/)
  await expect(object).toHaveAttribute('data-anchor', 'D1:I11')
  const before = await object.boundingBox()
  const titleBox = (await title.boundingBox())!
  await page.mouse.move(titleBox.x + titleBox.width / 2, titleBox.y + 22)
  await page.mouse.down()
  await page.mouse.move(titleBox.x + titleBox.width / 2 + 112, titleBox.y + 22 + 64, { steps: 8 })
  await page.mouse.up()
  await expect(object).toHaveAttribute('data-anchor', 'E3:J13')
  expect((await object.boundingBox())!.x - before!.x).toBe(112)
  expect((await object.boundingBox())!.y - before!.y).toBe(64)
  await page.screenshot({ path: 'docs/verification/assets/PP07-CHARTS-02/moved.png' })
  const handle = (await object.getByRole('button', { name: 'Resize chart se', exact: true }).boundingBox())!
  await page.mouse.move(handle.x + 22, handle.y + 22)
  await page.mouse.down()
  await page.mouse.move(handle.x + 22 + 112, handle.y + 22 + 64, { steps: 8 })
  await page.mouse.up()
  await expect(object).toHaveAttribute('data-anchor', 'E3:K15')
  await title.press('ArrowRight')
  await expect(object).toHaveAttribute('data-anchor', 'F3:L15')
  await title.press('Control+z')
  await title.press('Shift+ArrowDown')
  await expect(object).toHaveAttribute('data-anchor', 'E3:K16')
  await title.press('Control+z')
  await expect(object).toHaveAttribute('data-anchor', 'E3:K15')
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await page.screenshot({ path: 'docs/verification/assets/PP07-CHARTS-02/resized.png' })
  await title.press('Control+z')
  await expect(object).toHaveAttribute('data-anchor', 'E3:J13')
  await title.press('Control+z')
  await expect(object).toHaveAttribute('data-anchor', 'D1:I11')
  await title.press('Control+y')
  await title.press('Control+y')
  await expect(object).toHaveAttribute('data-anchor', 'E3:K15')
  const placed = (await object.boundingBox())!
  await grid.evaluate((el) => {
    el.scrollLeft = 80
    el.scrollTop = 32
  })
  await expect.poll(async () => Math.round((await object.boundingBox())!.x)).toBe(Math.round(placed.x - 80))
  await expect.poll(async () => Math.round((await object.boundingBox())!.y)).toBe(Math.round(placed.y - 32))
  await page.screenshot({ path: 'docs/verification/assets/PP07-CHARTS-02/scrolled.png' })
  await page.getByRole('button', { name: 'Zoom in', exact: true }).click()
  await expect.poll(async () => Math.round((await object.boundingBox())!.width)).toBe(Math.round(placed.width * 1.1))
  await page.screenshot({ path: 'docs/verification/assets/PP07-CHARTS-02/zoomed.png' })
  await edit(page, 'B2', '360')
  await object.getByRole('button', { name: 'Select chart: Revenue', exact: true }).click()
  await object.locator('summary').click()
  await grid.evaluate((el) => {
    el.scrollTop = 0
    el.scrollLeft = 0
  })
  await expect.poll(async () => grid.evaluate((el) => el.scrollTop)).toBe(0)
  await expect(object.getByRole('row', { name: 'Jan 360', exact: true })).toBeVisible()
  await page.screenshot({ path: 'docs/verification/assets/PP07-CHARTS-02/live-data.png' })
  await object.locator('summary').click()
  await page.locator('[data-cell-address="A2"]').dblclick()
  await expect(page.getByRole('textbox', { name: 'Edit cell A2', exact: true })).toBeFocused()
  await page.keyboard.press('Escape')
  await expect(object).toHaveAttribute('data-selected', 'false')
  await expect(object.getByRole('button', { name: 'Edit chart', exact: true })).toHaveCount(0)
  await (await gridCommand(page, 'Freeze first row')).click()
  await (await gridCommand(page, 'Freeze first column')).click()
  await grid.evaluate((el) => {
    el.scrollLeft = 160
    el.scrollTop = 160
  })
  await expect.poll(async () => object.evaluate((el) => el.style.clipPath)).toContain('inset(124.8px')
  await page.keyboard.press('Escape')
  await page.screenshot({ path: 'docs/verification/assets/PP07-CHARTS-02/frozen.png' })
  const pending = page.waitForEvent('download')
  await (await gridCommand(page, 'Save As')).click()
  const saveReview = page.getByRole('dialog')
  await expect(saveReview.getByRole('heading', { name: 'Workbook save review', exact: true })).toBeVisible()
  await saveReview.getByRole('button', { name: 'Save As new file', exact: true }).click()
  const download = await pending
  await download.saveAs('tmp/pp07-02-placed.xlsx')
  const chunks: Buffer[] = []
  for await (const chunk of (await download.createReadStream())!) chunks.push(Buffer.from(chunk))
  const bytes = Buffer.concat(chunks)
  const parts = unzipSync(bytes)
  const drawing = strFromU8(parts['xl/drawings/drawing1.xml'])
  expect(drawing).toContain('<xdr:col>4</xdr:col>')
  expect(drawing).toContain('<xdr:col>10</xdr:col>')
  expect(drawing).toContain('<xdr:row>14</xdr:row>')
  const parsed = await parseXlsxWorkbook('placed.xlsx', bytes)
  expect(parsed.workbook!.sheetsById.get(parsed.workbook!.activeSheetId)!.drawings[0].range).toEqual({
    start: { row: 3, column: 5 },
    end: { row: 15, column: 11 },
  })
  for (const theme of ['dark', 'light', 'e-ink-dark', 'e-ink-light']) {
    const fresh = await page.context().newPage()
    await fresh.setViewportSize({ width: 1440, height: 1000 })
    await fresh.addInitScript((value) => localStorage.setItem('allsuite:theme', value), theme)
    await fresh.goto('./#/grid')
    await open(fresh, bytes)
    const reopened = fresh.locator('.grid-chart-object')
    await expect(reopened).toHaveAttribute('data-anchor', 'E3:K15')
    expect(Math.round((await reopened.boundingBox())!.width)).toBe(placed.width)
    await reopened.getByRole('img').click()
    await fresh.screenshot({ path: `docs/verification/assets/PP07-CHARTS-02/reopened-${theme}.png` })
    await fresh.close()
  }
})
