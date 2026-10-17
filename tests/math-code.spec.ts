import { test, expect } from '@playwright/test'

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
})
