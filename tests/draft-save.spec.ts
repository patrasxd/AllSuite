import { draftFileAction } from './helpers/reveal-toolbar-command'
import { test, expect } from '@playwright/test'
import { unzipSync, strFromU8 } from 'fflate'

test('Draft retains newer edits and the confirmed filename across an asynchronous save and Save as cancellation', async ({
  page,
}) => {
  await page.addInitScript(() => {
    const probe = { closing: false, writes: [] as number[], suggested: [] as string[], finish: () => {} }
    Object.assign(window, { pendingSave: probe })
    Object.defineProperty(window, 'showSaveFilePicker', {
      configurable: true,
      value: async ({ suggestedName }: { suggestedName: string }) => {
        probe.suggested.push(suggestedName)
        if (probe.suggested.length > 1) throw new DOMException('Canceled', 'AbortError')
        return {
          kind: 'file',
          name: 'confirmed.docx',
          createWritable: async () => ({
            write: async (blob: Blob) => {
              probe.writes = Array.from(new Uint8Array(await blob.arrayBuffer()))
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
  })
  await page.goto('./apps/draft')
  const editor = page.getByRole('textbox', { name: 'Document editor', exact: true })
  await editor.fill('Saved snapshot')
  await page.getByRole('button', { name: 'File', exact: true }).click()
  const save = page.getByRole('button', { name: 'Save document', exact: true })
  await save.click()
  await expect
    .poll(() => page.evaluate(() => (window as unknown as { pendingSave: { closing: boolean } }).pendingSave.closing))
    .toBe(true)
  await expect(save).toBeDisabled()
  await editor.fill('Newer unsaved edit')
  await page.evaluate(() => (window as unknown as { pendingSave: { finish: () => void } }).pendingSave.finish())
  await expect(save).toBeEnabled()
  await expect(page.getByText('Unsaved changes', { exact: true })).toBeVisible()
  const bytes = await page.evaluate(
    () => (window as unknown as { pendingSave: { writes: number[] } }).pendingSave.writes,
  )
  const xml = strFromU8(unzipSync(new Uint8Array(bytes))['word/document.xml'])
  expect(xml).toContain('Saved snapshot')
  expect(xml).not.toContain('Newer unsaved edit')
  await draftFileAction(page, 'Save as')
  await expect(save).toBeEnabled()
  await expect
    .poll(() =>
      page.evaluate(() => (window as unknown as { pendingSave: { suggested: string[] } }).pendingSave.suggested),
    )
    .toEqual(['Untitled.docx', 'confirmed.docx'])
  await expect(editor).toHaveText('Newer unsaved edit')
  await expect(page.getByText('Unsaved changes', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Back to AllSuite', exact: true }).click()
  await expect(page.getByRole('dialog', { name: 'Unsaved changes', exact: true })).toBeVisible()
})

for (const outcome of [
  'cancel',
  'unavailable',
  'picker-error',
  'write-error',
  'write-abort-error',
  'close-error',
  'success',
] as const) {
  test(`Draft save distinguishes ${outcome}`, async ({ page }) => {
    await page.addInitScript((outcome) => {
      const state = { calls: 0, writes: [] as number[], closed: false }
      Object.assign(window, { saveProbe: state })
      Object.defineProperty(window, 'showSaveFilePicker', {
        configurable: true,
        value:
          outcome === 'unavailable'
            ? undefined
            : async () => {
                state.calls++
                if (outcome === 'cancel') throw new DOMException('Canceled', 'AbortError')
                if (outcome === 'picker-error') throw new DOMException('Denied', 'NotAllowedError')
                return {
                  kind: 'file',
                  name: 'native.docx',
                  createWritable: async () => ({
                    write: async (blob: Blob) => {
                      if (outcome === 'write-error') throw new DOMException('Disk full', 'QuotaExceededError')
                      if (outcome === 'write-abort-error') throw new DOMException('Write aborted', 'AbortError')
                      state.writes = Array.from(new Uint8Array(await blob.arrayBuffer()))
                    },
                    close: async () => {
                      if (outcome === 'close-error') throw new Error('Close failed')
                      state.closed = true
                    },
                  }),
                }
              },
      })
    }, outcome)
    const downloads: string[] = []
    page.on('download', (download) => downloads.push(download.suggestedFilename()))
    await page.goto('./#/draft')
    const editor = page.getByRole('textbox', { name: 'Document editor', exact: true })
    await editor.fill('Save regression content')
    await expect(page.getByText('Unsaved changes', { exact: true })).toBeVisible()
    await page.getByRole('button', { name: 'File', exact: true }).click()
    const save = page.getByRole('button', { name: 'Save document', exact: true })
    await save.click()
    if (outcome === 'unavailable') {
      await expect.poll(() => downloads).toEqual(['Untitled.docx'])
    } else {
      await expect
        .poll(() => page.evaluate(() => (window as unknown as { saveProbe: { calls: number } }).saveProbe.calls))
        .toBe(1)
    }
    await expect(save).toBeEnabled()
    const saved = outcome === 'success' || outcome === 'unavailable'
    await expect(page.getByText(saved ? 'Ready' : 'Unsaved changes', { exact: true })).toBeVisible()
    await expect(page.getByText(saved ? 'Unsaved changes' : 'Ready', { exact: true })).toHaveCount(0)
    await expect(page.getByText('The file could not be opened or saved.', { exact: true })).toHaveCount(
      outcome.endsWith('error') ? 1 : 0,
    )
    await expect(editor).toHaveText('Save regression content')
    if (outcome !== 'unavailable') expect(downloads).toEqual([])
    if (outcome === 'success') {
      const probe = await page.evaluate(
        () => (window as unknown as { saveProbe: { writes: number[]; closed: boolean } }).saveProbe,
      )
      expect(probe.closed).toBe(true)
      const parts = unzipSync(new Uint8Array(probe.writes))
      expect(strFromU8(parts['word/document.xml'])).toContain('Save regression content')
    }
    if (!saved) {
      await page.getByRole('button', { name: 'Back to AllSuite', exact: true }).click()
      const guard = page.getByRole('dialog', { name: 'Unsaved changes', exact: true })
      await expect(guard).toContainText('Save your document before leaving the editor.')
      await guard.getByRole('button', { name: 'Stay', exact: true }).click()
      await expect(editor).toHaveText('Save regression content')
    }
  })
}
