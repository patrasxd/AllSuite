import { expect, test } from '@playwright/test'

for (const app of ['draft', 'grid']) {
  for (const viewport of [
    { width: 390, height: 844 },
    { width: 844, height: 390 },
    { width: 1280, height: 800 },
  ]) {
    for (const theme of ['light', 'dark', 'e-ink-light', 'e-ink-dark']) {
      test(`${app} reachable toolbar ${viewport.width}x${viewport.height} ${theme}`, async ({ browser }) => {
        const context = await browser.newContext({ viewport, hasTouch: viewport.width < 900 })
        const page = await context.newPage()
        try {
          await page.addInitScript((value) => {
            localStorage.setItem('allsuite:theme', value)
            localStorage.setItem('allsuite:locale', 'en')
          }, theme)
          await page.goto(`http://127.0.0.1:4176/AllSuite/apps/${app}`)
          await expect(
            page.getByRole('textbox', { name: app === 'draft' ? 'Document editor' : 'Formula bar', exact: true }),
          ).toBeVisible()
          if (app === 'grid') await expect(page.locator('.grid-app')).toBeVisible()
          const gridMobile = await page.locator(`.${app}-mobile-dock`).isVisible()
          if (gridMobile) await page.getByRole('button', { name: 'More', exact: true }).click()
          const toolbar = page.locator(`.${app}-toolbar:visible`)
          await expect(toolbar).toBeVisible()
          const tabs = page.locator('.all-workspace-tabs').getByRole('tab')
          const observations = []
          for (let tab = 0; tab < (await tabs.count()); tab++) {
            await tabs.nth(tab).click()
            if (
              gridMobile &&
              (await page.getByRole('button', { name: 'More', exact: true }).isVisible()) &&
              (app === 'grid' ||
                (await page.getByRole('button', { name: 'More', exact: true }).getAttribute('aria-expanded')) !==
                  'true')
            )
              await page.getByRole('button', { name: 'More', exact: true }).click()
            const phoneQuick =
              gridMobile && !(await page.getByRole('button', { name: 'More', exact: true }).isVisible())
            const activeToolbar = phoneQuick ? page.locator('.grid-mobile-dock') : toolbar
            const scrollHost =
              app === 'grid' && !phoneQuick
                ? page.locator('.grid-command-panel:visible .grid-ribbon-surface')
                : app === 'draft'
                  ? page.locator('.draft-command-panel')
                  : activeToolbar
            for (let index = 0; index < 20; index++) {
              const overflow = await scrollHost.evaluate((element) => ({
                client: element.clientWidth,
                scroll: element.scrollWidth,
              }))
              if (overflow.scroll > overflow.client + 1) {
                // Whole-group paging cannot subdivide a group wider than its viewport.
                // Real wheel/swipe scrolling must work, not only programmatic focus scrolling.
                await scrollHost.hover()
                // Wheel dispatch does not await scrolling. Avoid queuing an unnecessary
                // negative gesture at zero that can coalesce with the positive gesture.
                if (await scrollHost.evaluate((element) => element.scrollLeft > 0)) await page.mouse.wheel(-2000, 0)
                await expect.poll(() => scrollHost.evaluate((element) => element.scrollLeft)).toBe(0)
                await page.mouse.wheel(2000, 0)
                await expect.poll(() => scrollHost.evaluate((element) => element.scrollLeft)).toBeGreaterThan(0)
                await page.mouse.wheel(-2000, 0)
                await expect.poll(() => scrollHost.evaluate((element) => element.scrollLeft)).toBe(0)
              }
              const controls = activeToolbar.locator('button:visible, input:visible, select:visible')
              for (let control = 0; control < (await controls.count()); control++) {
                const target = controls.nth(control)
                const geometry = await target.evaluate((element) => {
                  // Wheel interaction above proves user scrolling. Check each box without
                  // paying a separate Playwright stability wait for every static control.
                  element.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'instant' })
                  const rect = element.getBoundingClientRect()
                  const viewport = (element.closest('.grid-ribbon-surface, .draft-command-panel') ??
                    element.closest('[role="toolbar"]'))!.getBoundingClientRect()
                  return {
                    name: element.getAttribute('aria-label') || element.textContent,
                    left: rect.left - viewport.left,
                    right: viewport.right - rect.right,
                    top: rect.top - viewport.top,
                    bottom: viewport.bottom - rect.bottom,
                  }
                })
                expect(geometry.left, JSON.stringify(geometry)).toBeGreaterThanOrEqual(-1)
                expect(geometry.right, JSON.stringify(geometry)).toBeGreaterThanOrEqual(-1)
                expect(geometry.top, JSON.stringify(geometry)).toBeGreaterThanOrEqual(-1)
                expect(geometry.bottom, JSON.stringify(geometry)).toBeGreaterThanOrEqual(-1)
              }
              observations.push({ tab: await tabs.nth(tab).textContent(), index, ...overflow })
              if (gridMobile && !phoneQuick)
                await expect(page.getByRole('button', { name: 'More', exact: true })).toHaveAttribute(
                  'aria-expanded',
                  'true',
                )
              break
            }
          }
          expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(viewport.width)
          expect(await page.evaluate(() => document.documentElement.scrollHeight)).toBeLessThanOrEqual(viewport.height)
          const pane = page.locator(app === 'draft' ? '.draft-document-area' : '.grid-sheet-scroll')
          await expect(pane).toBeVisible()
          expect((await pane.boundingBox())!.height).toBeGreaterThan(40)
          if (app === 'grid') {
            const firstCell = page.locator('[data-cell-address="A1"]')
            const bounds = (await firstCell.boundingBox())!
            const sheet = (await pane.boundingBox())!
            expect(bounds.y + bounds.height).toBeLessThanOrEqual(sheet.y + sheet.height)
            await firstCell.click()
            await expect(page.getByRole('grid', { name: 'Spreadsheet grid', exact: true })).toBeFocused()
            for (const button of await page.locator('.all-workspace-status button:visible').all()) {
              const rect = (await button.boundingBox())!
              expect(rect.y + rect.height).toBeLessThanOrEqual(viewport.height)
              if (viewport.width < 900) expect(rect.height).toBeGreaterThanOrEqual(44)
            }
          }
          await test
            .info()
            .attach('toolbar-pages', { body: JSON.stringify(observations), contentType: 'application/json' })
          await page.screenshot({ path: test.info().outputPath('workspace.png') })
        } finally {
          await context.close()
        }
      })
    }
  }
}
