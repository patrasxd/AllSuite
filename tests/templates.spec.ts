import { test, expect } from '@playwright/test'

test('New document offers five templates that open in the editor', async ({ page }) => {
  await page.goto('./#/draft')
  await page.getByRole('tab', { name: 'File', exact: true }).click()
  const editor = page.getByRole('textbox', { name: 'Document editor', exact: true })
  const choices = [
    ['CV', 'Name Surname'],
    ['Letter', 'Dear recipient,'],
    ['Report', 'Report title'],
    ['Meeting notes', 'Team or project'],
    ['Essay', 'Essay title'],
  ] as const

  for (const [label, sample] of choices) {
    await page.getByRole('button', { name: 'New', exact: true }).click()
    const dialog = page.getByRole('dialog', { name: 'New document', exact: true })
    await expect(dialog).toBeVisible()
    await expect(dialog.getByRole('button', { name: new RegExp(`^${label}`) })).toBeVisible()
    await dialog.getByRole('button', { name: new RegExp(`^${label}`) }).click()
    await expect(dialog).toBeHidden()
    await expect(editor).toContainText(sample)
  }
})

test('New document template picker is localized in Polish', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('allsuite:locale', 'pl'))
  await page.goto('./#/draft')
  await page.getByRole('tab', { name: 'Plik', exact: true }).click()
  await page.getByRole('button', { name: 'Nowy', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'Nowy dokument', exact: true })
  await expect(dialog).toBeVisible()
  await expect(dialog.getByRole('button', { name: /^CV Czytelny profil/ })).toBeVisible()
  await dialog.getByRole('button', { name: /^Esej/ }).click()
  await expect(page.getByRole('textbox', { name: 'Edytor dokumentu', exact: true })).toContainText('Tytuł eseju')
})
