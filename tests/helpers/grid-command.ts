import { expect, type Page } from '@playwright/test'

/** Table identity belongs to the contextual ribbon, with separate compact name/range text. */
export async function expectGridTableContext(page: Page, name: string, range: string) {
  await page.getByRole('tab', { name: 'Table', exact: true }).click()
  const more = page.getByRole('button', { name: 'More', exact: true })
  if (await more.isVisible()) await more.click()
  const context = page.locator('#grid-panel-table .grid-table-context')
  await expect(context.getByText(name, { exact: true })).toBeVisible()
  await expect(context.getByText(range, { exact: true })).toBeVisible()
}

/** Follow the same tabs, command disclosures and responsive navigation as a user. */
export async function gridCommand(page: Page, name: string) {
  const command = page.getByRole('button', { name, exact: true })
  if (await command.isVisible()) {
    if (
      (await page.locator('.allsuite-ribbon-menu__items').count()) &&
      !(await command.evaluate((element) => Boolean(element.closest('.allsuite-ribbon-menu__items'))))
    )
      await page.keyboard.press('Escape')
    return command
  }
  if (await page.locator('.allsuite-ribbon-menu__items').count()) await page.keyboard.press('Escape')
  const polish = await page.getByRole('button', { name: 'Plik', exact: true }).isVisible()
  const tab = /^(Create Table|Utwórz tabelę)$/.test(name)
    ? 'Insert'
    : name === 'Convert to Range'
      ? (await page.getByRole('tab', { name: 'Table', exact: true }).isVisible())
        ? 'Table'
        : 'Insert'
      : /^(Freeze first|Unfreeze|Zamroź|Odblokuj)/.test(name)
        ? 'View'
        : /^(AutoFilter|Autofiltr|Clear filter|Wyczyść filtr)/.test(name) &&
            (await page.getByRole('tab', { name: polish ? 'Tabela' : 'Table', exact: true }).isVisible())
          ? 'Table'
          : /^(Sort range|AutoFilter|Autofiltr|Clear filter|Wyczyść filtr)/.test(name)
            ? 'Data'
            : /^(Copy |Paste |Insert row|Insert column)/.test(name)
              ? 'Home'
              : 'File'
  const localized = polish
    ? ({
        File: 'Plik',
        Insert: 'Wstaw',
        View: 'Widok',
        Home: 'Narzędzia główne',
        Data: 'Dane',
        Table: 'Tabela',
      }[tab] ?? tab)
    : tab
  if (tab === 'File') {
    const file = page.getByRole('button', { name: localized, exact: true })
    if ((await file.getAttribute('aria-expanded')) !== 'true') await file.click()
    return command
  }
  await page.getByRole('tab', { name: localized, exact: true }).click()
  if (await page.locator('.grid-mobile-dock').isVisible()) {
    if (/^(Copy |Paste )/.test(name)) {
      await page.getByRole('button', { name: polish ? 'Schowek' : 'Clipboard', exact: true }).click()
      return command
    }
    if (/^(AutoFilter|Autofiltr|Clear filter|Wyczyść filtr)/.test(name)) {
      await page.getByRole('button', { name: polish ? 'Filtr' : 'Filter', exact: true }).click()
      return command
    }
    const more = page.getByRole('button', { name: polish ? 'Więcej' : 'More', exact: true })
    if (
      !(await command.isVisible()) &&
      (await more.isVisible()) &&
      (await more.getAttribute('aria-expanded')) !== 'true'
    )
      await more.click()
  }
  for (let i = 0; i < 10 && !(await command.isVisible()); i++) {
    const disclosure = /^(Copy |Paste )/.test(name)
      ? `${name.split(' ')[0]} options`
      : /^(Freeze first|Unfreeze|Zamroź|Odblokuj)/.test(name)
        ? polish
          ? 'Zamroź okienka'
          : 'Freeze panes'
        : null
    if (disclosure) {
      const trigger = page.getByRole('button', { name: disclosure, exact: true })
      if (await trigger.isVisible()) {
        await trigger.click()
        break
      }
    }
    const next = page.getByRole('button', {
      name: polish ? 'Następna strona paska narzędzi' : 'Next toolbar page',
      exact: true,
    })
    if (!(await next.isVisible()) || !(await next.isEnabled())) break
    await next.click()
  }
  return command
}
