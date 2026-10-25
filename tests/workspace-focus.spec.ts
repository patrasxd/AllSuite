import { expect, test, type Locator, type Page } from '@playwright/test'

async function tabTo(page: Page, target: Locator, backwards = false) {
  for (let i = 0; i < 100; i++) {
    await page.keyboard.press(backwards ? 'Shift+Tab' : 'Tab')
    if (await target.evaluate((element) => element === document.activeElement)) return
  }
  await expect(target).toBeFocused()
}

async function appearance(target: Locator) {
  return target.evaluate(async (element) => {
    // Read after existing CSS transitions settle, rather than comparing intermediate colors.
    void getComputedStyle(element).borderColor
    await Promise.all(
      document
        .getAnimations()
        .filter((animation) => animation instanceof CSSTransition)
        .map((animation) => animation.finished),
    )
    const style = getComputedStyle(element.closest('.all-select-wrapper, .all-input-wrapper') || element)
    return {
      outline: style.outline,
      shadow: style.boxShadow,
      border: style.border,
      background: style.backgroundColor,
    }
  })
}

async function checkFocus(page: Page, target: Locator, label: string, backwards = false) {
  const before = await appearance(target)
  await tabTo(page, target, backwards)
  await expect(target).toBeFocused()
  expect(await target.evaluate((element) => element.matches(':focus-visible'))).toBe(true)
  const focused = await appearance(target)
  expect.soft(focused, `${label}: focus must differ from the unfocused state`).not.toEqual(before)
  const indicator = await target.evaluate((element) => {
    const ring = element.closest('.all-select-wrapper, .all-input-wrapper') || element
    const style = getComputedStyle(ring)
    let surface: Element | null = parseFloat(style.outlineOffset) < 0 ? ring : ring.parentElement
    while (surface && getComputedStyle(surface).backgroundColor === 'rgba(0, 0, 0, 0)') surface = surface.parentElement
    const luminance = (color: string) => {
      const channels = color
        .match(/[\d.]+/g)!
        .slice(0, 3)
        .map(Number)
        .map((value) => {
          const channel = value / 255
          return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4
        })
      return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722
    }
    const ink = luminance(style.outlineColor)
    const paper = luminance(getComputedStyle(surface!).backgroundColor)
    return {
      visible: (style.outlineStyle !== 'none' && parseFloat(style.outlineWidth) >= 2) || style.boxShadow !== 'none',
      outline: style.outline,
      shadow: style.boxShadow,
      contrast: (Math.max(ink, paper) + 0.05) / (Math.min(ink, paper) + 0.05),
    }
  })
  expect.soft(indicator.visible, `${label}: ${JSON.stringify(indicator)}`).toBe(true)
  if (indicator.outline.includes('solid'))
    expect.soft(indicator.contrast, `${label}: outline contrast`).toBeGreaterThanOrEqual(3)
  const capture = target.locator(
    'xpath=ancestor::*[contains(@class,"draft-command-panel") or contains(@class,"draft-mobile-dock") or contains(@class,"all-toolbar-pager") or contains(@class,"all-workspace-tabs") or contains(@class,"grid-mobile-dock") or contains(@class,"grid-ribbon-surface") or contains(@class,"allsuite-ribbon-menu__items")][1]',
  )
  const path = test.info().outputPath(`${label}.png`)
  await capture.screenshot({ path })
  await test.info().attach(label, { path, contentType: 'image/png' })
  await page.keyboard.press(backwards ? 'Tab' : 'Shift+Tab')
  expect.soft(await appearance(target), `${label}: indicator clears on blur`).toEqual(before)
  await tabTo(page, target, backwards)
  expect.soft(await appearance(target), `${label}: reverse navigation restores indicator`).toEqual(focused)
}

for (const app of ['draft', 'grid']) {
  for (const width of [390, 1280]) {
    for (const theme of ['light', 'dark', 'e-ink-light', 'e-ink-dark']) {
      for (const reducedMotion of ['reduce', 'no-preference'] as const) {
        test(`${app} keyboard focus ${width} ${theme} ${reducedMotion}`, async ({ page }) => {
          await page.setViewportSize({ width, height: 844 })
          await page.emulateMedia({ reducedMotion })
          await page.addInitScript((value) => {
            localStorage.setItem('allsuite:theme', value)
            localStorage.setItem('allsuite:locale', 'en')
          }, theme)
          await page.goto(`./apps/${app}`)
          const format = page.getByRole('tab', { name: app === 'grid' ? 'Home' : 'Home', exact: true })
          await expect(format).toBeVisible()
          await tabTo(page, format)
          await page.keyboard.press('Home')
          const file = page.getByRole('tab', { name: app === 'grid' ? 'Home' : 'Home', exact: true })
          await expect(file).toBeFocused()
          await expect(file).toHaveAttribute('aria-selected', 'true')
          // The original S2 strict check; retain it in addition to the before/after checks.
          const strict = await file.evaluate((element) => {
            const style = getComputedStyle(element)
            return style.boxShadow !== 'none' || style.outlineStyle !== 'none'
          })
          expect.soft(strict, 'S2 strict selected-tab focus check').toBe(true)
          if (app === 'grid') {
            const disclosure = page.getByRole('button', { name: 'File', exact: true })
            await tabTo(page, disclosure, true)
            await disclosure.press('Enter')
            await expect(page.getByRole('button', { name: 'New', exact: true })).toBeFocused()
            await checkFocus(page, page.getByRole('button', { name: 'Open', exact: true }), 'file-action')
            await page.keyboard.press('Escape')
            await expect(disclosure).toBeFocused()
          } else {
            const disclosure = page.getByRole('button', { name: 'File', exact: true })
            await tabTo(page, disclosure, true)
            await disclosure.press('Enter')
            await expect(page.getByRole('button', { name: 'New', exact: true })).toBeFocused()
            const action = page.getByRole('button', { name: 'Open', exact: true })
            await checkFocus(page, action, 'file-action')
            await page.keyboard.press('Escape')
            await file.click()
          }
          // Return to the selected tab without changing selection: its selected border is baseline.
          await tabTo(page, file, app !== 'grid')
          await page.keyboard.press('Tab')
          await checkFocus(page, file, 'selected-tab', true)
          await page.keyboard.press('End')
          await page.keyboard.press('ArrowLeft')
          if (app === 'grid') {
            await expect(page.getByRole('tab', { name: 'Data', exact: true })).toBeFocused()
            await page.keyboard.press('ArrowLeft')
            await expect(page.getByRole('tab', { name: 'Insert', exact: true })).toBeFocused()
            await page.keyboard.press('ArrowLeft')
          }
          await expect(page.getByRole('tab', { name: app === 'grid' ? 'Home' : 'Review', exact: true })).toBeFocused()
          if (width === 1280) {
            const select = page.locator(`.${app}-toolbar:visible select:visible`).first()
            await checkFocus(page, select, 'toolbar-select')
          }
          // Grid traverses Data and Insert back to Home; Draft reaches View.
          if (width === 390) {
            const more = page.getByRole('button', { name: 'More', exact: true })
            await checkFocus(page, more, 'command-more')
            await page.keyboard.press('Enter')
            await expect(page.locator(`.${app}-toolbar:visible`)).toBeVisible()
            await expect(more).toHaveAttribute('aria-expanded', 'true')
            await more.press('Enter')
            await expect(more).toHaveAttribute('aria-expanded', 'false')
            await expect(page.locator(`.${app}-toolbar:visible`)).toHaveCount(0)
          }
        })
      }
    }
  }
}
