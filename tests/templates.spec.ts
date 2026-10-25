import { draftFileAction } from './helpers/reveal-toolbar-command'
import { test, expect } from '@playwright/test'

test('New document offers five templates that open in the editor', async ({ page }) => {
  await page.goto('./#/draft')
  await page.getByRole('button', { name: 'File', exact: true }).click()
  const editor = page.getByRole('textbox', { name: 'Document editor', exact: true })
  const choices = [
    ['Classic CV', 'Name Surname'],
    ['Letter', 'Dear recipient,'],
    ['Report', 'Report title'],
    ['Meeting notes', 'Team or project'],
    ['Essay', 'Essay title'],
  ] as const

  for (const [index, [label, sample]] of choices.entries()) {
    if (index === 0) {
      await draftFileAction(page, 'New')
    } else {
      const confirmation = page.waitForEvent('dialog')
      page.once('dialog', (prompt) => void prompt.accept())
      await draftFileAction(page, 'New')
      const prompt = await confirmation
      expect(prompt.type()).toBe('confirm')
      expect(prompt.message()).toBe('Discard unsaved changes?')
    }
    const dialog = page.getByRole('dialog', { name: 'New document', exact: true })
    await expect(dialog).toBeVisible()
    await expect(dialog.getByRole('button', { name: new RegExp(`^${label}`) })).toBeVisible()
    await dialog.getByRole('button', { name: new RegExp(`^${label}`) }).click()
    await expect(dialog).toBeHidden()
    await expect(editor).toContainText(sample)
    await editor.focus()
    await editor.press('Control+End')
    await editor.pressSequentially(' [edited]')
    await expect(editor).toContainText(sample)
    await expect(editor).toContainText('[edited]')
  }
})

test('New document template picker is localized in Polish', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('allsuite:locale', 'pl'))
  await page.goto('./#/draft')
  await page.getByRole('button', { name: 'Plik', exact: true }).click()
  await page.getByRole('button', { name: 'Nowy', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'Nowy dokument', exact: true })
  await expect(dialog).toBeVisible()
  await expect(dialog.getByRole('button', { name: /^CV klasyczne/ })).toBeVisible()
  await dialog.getByRole('button', { name: /^Esej/ }).click()
  const editor = page.getByRole('textbox', { name: 'Edytor dokumentu', exact: true })
  await expect(editor).toContainText('Tytuł eseju')
  await editor.focus()
  await editor.press('Control+End')
  await editor.pressSequentially(' [edytowalny]')
  await expect(editor).toContainText('Tytuł eseju')
  await expect(editor).toContainText('[edytowalny]')
})
