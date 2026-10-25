import { draftFileAction } from './helpers/reveal-toolbar-command'
import { test, expect, type Page } from '@playwright/test'
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate'

const source = zipSync({
  '[Content_Types].xml': strToU8('<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>'),
  'word/document.xml': strToU8(
    '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:rPr><w:lang w:val="pl-PL"/></w:rPr><w:t>Original source</w:t></w:r></w:p><w:object/></w:body></w:document>',
  ),
  'docProps/core.xml': strToU8(
    '<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>Source title</dc:title><dc:creator>Source author</dc:creator></cp:coreProperties>',
  ),
})

async function installProbe(page: Page, docx = false) {
  await page.addInitScript(
    ({ bytes, docx }) => {
      const probe = {
        picks: 0,
        opens: 0,
        writes: [] as number[][],
        sourceWrites: 0,
        sourceCreates: 0,
        closing: false,
        finish: () => {},
        finishOpen: () => {},
        confirmations: [] as string[],
        accept: false,
        cancelNextPick: false,
        failNextWrite: false,
        pickSource: false,
        aliasSource: false,
      }
      Object.assign(window, { integrity: probe })
      window.confirm = (message) => {
        probe.confirmations.push(message)
        return probe.accept
      }
      const original = {
        kind: 'file',
        name: docx ? 'original.docx' : 'original.txt',
        getFile: async () =>
          new File([docx ? new Uint8Array(bytes) : 'Original source'], docx ? 'original.docx' : 'original.txt'),
        createWritable: async () => {
          probe.sourceCreates++
          return {
            write: async () => {
              probe.sourceWrites++
            },
            close: async () => {},
          }
        },
        isSameEntry: async (other: unknown) =>
          other === original || Boolean((other as { sourceAlias?: boolean }).sourceAlias),
      }
      Object.defineProperty(window, 'showOpenFilePicker', {
        configurable: true,
        value: async () => {
          probe.opens++
          if (probe.opens > 1)
            await new Promise<void>((resolve) => {
              probe.finishOpen = resolve
            })
          return [
            probe.opens === 1
              ? original
              : { ...original, name: 'second.txt', getFile: async () => new File(['Document B'], 'second.txt') },
          ]
        },
      })
      Object.defineProperty(window, 'showSaveFilePicker', {
        configurable: true,
        value: async () => {
          probe.picks++
          if (probe.cancelNextPick) {
            probe.cancelNextPick = false
            throw new DOMException('Cancelled', 'AbortError')
          }
          if (probe.pickSource) return original
          if (probe.aliasSource) return { ...original, name: 'renamed.docx', sourceAlias: true }
          return {
            kind: 'file',
            name: 'copy.docx',
            getFile: async () => new File([], 'copy.docx'),
            createWritable: async () => ({
              write: async (blob: Blob) => {
                if (probe.failNextWrite) {
                  probe.failNextWrite = false
                  throw new DOMException('Disk full', 'QuotaExceededError')
                }
                probe.writes.push(Array.from(new Uint8Array(await blob.arrayBuffer())))
              },
              close: () =>
                new Promise<void>((resolve) => {
                  probe.closing = true
                  probe.finish = resolve
                }),
            }),
          }
        },
      })
    },
    { bytes: Array.from(source), docx },
  )
}

const editorFor = (page: Page) => page.getByRole('textbox', { name: 'Document editor', exact: true })
const probe = (page: Page) =>
  page.evaluate(
    () =>
      (
        window as unknown as {
          integrity: {
            picks: number
            opens: number
            sourceWrites: number
            sourceCreates: number
            writes: number[][]
            closing: boolean
            confirmations: string[]
          }
        }
      ).integrity,
  )
async function fileTab(page: Page) {
  const file = page.getByRole('button', { name: 'File', exact: true })
  if ((await file.getAttribute('aria-expanded')) !== 'true') await file.click()
}
async function finish(page: Page, opening = false) {
  await page.evaluate((opening) => {
    const state = (window as unknown as { integrity: { finish: () => void; finishOpen: () => void } }).integrity
    if (opening) state.finishOpen()
    else state.finish()
  }, opening)
}

async function configure(page: Page, values: Record<string, boolean>) {
  await page.evaluate((values) => Object.assign((window as unknown as { integrity: object }).integrity, values), values)
}

function writtenParts(bytes: number[]) {
  return unzipSync(new Uint8Array(bytes))
}

test('language changed during save remains unsaved', async ({ page }) => {
  await installProbe(page)
  await page.goto('./apps/draft')
  await editorFor(page).fill('Snapshot')
  await fileTab(page)
  await page.getByRole('button', { name: 'Save document', exact: true }).click()
  await expect.poll(async () => (await probe(page)).closing).toBe(true)
  await page.getByRole('tab', { name: 'Review', exact: true }).click()
  await page.getByRole('combobox', { name: 'Document language', exact: true }).selectOption('pl')
  await expect(editorFor(page)).toHaveAttribute('lang', 'pl-PL')
  await finish(page)
  await expect(page.getByText('Unsaved changes', { exact: true })).toBeVisible()
  await expect(editorFor(page)).toHaveAttribute('lang', 'pl-PL')
  const first = writtenParts((await probe(page)).writes[0])
  expect(strFromU8(first['word/styles.xml'])).not.toContain('pl-PL')
  await editorFor(page).press('Control+s')
  await expect.poll(async () => (await probe(page)).writes.length).toBe(2)
  await finish(page)
  await expect(page.getByText('Ready', { exact: true })).toBeVisible()
  expect(strFromU8(writtenParts((await probe(page)).writes[1])['word/styles.xml'])).toContain('pl-PL')
})

test('repeated save shortcuts share one pending operation', async ({ page }) => {
  await installProbe(page)
  await page.goto('./apps/draft')
  await editorFor(page).fill('Snapshot')
  await editorFor(page).press('Control+s')
  await expect.poll(async () => (await probe(page)).closing).toBe(true)
  await fileTab(page)
  await fileTab(page)
  await expect(page.getByRole('button', { name: 'Open', exact: true })).toBeDisabled()
  await expect(page.getByRole('button', { name: 'New', exact: true })).toBeDisabled()
  await editorFor(page).fill('Newer edit')
  await editorFor(page).press('Control+s')
  await editorFor(page).press('Control+s')
  // Allow requests to reach the deliberately blocked writer, without releasing any save.
  await page.waitForTimeout(250)
  await expect.poll(async () => (await probe(page)).picks).toBe(1)
  await finish(page)
  await expect(page.getByText('Unsaved changes', { exact: true })).toBeVisible()
  expect((await probe(page)).writes).toHaveLength(1)
  expect((await probe(page)).opens).toBe(0)
  const xml = strFromU8(writtenParts((await probe(page)).writes[0])['word/document.xml'])
  expect(xml).toContain('Snapshot')
  expect(xml).not.toContain('Newer edit')
})

test('save shortcut during pending open cannot save the previous document', async ({ page }) => {
  await installProbe(page)
  await page.goto('./apps/draft')
  await fileTab(page)
  await draftFileAction(page, 'Open')
  await expect(editorFor(page)).toHaveText('Original source')
  await draftFileAction(page, 'Open')
  await expect.poll(async () => (await probe(page)).opens).toBe(2)
  await editorFor(page).press('Control+s')
  await page.waitForTimeout(250)
  await finish(page, true)
  await expect(editorFor(page)).toHaveText('Document B')
  expect((await probe(page)).sourceWrites).toBe(0)
  expect((await probe(page)).sourceCreates).toBe(0)
  expect((await probe(page)).picks).toBe(0)
  expect((await probe(page)).writes).toHaveLength(0)
})

test('edits made while opening require a fresh discard decision', async ({ page }) => {
  await installProbe(page)
  await page.goto('./apps/draft')
  await fileTab(page)

  await draftFileAction(page, 'Open')
  await expect(editorFor(page)).toHaveText('Original source')
  await draftFileAction(page, 'Open')
  await expect.poll(async () => (await probe(page)).opens).toBe(2)
  await editorFor(page).fill('Keep edits made during open')
  await finish(page, true)
  await expect(editorFor(page)).toHaveText('Keep edits made during open')
  await expect(page.getByText('Unsaved changes', { exact: true })).toBeVisible()
  expect((await probe(page)).confirmations).toHaveLength(1)
})

test('lossy imported DOCX never replaces its source without a save decision', async ({ page }) => {
  await installProbe(page, true)
  await page.goto('./apps/draft')
  await fileTab(page)
  await draftFileAction(page, 'Open')
  const report = page.getByRole('dialog', { name: 'Import report', exact: true })
  await expect(report).toBeVisible()
  await report.getByRole('button', { name: 'Continue', exact: true }).click()
  await editorFor(page).fill('Edited source')
  await page.getByRole('button', { name: 'Save document', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Save document', exact: true })).toBeEnabled()
  expect((await probe(page)).sourceWrites).toBe(0)
  expect((await probe(page)).confirmations).toHaveLength(1)
  expect((await probe(page)).picks).toBe(0)
  await expect(page.getByText('Unsaved changes', { exact: true })).toBeVisible()
})

test('saving imported text writes DOCX to a new destination, preserving the text source', async ({ page }) => {
  await installProbe(page)
  await page.goto('./apps/draft')
  await fileTab(page)
  await draftFileAction(page, 'Open')
  await expect(editorFor(page)).toHaveText('Original source')
  await editorFor(page).fill('Edited text')
  await page.getByRole('button', { name: 'Save document', exact: true }).click()
  await page.waitForTimeout(250)
  expect((await probe(page)).sourceWrites).toBe(0)
  await expect.poll(async () => (await probe(page)).closing).toBe(true)
  await finish(page)
  await expect(page.getByText('Ready', { exact: true })).toBeVisible()
})

test('save failure then retry and Save As cancellation then retry preserve actual edits', async ({ page }) => {
  await installProbe(page)
  await page.goto('./apps/draft')
  await editorFor(page).fill('Retry this content')
  await fileTab(page)
  const save = page.getByRole('button', { name: 'Save document', exact: true })
  await configure(page, { failNextWrite: true })
  await save.click()
  await expect(page.getByText('The file could not be opened or saved.', { exact: true })).toBeVisible()
  await expect(page.getByText('Unsaved changes', { exact: true })).toBeVisible()
  expect((await probe(page)).writes).toHaveLength(0)
  await save.click()
  await expect.poll(async () => (await probe(page)).writes.length).toBe(1)
  await finish(page)
  await expect(page.getByText('Ready', { exact: true })).toBeVisible()
  await editorFor(page).fill('Newer Save As retry')
  await configure(page, { cancelNextPick: true })
  await draftFileAction(page, 'Save as')
  await expect(save).toBeEnabled()
  await expect(page.getByText('Unsaved changes', { exact: true })).toBeVisible()
  expect((await probe(page)).writes).toHaveLength(1)
  await draftFileAction(page, 'Save as')
  await expect.poll(async () => (await probe(page)).writes.length).toBe(2)
  await finish(page)
  await expect(page.getByText('Ready', { exact: true })).toBeVisible()
  const xml = strFromU8(writtenParts((await probe(page)).writes[1])['word/document.xml'])
  expect(xml).toContain('Newer Save As retry')
  expect(xml).not.toContain('Retry this content')
})

test('acknowledged conversion refuses source and aliases, writes a copy, then reopens metadata and edits', async ({
  page,
}) => {
  await installProbe(page, true)
  await page.goto('./apps/draft')
  await fileTab(page)
  await draftFileAction(page, 'Open')
  await page
    .getByRole('dialog', { name: 'Import report', exact: true })
    .getByRole('button', { name: 'Continue', exact: true })
    .click()
  await expect(editorFor(page)).toHaveText('Original source')
  await expect(editorFor(page)).toHaveAttribute('lang', 'pl-PL')
  await editorFor(page).fill('Edited copy')
  const save = page.getByRole('button', { name: 'Save document', exact: true })
  await configure(page, { accept: true, pickSource: true })
  await save.click()
  await expect(
    page.getByText('The imported source cannot be replaced. Choose a different filename for the converted DOCX copy.', {
      exact: true,
    }),
  ).toBeVisible()
  expect((await probe(page)).sourceWrites).toBe(0)
  await configure(page, { pickSource: false, aliasSource: true })
  await save.click()
  await expect(save).toBeEnabled()
  expect((await probe(page)).sourceWrites).toBe(0)
  expect((await probe(page)).writes).toHaveLength(0)
  expect((await probe(page)).sourceCreates).toBe(0)
  await configure(page, { aliasSource: false })
  await save.click()
  await expect.poll(async () => (await probe(page)).writes.length).toBe(1)
  await finish(page)
  await expect(page.getByText('Ready', { exact: true })).toBeVisible()
  const bytes = (await probe(page)).writes[0]
  const parts = writtenParts(bytes)
  expect(strFromU8(parts['docProps/core.xml'])).toContain('Source author')
  expect(strFromU8(parts['docProps/core.xml'])).toContain('Source title')
  expect(strFromU8(parts['word/document.xml'])).toContain('Edited copy')
  expect(strFromU8(parts['word/document.xml'])).not.toContain('<w:object')
  // The original bytes remain unchanged; omission is permitted only in the acknowledged copy.
  expect(strFromU8(unzipSync(source)['word/document.xml'])).toContain('<w:object')
  await page.evaluate(() =>
    Object.defineProperty(window, 'showOpenFilePicker', { configurable: true, value: undefined }),
  )
  const choosing = page.waitForEvent('filechooser')
  await draftFileAction(page, 'Open')
  await (
    await choosing
  ).setFiles({
    name: 'copy.docx',
    mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    buffer: Buffer.from(bytes),
  })
  await expect(editorFor(page)).toHaveText('Edited copy')
  await expect(editorFor(page)).toHaveAttribute('lang', 'pl-PL')
  await expect(page.getByText('Ready', { exact: true })).toBeVisible()
})

test('input import without source identity refuses an existing renamed destination before writing', async ({
  page,
}) => {
  await installProbe(page, true)
  await page.goto('./apps/draft')
  await fileTab(page)
  await page.evaluate(() =>
    Object.defineProperty(window, 'showOpenFilePicker', { configurable: true, value: undefined }),
  )
  const choosing = page.waitForEvent('filechooser')
  await draftFileAction(page, 'Open')
  await (
    await choosing
  ).setFiles({
    name: 'original.docx',
    mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    buffer: Buffer.from(source),
  })
  await page
    .getByRole('dialog', { name: 'Import report', exact: true })
    .getByRole('button', { name: 'Continue', exact: true })
    .click()
  await editorFor(page).fill('Keep original safe')
  await configure(page, { accept: true, aliasSource: true })
  const save = page.getByRole('button', { name: 'Save document', exact: true })
  await save.click()
  await expect(save).toBeEnabled()
  expect((await probe(page)).sourceCreates).toBe(0)
  expect((await probe(page)).sourceWrites).toBe(0)
  await expect(page.getByText('Unsaved changes', { exact: true })).toBeVisible()
  await configure(page, { aliasSource: false })
  await save.click()
  await expect.poll(async () => (await probe(page)).writes.length).toBe(1)
  await finish(page)
  await expect(page.getByText('Ready', { exact: true })).toBeVisible()
  expect(strFromU8(writtenParts((await probe(page)).writes[0])['word/document.xml'])).toContain('Keep original safe')
})
