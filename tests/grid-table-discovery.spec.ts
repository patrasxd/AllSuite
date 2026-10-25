import { expectGridTableContext, gridCommand } from './helpers/grid-command'
import { test, expect, type Page } from '@playwright/test'
import { unzipSync, strFromU8 } from 'fflate'
import { tableAndNoteFixture } from '../packages/apps/grid/src/engine/xlsx/fixtures/safety-corpus'

const cell = (page: Page, address: string) => page.locator(`[data-cell-address="${address}"]`)

test('PP06-UI-FIX empty workbook discovers Insert and explains required selection', async ({ page }) => {
  await page.goto('./apps/grid')
  await page.screenshot({
    path: `docs/verification/assets/pp06-ui-${process.env.PP06_SCREENSHOT_PHASE || 'after'}-toolbar.png`,
  })
  const tabs = page.locator('.all-workspace-tabs').getByRole('tab')
  await expect(tabs).toHaveText(['Home', 'Insert', 'Data', 'View'])
  await expect(page.getByRole('button', { name: 'File', exact: true })).toBeVisible()
  await page.getByRole('tab', { name: 'Insert', exact: true }).click()
  await expect(page.getByRole('tab', { name: 'Insert', exact: true })).toHaveAttribute('aria-selected', 'true')
  await page.screenshot({ path: 'docs/verification/assets/pp06-ui-after-insert.png', animations: 'disabled' })
  const create = await gridCommand(page, 'Create Table')
  await expect(create).toBeVisible()
  await expect(create).toBeEnabled()
  await create.click()
  await expect(page.getByRole('status')).toContainText('Select one rectangular range')
  await expect(page.getByRole('dialog')).toHaveCount(0)
})

async function enterData(page: Page, locale = 'en') {
  for (const [address, value] of [
    ['A1', 'Name'],
    ['B1', 'Team'],
    ['A2', 'Anna'],
    ['B2', 'A'],
    ['A3', 'Bob'],
    ['B3', 'B'],
  ]) {
    await cell(page, address).dblclick()
    const editor = page.getByRole('textbox', {
      name: `${locale === 'en' ? 'Edit cell' : 'Edytuj komórkę'} ${address}`,
      exact: true,
    })
    await editor.fill(value)
    await editor.press('Enter')
  }
  const box = page.locator('.grid-name-box input')
  await box.fill('A1:B3')
  await box.press('Enter')
}

test('PP06-UI-FIX visible creation from entered data saves reopens and converts selected table', async ({
  page,
  context,
}) => {
  await context.addInitScript(() =>
    Object.defineProperty(window, 'showSaveFilePicker', { configurable: true, value: undefined }),
  )
  await page.goto('./apps/grid')
  await enterData(page)
  await page.getByRole('tab', { name: 'Insert', exact: true }).click()
  await (await gridCommand(page, 'Create Table')).click()
  const dialog = page.getByRole('dialog', { name: 'Create Table', exact: true })
  await dialog.getByRole('textbox', { name: 'Table name' }).fill('People')
  await dialog.getByRole('button', { name: 'Create Table', exact: true }).click()
  await expect(cell(page, 'A1')).toHaveAttribute('data-table-role', 'header')
  await expect(page.getByRole('grid')).toBeFocused()
  await cell(page, 'D1').click()
  await expect(page.getByRole('button', { name: 'Convert to Range', exact: true })).toHaveCount(0)
  await page.getByRole('button', { name: 'File', exact: true }).click()
  const pending = page.waitForEvent('download')
  await (await gridCommand(page, 'Save As')).click()
  const download = await pending
  const chunks: Buffer[] = []
  for await (const chunk of (await download.createReadStream())!) chunks.push(Buffer.from(chunk))
  const bytes = Buffer.concat(chunks)
  const parts = unzipSync(bytes)
  expect(strFromU8(parts['xl/tables/table1.xml'])).toContain('displayName="People"')
  expect(strFromU8(parts['xl/tables/table1.xml'])).toContain('ref="A1:B3"')
  expect(strFromU8(parts['xl/worksheets/sheet1.xml'])).toContain('tableParts')
  expect(strFromU8(parts['xl/worksheets/_rels/sheet1.xml.rels'])).toContain('../tables/table1.xml')
  expect(strFromU8(parts['[Content_Types].xml'])).toContain('spreadsheetml.table+xml')
  const fresh = await context.newPage()
  await fresh.goto('./apps/grid')
  await fresh.locator('input[type="file"]').setInputFiles({
    name: 'people.xlsx',
    mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    buffer: bytes,
  })
  await fresh
    .getByRole('dialog', { name: 'Workbook compatibility check' })
    .getByRole('button', { name: 'Open workbook', exact: true })
    .click()
  await cell(fresh, 'B2').click()
  await expectGridTableContext(fresh, 'People', 'A1:B3')
  await expect(cell(fresh, 'A1')).toHaveAttribute('data-table-role', 'header')
  // The native filter remains usable after the fresh file-input reopen.
  await fresh.getByRole('button', { name: 'File', exact: true }).click()
  await (await gridCommand(fresh, 'AutoFilter')).click()
  await expect(fresh.getByRole('dialog', { name: 'AutoFilter', exact: true })).toBeVisible()
  await fresh.getByRole('dialog', { name: 'AutoFilter', exact: true }).press('Escape')
  await fresh.getByRole('tab', { name: 'Insert', exact: true }).click()
  await (await gridCommand(fresh, 'Convert to Range')).click()
  await expect(cell(fresh, 'A1')).not.toHaveAttribute('data-table-role', 'header')
  for (const [address, value] of [
    ['A1', 'Name'],
    ['B1', 'Team'],
    ['A2', 'Anna'],
    ['B2', 'A'],
    ['A3', 'Bob'],
    ['B3', 'B'],
  ]) {
    await expect(cell(fresh, address)).toHaveText(value)
  }
  await expect(fresh.getByRole('button', { name: 'Convert to Range', exact: true })).toHaveCount(0)
  await fresh.close()
})

test('PP06-UI-FIX Insert refuses conversion of an unsupported imported table', async ({ page }) => {
  await page.goto('./apps/grid')
  await page.locator('input[type="file"]').setInputFiles({
    name: 'protected.xlsx',
    mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    buffer: Buffer.from(tableAndNoteFixture()),
  })
  await page
    .getByRole('dialog', { name: 'Workbook compatibility check' })
    .getByRole('button', { name: 'Open workbook', exact: true })
    .click()
  await cell(page, 'A1').click()
  await page.getByRole('tab', { name: 'Insert', exact: true }).click()
  await (await gridCommand(page, 'Convert to Range')).click()
  await expect(page.getByRole('status')).toContainText('Cannot create or convert this table')
  await expect(page.getByRole('button', { name: 'Convert to Range', exact: true })).toBeVisible()
  await expect(cell(page, 'A1')).not.toHaveAttribute('data-table-role', 'header')
})

for (const theme of ['light', 'dark', 'e-ink-light', 'e-ink-dark']) {
  for (const locale of ['en', 'pl']) {
    test(`PP06-UI-FIX mobile keyboard discovery ${theme} ${locale}`, async ({ page }) => {
      await page.setViewportSize({ width: 390, height: 844 })
      await page.addInitScript(
        ({ theme, locale }) => {
          localStorage.setItem('allsuite:theme', theme)
          localStorage.setItem('allsuite:locale', locale)
        },
        { theme, locale },
      )
      await page.goto('./apps/grid')
      const insert = page.getByRole('tab', { name: locale === 'en' ? 'Insert' : 'Wstaw', exact: true })
      // Reach the localized Home tab from normal document focus, then use tablist arrows.
      for (let i = 0; i < 30; i++) {
        await page.keyboard.press('Tab')
        if (
          await page
            .getByRole('tab', { name: locale === 'en' ? 'Home' : 'Narzędzia główne', exact: true })
            .evaluate((el) => el === document.activeElement)
        )
          break
      }
      await expect(
        page.getByRole('tab', { name: locale === 'en' ? 'Home' : 'Narzędzia główne', exact: true }),
      ).toBeFocused()
      await page.keyboard.press('ArrowRight')
      await expect(insert).toBeFocused()
      await expect(insert).toHaveAttribute('aria-selected', 'true')
      const create = page.getByRole('button', { name: locale === 'en' ? 'Create Table' : 'Utwórz tabelę', exact: true })
      await page.keyboard.press('Tab')
      await expect(create).toBeFocused()
      const focus = await create.evaluate((el) => ({
        outline: getComputedStyle(el).outlineStyle,
        width: getComputedStyle(el).outlineWidth,
        visible: el.matches(':focus-visible'),
      }))
      expect(focus.visible).toBe(true)
      expect(focus.outline).not.toBe('none')
      expect(parseFloat(focus.width)).toBeGreaterThan(0)
      const bounds = (await create.boundingBox())!
      expect(bounds.width).toBeGreaterThanOrEqual(44)
      expect(bounds.height).toBeGreaterThanOrEqual(44)
      expect(bounds.x).toBeGreaterThanOrEqual(0)
      expect(bounds.x + bounds.width).toBeLessThanOrEqual(390)
      await page.screenshot({
        path: `docs/verification/assets/pp06-ui-focus-${theme}-${locale}.png`,
        animations: 'disabled',
      })
      await page.keyboard.press('Enter')
      await expect(page.getByRole('status')).toContainText(
        locale === 'en' ? 'Select one rectangular range' : 'Zaznacz jeden prostokątny zakres',
      )
      await enterData(page, locale)
      await insert.click()
      await create.click()
      const dialog = page.getByRole('dialog')
      await expect(dialog).toBeVisible()
      await expect(
        dialog.getByRole('button', { name: locale === 'en' ? 'Cancel' : 'Anuluj', exact: true }).first(),
      ).toBeFocused()
      await page.keyboard.press('Tab')
      await expect(
        dialog.getByRole('textbox', { name: locale === 'en' ? 'Table name' : 'Nazwa tabeli', exact: true }),
      ).toBeFocused()
      await page.keyboard.press('Control+a')
      await page.keyboard.type('MobilePeople')
      const confirm = dialog.getByRole('button', {
        name: locale === 'en' ? 'Create Table' : 'Utwórz tabelę',
        exact: true,
      })
      for (let step = 0; step < 8 && !(await confirm.evaluate((el) => el === document.activeElement)); step++)
        await page.keyboard.press('Tab')
      await expect(confirm).toBeFocused()
      await page.keyboard.press('Enter')
      await expect(cell(page, 'A1')).toHaveAttribute('data-table-role', 'header')
      await expect(page.getByRole('grid')).toBeFocused()
      const convert = page.getByRole('button', {
        name: locale === 'en' ? 'Convert to Range' : 'Konwertuj na zakres',
        exact: true,
      })
      // Conversion belongs on the contextual Table tab. Reach it with
      // the tablist arrows, then traverse the same compact mobile tool dock.
      await page.keyboard.press('Escape')
      await expect(insert).toBeFocused()
      await page.keyboard.press('ArrowRight')
      await expect(page.getByRole('tab', { name: locale === 'en' ? 'Data' : 'Dane', exact: true })).toBeFocused()
      await page.keyboard.press('ArrowRight')
      await expect(page.getByRole('tab', { name: locale === 'en' ? 'View' : 'Widok', exact: true })).toBeFocused()
      await page.keyboard.press('ArrowRight')
      await expect(page.getByRole('tab', { name: locale === 'en' ? 'Table' : 'Tabela', exact: true })).toBeFocused()
      await page.keyboard.press('Tab')
      await expect(page.getByRole('button', { name: locale === 'en' ? 'Filter' : 'Filtr', exact: true })).toBeFocused()
      await page.keyboard.press('Enter')
      await expect(
        page.getByRole('button', { name: locale === 'en' ? 'AutoFilter' : 'Autofiltr', exact: true }),
      ).toBeFocused()
      await page.keyboard.press('Escape')
      await page.keyboard.press('Tab')
      await expect(page.getByRole('button', { name: locale === 'en' ? 'More' : 'Więcej', exact: true })).toBeFocused()
      await page.keyboard.press('Enter')
      await expect(page.getByRole('button', { name: locale === 'en' ? 'Done' : 'Gotowe', exact: true })).toBeFocused()
      await page.keyboard.press('Tab')
      await expect(
        page.getByRole('button', { name: locale === 'en' ? 'AutoFilter' : 'Autofiltr', exact: true }),
      ).toBeFocused()
      await page.keyboard.press('Tab')
      await expect(convert).toBeFocused()
      const convertBounds = (await convert.boundingBox())!
      expect(convertBounds.x).toBeGreaterThanOrEqual(0)
      expect(convertBounds.x + convertBounds.width).toBeLessThanOrEqual(390)
      await page.screenshot({
        path: `docs/verification/assets/pp06-ui-mobile-${theme}-${locale}.png`,
        animations: 'disabled',
      })
      await page.keyboard.press('Enter')
      await expect(cell(page, 'A2')).toHaveText('Anna')
      await expect(cell(page, 'A1')).not.toHaveAttribute('data-table-role', 'header')
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390)
    })
  }
}
