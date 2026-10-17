import { test, expect } from '@playwright/test'

test('editing commands, history, headings, alignment and dirty navigation', async ({ page }) => {
  await page.goto('./#/draft')
  const editor = page.getByRole('textbox', { name: 'Document editor', exact: true })
  await editor.fill('Hello document')
  await editor.press('Control+a')
  await page.getByRole('button', { name: 'Bold', exact: true }).click()
  await expect(editor.locator('strong')).toHaveText('Hello document')
  await expect(page.getByRole('button', { name: 'Bold', exact: true })).toHaveAttribute('aria-pressed', 'true')
  await page.getByRole('tab', { name: 'Edit', exact: true }).click()
  await page.getByRole('button', { name: 'Undo', exact: true }).click()
  await expect(editor.locator('strong')).toHaveCount(0)
  await page.getByRole('button', { name: 'Redo', exact: true }).click()
  await expect(editor.locator('strong')).toHaveText('Hello document')
  await editor.press('Control+Alt+6')
  await expect(editor.locator('h6')).toHaveText('Hello document')
  await editor.press('Control+e')
  await expect(editor.locator('h6')).toHaveAttribute('style', /text-align: center/)
  await expect(page.getByRole('status')).toHaveText('Unsaved changes')
  await page.getByRole('button', { name: 'Back to AllSuite' }).click()
  await expect(page.getByRole('dialog')).toBeVisible()
  await page.getByRole('button', { name: 'Stay', exact: true }).click()
  await expect(editor).toContainText('Hello document')
  const keys = await page.evaluate(() => ({ local: Object.keys(localStorage), session: Object.keys(sessionStorage) }))
  expect(
    keys.local.every((key) =>
      ['allsuite:locale', 'allsuite:theme', 'allsuite:draft:view-preferences', 'allsuite:draft:image-options'].includes(
        key,
      ),
    ),
  ).toBe(true)
  expect(keys.session).toEqual([])
})

test('list commands create nested items and can outdent them', async ({ page }) => {
  await page.goto('./#/draft')
  const editor = page.getByRole('textbox', { name: 'Document editor', exact: true })
  await editor.fill('First')
  await page.getByRole('button', { name: 'Bullet list', exact: true }).click()
  await editor.press('End')
  await editor.press('Enter')
  await editor.pressSequentially('Second')
  await page.getByRole('button', { name: 'Indent list', exact: true }).click()
  await expect(editor.locator('ul ul li')).toHaveText('Second')
  await page.getByRole('button', { name: 'Outdent list', exact: true }).click()
  await expect(editor.locator('ul ul')).toHaveCount(0)
  await editor.press('Tab')
  await expect(editor.locator('ul ul li')).toHaveText('Second')
  await editor.press('Shift+Tab')
  await expect(editor.locator('ul ul')).toHaveCount(0)
})

test('native rich/plain paste sanitizes HTML and never starts remote requests', async ({ page }) => {
  const remote: string[] = []
  page.on('request', (request) => {
    if (request.url().includes('unsafe.test')) remote.push(request.url())
  })
  await page.goto('./#/draft')
  const editor = page.getByRole('textbox', { name: 'Document editor', exact: true })
  await editor.focus()
  await editor.evaluate((element) => {
    const data = new DataTransfer()
    data.setData(
      'text/html',
      '<p><strong>Safe text</strong><img src="https://unsafe.test/image"><script>evil()</script></p>',
    )
    data.setData('text/plain', 'Safe text')
    element.dispatchEvent(new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: data }))
  })
  await expect(editor.locator('strong')).toHaveText('Safe text')
  await expect(editor.locator('img,script')).toHaveCount(0)
  await editor.press('Control+a')
  await editor.evaluate((element) => {
    // Deliver one shortcut + paste pair without reading or overwriting the user's system clipboard.
    element.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'v', ctrlKey: true, shiftKey: true, bubbles: true, cancelable: true }),
    )
    const data = new DataTransfer()
    data.setData('text/html', '<h1>Rich</h1>')
    data.setData('text/plain', '<b>Literal text</b>')
    element.dispatchEvent(new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: data }))
  })
  await expect(editor).toHaveText('<b>Literal text</b>')
  await expect(editor.locator('h1,strong,b')).toHaveCount(0)
  expect(remote).toEqual([])
})

test('formatting stays intact across all four presentation themes', async ({ page }) => {
  await page.goto('./#/draft')
  const editor = page.getByRole('textbox', { name: 'Document editor', exact: true })
  await editor.fill('Styled text')
  await editor.press('Control+a')
  await page.getByRole('textbox', { name: 'Font size (pt)' }).fill('18')
  await page.getByRole('textbox', { name: 'Font size (pt)' }).press('Enter')
  await page.getByLabel('Text color', { exact: true }).fill('#aabbcc')
  const original = await editor.innerHTML()
  await page.getByRole('button', { name: 'Open preferences menu', exact: true }).click()
  for (const [base, eink, theme] of [
    ['Light', 'Off', 'light'],
    ['Light', 'On', 'e-ink-light'],
    ['Dark', 'On', 'e-ink-dark'],
    ['Dark', 'Off', 'dark'],
  ]) {
    await page.getByRole('button', { name: base, exact: true }).click()
    await page.getByRole('button', { name: eink, exact: true }).click()
    await expect(page.locator('html')).toHaveAttribute('data-theme', theme)
    expect(await editor.innerHTML()).toBe(original)
  }
})

test('paragraph dialog, columns, view preferences and autoformat work together', async ({ page }) => {
  await page.goto('./#/draft')
  const editor = page.getByRole('textbox', { name: 'Document editor', exact: true })
  await editor.fill('Paragraph text')
  await page.getByRole('tab', { name: 'Format', exact: true }).click()
  await page.getByRole('button', { name: 'Open paragraph settings', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'Paragraph settings', exact: true })
  await dialog.getByRole('textbox', { name: 'Spacing before (pt)' }).fill('6')
  await dialog.getByRole('textbox', { name: 'Spacing after (pt)' }).fill('12')
  await dialog.getByRole('textbox', { name: 'Left indent (pt)' }).fill('18')
  await dialog.getByRole('textbox', { name: 'Tab stops (pt)' }).fill('72, 144')
  await dialog.getByRole('button', { name: 'Apply', exact: true }).click()
  await expect(editor.locator('p')).toHaveCSS('margin-top', '8px')
  await expect(editor.locator('p')).toHaveCSS('margin-bottom', '16px')
  await expect(editor.locator('p')).toHaveCSS('margin-left', '24px')

  await page.getByRole('tab', { name: 'Layout', exact: true }).click()
  await page.getByRole('combobox', { name: 'Columns', exact: true }).selectOption('2')
  await expect(editor).toHaveCSS('column-count', '2')

  await page.getByRole('tab', { name: 'View', exact: true }).click()
  await page.getByRole('button', { name: 'Ruler', exact: true }).click()
  await expect(page.locator('.draft-ruler')).toHaveCount(0)
  await page.getByRole('button', { name: 'Show formatting marks', exact: true }).click()
  await expect(editor.locator('.draft-format-space')).toHaveCount(1)
  await page.getByRole('button', { name: 'Autoformat while typing', exact: true }).click()
  await editor.fill('')
  await editor.pressSequentially('--')
  await expect(editor).toContainText('--')
  await expect(editor).not.toContainText('–')
})

test('autoformat rules are language-aware and each replacement is undoable once', async ({ page }) => {
  await page.goto('./#/draft')
  const editor = page.getByRole('textbox', { name: 'Document editor', exact: true })
  await editor.focus()
  await editor.pressSequentially('--')
  await expect(editor).toHaveText('–')
  await editor.press('Control+z')
  await expect(editor).toHaveText('--')
  await editor.press('Control+a')
  await editor.press('Backspace')
  await expect(editor).toHaveText('')
  await editor.pressSequentially('"Hello" ...')
  await expect(editor).toHaveText('“Hello” …')
  await editor.press('Control+a')
  await editor.press('Backspace')
  await expect(editor).toHaveText('')
  await editor.pressSequentially('- ')
  await expect(editor.locator('ul li')).toHaveCount(1)

  await page.reload()
  const freshEditor = page.getByRole('textbox', { name: 'Document editor', exact: true })
  await freshEditor.focus()
  await freshEditor.pressSequentially('# ')
  await expect(freshEditor.locator('h1')).toHaveCount(1)
  await page.reload()
  const numberedEditor = page.getByRole('textbox', { name: 'Document editor', exact: true })
  await numberedEditor.focus()
  await numberedEditor.pressSequentially('1. ')
  await expect(numberedEditor.locator('ol li')).toHaveCount(1)
  await page.getByRole('button', { name: 'Open preferences menu', exact: true }).click()
  await page.getByRole('button', { name: 'Polski', exact: true }).click()
  const polishEditor = page.getByRole('textbox', { name: 'Edytor dokumentu', exact: true })
  await polishEditor.fill('')
  await polishEditor.pressSequentially('"Tekst"')
  await expect(polishEditor).toHaveText('„Tekst”')
})

test('editing utilities find across formatting, report selection stats and insert local symbols', async ({ page }) => {
  await page.goto('./#/draft')
  const editor = page.getByRole('textbox', { name: 'Document editor', exact: true })
  await editor.focus()
  await editor.evaluate((element) => {
    const data = new DataTransfer()
    data.setData('text/html', '<p><strong>Hel</strong><em>lo</em> hello</p>')
    data.setData('text/plain', 'Hello hello')
    element.dispatchEvent(new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: data }))
  })
  await editor.press('Control+f')
  const find = page.getByRole('search', { name: 'Find and replace', exact: true })
  await find.getByRole('textbox', { name: 'Find', exact: true }).fill('hello')
  await expect(find).toContainText('1/2')
  expect(await editor.locator('.draft-search-match').count()).toBeGreaterThanOrEqual(2)
  await editor.press('Control+h')
  await find.getByRole('textbox', { name: 'Replace with', exact: true }).fill('world')
  await find.getByRole('button', { name: 'Replace all', exact: true }).click()
  await expect(editor).toHaveText('world world')
  await find.getByRole('button', { name: 'Close find and replace', exact: true }).click()

  await editor.press('Control+a')
  await expect(page.locator('.draft-status-bar')).toContainText('Selection: 2 words, 11 characters')
  await expect(page.locator('.draft-status-bar')).toContainText('Characters with spaces: 11')
  await expect(page.locator('.draft-status-bar')).toContainText('Pages: 1')

  expect(
    await page.evaluate(() =>
      performance.getEntriesByType('resource').some((entry) => entry.name.toLowerCase().includes('carlito')),
    ),
  ).toBe(false)
  await page.getByRole('tab', { name: 'Format', exact: true }).click()
  await page.getByRole('combobox', { name: 'Font family', exact: true }).selectOption('Carlito')
  await expect(editor.locator('span[style*="Carlito"]')).toHaveCount(1)
  await expect.poll(() => page.evaluate(() => document.fonts.check('16px Carlito'))).toBe(true)
  await page.getByRole('tab', { name: 'View', exact: true }).click()
  await page.getByRole('combobox', { name: 'Document language', exact: true }).selectOption('pl')
  await expect(editor).toHaveAttribute('lang', 'pl-PL')

  await editor.press('End')
  await page.getByRole('tab', { name: 'Insert', exact: true }).click()
  await page.getByRole('button', { name: 'Special characters', exact: true }).click()
  await page.getByRole('button', { name: 'Insert ©', exact: true }).click()
  await expect(editor).toContainText('©')
  await page.getByRole('tab', { name: 'Insert', exact: true }).click()
  await page.getByRole('button', { name: 'Emoji', exact: true }).click()
  await page.getByRole('button', { name: 'Insert 😀', exact: true }).click()
  await expect(editor).toContainText('😀')
})
