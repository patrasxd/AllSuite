import { test, expect, type Page } from '@playwright/test'
import type { Editor } from '@tiptap/core'
import { unzipSync, strFromU8 } from 'fflate'
import { readFile, mkdir } from 'node:fs/promises'
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs'
import { generatedPNG } from './fixtures/png'
import { draftFileAction, revealToolbarCommand } from './helpers/reveal-toolbar-command'
const artifacts = 'docs/verification/draft-dialogs-implement-01'
const body = (page: Page) => page.getByRole('textbox', { name: 'Document editor', exact: true })
async function model(page: Page) {
  return body(page).evaluate((el) => (el as HTMLElement & { editor: Editor }).editor.getJSON())
}
async function config(page: Page) {
  return JSON.parse((await model(page)).attrs!.pageSetup)
}
async function entry(page: Page, name: string, tab: string) {
  const more = page.getByRole('button', { name: 'More', exact: true })
  if ((await more.isVisible()) && (await more.getAttribute('aria-expanded')) !== 'true') await more.click()
  await page.getByRole('tab', { name: tab, exact: true }).click()
  const { command } = await revealToolbarCommand(page, name)
  await command.click()
}
async function boot(page: Page, theme = 'dark') {
  await page.addInitScript((theme) => {
    localStorage.setItem('allsuite:locale', 'en')
    localStorage.setItem('allsuite:theme', theme)
    Object.defineProperty(window, 'showSaveFilePicker', { value: undefined, configurable: true })
    Object.defineProperty(window, 'showOpenFilePicker', { value: undefined, configurable: true })
  }, theme)
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.goto('./apps/draft')
  await body(page).fill('A thoughtful document with room to breathe.')
}
async function download(page: Page, action: string) {
  const pending = page.waitForEvent('download')
  await draftFileAction(page, action)
  const d = await pending
  return { bytes: await readFile((await d.path())!), name: d.suggestedFilename() }
}

test('Draft dialogs apply locally, cancel, preserve history and round trip real rich DOCX/PDF', async ({ page }) => {
  test.setTimeout(120000)
  page.setDefaultTimeout(15000)
  await mkdir(artifacts, { recursive: true })
  await boot(page)
  const original = await config(page)
  await entry(page, 'Page setup', 'Layout')
  const dialog = page.getByRole('dialog')
  await dialog.getByLabel('Size', { exact: true }).selectOption('custom')
  await dialog.getByLabel('Width (mm)', { exact: true }).fill('220')
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click()
  expect(await config(page)).toEqual(original)
  await entry(page, 'Page setup', 'Layout')
  await dialog.getByLabel('Size', { exact: true }).selectOption('letter')
  await dialog.getByLabel('Orientation', { exact: true }).selectOption('landscape')
  await dialog.getByRole('tab', { name: 'Margins', exact: true }).click()
  await dialog.getByLabel('Top (mm)', { exact: true }).fill('24')
  await dialog.getByRole('button', { name: 'Apply', exact: true }).click()
  expect(await config(page)).toMatchObject({ width: 15840, height: 12240, top: 1361, orientation: 'landscape' })
  // A fresh transaction must undo/redo as a single body history entry.
  await body(page).evaluate((el) => (el as HTMLElement & { editor: Editor }).editor.commands.undo())
  expect(await config(page)).toEqual(original)
  await body(page).evaluate((el) => (el as HTMLElement & { editor: Editor }).editor.commands.redo())
  expect((await config(page)).width).toBe(15840)
  await entry(page, 'Page setup', 'Layout')
  await dialog.getByRole('tab', { name: 'Position', exact: true }).click()
  await dialog.getByRole('button', { name: 'Apply & edit header / footer', exact: true }).click()
  await expect(dialog).toHaveAccessibleName('Header & footer')
  const rich = page.getByRole('textbox', { name: 'Edit rich headers and footers', exact: true })
  await rich.fill('Discarded rich text')
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click()
  expect((await config(page)).stories).toBeUndefined()
  await entry(page, 'Header & footer', 'Insert')
  await rich.fill('Rich header ')
  await rich.press('Control+a')
  await dialog.getByRole('button', { name: 'Bold', exact: true }).click()
  await dialog.getByRole('button', { name: 'Link', exact: true }).click()
  await page.getByLabel('Link address', { exact: true }).fill('https://example.org/reference')
  await page.getByRole('button', { name: 'Apply link', exact: true }).click()
  await expect(rich).toBeFocused()
  await expect(page.locator('.allsuite-ribbon-menu__items')).toHaveCount(0)
  await rich.click({ position: { x: 300, y: 24 } })
  await expect
    .poll(() => rich.evaluate((el) => (el as HTMLElement & { editor: Editor }).editor.state.selection.empty))
    .toBe(true)
  await expect(rich).toContainText('Rich header')
  await dialog.getByRole('button', { name: 'Insert', exact: true }).click()
  await page.getByRole('button', { name: 'Page / total', exact: true }).click()
  await dialog.getByRole('button', { name: 'Insert', exact: true }).click()
  await page.getByRole('button', { name: 'Document title', exact: true }).click()
  await dialog.getByRole('button', { name: 'Insert', exact: true }).click()
  const imageChooser = page.waitForEvent('filechooser')
  await page
    .getByRole('group', { name: 'Insert', exact: true })
    .getByRole('button', { name: 'Insert image', exact: true })
    .click()
  await (
    await imageChooser
  ).setFiles({ name: 'header.png', mimeType: 'image/png', buffer: Buffer.from(generatedPNG(40, 30)) })
  await expect
    .poll(() =>
      rich.evaluate(
        (el) =>
          (el as HTMLElement & { editor: Editor }).editor
            .getJSON()
            .content!.flatMap((n) => n.content || [])
            .filter((n) => n.type === 'image').length,
      ),
    )
    .toBe(1)
  // Confirm edits are still local before changing variants.
  expect((await config(page)).stories).toBeUndefined()
  await dialog.getByLabel('Editing', { exact: true }).selectOption('header:first')
  await rich.fill('First page header')
  await dialog.getByLabel('Editing', { exact: true }).selectOption('header:even')
  await rich.fill('Even page header')
  await dialog.getByLabel('Editing', { exact: true }).selectOption('footer:default')
  await rich.fill('Footer text')
  await dialog.getByLabel('Editing', { exact: true }).selectOption('footer:first')
  await rich.fill('First footer')
  await dialog.getByRole('tab', { name: 'Page variants', exact: true }).click()
  await dialog.getByRole('switch', { name: 'Different first page', exact: true }).click()
  await dialog.getByRole('switch', { name: 'Different odd/even pages', exact: true }).click()
  await dialog.getByRole('tab', { name: 'Numbering & title', exact: true }).click()
  await dialog.getByLabel('Starting page number', { exact: true }).fill('')
  await dialog.getByRole('button', { name: 'Apply', exact: true }).click()
  await expect(dialog.getByRole('alert').filter({ hasText: 'Check the starting number' })).toBeVisible()
  await dialog.getByLabel('Starting page number', { exact: true }).fill('7')
  await dialog.getByLabel('Page number format', { exact: true }).selectOption('upperRoman')
  await dialog.getByLabel('Document title', { exact: true }).fill('Story title')
  await dialog.getByRole('button', { name: 'Apply', exact: true }).click()
  const applied = await config(page)
  expect(applied.stories).toMatchObject({
    start: 7,
    format: 'upperRoman',
    title: 'Story title',
    differentFirst: true,
    differentEven: true,
  })
  const richJSON = JSON.stringify(applied.stories.header.default)
  for (const text of ['Rich header', 'bold', 'link', 'PAGE', 'NUMPAGES', 'TITLE', 'image'])
    expect(richJSON).toContain(text)
  await body(page).evaluate((el) => (el as HTMLElement & { editor: Editor }).editor.commands.undo())
  expect((await config(page)).stories).toBeUndefined()
  await body(page).evaluate((el) => (el as HTMLElement & { editor: Editor }).editor.commands.redo())
  expect((await config(page)).stories).toEqual(applied.stories)
  await expect(page.getByText('Unsaved changes', { exact: true })).toBeVisible()
  await entry(page, 'Open paragraph settings', 'Layout')
  await dialog.getByLabel('Spacing before (pt)', { exact: true }).fill('6')
  await dialog.getByLabel('Spacing after (pt)', { exact: true }).fill('12')
  await dialog.getByLabel('Special', { exact: true }).selectOption('first')
  await dialog.getByLabel('First-line indent (pt)', { exact: true }).fill('18')
  await dialog.getByLabel('Special', { exact: true }).selectOption('hanging')
  await dialog.getByLabel('Hanging indent (pt)', { exact: true }).fill('9')
  await dialog.getByRole('tab', { name: 'Tab stops', exact: true }).click()
  await dialog.getByLabel('Tab stops (pt)', { exact: true }).fill('144, 72')
  await dialog.getByRole('tab', { name: 'Page flow', exact: true }).click()
  await dialog.getByRole('switch', { name: 'Keep with next', exact: true }).click()
  await dialog.getByRole('button', { name: 'Apply', exact: true }).click()
  expect((await model(page)).content![0].attrs).toMatchObject({
    spacingBefore: 6,
    spacingAfter: 12,
    indentFirstLine: 0,
    indentHanging: 9,
    tabStops: [72, 144],
    keepNext: true,
  })
  await body(page).press('Control+End')
  await body(page).press('Control+Enter')
  await body(page).pressSequentially('Second page')
  await body(page).press('Control+Enter')
  await body(page).pressSequentially('Third page')
  await expect(page.locator('.draft-sheet')).toHaveCount(3)
  await page.screenshot({ animations: 'disabled', path: artifacts + '/applied-document.png' })
  const docx = await download(page, 'Save document')
  await (await import('node:fs/promises')).writeFile(artifacts + '/edited.docx', docx.bytes)
  const zip = unzipSync(docx.bytes),
    xml = strFromU8(zip['word/document.xml'])
  expect(xml).toContain('w:pgNumType')
  expect(xml).toContain('upperRoman')
  expect(xml).toContain('w:hanging="180"')
  const storyParts = Object.keys(zip).filter((name) => /^word\/(header|footer)\d+\.xml$/.test(name))
  expect(storyParts).toHaveLength(6)
  const storyXML = storyParts.map((name) => strFromU8(zip[name])).join('')
  for (const value of [
    'Rich header',
    'First page header',
    'Even page header',
    'Footer text',
    'PAGE',
    'NUMPAGES',
    'TITLE',
    'w:drawing',
    'w:hyperlink',
  ])
    expect(storyXML).toContain(value)
  expect(
    Object.keys(zip).some(
      (name) => /^word\/_rels\/header.*rels$/.test(name) && strFromU8(zip[name]).includes('relationships/image'),
    ),
  ).toBe(true)
  // Open the actual saved package in a fresh Draft session, through its file chooser.
  await expect(page.getByText('Ready', { exact: true })).toBeVisible()
  await page.reload()
  await body(page).waitFor()
  const chooser = page.waitForEvent('filechooser')
  await draftFileAction(page, 'Open')
  await (
    await chooser
  ).setFiles({
    name: 'edited.docx',
    mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    buffer: docx.bytes,
  })
  await expect(body(page)).toContainText('A thoughtful document')
  expect((await config(page)).stories).toMatchObject({
    start: 7,
    format: 'upperRoman',
    differentFirst: true,
    differentEven: true,
  })
  const reopened = JSON.stringify((await config(page)).stories)
  for (const text of [
    'Rich header',
    'First page header',
    'Even page header',
    'Footer text',
    'PAGE',
    'NUMPAGES',
    'TITLE',
    'image',
  ])
    expect(reopened).toContain(text)
  expect((await model(page)).content![0].attrs).toMatchObject({
    spacingBefore: 6,
    spacingAfter: 12,
    indentHanging: 9,
    tabStops: [72, 144],
  })
  await draftFileAction(page, 'Print preview')
  const print = page.frameLocator('iframe[title="Print preview"]')
  await expect(print.locator('.print-sheet').first()).toContainText('First page header')
  await expect(print.locator('.print-sheet').first()).toContainText('First footer')
  await expect(print.locator('.print-sheet').nth(1)).toContainText('Even page header')
  await expect(print.locator('.print-sheet').nth(2)).toContainText('Rich header')
  await expect(print.locator('.print-sheet').nth(2).locator('image')).toHaveCount(1)
  const pending = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Download PDF', exact: true }).click()
  const pdfBytes = await readFile((await (await pending).path())!)
  await (await import('node:fs/promises')).writeFile(artifacts + '/edited.pdf', pdfBytes)
  const loading = getDocument({ data: new Uint8Array(pdfBytes), disableFontFace: true })
  const pdf = await loading.promise
  const text = (await (await pdf.getPage(1)).getTextContent()).items.map((i) => ('str' in i ? i.str : '')).join(' ')
  expect(text).toContain('First page header')
  expect(text).toContain('First footer')
  expect(pdf.numPages).toBe(3)
  const third = (await (await pdf.getPage(3)).getTextContent()).items.map((i) => ('str' in i ? i.str : '')).join(' ')
  expect(third).toContain('Rich header')
  expect(third).toContain('IX')
  expect(third).toContain('Story title')
  expect((await pdf.getPage(1)).getViewport({ scale: 1 }).width).toBeCloseTo(792, 0)
  await loading.destroy()
})

for (const [theme, width, height] of [
  ['dark', 1280, 800],
  ['light', 1280, 800],
  ['e-ink-light', 1280, 800],
  ['e-ink-dark', 1280, 800],
  ['dark', 390, 844],
  ['light', 320, 568],
] as const) {
  test('production dialog visual and keyboard coverage ' + theme + ' ' + width, async ({ page }) => {
    await mkdir(artifacts, { recursive: true })
    await page.setViewportSize({ width, height })
    await boot(page, theme)
    await entry(page, 'Page setup', 'Layout')
    const dialog = page.getByRole('dialog')
    const shot = async (name: string) => {
      await expect(dialog.getByRole('button', { name: 'Apply', exact: true })).toBeInViewport()
      await expect(dialog.getByRole('button', { name: 'Cancel', exact: true })).toBeInViewport()
      await page.screenshot({
        animations: 'disabled',
        path: artifacts + '/' + name + '-' + theme + '-' + width + '.png',
      })
    }
    await shot('page-paper')
    await dialog.getByRole('tab', { name: 'Paper', exact: true }).press('ArrowRight')
    await expect(dialog.getByRole('tab', { name: 'Margins', exact: true })).toBeFocused()
    await shot('page-margins')
    await dialog.getByRole('tab', { name: 'Margins', exact: true }).press('End')
    await shot('page-position')
    await page.keyboard.press('Escape')
    await expect(page.getByRole('button', { name: 'Page setup', exact: true })).toBeFocused()
    await entry(page, 'Header & footer', 'Insert')
    await page.getByRole('textbox', { name: 'Edit rich headers and footers', exact: true }).fill('A calmer working day')
    await shot('story-content')
    await dialog.getByRole('button', { name: 'Insert', exact: true }).click()
    await page.keyboard.press('Escape')
    await expect(dialog).toBeVisible()
    await expect(dialog.getByRole('button', { name: 'Insert', exact: true })).toBeFocused()
    await dialog.getByRole('tab', { name: 'Page variants', exact: true }).click()
    await shot('story-variants')
    await dialog.getByRole('tab', { name: 'Numbering & title', exact: true }).click()
    await shot('story-numbering')
    await dialog.getByRole('tab', { name: 'Content', exact: true }).click()
    await page
      .getByRole('textbox', { name: 'Edit rich headers and footers', exact: true })
      .fill(Array(80).fill('Long header paragraph.').join('\n'))
    await shot('story-long')
    await dialog.getByRole('button', { name: 'Cancel', exact: true }).click()
    await entry(page, 'Open paragraph settings', 'Layout')
    await shot('paragraph-spacing')
    await dialog.getByRole('tab', { name: 'Page flow', exact: true }).click()
    await shot('paragraph-flow')
    await dialog.getByRole('tab', { name: 'Tab stops', exact: true }).click()
    await shot('paragraph-tabs')
    if (width === 390) {
      await dialog.getByLabel('Tab stops (pt)', { exact: true }).focus()
      await page.setViewportSize({ width, height: 420 })
      await expect(dialog.getByRole('button', { name: 'Apply', exact: true })).toBeInViewport()
      await expect(dialog.getByRole('button', { name: 'Cancel', exact: true })).toBeInViewport()
      await page.screenshot({ animations: 'disabled', path: artifacts + '/reduced-height-mobile.png' })
      await page.setViewportSize({ width, height })
    }
    expect(await dialog.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true)
    await page.keyboard.press('Escape')
    expect((await config(page)).stories).toBeUndefined()
  })
}

test('clean cancellation, local rich history, page-band and Home entry points', async ({ page }) => {
  await boot(page)
  await download(page, 'Save document')
  await expect(page.getByText('Ready', { exact: true })).toBeVisible()
  const before = await model(page)
  await page.locator('.draft-story-region--footer').first().click()
  const dialog = page.getByRole('dialog')
  await expect(dialog.getByLabel('Editing', { exact: true })).toHaveValue('footer:default')
  const rich = page.getByRole('textbox', { name: 'Edit rich headers and footers', exact: true })
  await rich.fill('Local only')
  await rich.press('Control+z')
  await expect(rich).not.toContainText('Local only')
  await rich.press('Control+Shift+z')
  await expect(rich).toContainText('Local only')
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click()
  expect(await model(page)).toEqual(before)
  await expect(page.getByText('Ready', { exact: true })).toBeVisible()
  await expect(page.locator('.draft-story-region--footer').first()).toBeFocused()
  await entry(page, 'Page setup', 'Layout')
  await dialog.getByLabel('Size', { exact: true }).selectOption('custom')
  await dialog.getByLabel('Width (mm)', { exact: true }).fill('abc')
  await dialog.getByRole('button', { name: 'Apply', exact: true }).click()
  await expect(dialog.getByRole('alert')).toBeVisible()
  await expect(dialog.getByLabel('Width (mm)', { exact: true })).toHaveValue('abc')
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click()
  expect(await model(page)).toEqual(before)
  await page.getByRole('tab', { name: 'Home', exact: true }).click()
  await page.getByRole('button', { name: 'Paragraph options', exact: true }).click()
  await page.getByRole('button', { name: 'Open paragraph settings', exact: true }).click()
  await dialog.getByLabel('Spacing before (pt)', { exact: true }).fill('17')
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click()
  expect(await model(page)).toEqual(before)
  await expect(page.getByRole('button', { name: 'Paragraph options', exact: true })).toBeFocused()
  await expect(page.getByText('Ready', { exact: true })).toBeVisible()
})
