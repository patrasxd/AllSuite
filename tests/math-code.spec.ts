import { test, expect, type Page } from '@playwright/test'

async function observeCodeDomWrites(page: Page) {
  await page.addInitScript(() => {
    const writes: string[] = []
    Object.assign(window, { codeDomWrites: writes })
    const descriptor = Object.getOwnPropertyDescriptor(Element.prototype, 'innerHTML')!
    Object.defineProperty(Element.prototype, 'innerHTML', {
      ...descriptor,
      set(value: string) {
        if (this.matches('[contenteditable="true"] code, [contenteditable="true"] code *')) writes.push(value)
        descriptor.set!.call(this, value)
      },
    })
  })
}

test('@smoke equation dialog previews and inserts rendered math', async ({ page }) => {
  await page.goto('./#/draft')
  const editor = page.getByRole('textbox', { name: 'Document editor', exact: true })

  await page.getByRole('tab', { name: 'Insert', exact: true }).click()
  await page.getByRole('button', { name: 'Equation', exact: true }).click()
  const equationDialog = page.getByRole('dialog', { name: 'Equation', exact: true })
  const source = equationDialog.getByRole('textbox', { name: 'LaTeX source', exact: true })
  await source.fill('\\frac{x_1}{y}')
  await expect(equationDialog.locator('.draft-equation-preview .katex')).toBeVisible()
  await equationDialog.getByRole('button', { name: 'Insert', exact: true }).click()
  await expect(editor.locator('.draft-math-node--inline .katex')).toBeVisible()
})

test('@smoke code dialog inserts a highlighted language-labeled block', async ({ page }) => {
  // Prism must only tokenize for ProseMirror decorations. Its automatic DOM
  // highlighter replaces editable code and resets the native selection.
  await observeCodeDomWrites(page)
  await page.goto('./#/draft')
  const editor = page.getByRole('textbox', { name: 'Document editor', exact: true })
  await page.getByRole('tab', { name: 'Insert', exact: true }).click()
  await page.getByRole('button', { name: 'Code block', exact: true }).click()
  const codeDialog = page.getByRole('dialog', { name: 'Code block', exact: true })
  await codeDialog.getByRole('combobox', { name: 'Language label', exact: true }).selectOption('javascript')
  await codeDialog.getByRole('button', { name: 'Insert', exact: true }).click()
  await editor.pressSequentially('const answer = 42')
  const code = editor.locator('pre.draft-code-block[data-language="javascript"]')
  await expect(code).toContainText('const answer = 42')
  await expect(code.locator('.draft-code-token--keyword')).toHaveText('const')
  expect(await page.evaluate(() => (window as unknown as { codeDomWrites: string[] }).codeDomWrites)).toEqual([])
})

test('lazy syntax highlighting preserves a live code caret', async ({ page }) => {
  await observeCodeDomWrites(page)
  let releaseGrammar!: () => void
  const grammarGate = new Promise<void>((resolve) => (releaseGrammar = resolve))
  await page.route('**/assets/prism-*.js', async (route) => {
    await grammarGate
    await route.continue()
  })
  await page.goto('./#/draft')
  const editor = page.getByRole('textbox', { name: 'Document editor', exact: true })
  await page.getByRole('tab', { name: 'Insert', exact: true }).click()
  await page.getByRole('button', { name: 'Code block', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'Code block', exact: true })
  await dialog.getByRole('combobox', { name: 'Language label', exact: true }).selectOption('javascript')
  await dialog.getByRole('button', { name: 'Insert', exact: true }).click()
  await editor.pressSequentially('const')
  releaseGrammar()
  const code = editor.locator('pre.draft-code-block[data-language="javascript"]')
  await expect(code.locator('.draft-code-token--keyword')).toHaveText('const')
  // Allow Prism's startup animation-frame callback to run, if it was scheduled.
  await page.evaluate(
    () => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))),
  )
  expect(await page.evaluate(() => (window as unknown as { codeDomWrites: string[] }).codeDomWrites)).toEqual([])
  await expect(editor).toBeFocused()
  await page.keyboard.type(' answer = 42')
  await expect(code).toHaveText('const answer = 42')
  await expect(code.locator('.draft-code-token--keyword')).toHaveText('const')
})
