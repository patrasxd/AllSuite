import { expect, test, type Page } from '@playwright/test'
import type { Editor } from '@tiptap/core'
import { readFileSync } from 'node:fs'

const document = JSON.parse(readFileSync('tests/helpers/task-pane-document.json', 'utf8'))
const evidence = 'docs/verification/task-panes-ux/'
const editorOf = (page: Page) => page.getByRole('textbox', { name: 'Document editor', exact: true })
const paneOf = (page: Page) => page.locator('.allsuite-task-pane-host:not([hidden])')
async function populate(page: Page) {
  await page.goto('./apps/draft')
  await editorOf(page).evaluate((element, doc) => {
    const editor = (element as HTMLElement & { editor: Editor }).editor
    editor.commands.setContent(doc)
    editor.view.dispatch(editor.state.tr.setDocAttribute('comments', doc.attrs.comments))
  }, document)
  await page.getByRole('tab', { name: 'Review', exact: true }).click()
}

test('populated review panes keep contextual drafts, anchors and search across modes', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await populate(page)
  await page.getByRole('button', { name: /^Comments \(3\)$/ }).click()
  const pane = paneOf(page)
  await expect(pane.locator('.draft-comment-thread')).toHaveCount(3)
  await expect(pane.getByRole('textbox')).toHaveCount(0)
  await page.screenshot({ path: evidence + 'after-comments.png' })
  await pane.locator('.draft-comment-anchor-link').first().click()
  await expect
    .poll(() =>
      editorOf(page).evaluate((element) => {
        const editor = (element as HTMLElement & { editor: Editor }).editor
        return editor.state.doc.textBetween(editor.state.selection.from, editor.state.selection.to)
      }),
    )
    .toBe('shared workspace')
  await page.getByRole('button', { name: 'Add comment', exact: true }).click()
  await page.getByLabel('New comment', { exact: true }).fill('Ask the team about accessible workshop times.')
  await expect(pane.getByRole('button', { name: 'Add comment', exact: true })).toBeEnabled()
  await expect(page.getByLabel('New comment', { exact: true })).toBeFocused()
  await page.screenshot({ path: evidence + 'after-composer.png' })
  await page.getByRole('button', { name: /^Review changes \(3\)$/ }).click()
  await expect(pane.locator('.draft-suggestion-card')).toHaveCount(3)
  await expect(pane.getByRole('textbox')).toHaveCount(0)
  await expect(page.locator('.all-side-panel:visible')).toHaveCount(1)
  await page.screenshot({ path: evidence + 'after-switch-review.png' })
  await pane.locator('.draft-suggestion-jump').first().click()
  await expect(editorOf(page)).toBeFocused()
  await page.screenshot({ path: evidence + 'after-review.png' })
  await page.getByRole('button', { name: /^Comments \(3\)$/ }).click()
  await expect(page.getByLabel('New comment', { exact: true })).toHaveValue(
    'Ask the team about accessible workshop times.',
  )
  await page.keyboard.press('Control+f')
  await page.getByRole('textbox', { name: 'Find', exact: true }).fill('Review')
  await expect(pane.locator('.draft-search-results li')).toHaveCount(5)
  await expect(pane.locator('.draft-search-context strong').first()).toHaveText('review')
  await page.screenshot({ path: evidence + 'after-results.png' })
  await pane.getByRole('button', { name: 'Headings', exact: true }).click()
  await expect(pane.getByRole('treeitem')).toHaveCount(4)
  await expect(pane.getByRole('textbox', { name: 'Find', exact: true })).toHaveValue('Review')
  await expect(page.locator('.draft-search-match')).toHaveCount(0)
  await page.screenshot({ path: evidence + 'after-headings.png' })
  await pane.getByRole('textbox', { name: 'Find', exact: true }).fill('workshop')
  await expect(pane.getByRole('button', { name: 'Find', exact: true })).toHaveAttribute('aria-pressed', 'true')
  await expect(pane.locator('.draft-search-results li')).toHaveCount(3)
  await pane.getByRole('button', { name: 'Replace', exact: true }).click()
  await expect(pane.getByRole('textbox', { name: 'Replace with', exact: true })).toBeVisible()
  await page.screenshot({ path: evidence + 'after-replace.png' })
  await pane.getByRole('button', { name: 'Find', exact: true }).click()
  await expect(pane.getByRole('textbox', { name: 'Replace with', exact: true })).toHaveCount(0)
  await pane.locator('.draft-search-options summary').click()
  await pane.getByRole('switch', { name: 'Case-sensitive', exact: true }).click()
  await expect(pane.locator('.draft-search-results li')).toHaveCount(2)
})

for (const theme of ['dark', 'light', 'e-ink-light', 'e-ink-dark']) {
  test(`populated mobile ${theme}: threads and revisions remain readable and bounded`, async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await page.addInitScript((theme) => localStorage.setItem('allsuite:theme', theme), theme)
    await populate(page)
    // Shortcuts use the same pane state as the compact ribbon.
    await editorOf(page).focus()
    await page.keyboard.press('Control+Alt+Shift+m')
    await expect(paneOf(page).locator('.draft-comment-thread')).toHaveCount(3)
    await page.screenshot({ path: evidence + `after-mobile-${theme}.png` })
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    const targets = await paneOf(page)
      .locator('button:visible:not(:disabled)')
      .evaluateAll((elements) =>
        elements.map((element) => {
          const rect = element.getBoundingClientRect()
          return { width: rect.width, height: rect.height }
        }),
      )
    expect(targets.every(({ width, height }) => width >= 44 && height >= 44)).toBe(true)
    await page.keyboard.press('Escape')
    await expect(editorOf(page)).toBeFocused()
    await expect(editorOf(page)).toContainText('Open Studio')
  })
}
