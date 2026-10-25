import { gridCommand } from './helpers/grid-command'
import { test, expect, type Page } from '@playwright/test'
import { unzipSync, strFromU8 } from 'fflate'
import { tableAndNoteFixture } from '../packages/apps/grid/src/engine/xlsx/fixtures/safety-corpus'

async function edit(page: Page, text: string) {
  const formula = page.getByRole('textbox', { name: 'Formula bar' })
  await formula.fill(text)
  await formula.press('Control+Enter')
}

async function save(page: Page) {
  await page.getByRole('button', { name: 'File', exact: true }).click()
  await (await gridCommand(page, 'Save')).click()
}

test('Grid saves the checkpoint taken before a deferred picker and keeps later edits dirty through undo', async ({
  page,
}) => {
  await page.addInitScript(() => {
    const state = { bytes: [] as number[], choose: null as null | (() => void) }
    Object.assign(window, { __gridCheckpoint: state })
    Object.defineProperty(window, 'showSaveFilePicker', {
      configurable: true,
      value: () =>
        new Promise((resolve) => {
          state.choose = () =>
            resolve({
              name: 'snapshot.xlsx',
              createWritable: async () => ({
                write: async (blob: Blob) => {
                  state.bytes = [...new Uint8Array(await blob.arrayBuffer())]
                },
                close: async () => {},
              }),
            })
        }),
    })
  })
  await page.goto('./#/grid')
  await edit(page, 'checkpoint')
  await save(page)
  await edit(page, 'later edit')
  await page.evaluate(() =>
    (window as unknown as { __gridCheckpoint: { choose: () => void } }).__gridCheckpoint.choose(),
  )
  await expect(page.getByRole('status')).toContainText('snapshot was saved')
  const bytes = await page.evaluate(
    () => (window as unknown as { __gridCheckpoint: { bytes: number[] } }).__gridCheckpoint.bytes,
  )
  const xml = strFromU8(unzipSync(new Uint8Array(bytes))['xl/worksheets/sheet1.xml'])
  expect(xml).toContain('checkpoint')
  expect(xml).not.toContain('later edit')
  await expect(page.locator('.grid-app')).toHaveAttribute('data-dirty', 'true')
  const grid = page.getByRole('grid', { name: 'Spreadsheet grid' })
  await grid.focus()
  await grid.press('Control+z')
  await expect(page.locator('.grid-app')).not.toHaveAttribute('data-dirty', 'true')
  await expect(page.getByRole('gridcell', { name: 'A1, checkpoint' })).toBeVisible()
  await grid.press('Control+y')
  await expect(page.locator('.grid-app')).toHaveAttribute('data-dirty', 'true')
})

test('Grid safely saves supported column formulas at each undo/redo checkpoint', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, 'showSaveFilePicker', { configurable: true, value: undefined })
  })
  await page.goto('./#/grid')
  await edit(page, '=1+1')
  await expect(page.getByRole('gridcell', { name: 'A1, 2', exact: true })).toBeVisible()
  const grid = page.getByRole('grid', { name: 'Spreadsheet grid' })
  await grid.focus()
  await grid.press('Shift+F10')
  await page.getByRole('menuitem', { name: 'Insert column before' }).click()
  await expect(page.getByRole('gridcell', { name: 'B1, 2', exact: true })).toBeVisible()
  for (const [index, address] of ['B1', 'A1', 'B1'].entries()) {
    if (index > 0) {
      await grid.focus()
      await grid.press(index === 1 ? 'Control+z' : 'Control+y')
    }
    await expect(page.getByRole('gridcell', { name: `${address}, 2`, exact: true })).toBeVisible()
    const pending = page.waitForEvent('download')
    await save(page)
    const download = await pending
    const chunks: Buffer[] = []
    for await (const chunk of (await download.createReadStream())!) chunks.push(Buffer.from(chunk))
    const xml = strFromU8(unzipSync(Buffer.concat(chunks))['xl/worksheets/sheet1.xml'])
    expect(xml).toContain(`<c r="${address}"><f>1+1</f><v>2</v></c>`)
    await expect(page.locator('.grid-app')).not.toHaveAttribute('data-dirty', 'true')
  }
})

test('Grid refuses an acknowledged risky copy to a renamed nonempty input source', async ({ page }) => {
  await page.addInitScript(() => {
    const state = { writes: 0, empty: false, bytes: [] as number[] }
    Object.assign(window, { __gridIntegrity: state })
    Object.defineProperty(window, 'showSaveFilePicker', {
      configurable: true,
      value: async () => ({
        name: 'renamed-original.xlsx',
        getFile: async () => new File(state.empty ? [] : ['original bytes'], 'renamed-original.xlsx'),
        createWritable: async () => {
          state.writes++
          return {
            write: async (blob: Blob) => {
              state.bytes = [...new Uint8Array(await blob.arrayBuffer())]
            },
            close: async () => {},
          }
        },
      }),
    })
  })
  await page.goto('./#/grid')
  await page.locator('input[type="file"]').setInputFiles({
    name: 'source.xlsx',
    mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    buffer: Buffer.from(tableAndNoteFixture()),
  })
  await page
    .getByRole('dialog', { name: 'Workbook compatibility check' })
    .getByRole('button', { name: 'Open workbook' })
    .click()
  const nameBox = page.getByRole('textbox', { name: 'Name box' })
  await nameBox.fill('E5')
  await nameBox.press('Enter')
  await edit(page, 'ordinary edit')
  await save(page)
  const review = page.getByRole('dialog', { name: 'Workbook save review' })
  await expect(review).toBeVisible()
  await review.getByRole('button', { name: 'Save as new file' }).click()
  await expect(page.getByRole('status')).toContainText('different')
  expect(
    await page.evaluate(() => (window as unknown as { __gridIntegrity: { writes: number } }).__gridIntegrity.writes),
  ).toBe(0)
  await expect(page.locator('.grid-app')).toHaveAttribute('data-dirty', 'true')
  await page.evaluate(() => {
    ;(window as unknown as { __gridIntegrity: { empty: boolean } }).__gridIntegrity.empty = true
  })
  await save(page)
  await review.getByRole('button', { name: 'Save as new file' }).click()
  await expect(page.locator('.grid-app')).not.toHaveAttribute('data-dirty', 'true')
  const bytes = await page.evaluate(
    () => (window as unknown as { __gridIntegrity: { bytes: number[] } }).__gridIntegrity.bytes,
  )
  const output = unzipSync(new Uint8Array(bytes))
  expect(strFromU8(output['xl/worksheets/sheet1.xml'])).toContain('ordinary edit')
  const original = unzipSync(tableAndNoteFixture())
  for (const path of [
    'xl/tables/table1.xml',
    'xl/comments1.xml',
    'xl/drawings/vmlDrawing1.vml',
    'xl/worksheets/_rels/sheet1.xml.rels',
  ])
    expect([...output[path]]).toEqual([...original[path]])
  await page.locator('input[type="file"]').setInputFiles({
    name: 'reopen.xlsx',
    mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    buffer: Buffer.from(bytes),
  })
  await page
    .getByRole('dialog', { name: 'Workbook compatibility check' })
    .getByRole('button', { name: 'Open workbook' })
    .click()
  await expect(page.getByRole('gridcell', { name: 'E5, ordinary edit' })).toBeVisible()
})

for (const failure of ['cancel', 'picker', 'write', 'close'] as const) {
  test(`Grid ${failure} save failure stays dirty; a later successful retry saves`, async ({ page }) => {
    await page.addInitScript((mode) => {
      const state = { retry: false, writes: 0, closes: 0 }
      Object.assign(window, { __gridIntegrity: state })
      Object.defineProperty(window, 'showSaveFilePicker', {
        configurable: true,
        value: async () => {
          if (!state.retry && mode === 'cancel') throw new DOMException('cancel', 'AbortError')
          if (!state.retry && mode === 'picker') throw new Error('picker failed')
          return {
            name: 'saved.xlsx',
            getFile: async () => new File([], 'saved.xlsx'),
            createWritable: async () => ({
              write: async () => {
                state.writes++
                if (!state.retry && mode === 'write') throw new Error('write failed')
              },
              close: async () => {
                if (!state.retry && mode === 'close') throw new Error('close failed')
                state.closes++
              },
              abort: async () => {},
            }),
          }
        },
      })
    }, failure)
    await page.goto('./#/grid')
    await edit(page, 'retain this edit')
    await save(page)
    await expect(page.getByRole('status')).toContainText(failure === 'cancel' ? 'cancel' : 'failed')
    await expect(page.locator('.grid-app')).toHaveAttribute('data-dirty', 'true')
    await page.evaluate(() => {
      ;(window as unknown as { __gridIntegrity: { retry: boolean } }).__gridIntegrity.retry = true
    })
    await save(page)
    await expect(page.locator('.grid-app')).not.toHaveAttribute('data-dirty', 'true')
    expect(
      await page.evaluate(() => (window as unknown as { __gridIntegrity: { closes: number } }).__gridIntegrity.closes),
    ).toBe(1)
  })
}
