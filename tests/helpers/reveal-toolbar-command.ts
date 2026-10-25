import { expect, type Locator, type Page } from '@playwright/test'

type Locale = 'en' | 'pl'

export async function draftFileAction(page: Page, name: string) {
  const file = page.getByRole('button', { name: 'File', exact: true })
  if ((await file.getAttribute('aria-expanded')) !== 'true') await file.click()
  await page.getByRole('button', { name, exact: true }).click()
}

const pagerLabels = {
  en: { previous: 'Previous toolbar page', next: 'Next toolbar page' },
  pl: { previous: 'Poprzednia strona paska narzędzi', next: 'Następna strona paska narzędzi' },
} satisfies Record<Locale, { previous: string; next: string }>

export async function revealToolbarCommand(
  page: Page,
  name: string,
  locale: Locale = 'en',
): Promise<{ command: Locator; pagesAdvanced: number }> {
  const command = page.getByRole('button', { name, exact: true })
  const more = page.getByRole('button', { name: locale === 'pl' ? 'Więcej' : 'More', exact: true })
  if ((await more.isVisible()) && (await more.getAttribute('aria-expanded')) !== 'true' && !(await command.isVisible()))
    await more.click()
  if (await command.isVisible()) return { command, pagesAdvanced: 0 }
  const next = page.getByRole('button', { name: pagerLabels[locale].next, exact: true })

  for (let pagesAdvanced = 0; pagesAdvanced < 12; pagesAdvanced += 1) {
    if (await command.isVisible()) return { command, pagesAdvanced }
    await expect(next, `Could not reach toolbar command "${name}" from the current page`).toBeEnabled()
    await next.click()
  }

  await expect(command, `Toolbar command "${name}" was not found after paging`).toBeVisible()
  return { command, pagesAdvanced: 12 }
}

export async function returnToFirstToolbarPage(page: Page, locale: Locale = 'en') {
  const previous = page.getByRole('button', { name: pagerLabels[locale].previous, exact: true })
  for (let pageIndex = 0; pageIndex < 12 && (await previous.isEnabled()); pageIndex += 1) {
    await previous.click()
  }
  await expect(previous).toBeDisabled()
}
