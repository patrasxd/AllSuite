import { gridCommand } from './helpers/grid-command'
import { test, expect, type Page } from '@playwright/test'
import { strFromU8, unzipSync } from 'fflate'
import { parseDelimitedValues } from '../packages/apps/grid/src/engine/editing/clipboard'

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, 'showOpenFilePicker', { configurable: true, value: undefined })
    Object.defineProperty(window, 'showSaveFilePicker', { configurable: true, value: undefined })
  })
})

async function select(page: Page, address: string) {
  const box = page.getByRole('textbox', { name: 'Name box' })
  await box.fill(address)
  await box.press('Enter')
}

async function downloadBytes(page: Page, action: () => Promise<unknown>) {
  const pending = page.waitForEvent('download')
  await action()
  const download = await pending
  const stream = await download.createReadStream()
  if (!stream) throw new Error('Missing actual file stream')
  const chunks: Buffer[] = []
  for await (const chunk of stream) chunks.push(Buffer.from(chunk))
  return { name: download.suggestedFilename(), bytes: Buffer.concat(chunks) }
}

async function preview(page: Page, name: string, text: string | Buffer) {
  await page
    .locator('input[type="file"]')
    .setInputFiles({ name, mimeType: 'text/plain', buffer: typeof text === 'string' ? Buffer.from(text) : text })
  return page.getByRole('dialog', { name: 'CSV/TSV preview' })
}

async function fileTab(page: Page) {
  await page.getByRole('button', { name: 'File', exact: true }).click()
}

test('PP12 real local preview cancellation and dirty discard rejection preserve the workbook', async ({ page }) => {
  await page.goto('./#/grid')
  const bar = page.getByRole('textbox', { name: 'Formula bar' })
  await bar.fill('original')
  await bar.press('Control+Enter')
  await fileTab(page)
  const chooser = page.waitForEvent('filechooser')
  await (await gridCommand(page, 'Import CSV/TSV')).click()
  await (
    await chooser
  ).setFiles({ name: 'data.csv', mimeType: 'text/csv', buffer: Buffer.from('id,name\r\n00123,Zażółć') })
  const dialog = page.getByRole('dialog', { name: 'CSV/TSV preview' })
  await expect(dialog).toContainText('Zażółć')
  await expect(page.getByRole('gridcell', { name: 'A1, original', exact: true })).toBeVisible()
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).last().click()
  await expect(dialog).toBeHidden()
  await expect(page.getByRole('gridcell', { name: 'A1, original', exact: true })).toBeVisible()
  await page
    .locator('input[type="file"]')
    .setInputFiles({ name: 'data.tsv', mimeType: 'text/tab-separated-values', buffer: Buffer.from('new\tvalue') })
  page.once('dialog', (prompt) => prompt.dismiss())
  await dialog.getByRole('button', { name: 'Import workbook', exact: true }).click()
  await expect(page.getByRole('gridcell', { name: 'A1, original', exact: true })).toBeVisible()
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).last().click()
  await page.getByRole('grid').press('Control+z')
  await expect(page.getByRole('gridcell', { name: 'A1, empty', exact: true })).toBeVisible()
  await page.getByRole('grid').press('Control+y')
  await expect(page.getByRole('gridcell', { name: 'A1, original', exact: true })).toBeVisible()
})

test('PP12 quoted UTF-8 import edit actual CSV and TSV bytes fresh import and XLSX reopen', async ({ page }) => {
  const remote: string[] = []
  page.on('request', (request) => {
    if (!request.url().startsWith('http://127.0.0.1:4176/') && /^https?:/.test(request.url()))
      remote.push(request.url())
  })
  await page.goto('./#/grid')
  await fileTab(page)
  const input =
    '\ufeffid;label;expression;extra\r\n00123;"Zażółć; gęślą";=SUM(A1);\r\n;"line\r\n""two""";@cmd;https://example.invalid/no-fetch\r\n;;;\r\n00007;last;+cmd;-cmd'
  const dialog = await preview(page, 'polski.csv', input)
  await dialog.getByRole('combobox', { name: 'Delimiter', exact: true }).selectOption(';')
  await expect(dialog.getByRole('table')).toContainText('Zażółć; gęślą')
  await dialog.getByRole('combobox', { name: 'First row', exact: true }).selectOption('skip')
  await dialog.getByRole('button', { name: 'Import workbook', exact: true }).click()
  await expect(page.locator('.grid-app')).toHaveAttribute('data-dirty', 'true')
  await expect(page.getByRole('gridcell', { name: 'A1, 00123', exact: true })).toBeVisible()
  await expect(page.getByRole('gridcell', { name: 'C1, =SUM(A1)', exact: true })).toBeVisible()
  await select(page, 'C1')
  const bar = page.getByRole('textbox', { name: 'Formula bar' })
  await bar.click()
  await expect(bar).toHaveValue("'=SUM(A1)")
  await bar.press('Escape')
  await select(page, 'B4')
  await bar.fill('Łódź, "edited"')
  await bar.press('Control+Enter')
  await page.getByRole('grid').press('Control+z')
  await expect(page.getByRole('gridcell', { name: 'B4, last', exact: true })).toBeVisible()
  await page.getByRole('grid').press('Control+y')
  await fileTab(page)
  const expected =
    '00123,Zażółć; gęślą,"=SUM(A1)",\r\n,"line\r\n""two""","@cmd",https://example.invalid/no-fetch\r\n,,,\r\n00007,"Łódź, ""edited""","+cmd","-cmd"'
  const expectedTsv =
    '00123\tZażółć; gęślą\t"=SUM(A1)"\t\r\n\t"line\r\n""two"""\t"@cmd"\thttps://example.invalid/no-fetch\r\n\t\t\t\r\n00007\t"Łódź, ""edited"""\t"+cmd"\t"-cmd"'
  let csv!: Buffer
  for (const delimiter of [',', '\t']) {
    await (await gridCommand(page, 'Export CSV/TSV')).click()
    const exportDialog = page.getByRole('dialog', { name: 'Export CSV/TSV', exact: true })
    await expect(exportDialog).toContainText('does not prevent')
    await exportDialog.getByRole('combobox', { name: 'File format' }).selectOption(delimiter)
    const output = await downloadBytes(page, () =>
      exportDialog.getByRole('button', { name: 'Export file', exact: true }).click(),
    )
    const text = output.bytes.toString('utf8')
    expect(output.name).toBe(delimiter === ',' ? 'Sheet.csv' : 'Sheet.tsv')
    expect(text).toBe(delimiter === ',' ? expected : expectedTsv)
    expect(output.bytes.includes(Buffer.from('Łódź', 'utf8'))).toBe(true)
    expect(parseDelimitedValues(text, delimiter as ',' | '\t', 'text')).toEqual(
      parseDelimitedValues(expected, ',', 'text'),
    )
    await expect(page.locator('.grid-app')).toHaveAttribute('data-dirty', 'true')
    if (delimiter === ',') csv = output.bytes
  }
  const xlsx = await downloadBytes(page, async () => (await gridCommand(page, 'Save As')).click())
  const xml = strFromU8(unzipSync(xlsx.bytes)['xl/worksheets/sheet1.xml'])
  expect(xml).not.toContain('<f>')
  expect(xml).toContain('=SUM(A1)')
  expect(xml).toContain('<t>Łódź, "edited"</t>')
  expect(xml).toContain('line&#13;\n"two"')
  await expect(page.locator('.grid-app')).not.toHaveAttribute('data-dirty', 'true')
  await page.locator('input[type="file"]').setInputFiles({
    name: 'roundtrip.xlsx',
    mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    buffer: xlsx.bytes,
  })
  await page
    .getByRole('dialog', { name: 'Workbook compatibility check' })
    .getByRole('button', { name: 'Open workbook', exact: true })
    .click()
  await expect(page.getByRole('gridcell', { name: 'A1, 00123', exact: true })).toBeVisible()
  await expect(page.getByRole('gridcell', { name: 'C1, =SUM(A1)', exact: true })).toBeVisible()
  await (await gridCommand(page, 'Export CSV/TSV')).click()
  await downloadBytes(page, () =>
    page
      .getByRole('dialog', { name: 'Export CSV/TSV', exact: true })
      .getByRole('button', { name: 'Export file', exact: true })
      .click(),
  )
  await expect(page.locator('.grid-app')).not.toHaveAttribute('data-dirty', 'true')
  const fresh = await page.context().newPage()
  await fresh.goto('./#/grid')
  const freshDialog = await preview(fresh, 'fresh.csv', csv)
  await freshDialog.getByRole('button', { name: 'Import workbook', exact: true }).click()
  await expect(fresh.getByRole('gridcell', { name: 'A1, 00123', exact: true })).toBeVisible()
  await expect(fresh.getByRole('gridcell', { name: 'C1, =SUM(A1)', exact: true })).toBeVisible()
  await expect(fresh.getByRole('gridcell', { name: 'B4, Łódź, "edited"', exact: true })).toBeVisible()
  await fresh.close()
  expect(remote).toEqual([])
})

test('PP12 pending text draft survives preview Escape and discard rejection without committing', async ({ page }) => {
  await page.goto('./#/grid')
  await fileTab(page)
  const bar = page.getByRole('textbox', { name: 'Formula bar' })
  await bar.fill('uncommitted draft')
  const chooser = page.waitForEvent('filechooser')
  await (await gridCommand(page, 'Import CSV/TSV')).click()
  await (await chooser).setFiles({ name: 'draft.csv', mimeType: 'text/csv', buffer: Buffer.from('replacement') })
  const dialog = page.getByRole('dialog', { name: 'CSV/TSV preview' })
  await expect(dialog).toBeVisible()
  page.once('dialog', (prompt) => prompt.dismiss())
  await dialog.getByRole('button', { name: 'Import workbook', exact: true }).click()
  await expect(bar).toHaveValue('uncommitted draft')
  await page.keyboard.press('Escape')
  await expect(dialog).toBeHidden()
  await expect(bar).toBeFocused()
  await expect(bar).toHaveValue('uncommitted draft')
  await bar.press('Escape')
  await expect(page.getByRole('gridcell', { name: 'A1, empty', exact: true })).toBeVisible()
  await expect(page.locator('.grid-app')).not.toHaveAttribute('data-dirty', 'true')
})

test('PP12 malformed oversize UTF-8 failure and preview controls never partially replace data', async ({ page }) => {
  await page.goto('./#/grid')
  const bar = page.getByRole('textbox', { name: 'Formula bar' })
  await bar.fill('keep me')
  await bar.press('Control+Enter')
  await fileTab(page)
  for (const text of ['"unfinished', 'a,b\nc', 'x'.repeat(1_000_001)]) {
    const dialog = await preview(page, 'bad.csv', text)
    await expect(dialog.getByRole('alert')).toBeVisible()
    await expect(dialog.getByRole('button', { name: 'Import workbook', exact: true })).toBeDisabled()
    await dialog.getByRole('button', { name: 'Cancel', exact: true }).last().click()
    await expect(page.getByRole('gridcell', { name: 'A1, keep me', exact: true })).toBeVisible()
  }
  for (const bytes of [Buffer.from([0xff]), Buffer.alloc(4_000_001, 'x')]) {
    await preview(page, 'invalid.csv', bytes)
    await expect(page.getByRole('status')).toContainText('Invalid, oversized')
    await expect(page.getByRole('dialog', { name: 'CSV/TSV preview' })).toBeHidden()
    await expect(page.getByRole('gridcell', { name: 'A1, keep me', exact: true })).toBeVisible()
  }
  const dialog = await preview(page, 'typed.tsv', 'id\tvalue\r\n00123\t12\r\n=1+2\tTRUE')
  await dialog.getByRole('combobox', { name: 'First row' }).selectOption('skip')
  await dialog.getByRole('combobox', { name: 'Value types' }).selectOption('scalars')
  page.once('dialog', (prompt) => prompt.accept())
  await dialog.getByRole('button', { name: 'Import workbook', exact: true }).click()
  await select(page, 'B1')
  await bar.click()
  await expect(bar).toHaveValue('12')
  await bar.press('Escape')
  await select(page, 'A2')
  await bar.click()
  await expect(bar).toHaveValue("'=1+2")
  await bar.press('Escape')
  await expect(page.locator('.grid-app')).toHaveAttribute('data-dirty', 'true')
})
