import { expect, test, type Locator, type Page } from '@playwright/test'
import { strToU8, zipSync } from 'fflate'

const docxType = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'

function documentFixture(text: string, extra = '') {
  return Buffer.from(
    zipSync({
      'word/document.xml': strToU8(
        `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>${text}</w:t></w:r></w:p>${extra}</w:body></w:document>`,
      ),
    }),
  )
}

async function openFallbackFile(page: Page, file: { name: string; mimeType: string; buffer: Buffer }) {
  await page.getByRole('tab', { name: 'File', exact: true }).click()
  const chooser = page.waitForEvent('filechooser')
  await page.getByRole('button', { name: 'Open', exact: true }).click()
  await (await chooser).setFiles(file)
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, 'showOpenFilePicker', { value: undefined, configurable: true })
    Object.defineProperty(window, 'showSaveFilePicker', { value: undefined, configurable: true })
  })
})

test('opens DOCX, edits, saves and reopens the exported document', async ({ page }) => {
  await page.goto('./#/draft')
  await openFallbackFile(page, { name: 'round-trip.docx', mimeType: docxType, buffer: documentFixture('Original') })

  const editor = page.getByRole('textbox', { name: 'Document editor', exact: true })
  await expect(editor).toContainText('Original')
  await editor.click()
  await page.keyboard.press('End')
  await page.keyboard.type(' edited')

  const downloadEvent = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Save', exact: true }).click()
  const download = await downloadEvent
  const stream = await download.createReadStream()
  const saved: Buffer[] = []
  for await (const chunk of stream) saved.push(Buffer.from(chunk))
  await expect(page.getByRole('status')).toContainText('Ready')

  await page.getByRole('button', { name: 'New', exact: true }).click()
  await expect(editor).not.toContainText('Original')
  const chooser = page.waitForEvent('filechooser')
  await page.getByRole('button', { name: 'Open', exact: true }).click()
  await (await chooser).setFiles({ name: 'reopened.docx', mimeType: docxType, buffer: Buffer.concat(saved) })
  await expect(editor).toContainText('Original edited')
})

test('a corrupted DOCX reports an error without replacing the document', async ({ page }) => {
  await page.goto('./#/draft')
  const editor = page.getByRole('textbox', { name: 'Document editor', exact: true })
  await openFallbackFile(page, {
    name: 'corrupted.docx',
    mimeType: docxType,
    buffer: Buffer.from('this is not a zip archive'),
  })
  await expect(page.getByText('The file could not be opened or saved.', { exact: true })).toBeVisible()
  await expect(editor).toBeEmpty()
})

async function expectNamedControls(container: Locator) {
  const controls = container.locator('button, input, select, [role="switch"]')
  for (let index = 0; index < (await controls.count()); index++) {
    const control = controls.nth(index)
    if (!(await control.isVisible())) continue
    const name = await control.evaluate((element) => {
      const labelledBy = element.getAttribute('aria-labelledby')
      const labelled = labelledBy
        ? labelledBy
            .split(/\s+/)
            .map((id) => document.getElementById(id)?.textContent || '')
            .join(' ')
        : ''
      const labels =
        'labels' in element
          ? Array.from(element.labels || [])
              .map((label) => label.textContent || '')
              .join(' ')
          : ''
      return (
        element.getAttribute('aria-label') ||
        labelled ||
        labels ||
        element.getAttribute('title') ||
        element.textContent ||
        ''
      ).trim()
    })
    expect(name, `control ${index} needs an accessible name`).not.toBe('')
  }
}

async function keyboardWalkControls(page: Page, panel: Locator) {
  await panel.evaluate((element) => {
    const controls = Array.from(
      element.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled]), select:not([disabled])'),
    ).filter((control) => control.getClientRects().length > 0 && control.tabIndex >= 0)
    controls.forEach((control, index) => control.setAttribute('data-release-focus-index', String(index)))
  })
  await panel.locator('[data-release-focus-index="0"]').focus()
  const visited = new Set<string>()
  for (let index = 0; index < 100; index++) {
    const focusedIndex = await page.locator(':focus').getAttribute('data-release-focus-index')
    if (focusedIndex === null) break
    expect(visited.has(focusedIndex), `toolbar keyboard stop ${index + 1} must not loop`).toBe(false)
    visited.add(focusedIndex!)
    await page.keyboard.press('Tab')
  }
  expect(visited.size).toBeGreaterThan(0)
}

test('all tabs, toolbars and dialogs are keyboard reachable, labelled and visibly focused', async ({ page }) => {
  await page.goto('./#/draft')
  const tablist = page.getByRole('tablist', { name: 'Document toolbar' })
  const tabs = ['File', 'Edit', 'Insert', 'Format', 'Layout', 'View']
  const first = tablist.getByRole('tab', { name: 'File', exact: true })
  await first.focus()
  for (const name of tabs.slice(1)) {
    await page.keyboard.press('ArrowRight')
    await expect(tablist.getByRole('tab', { name, exact: true })).toBeFocused()
    await expect(tablist.getByRole('tab', { name, exact: true })).toHaveAttribute('aria-selected', 'true')
  }

  for (const name of tabs) {
    const trigger = tablist.getByRole('tab', { name, exact: true })
    await trigger.click()
    const panel = page.getByRole('tabpanel', { name, exact: true })
    await expect(panel).toBeVisible()
    await expectNamedControls(panel)
    await keyboardWalkControls(page, panel)
  }

  await tablist.getByRole('tab', { name: 'Format', exact: true }).click()
  const formatToolbar = page.getByRole('toolbar', { name: 'Format' })
  await expectNamedControls(formatToolbar)
  await keyboardWalkControls(page, formatToolbar)

  await page.getByRole('button', { name: 'Bold', exact: true }).focus()
  const focused = page.locator(':focus')
  await expect(focused).toBeVisible()
  const focusStyle = await focused.evaluate((element) => {
    const style = getComputedStyle(element)
    return { outline: style.outlineStyle, width: Number.parseFloat(style.outlineWidth), shadow: style.boxShadow }
  })
  expect(focusStyle.width > 0 || focusStyle.shadow !== 'none').toBe(true)

  await page.getByRole('button', { name: 'Open paragraph settings', exact: true }).focus()
  await page.keyboard.press('Enter')
  const paragraph = page.getByRole('dialog', { name: 'Paragraph settings', exact: true })
  await expect(paragraph).toBeVisible()
  await expectNamedControls(paragraph)
  await page.keyboard.press('Escape')
  await expect(paragraph).toBeHidden()

  await tablist.getByRole('tab', { name: 'Insert', exact: true }).click()
  await page.getByRole('button', { name: 'Special characters', exact: true }).click()
  const symbols = page.getByRole('dialog', { name: 'Special characters', exact: true })
  await expect(symbols).toBeVisible()
  await expectNamedControls(symbols)
  await page.keyboard.press('Escape')
  await expect(symbols).toBeHidden()
})

for (const theme of ['dark', 'light', 'e-ink-light', 'e-ink-dark']) {
  test(`primary editor text meets contrast in ${theme}`, async ({ page }) => {
    await page.addInitScript((value) => localStorage.setItem('allsuite:theme', value), theme)
    await page.goto('./#/draft')
    const ratio = await page.getByRole('status').evaluate((element) => {
      const parse = (value: string) =>
        value
          .match(/[\d.]+/g)
          ?.slice(0, 3)
          .map(Number) || [0, 0, 0]
      const luminance = (value: number[]) => {
        const channels = value.map((channel) => {
          const normalized = channel / 255
          return normalized <= 0.04045 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4
        })
        return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722
      }
      const style = getComputedStyle(element)
      const foreground = luminance(parse(style.color))
      let backgroundElement: Element | null = element
      let backgroundColor = style.backgroundColor
      while (backgroundElement && /rgba?\([^)]*,\s*0(?:\.0+)?\)$/.test(backgroundColor)) {
        backgroundElement = backgroundElement.parentElement
        if (backgroundElement) backgroundColor = getComputedStyle(backgroundElement).backgroundColor
      }
      const background = luminance(parse(backgroundColor))
      return (Math.max(foreground, background) + 0.05) / (Math.min(foreground, background) + 0.05)
    })
    expect(ratio).toBeGreaterThanOrEqual(4.5)
  })
}
