import { gridCommand } from './helpers/grid-command'
import { test, expect, type Page } from '@playwright/test'
import { strFromU8, unzipSync } from 'fflate'

async function select(page: Page, range: string) {
  const box = page.getByRole('textbox', { name: 'Name box' })
  await box.fill(range)
  await box.press('Enter')
}

test('PP01-FIX identical external plain text never inherits internal types and survives XLSX reopen', async ({
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
  for (const [address, value] of [
    ['A1', "'12"],
    ['B1', "'TRUE"],
    ['A2', '00123'],
    ['B2', "'=literal"],
    ['A3', '2023-03-15'],
    ['B3', '7'],
    ['G4', 'clear me'],
    ['J1', 'neighbor'],
  ]) {
    await select(page, address)
    await bar.fill(value)
    await bar.press('Control+Enter')
  }
  await select(page, 'A1:B4')
  await grid.press('Control+c')
  await expect(page.getByRole('status')).toContainText('Values copied')
  await select(page, 'D1')
  await grid.press('Control+v')
  await expect(page.getByRole('status')).toContainText('Values pasted')
  await select(page, 'D1')
  await bar.click()
  await expect(bar).toHaveValue("'12")
  await bar.press('Escape')

  // Another page writes only plain text to the real OS clipboard, as an external app would.
  const external = await context.newPage()
  await external.goto('./')
  await external.evaluate(async () => {
    const text = await navigator.clipboard.readText()
    await navigator.clipboard.writeText(text)
  })
  await external.close()
  await page.bringToFront()
  await select(page, 'G1')
  await grid.press('Control+v')
  await expect(page.getByRole('textbox', { name: 'Name box' })).toHaveValue('G1:H4')
  await select(page, 'G1')
  await bar.click()
  await expect(bar).toHaveValue('12')
  await bar.press('Escape')
  await select(page, 'H1')
  await bar.click()
  await expect(bar).toHaveValue('TRUE')
  await bar.press('Escape')
  await grid.press('Control+z')
  for (const address of ['G1', 'H1', 'G2', 'H2'])
    await expect(page.getByRole('gridcell', { name: `${address}, empty`, exact: true })).toBeVisible()
  await expect(page.getByRole('gridcell', { name: 'G4, clear me', exact: true })).toBeVisible()
  await grid.press('Control+y')
  await expect(page.getByRole('gridcell', { name: 'G2, 00123', exact: true })).toBeVisible()
  await expect(page.getByRole('gridcell', { name: 'H2, =literal', exact: true })).toBeVisible()
  await expect(page.getByRole('gridcell', { name: 'G4, empty', exact: true })).toBeVisible()

  const pending = page.waitForEvent('download')
  await page.getByRole('button', { name: 'File', exact: true }).click()
  await (await gridCommand(page, 'Save As')).click()
  const download = await pending
  const stream = await download.createReadStream()
  if (!stream) throw new Error('Missing download')
  const chunks: Buffer[] = []
  for await (const chunk of stream) chunks.push(Buffer.from(chunk))
  const bytes = Buffer.concat(chunks)
  const xml = strFromU8(unzipSync(bytes)['xl/worksheets/sheet1.xml'])
  expect(xml).toMatch(/<c\b[^>]*r="D1"[^>]*t="inlineStr"[^>]*>[\s\S]*?<t[^>]*>12<\/t>/)
  expect(xml).toMatch(/<c\b[^>]*r="E1"[^>]*t="inlineStr"[^>]*>[\s\S]*?<t[^>]*>TRUE<\/t>/)
  // The existing writer omits t for the OOXML default numeric kind.
  expect(xml).toContain('<c r="G1"><v>12</v></c>')
  expect(xml).toMatch(/<c\b[^>]*r="H1"[^>]*t="b"[^>]*>\s*<v>1<\/v>/)
  expect(xml).not.toContain('<f>')
  await page.locator('input[type="file"]').setInputFiles({
    name: 'provenance.xlsx',
    mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    buffer: bytes,
  })
  await page
    .getByRole('dialog', { name: 'Workbook compatibility check' })
    .getByRole('button', { name: 'Open workbook', exact: true })
    .click()
  for (const [address, expected] of [
    ['D1', "'12"],
    ['E1', "'TRUE"],
    ['G1', '12'],
    ['H1', 'TRUE'],
    ['G2', '00123'],
    ['H2', "'=literal"],
    ['D3', '2023-03-15'],
    ['E3', '7'],
    ['G3', '45000'],
    ['H3', '7'],
    ['G4', ''],
    ['J1', 'neighbor'],
  ]) {
    await select(page, address)
    await bar.click()
    await expect(bar).toHaveValue(expected)
    await bar.press('Escape')
  }
  await expect(page.locator('.grid-app')).not.toHaveAttribute('data-dirty', 'true')
})

for (const capability of ['custom format unavailable', 'read unavailable after copy'] as const) {
  test(`PP01-FIX plain TSV fallback when ${capability}`, async ({ page, context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write'])
    await page.goto('./#/grid')
    const grid = page.getByRole('grid')
    const bar = page.getByRole('textbox', { name: 'Formula bar' })
    await bar.fill("'12")
    await bar.press('Control+Enter')
    if (capability === 'custom format unavailable')
      await page.evaluate(() => Object.defineProperty(ClipboardItem, 'supports', { value: () => false }))
    await grid.press('Control+c')
    await expect(page.getByRole('status')).toContainText('Values copied')
    if (capability === 'read unavailable after copy')
      await page.evaluate(() => Object.defineProperty(navigator.clipboard, 'read', { value: undefined }))
    await select(page, 'D1')
    await grid.press('Control+v')
    await expect(page.getByRole('status')).toContainText('Values pasted')
    await bar.click()
    await expect(bar).toHaveValue('12')
    await bar.press('Escape')
  })
}

test('PP01-FIX token and text must both match, and denied rich clipboard calls do not mutate history', async ({
  page,
  context,
}) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write'])
  await page.goto('./#/grid')
  const grid = page.getByRole('grid')
  const bar = page.getByRole('textbox', { name: 'Formula bar' })
  await bar.fill("'12")
  await bar.press('Control+Enter')
  await grid.press('Control+c')
  await expect(page.getByRole('status')).toContainText('Values copied')
  const original = await page.evaluate(async () => {
    const type = 'web application/x-allsuite-grid-values-token'
    const [item] = await navigator.clipboard.read()
    return { token: await (await item.getType(type)).text(), text: await (await item.getType('text/plain')).text() }
  })
  expect(original.text.trim()).toBe('12')
  expect(original.token).toMatch(/^[\da-f-]{36}$/)
  for (const [address, text, token] of [
    ['D1', original.text, 'unrelated-token'],
    ['E1', 'TRUE', original.token],
  ]) {
    await page.evaluate(
      async ({ text, token }) => {
        await navigator.clipboard.write([
          new ClipboardItem({
            'text/plain': new Blob([text], { type: 'text/plain' }),
            'web application/x-allsuite-grid-values-token': new Blob([token], {
              type: 'application/x-allsuite-grid-values-token',
            }),
          }),
        ])
      },
      { text, token },
    )
    await select(page, address)
    await grid.press('Control+v')
    await expect(page.getByRole('status')).toContainText('Values pasted')
    await bar.click()
    await expect(bar).toHaveValue(text.trim())
    await bar.press('Escape')
  }
  await select(page, 'G1')
  await page.evaluate(() => {
    const denied = async () => {
      throw new DOMException('Denied', 'NotAllowedError')
    }
    Object.defineProperty(navigator, 'clipboard', {
      value: {
        read: denied,
        write: denied,
        readText: denied,
        writeText: denied,
      },
    })
  })
  await grid.press('Control+v')
  await expect(page.getByRole('status')).toContainText('Clipboard operation refused')
  await expect(page.getByRole('textbox', { name: 'Name box' })).toHaveValue('G1')
  await grid.press('Control+c')
  await expect(page.getByRole('status')).toContainText('Clipboard operation refused')
  await expect(page.getByRole('gridcell', { name: 'G1, empty', exact: true })).toBeVisible()
  await grid.press('Control+z')
  await expect(page.getByRole('gridcell', { name: 'E1, empty', exact: true })).toBeVisible()
  await expect(page.getByRole('gridcell', { name: 'D1, 12', exact: true })).toBeVisible()
  await grid.press('Control+y')
  await expect(page.getByRole('gridcell', { name: 'E1, TRUE', exact: true })).toBeVisible()
})

test('PP01 keyboard and context values clipboard, one undo/redo, native editor and permission refusal', async ({
  page,
  context,
}) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write'])
  await page.goto('./#/grid')
  const grid = page.getByRole('grid')
  const bar = page.getByRole('textbox', { name: 'Formula bar' })
  await bar.fill('00123')
  await bar.press('Control+Enter')
  await select(page, 'B1')
  await bar.fill('TRUE')
  await bar.press('Control+Enter')
  await select(page, 'A1:B3')
  await grid.press('Control+c')
  await expect(page.getByRole('status')).toContainText('Values copied')
  expect((await page.evaluate(() => navigator.clipboard.readText())).replaceAll('\r\n', '\n')).toBe(
    '00123\tTRUE\n\t\n\t',
  )
  await select(page, 'D1')
  await page.locator('[data-cell-address="D1"]').click({ button: 'right' })
  await page.getByRole('menuitem', { name: 'Paste values', exact: true }).click()
  await expect(page.getByRole('gridcell', { name: 'D1, 00123', exact: true })).toBeVisible()
  await expect(page.getByRole('gridcell', { name: 'E1, TRUE', exact: true })).toBeVisible()
  await expect(page.getByRole('textbox', { name: 'Name box' })).toHaveValue('D1:E3')
  await grid.press('Control+z')
  await expect(page.getByRole('gridcell', { name: 'D1, empty', exact: true })).toBeVisible()
  await grid.press('Control+y')
  await expect(page.getByRole('gridcell', { name: 'D1, 00123', exact: true })).toBeVisible()
  await expect(page.locator('.grid-app')).toHaveAttribute('data-dirty', 'true')

  // Focused editor retains native text clipboard behavior, never block paste.
  await page.evaluate(() => navigator.clipboard.writeText('=literal'))
  await bar.fill('draft ')
  await bar.press('End')
  await bar.press('Control+v')
  await expect(bar).toHaveValue('draft =literal')
  await bar.press('Escape')
  await select(page, 'G1')
  await grid.press('Control+v')
  await expect(page.getByRole('gridcell', { name: 'G1, =literal', exact: true })).toBeVisible()

  await select(page, 'H1')
  await page.evaluate(() => {
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {
        readText: async () => {
          throw new DOMException('Denied', 'NotAllowedError')
        },
        writeText: async () => {
          throw new DOMException('Denied', 'NotAllowedError')
        },
      },
    })
  })
  await grid.press('Control+v')
  await expect(page.getByRole('status')).toContainText('Clipboard operation refused')
  await expect(page.getByRole('gridcell', { name: 'H1, empty', exact: true })).toBeVisible()
  await grid.press('Control+c')
  await expect(page.getByRole('status')).toContainText('Clipboard operation refused')
  await grid.press('Control+z')
  await expect(page.getByRole('gridcell', { name: 'G1, empty', exact: true })).toBeVisible()
})

test('PP01 file-backed typed values survive copy, actual XLSX download and fresh browser reopen', async ({
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
  for (const [address, text] of [
    ['A1', "'12"],
    ['B1', 'TRUE'],
    ['A2', "'=literal"],
    ['B2', '7'],
    ['A3', 'Zażółć'],
    ['F3', 'neighbor'],
  ]) {
    await select(page, address)
    await bar.fill(text)
    await bar.press('Control+Enter')
  }
  const save = async () => {
    const pending = page.waitForEvent('download')
    await page.getByRole('button', { name: 'File', exact: true }).click()
    await (await gridCommand(page, 'Save As')).click()
    const download = await pending
    const stream = await download.createReadStream()
    if (!stream) throw new Error('Missing download')
    const chunks: Buffer[] = []
    for await (const chunk of stream) chunks.push(Buffer.from(chunk))
    return Buffer.concat(chunks)
  }
  const open = async (bytes: Buffer) => {
    await page.locator('input[type="file"]').setInputFiles({
      name: 'values.xlsx',
      mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      buffer: bytes,
    })
    await page
      .getByRole('dialog', { name: 'Workbook compatibility check' })
      .getByRole('button', { name: 'Open workbook', exact: true })
      .click()
  }
  await open(await save())
  await select(page, 'A1')
  await grid.press('Shift+ArrowRight')
  await grid.press('Shift+ArrowDown')
  await grid.press('Shift+ArrowDown')
  await grid.press('Shift+F10')
  await page.getByRole('menuitem', { name: 'Copy values', exact: true }).click()
  await expect(page.getByRole('status')).toContainText('Values copied')
  await select(page, 'D1')
  await grid.press('Control+v')
  await expect(page.getByRole('textbox', { name: 'Name box' })).toHaveValue('D1:E3')
  const bytes = await save()
  const xml = strFromU8(unzipSync(bytes)['xl/worksheets/sheet1.xml'])
  expect(xml).toMatch(/<c\b[^>]*r="D1"[^>]*t="inlineStr"[^>]*>[\s\S]*?<t[^>]*>12<\/t>/)
  expect(xml).toMatch(/<c\b[^>]*r="E1"[^>]*t="b"[^>]*>\s*<v>1<\/v>/)
  expect(xml).not.toContain('<f>')
  await open(bytes)
  for (const [address, value] of [
    ['A1', '12'],
    ['B1', 'TRUE'],
    ['A2', '=literal'],
    ['B2', '7'],
    ['A3', 'Zażółć'],
    ['D1', '12'],
    ['E1', 'TRUE'],
    ['D2', '=literal'],
    ['E2', '7'],
    ['D3', 'Zażółć'],
    ['F3', 'neighbor'],
  ]) {
    await expect(page.getByRole('gridcell', { name: `${address}, ${value}`, exact: true })).toBeVisible()
  }
  await select(page, 'D1')
  await bar.click()
  await expect(bar).toHaveValue("'12")
  await bar.press('Escape')
  await expect(page.locator('.grid-app')).not.toHaveAttribute('data-dirty', 'true')
})

test('PP01 fresh formula value, malformed TSV and deferred clipboard target changes are safe', async ({
  page,
  context,
}) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write'])
  await page.goto('./#/grid')
  const grid = page.getByRole('grid')
  const bar = page.getByRole('textbox', { name: 'Formula bar' })
  await bar.fill('=2+3')
  await bar.press('Control+Enter')
  await expect(page.getByRole('gridcell', { name: 'A1, 5', exact: true })).toBeVisible()
  await grid.press('Control+c')
  await expect(page.getByRole('status')).toContainText('Values copied')
  await select(page, 'D1')
  await grid.press('Control+v')
  await expect(page.getByRole('gridcell', { name: 'D1, 5', exact: true })).toBeVisible()
  await bar.click()
  await expect(bar).toHaveValue('5')
  await bar.press('Escape')
  await select(page, 'E1')
  await page.evaluate(() => navigator.clipboard.writeText('a\tb\nc'))
  await grid.press('Control+v')
  await expect(page.getByRole('status')).toContainText('Clipboard operation refused')
  await expect(page.getByRole('gridcell', { name: 'E1, empty', exact: true })).toBeVisible()
  await page.evaluate(() => {
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {
        readText: () => new Promise<string>((resolve) => Object.assign(window, { __resolveValues: resolve })),
      },
    })
  })
  await grid.press('Control+v')
  await bar.fill('pending draft')
  await page.evaluate(() =>
    (window as unknown as { __resolveValues: (value: string) => void }).__resolveValues('replace'),
  )
  await expect(page.getByRole('status')).toContainText('Clipboard operation refused')
  await expect(bar).toBeFocused()
  await expect(bar).toHaveValue('pending draft')
  await bar.press('Escape')
  await expect(page.getByRole('gridcell', { name: 'E1, empty', exact: true })).toBeVisible()
  await grid.press('Control+z')
  await expect(page.getByRole('gridcell', { name: 'D1, empty', exact: true })).toBeVisible()
})
