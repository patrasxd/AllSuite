import { test, expect, type Download } from '@playwright/test'
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate'

const simpleXlsxFixture = () =>
  zipSync(
    {
      '[Content_Types].xml': strToU8(
        '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>',
      ),
      '_rels/.rels': strToU8(
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="root" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>',
      ),
      'xl/workbook.xml': strToU8(
        '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Imported" sheetId="1" r:id="sheet1"/></sheets></workbook>',
      ),
      'xl/_rels/workbook.xml.rels': strToU8(
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="sheet1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>',
      ),
      'xl/worksheets/sheet1.xml': strToU8(
        '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>opened from xlsx</t></is></c></row><row r="2"><c r="A2"><f>1+1</f><v>2</v></c></row></sheetData></worksheet>',
      ),
    },
    { level: 0 },
  )

const chartPivotXlsxFixture = () => {
  const parts = unzipSync(simpleXlsxFixture())
  const relationshipNamespace = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'
  const packageRelationshipsNamespace = 'http://schemas.openxmlformats.org/package/2006/relationships'
  const contentTypes = strFromU8(parts['[Content_Types].xml'])
  const overrides = [
    ['xl/drawings/drawing1.xml', 'application/vnd.openxmlformats-officedocument.drawing+xml'],
    ['xl/charts/chart1.xml', 'application/vnd.openxmlformats-officedocument.drawingml.chart+xml'],
    ['xl/pivotTables/pivotTable1.xml', 'application/vnd.openxmlformats-officedocument.spreadsheetml.pivotTable+xml'],
    [
      'xl/pivotCache/pivotCacheDefinition1.xml',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.pivotCacheDefinition+xml',
    ],
    [
      'xl/pivotCache/pivotCacheRecords1.xml',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.pivotCacheRecords+xml',
    ],
  ]
    .map(([partName, contentType]) => `<Override PartName="/${partName}" ContentType="${contentType}"/>`)
    .join('')
  parts['[Content_Types].xml'] = strToU8(contentTypes.replace('</Types>', `${overrides}</Types>`))
  parts['xl/workbook.xml'] = strToU8(
    strFromU8(parts['xl/workbook.xml']).replace(
      '</workbook>',
      '<pivotCaches><pivotCache cacheId="1" r:id="pivotCache1"/></pivotCaches></workbook>',
    ),
  )
  parts['xl/_rels/workbook.xml.rels'] = strToU8(
    strFromU8(parts['xl/_rels/workbook.xml.rels']).replace(
      '</Relationships>',
      `<Relationship Id="pivotCache1" Type="${relationshipNamespace}/pivotCacheDefinition" Target="pivotCache/pivotCacheDefinition1.xml"/></Relationships>`,
    ),
  )
  parts['xl/worksheets/sheet1.xml'] = strToU8(
    strFromU8(parts['xl/worksheets/sheet1.xml'])
      .replace(
        '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">',
        '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">',
      )
      .replace(
        '</worksheet>',
        '<drawing r:id="drawing1"/><pivotTableParts count="1"><pivotTablePart r:id="pivot1"/></pivotTableParts></worksheet>',
      ),
  )
  parts['xl/worksheets/_rels/sheet1.xml.rels'] = strToU8(
    `<Relationships xmlns="${packageRelationshipsNamespace}"><Relationship Id="drawing1" Type="${relationshipNamespace}/drawing" Target="../drawings/drawing1.xml"/><Relationship Id="pivot1" Type="${relationshipNamespace}/pivotTable" Target="../pivotTables/pivotTable1.xml"/></Relationships>`,
  )
  parts['xl/drawings/drawing1.xml'] = strToU8(
    `<xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing" xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="${relationshipNamespace}"><xdr:graphicFrame><xdr:graphic><a:graphicData><c:chart r:id="chart1"/></a:graphicData></xdr:graphic></xdr:graphicFrame></xdr:wsDr>`,
  )
  parts['xl/drawings/_rels/drawing1.xml.rels'] = strToU8(
    `<Relationships xmlns="${packageRelationshipsNamespace}"><Relationship Id="chart1" Type="${relationshipNamespace}/chart" Target="../charts/chart1.xml"/></Relationships>`,
  )
  parts['xl/charts/chart1.xml'] = strToU8(
    '<chartSpace xmlns="http://schemas.openxmlformats.org/drawingml/2006/chart"/>',
  )
  parts['xl/pivotTables/pivotTable1.xml'] = strToU8(
    '<pivotTableDefinition xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" name="PivotOne" cacheId="1"><location ref="E1:G5"/></pivotTableDefinition>',
  )
  parts['xl/pivotCache/pivotCacheDefinition1.xml'] = strToU8(
    '<pivotCacheDefinition xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" cacheId="1" r:id="pivotRecords1" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><cacheSource type="worksheet"><worksheetSource ref="A1:C2" sheet="Imported"/></cacheSource></pivotCacheDefinition>',
  )
  parts['xl/pivotCache/_rels/pivotCacheDefinition1.xml.rels'] = strToU8(
    `<Relationships xmlns="${packageRelationshipsNamespace}"><Relationship Id="pivotRecords1" Type="${relationshipNamespace}/pivotCacheRecords" Target="pivotCacheRecords1.xml"/></Relationships>`,
  )
  parts['xl/pivotCache/pivotCacheRecords1.xml'] = strToU8(
    '<pivotCacheRecords xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="1"><r><n v="5"/></r></pivotCacheRecords>',
  )
  return zipSync(parts, { level: 0 })
}

async function readDownloadBytes(download: Download): Promise<Buffer> {
  const stream = await download.createReadStream()
  if (!stream) throw new Error('The browser did not provide the XLSX download stream.')
  const chunks: Buffer[] = []
  for await (const chunk of stream) chunks.push(Buffer.from(chunk))
  return Buffer.concat(chunks)
}

test('@smoke Draft to Grid to Draft navigation uses the registered lazy app route', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 })
  await page.goto('./#/draft')
  await expect(page.getByRole('textbox', { name: 'Document editor', exact: true })).toBeVisible()

  await page.getByRole('button', { name: 'Back to AllSuite' }).click()
  await page.getByRole('button', { name: 'Open Grid', exact: true }).click()
  await expect(page).toHaveURL(/\/AllSuite\/apps\/grid$/)
  await expect(page.getByRole('grid', { name: 'Spreadsheet grid' })).toBeVisible()
  await expect(page.getByRole('textbox', { name: 'Formula bar' })).toBeVisible()

  const workspaceFits = await page.evaluate(() => {
    const root = document.documentElement
    return root.scrollWidth <= window.innerWidth && root.scrollHeight <= window.innerHeight
  })
  expect(workspaceFits).toBe(true)

  await page.getByRole('button', { name: 'Back to AllSuite' }).click()
  await page.getByRole('button', { name: 'Open Draft', exact: true }).click()
  await expect(page).toHaveURL(/\/AllSuite\/apps\/draft$/)
  await expect(page.getByRole('textbox', { name: 'Document editor', exact: true })).toBeVisible()
})

test('@smoke Grid keeps its workspace inside the viewport on a narrow touch screen', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('./#/grid')

  const formulaBar = page.getByRole('textbox', { name: 'Formula bar' })
  await expect(formulaBar).toBeVisible()
  await formulaBar.focus()
  await expect(formulaBar).toBeFocused()
  await expect(page.getByRole('navigation', { name: 'Touch controls' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Move selection right' })).toHaveCSS('min-height', '48px')

  for (const tab of await page.getByRole('tab').all()) {
    const bounds = await tab.boundingBox()
    expect(bounds?.height).toBeGreaterThanOrEqual(44)
    expect(bounds?.width).toBeGreaterThanOrEqual(44)
  }

  const dimensions = await page.evaluate(() => ({
    viewportWidth: window.innerWidth,
    documentWidth: document.documentElement.scrollWidth,
    documentScroll: document.scrollingElement?.scrollTop ?? 0,
    sheetOverflow: document.querySelector('.grid-sheet-scroll')!.scrollWidth,
  }))
  expect(dimensions.documentWidth).toBeLessThanOrEqual(dimensions.viewportWidth)
  expect(dimensions.documentScroll).toBe(0)
  expect(dimensions.sheetOverflow).toBeGreaterThan(dimensions.viewportWidth)
})

test('@smoke Grid edits formulas and literal text, and undoes a bulk row insertion', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 })
  await page.goto('./#/grid')
  const grid = page.getByRole('grid', { name: 'Spreadsheet grid' })
  await grid.focus()
  await grid.press('x')
  const editor = page.getByRole('textbox', { name: 'Edit cell A1' })
  await expect(editor).toBeFocused()
  await editor.fill('=1+1')
  await editor.press('Enter')
  await expect(page.getByRole('textbox', { name: 'Formula bar' })).toHaveValue('=1+1')
  await expect(page.getByRole('gridcell', { name: 'A1, empty' })).toBeVisible()

  const formulaBar = page.getByRole('textbox', { name: 'Formula bar' })
  await formulaBar.fill("'=1+1")
  await formulaBar.press('Enter')
  await expect(page.getByRole('gridcell', { name: 'A1, =1+1' })).toBeVisible()
  await grid.press('F2')
  const literalEditor = page.getByRole('textbox', { name: 'Edit cell A1' })
  await expect(literalEditor).toHaveValue("'=1+1")
  await literalEditor.press('Enter')

  const nameBox = page.getByRole('textbox', { name: 'Name box' })
  await nameBox.fill('A1:A2')
  await nameBox.press('Enter')
  await formulaBar.fill('bulk')
  await formulaBar.press('Control+Enter')
  await page.locator('[data-row-header="1"]').click({ button: 'right' })
  await page.getByRole('menuitem', { name: 'Insert 2 rows above' }).click()
  await expect(page.getByRole('gridcell', { name: 'A3, bulk' })).toBeVisible()
  await expect(page.getByRole('gridcell', { name: 'A4, bulk' })).toBeVisible()
  await grid.press('Control+z')
  await expect(page.getByRole('gridcell', { name: 'A1, bulk' })).toBeVisible()
  await expect(page.getByRole('gridcell', { name: 'A2, bulk' })).toBeVisible()
})

test('@smoke Grid preview edits use the shared dirty and beforeunload guards', async ({ page }) => {
  await page.goto('./#/grid')
  const formulaBar = page.getByRole('textbox', { name: 'Formula bar' })
  await formulaBar.fill('=SUM(A1:A4)')
  await page.getByRole('tab', { name: 'File', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Save', exact: true })).toBeVisible()

  await page.getByRole('button', { name: 'Back to AllSuite' }).click()
  const unsavedDialog = page.getByRole('dialog', { name: 'Unsaved changes' })
  await expect(unsavedDialog).toBeVisible()
  await unsavedDialog.getByRole('button', { name: 'Stay' }).click()
  await expect(page).toHaveURL(/\/AllSuite\/apps\/grid$/)

  const unloadDialog = page.waitForEvent('dialog').then(async (dialog) => {
    expect(dialog.type()).toBe('beforeunload')
    await dialog.accept()
  })
  await page.reload()
  await unloadDialog
  await expect(page.getByRole('grid', { name: 'Spreadsheet grid' })).toBeVisible()
})

test('@smoke Grid recalculates a visible formula after editing its precedent', async ({ page }) => {
  test.setTimeout(20_000)
  const externalRequests: string[] = []
  const errors: string[] = []
  page.on('request', (request) => {
    if (new URL(request.url()).origin !== 'http://127.0.0.1:4176') externalRequests.push(request.url())
  })
  page.on('pageerror', (error) => errors.push(error.message))
  await page.goto('./#/grid')
  // Exercise the built app under its real policy, including its module worker.
  await expect(page.locator('meta[http-equiv="Content-Security-Policy"]')).toHaveAttribute(
    'content',
    /script-src 'self';/,
  )
  const nameBox = page.getByRole('textbox', { name: 'Name box' })
  const formulaBar = page.getByRole('textbox', { name: 'Formula bar' })

  await formulaBar.fill('5')
  await formulaBar.press('Enter')
  await nameBox.fill('B1')
  await nameBox.press('Enter')
  await formulaBar.fill('=A1*2')
  await formulaBar.press('Enter')
  await expect(page.getByRole('gridcell', { name: 'B1, 10' })).toBeVisible()

  await nameBox.fill('A1')
  await nameBox.press('Enter')
  await formulaBar.fill('8')
  await formulaBar.press('Enter')
  await nameBox.fill('B1')
  await nameBox.press('Enter')
  await expect(page.getByRole('gridcell', { name: 'B1, 16' })).toBeVisible()
  await expect(formulaBar).toHaveValue('=A1*2')
  expect(externalRequests).toEqual([])
  expect(errors).toEqual([])
})

test('@smoke Grid localizes formula help and formatting without changing numeric cell contents', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 })
  await page.addInitScript(() => localStorage.setItem('allsuite:locale', 'en'))
  await page.goto('./#/grid')

  const nameBox = page.getByRole('textbox', { name: 'Name box' })
  const formulaBar = page.getByRole('textbox', { name: 'Formula bar' })
  await formulaBar.fill('=SUMA(1,5;2,5)')
  await formulaBar.press('Enter')
  await expect(page.getByRole('gridcell', { name: 'A1, 4' })).toBeVisible()

  await nameBox.fill('B1')
  await nameBox.press('Enter')
  await formulaBar.fill('=COUNT(A1)')
  await formulaBar.press('Enter')
  await expect(page.getByRole('gridcell', { name: 'B1, 1' })).toBeVisible()

  await nameBox.fill('A1')
  await nameBox.press('Enter')
  await page.getByRole('combobox', { name: 'Number format' }).selectOption('pln')
  await expect(page.locator('#grid-cell-A1')).toContainText(/PLN|zł/u)
  await expect(page.getByRole('gridcell', { name: 'B1, 1' })).toBeVisible()

  await page.getByRole('button', { name: 'Open preferences menu' }).click()
  await page.getByRole('button', { name: 'Polski', exact: true }).click()
  const polishFormulaBar = page.getByRole('textbox', { name: 'Pasek formuły' })
  await expect(polishFormulaBar).toHaveValue('=SUMA(1,5;2,5)')
  await expect(page.locator('#grid-cell-A1')).toContainText(/4/u)
  await expect(page.getByRole('gridcell', { name: /B1, 1/u })).toBeVisible()

  await page.getByRole('button', { name: 'Funkcje formuł', exact: true }).click()
  const functionSearch = page.getByRole('textbox', { name: 'Szukaj funkcji' })
  await functionSearch.fill('VLOOKUP')
  await expect(page.getByRole('button', { name: /Wstaw WYSZUKAJ.PIONOWO \(VLOOKUP\)/u })).toBeVisible()
  await functionSearch.fill('IF')
  await expect(page.getByRole('button', { name: 'Wstaw JEŻELI (IF)' })).toBeVisible()
})

test('@smoke Grid exports an XLSX download and clears dirty state after initiating the fallback', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, 'showSaveFilePicker', { configurable: true, value: undefined })
  })
  await page.goto('./#/grid')
  const formulaBar = page.getByRole('textbox', { name: 'Formula bar' })
  await formulaBar.fill('saved locally')
  await formulaBar.press('Enter')
  await expect(page.locator('.grid-app')).toHaveAttribute('data-dirty', 'true')

  const downloadPromise = page.waitForEvent('download')
  await page.getByRole('tab', { name: 'File', exact: true }).click()
  await page.getByRole('button', { name: 'Save', exact: true }).click()
  const download = await downloadPromise
  expect(download.suggestedFilename()).toBe('Book1.xlsx')
  await expect(page.locator('.grid-app')).not.toHaveAttribute('data-dirty', 'true')
  await expect(page.getByRole('status')).toContainText('download was initiated')
})

test('@smoke Grid Save As downloads a workbook when the file picker is unavailable', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, 'showSaveFilePicker', { configurable: true, value: undefined })
  })
  await page.goto('./#/grid')
  await page.getByRole('tab', { name: 'File', exact: true }).click()

  const downloadPromise = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Save As', exact: true }).click()
  const download = await downloadPromise

  expect(download.suggestedFilename()).toBe('Book1.xlsx')
  await expect(page.getByRole('status')).toContainText('download was initiated')
})

test('@smoke Grid saves, reopens, edits and saves an XLSX copy through the no-picker fallback', async ({ page }) => {
  test.setTimeout(60_000)
  await page.addInitScript(() => {
    Object.defineProperty(window, 'showOpenFilePicker', { configurable: true, value: undefined })
    Object.defineProperty(window, 'showSaveFilePicker', { configurable: true, value: undefined })
  })
  await page.goto('./#/grid')
  await page.getByRole('tab', { name: 'File', exact: true }).click()
  await page.getByRole('button', { name: 'New', exact: true }).click()

  const nameBox = page.getByRole('textbox', { name: 'Name box' })
  const formulaBar = page.getByRole('textbox', { name: 'Formula bar' })
  const setCell = async (address: string, value: string) => {
    await nameBox.fill(address)
    await nameBox.press('Enter')
    await formulaBar.fill(value)
    await formulaBar.press('Enter')
  }
  const openFallbackFile = async (name: string, buffer: Buffer) => {
    const chooserPromise = page.waitForEvent('filechooser')
    await page.getByRole('tab', { name: 'File', exact: true }).click()
    await page.getByRole('button', { name: 'Open', exact: true }).click()
    const chooser = await chooserPromise
    await chooser.setFiles({
      name,
      mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      buffer,
    })
  }
  const confirmOpen = async () => {
    const preflight = page.getByRole('dialog', { name: 'Workbook compatibility check' })
    await expect(preflight).toBeVisible()
    await preflight.getByRole('button', { name: 'Open workbook' }).click()
    await expect(preflight).toHaveCount(0)
  }

  await setCell('A1', '5')
  await setCell('B1', '=SUMA(A1;2)')
  await expect(page.getByRole('gridcell', { name: 'B1, 7' })).toBeVisible({ timeout: 20_000 })

  const firstDownloadPromise = page.waitForEvent('download')
  await page.getByRole('tab', { name: 'File', exact: true }).click()
  await page.getByRole('button', { name: 'Save', exact: true }).click()
  const firstDownload = await firstDownloadPromise
  const firstBytes = await readDownloadBytes(firstDownload)
  expect(firstBytes.byteLength).toBeGreaterThan(100)
  expect(strFromU8(unzipSync(firstBytes)['xl/workbook.xml'])).toContain('workbook')
  await expect(page.locator('.grid-app')).not.toHaveAttribute('data-dirty', 'true')

  await openFallbackFile(firstDownload.suggestedFilename(), firstBytes)
  await confirmOpen()
  await expect(page.getByRole('gridcell', { name: 'A1, 5' })).toBeVisible()
  await expect(page.getByRole('gridcell', { name: 'B1, 7' })).toBeVisible()
  await nameBox.fill('B1')
  await nameBox.press('Enter')
  await expect(formulaBar).toHaveValue('=SUM(A1,2)')

  await setCell('A1', '8')
  await expect(page.getByRole('gridcell', { name: 'B1, 10' })).toBeVisible()
  const saveAsDownloadPromise = page.waitForEvent('download')
  await page.getByRole('tab', { name: 'File', exact: true }).click()
  await page.getByRole('button', { name: 'Save As', exact: true }).click()
  const saveAsDownload = await saveAsDownloadPromise
  const saveAsBytes = await readDownloadBytes(saveAsDownload)
  expect(saveAsDownload.suggestedFilename()).toMatch(/\.xlsx$/i)
  await expect(page.locator('.grid-app')).not.toHaveAttribute('data-dirty', 'true')

  await openFallbackFile(saveAsDownload.suggestedFilename(), saveAsBytes)
  await confirmOpen()
  await expect(page.getByRole('gridcell', { name: 'A1, 8' })).toBeVisible()
  await expect(page.getByRole('gridcell', { name: 'B1, 10' })).toBeVisible()
})

test('@smoke Grid blocks corrupt XLSX and reports chart and pivot parts before replacement', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, 'showOpenFilePicker', { configurable: true, value: undefined })
  })
  await page.goto('./#/grid')
  const formulaBar = page.getByRole('textbox', { name: 'Formula bar' })
  await formulaBar.fill('keep current workbook')
  await formulaBar.press('Enter')
  const input = page.locator('input[type="file"]')
  const upload = (name: string, buffer: Buffer) =>
    input.setInputFiles({
      name,
      mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      buffer,
    })

  await upload('corrupt.xlsx', Buffer.from('not a zip archive'))
  const blocked = page.getByRole('dialog', { name: 'Workbook compatibility check' })
  await expect(blocked).toBeVisible()
  await expect(blocked).toContainText('Blocked')
  await expect(blocked.getByRole('button', { name: 'Open workbook' })).toBeDisabled()
  await blocked.getByRole('button', { name: 'Cancel', exact: true }).click()
  await expect(page.getByRole('gridcell', { name: 'A1, keep current workbook' })).toBeVisible()
  await expect(page.locator('.grid-app')).toHaveAttribute('data-dirty', 'true')

  await upload('chart-pivot.xlsx', Buffer.from(chartPivotXlsxFixture()))
  const preflight = page.getByRole('dialog', { name: 'Workbook compatibility check' })
  await expect(preflight).toBeVisible()
  await expect(preflight).toContainText('At risk')
  await expect(preflight).toContainText(/chart part/i)
  await expect(preflight).toContainText(/pivot table\/cache part/i)
  await preflight.getByRole('button', { name: 'Cancel', exact: true }).click()
  await expect(page.getByRole('gridcell', { name: 'A1, keep current workbook' })).toBeVisible()
  await expect(page.locator('.grid-app')).toHaveAttribute('data-dirty', 'true')
})

test('@smoke Grid requires Save As before overwriting a source with chart and pivot parts', async ({ page }) => {
  const fixtureBase64 = Buffer.from(chartPivotXlsxFixture()).toString('base64')
  await page.addInitScript((encoded) => {
    const binary = atob(encoded)
    const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0))
    const fileBytes = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
    const file = new File([fileBytes], 'chart-pivot.xlsx', {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    })
    const state = { sourceWrites: 0 }
    Object.defineProperty(window, '__gridRiskState', { configurable: true, value: state })
    Object.defineProperty(window, 'showOpenFilePicker', {
      configurable: true,
      value: async () => [
        {
          getFile: async () => file,
          createWritable: async () => {
            state.sourceWrites += 1
            return { write: async () => undefined, close: async () => undefined }
          },
        },
      ],
    })
  }, fixtureBase64)
  await page.goto('./#/grid')
  await page.getByRole('tab', { name: 'File', exact: true }).click()
  await page.getByRole('button', { name: 'Open', exact: true }).click()
  const importReview = page.getByRole('dialog', { name: 'Workbook compatibility check' })
  await expect(importReview).toBeVisible()
  await importReview.getByRole('button', { name: 'Open workbook' }).click()
  await expect(importReview).toHaveCount(0)

  const formulaBar = page.getByRole('textbox', { name: 'Formula bar' })
  await formulaBar.fill('edited with preserved parts')
  await formulaBar.press('Enter')
  await page.getByRole('tab', { name: 'File', exact: true }).click()
  await page.getByRole('button', { name: 'Save', exact: true }).click()

  const saveReview = page.getByRole('dialog', { name: 'Workbook save review' })
  await expect(saveReview).toBeVisible()
  await expect(saveReview).toContainText('Preservation at risk')
  await expect(saveReview).toContainText('xl/charts/chart1.xml')
  await expect(saveReview).toContainText('xl/pivotTables/pivotTable1.xml')
  expect(
    await page.evaluate(
      () => (window as Window & { __gridRiskState: { sourceWrites: number } }).__gridRiskState.sourceWrites,
    ),
  ).toBe(0)
  await saveReview.getByRole('button', { name: 'Cancel save' }).click()
  await expect(page.locator('.grid-app')).toHaveAttribute('data-dirty', 'true')
  expect(
    await page.evaluate(
      () => (window as Window & { __gridRiskState: { sourceWrites: number } }).__gridRiskState.sourceWrites,
    ),
  ).toBe(0)
})

test('@smoke Grid preflights XLSX parts before replacing the in-memory workbook', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 })
  await page.goto('./#/grid')
  const grid = page.getByRole('grid', { name: 'Spreadsheet grid' })
  const formulaBar = page.getByRole('textbox', { name: 'Formula bar' })
  await formulaBar.fill('keep current workbook')
  await formulaBar.press('Enter')
  await expect(page.locator('.grid-app')).toHaveAttribute('data-dirty', 'true')

  const xlsx = Buffer.from(simpleXlsxFixture())
  const input = page.locator('input[type="file"]')
  const uploadFixture = () =>
    input.setInputFiles({
      name: 'fixture.xlsx',
      mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      buffer: xlsx,
    })

  await uploadFixture()
  const preflight = page.getByRole('dialog', { name: 'Workbook compatibility check' })
  await expect(preflight).toBeVisible()
  await expect(preflight).toContainText('Supported and editable')
  await expect(preflight).toContainText('formulas keep their original source and cached result')
  await expect(page.getByRole('gridcell', { name: 'A1, keep current workbook' })).toBeVisible()
  await preflight.getByRole('button', { name: 'Cancel', exact: true }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await expect(page.getByRole('gridcell', { name: 'A1, keep current workbook' })).toBeVisible()
  await expect(page.locator('.grid-app')).toHaveAttribute('data-dirty', 'true')

  await uploadFixture()
  await expect(preflight).toBeVisible()
  const confirm = page.waitForEvent('dialog').then((dialog) => dialog.accept())
  await preflight.getByRole('button', { name: 'Open workbook' }).click()
  await confirm
  await expect(page.getByRole('button', { name: 'Imported' })).toBeVisible()
  await expect(page.getByRole('gridcell', { name: 'A1, opened from xlsx' })).toBeVisible()
  const nameBox = page.getByRole('textbox', { name: 'Name box' })
  await nameBox.fill('A2')
  await nameBox.press('Enter')
  await expect(formulaBar).toHaveValue('=1+1')
  await expect(page.getByRole('gridcell', { name: 'A2, 2' })).toBeVisible()
  await expect(page.locator('.grid-app')).not.toHaveAttribute('data-dirty', 'true')
  await expect(grid).toBeFocused()
})

test('@smoke Grid retains unsupported formula caches and inert external links after import review', async ({
  page,
}) => {
  const remoteRequests: string[] = []
  page.on('request', (request) => {
    if (new URL(request.url()).origin !== 'http://127.0.0.1:4176') remoteRequests.push(request.url())
  })
  const parts = unzipSync(simpleXlsxFixture())
  parts['xl/worksheets/sheet1.xml'] = strToU8(
    strFromU8(parts['xl/worksheets/sheet1.xml'])
      .replace(
        '<worksheet ',
        '<worksheet xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" ',
      )
      .replace('<f>1+1</f><v>2</v>', '<f>_xlfn.UNKNOWN([1]Data!A1)</f><v>37</v>')
      .replace('</worksheet>', '<hyperlinks><hyperlink ref="A1" r:id="external"/></hyperlinks></worksheet>'),
  )
  parts['xl/worksheets/_rels/sheet1.xml.rels'] = strToU8(
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="external" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="https://example.invalid/never-fetch" TargetMode="External"/></Relationships>',
  )
  parts['customXml/item1.xml'] = strToU8('<payload>retained opaque content</payload>')
  await page.goto('./#/grid')
  await page.locator('input[type="file"]').setInputFiles({
    name: 'external.xlsx',
    mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    buffer: Buffer.from(zipSync(parts, { level: 0 })),
  })
  const review = page.getByRole('dialog', { name: 'Workbook compatibility check' })
  await expect(review).toContainText('External links are inert')
  await expect(review).toContainText('Custom XML is retained')
  await review.getByRole('button', { name: 'Open workbook', exact: true }).click()
  const nameBox = page.getByRole('textbox', { name: 'Name box' })
  await nameBox.fill('A2')
  await nameBox.press('Enter')
  await expect(page.getByRole('textbox', { name: 'Formula bar' })).toHaveValue('=_xlfn.UNKNOWN([1]Data!A1)')
  await expect(page.getByRole('gridcell', { name: 'A2, 37' })).toBeVisible()
  expect(remoteRequests).toEqual([])
})

test('@smoke Grid inherits the shared e-ink theme and reduced-motion setting', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('allsuite:theme', 'e-ink-dark'))
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.goto('./#/grid')

  await expect(page.locator('html')).toHaveAttribute('data-theme', 'e-ink-dark')
  await expect(page.locator('html')).toHaveAttribute('data-motion', 'none')
  await expect(page.locator('.grid-app')).toHaveAttribute('data-theme', 'e-ink-dark')
})

test('@smoke Grid navigates, selects name-box ranges, grows lazily and virtualizes both axes', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 })
  await page.goto('./#/grid')
  const grid = page.getByRole('grid', { name: 'Spreadsheet grid' })
  await grid.focus()
  await grid.press('ArrowRight')
  await grid.press('Shift+ArrowDown')
  await expect(grid).toHaveAttribute('aria-activedescendant', 'grid-cell-B2')
  await expect(page.locator('#grid-cell-B2')).toHaveAttribute('aria-selected', 'true')

  const nameBox = page.getByRole('textbox', { name: 'Name box' })
  await nameBox.fill('A1:D20')
  await nameBox.press('Enter')
  await expect(grid).toHaveAttribute('aria-activedescendant', 'grid-cell-D20')
  await expect(nameBox).toHaveValue('A1:D20')

  const viewport = page.locator('.grid-sheet-scroll')
  await viewport.evaluate((element) => {
    element.scrollTop = element.scrollHeight
    element.scrollLeft = element.scrollWidth
    element.dispatchEvent(new Event('scroll'))
  })
  await expect(grid).toHaveAttribute('aria-rowcount', '201')
  await expect(grid).toHaveAttribute('aria-colcount', '43')
  expect(await page.locator('.grid-cell').count()).toBeLessThan(800)
})

test('@smoke Grid supports drag ranges and row, column and corner header selection', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 })
  await page.goto('./#/grid')
  const grid = page.getByRole('grid', { name: 'Spreadsheet grid' })
  await expect(grid).toBeVisible()
  const startBounds = await page.locator('.grid-cell[data-cell-address="A1"]').boundingBox()
  const endBounds = await page.locator('.grid-cell[data-cell-address="C3"]').boundingBox()
  expect(startBounds).not.toBeNull()
  expect(endBounds).not.toBeNull()
  await page.mouse.move(startBounds!.x + startBounds!.width / 2, startBounds!.y + startBounds!.height / 2)
  await page.mouse.down()
  await page.mouse.move(endBounds!.x + endBounds!.width / 2, endBounds!.y + endBounds!.height / 2)
  await page.mouse.up()
  await expect(page.getByRole('textbox', { name: 'Name box' })).toHaveValue('A1:C3')
  await expect(grid).toHaveAttribute('aria-activedescendant', 'grid-cell-C3')

  await page.locator('[data-row-header="3"]').click()
  await expect(page.getByRole('textbox', { name: 'Name box' })).toHaveValue('A3:Z3')
  await page.locator('.grid-sheet-scroll').evaluate((element) => {
    element.scrollLeft = 0
    element.dispatchEvent(new Event('scroll'))
  })
  await expect(page.locator('[data-column-header="2"]')).toBeVisible()
  await page.locator('[data-column-header="2"]').click()
  await expect(page.getByRole('textbox', { name: 'Name box' })).toHaveValue('B1:B100')
  await page.locator('[data-select-all="true"]').click()
  await expect(page.getByRole('textbox', { name: 'Name box' })).toHaveValue('A1:AP200')
})

test('@smoke Grid supports touch selection and keeps the formula bar available on mobile', async ({ browser }) => {
  const context = await browser.newContext({
    baseURL: 'http://127.0.0.1:4176/AllSuite/',
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
  })
  const mobilePage = await context.newPage()
  await mobilePage.goto('./#/grid')
  const grid = mobilePage.getByRole('grid', { name: 'Spreadsheet grid' })
  const targetCell = mobilePage.locator('.grid-cell[data-cell-address="B2"]')
  const cellBounds = await targetCell.boundingBox()
  expect(cellBounds).not.toBeNull()
  await mobilePage.touchscreen.tap(cellBounds!.x + 12, cellBounds!.y + 12)
  await expect(grid).toHaveAttribute('aria-activedescendant', 'grid-cell-B2')

  const formulaBar = mobilePage.getByRole('textbox', { name: 'Formula bar' })
  await expect(formulaBar).toBeVisible()
  await expect(formulaBar).toHaveAttribute('inputmode', 'text')
  await formulaBar.fill('touch value')
  await formulaBar.press('Enter')
  await expect(mobilePage.locator('#grid-cell-B2')).toContainText('touch value')
  await mobilePage.getByRole('button', { name: 'Move selection right' }).tap()
  await expect(grid).toHaveAttribute('aria-activedescendant', 'grid-cell-C2')
  const mobileCell = mobilePage.locator('.grid-cell[data-cell-address="C2"]')
  const mobileCellBounds = await mobileCell.boundingBox()
  expect(mobileCellBounds).not.toBeNull()
  await mobilePage.touchscreen.tap(mobileCellBounds!.x + 12, mobileCellBounds!.y + 12)
  await mobilePage.touchscreen.tap(mobileCellBounds!.x + 12, mobileCellBounds!.y + 12)
  const cellEditor = mobilePage.getByRole('textbox', { name: 'Edit cell C2' })
  await expect(cellEditor).toBeFocused()
  await expect(cellEditor).toHaveAttribute('inputmode', 'text')
  await cellEditor.fill('mobile keyboard entry')
  await cellEditor.press('Enter')
  await expect(mobilePage.getByRole('gridcell', { name: 'C2, mobile keyboard entry' })).toBeVisible()
  await expect(mobilePage.getByRole('navigation', { name: 'Touch controls' })).toBeVisible()

  const rangeToggle = mobilePage.getByRole('button', { name: 'Toggle touch range selection' })
  await rangeToggle.tap()
  await expect(rangeToggle).toHaveAttribute('aria-pressed', 'true')
  await expect(mobilePage.locator('.grid-app')).toHaveAttribute('data-range-selection', 'true')
  const dragStart = await mobilePage.locator('.grid-cell[data-cell-address="A2"]').boundingBox()
  const dragEnd = await mobilePage.locator('.grid-cell[data-cell-address="C3"]').boundingBox()
  expect(dragStart).not.toBeNull()
  expect(dragEnd).not.toBeNull()
  await mobilePage.locator('.grid-cell[data-cell-address="A2"]').dispatchEvent('pointerdown', {
    pointerId: 7,
    pointerType: 'touch',
    isPrimary: true,
    button: 0,
    buttons: 1,
    clientX: dragStart!.x + dragStart!.width / 2,
    clientY: dragStart!.y + dragStart!.height / 2,
  })
  await grid.dispatchEvent('pointermove', {
    pointerId: 7,
    pointerType: 'touch',
    isPrimary: true,
    button: 0,
    buttons: 1,
    clientX: dragEnd!.x + dragEnd!.width / 2,
    clientY: dragEnd!.y + dragEnd!.height / 2,
  })
  await grid.dispatchEvent('pointerup', {
    pointerId: 7,
    pointerType: 'touch',
    isPrimary: true,
    button: 0,
    buttons: 0,
  })
  await expect(mobilePage.getByRole('textbox', { name: 'Name box' })).toHaveValue('A2:C3')

  await context.close()
})

test('@smoke Grid resizes rows and columns and retains grid focus after sheet changes', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 })
  await page.goto('./#/grid')
  const grid = page.getByRole('grid', { name: 'Spreadsheet grid' })
  const columnResize = page.getByRole('slider', { name: 'Resize column A' })
  const columnBounds = await columnResize.boundingBox()
  expect(columnBounds?.width).toBeGreaterThanOrEqual(44)
  expect(columnBounds?.height).toBeGreaterThanOrEqual(44)
  await page.mouse.move(columnBounds!.x + 22, columnBounds!.y + 22)
  await page.mouse.down()
  await page.mouse.move(columnBounds!.x + 62, columnBounds!.y + 22)
  await page.mouse.up()
  await expect(columnResize).toHaveAttribute('aria-valuenow', /1[4-9]\d|2\d\d/)

  const rowResize = page.getByRole('slider', { name: 'Resize row 1', exact: true })
  const rowBounds = await rowResize.boundingBox()
  expect(rowBounds?.width).toBeGreaterThanOrEqual(44)
  expect(rowBounds?.height).toBeGreaterThanOrEqual(44)
  await page.mouse.move(rowBounds!.x + 22, rowBounds!.y + 22)
  await page.mouse.down()
  await page.mouse.move(rowBounds!.x + 22, rowBounds!.y + 42)
  await page.mouse.up()
  await expect(rowResize).toHaveAttribute('aria-valuenow', '52')

  await page.getByRole('button', { name: 'Add sheet' }).click()
  await expect(page.getByRole('button', { name: 'Sheet2' })).toHaveAttribute('aria-current', 'page')
  await page.getByRole('tab', { name: 'Sheet1' }).click()
  await expect(grid).toBeFocused()
  await expect(grid).toHaveAttribute('aria-activedescendant', 'grid-cell-A1')
})

test('@smoke Grid sheet rename uses compact AllUI controls', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 })
  await page.goto('./#/grid')
  await page.getByRole('button', { name: 'Rename sheet' }).click()

  const sheetName = page.getByRole('textbox', { name: 'Sheet name' })
  await expect(sheetName).toHaveCSS('height', '32px')
  await expect(page.getByRole('button', { name: 'Cancel' })).toHaveCSS('height', '32px')
  const renameButton = page.getByRole('button', { name: 'Rename', exact: true })
  await expect(renameButton).toHaveCSS('height', '32px')

  await sheetName.fill('Budget')
  await renameButton.click()
  await expect(page.getByRole('tab', { name: 'Budget' })).toBeVisible()
})

test('@smoke Grid number formatting uses the shared select and compact decimal actions', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 })
  await page.goto('./#/grid')

  const numberFormat = page.getByRole('combobox', { name: 'Number format' })
  await expect(numberFormat).toHaveClass(/all-select-field/)
  await expect(numberFormat.locator('..')).toHaveClass(/all-select-wrapper/)
  await expect(numberFormat.locator('xpath=../..')).toHaveClass(/all-select-container--compact/)

  for (const [name, title] of [
    ['Decrease decimal places', 'Show fewer decimal places.'],
    ['Increase decimal places', 'Show more decimal places.'],
  ]) {
    const action = page.getByRole('button', { name })
    await expect(action).toHaveAttribute('title', title)
    await expect(action).toHaveCSS('width', '32px')
    await expect(action.locator('svg')).toBeVisible()
  }
})

test('@smoke Grid keeps named keyboard editing and the workspace visible across themes and viewport sizes', async ({
  page,
}) => {
  const themes = ['dark', 'light', 'e-ink-light', 'e-ink-dark'] as const
  await page.goto('./#/grid')
  for (const theme of themes) {
    await page.setViewportSize({ width: 1280, height: 800 })
    await page.evaluate((selectedTheme) => localStorage.setItem('allsuite:theme', selectedTheme), theme)
    await page.reload()
    await expect(page.locator('html')).toHaveAttribute('data-theme', theme)
    await expect(page.locator('.grid-app')).toHaveAttribute('data-theme', theme)
    if (theme.startsWith('e-ink')) await expect(page.locator('html')).toHaveAttribute('data-motion', 'none')
    const tokens = await page.evaluate(() => ({
      background: getComputedStyle(document.documentElement).getPropertyValue('--all-bg').trim(),
      text: getComputedStyle(document.documentElement).getPropertyValue('--all-text').trim(),
    }))
    expect(tokens.background).not.toBe('')
    expect(tokens.text).not.toBe('')
    await page.screenshot({ path: `test-results/grid-${theme}.png` })
  }

  await page.evaluate(() => localStorage.setItem('allsuite:theme', 'dark'))
  await page.reload()
  for (const viewport of [
    { width: 390, height: 844 },
    { width: 844, height: 390 },
    { width: 820, height: 1180 },
    { width: 1280, height: 800 },
    { width: 1920, height: 1080 },
  ]) {
    await page.setViewportSize(viewport)
    const formulaBar = page.getByRole('textbox', { name: 'Formula bar' })
    await expect(formulaBar).toBeVisible()
    const formulaBarBounds = await formulaBar.boundingBox()
    const metrics = await page.evaluate(() => {
      return {
        width: window.innerWidth,
        height: window.innerHeight,
        pageWidth: document.documentElement.scrollWidth,
        pageHeight: document.documentElement.scrollHeight,
      }
    })
    expect(metrics.pageWidth).toBeLessThanOrEqual(metrics.width)
    expect(metrics.pageHeight).toBeLessThanOrEqual(metrics.height + 1)
    expect(formulaBarBounds?.width ?? 0).toBeGreaterThan(0)
    expect((formulaBarBounds?.y ?? Number.POSITIVE_INFINITY) + (formulaBarBounds?.height ?? 0)).toBeLessThanOrEqual(
      metrics.height,
    )
    if (viewport.width < 600) await expect(page.getByRole('navigation', { name: 'Touch controls' })).toBeVisible()
    else await expect(page.getByRole('navigation', { name: 'Touch controls' })).toBeHidden()
    await page.screenshot({ path: `test-results/grid-${viewport.width}x${viewport.height}.png` })
  }

  await page.setViewportSize({ width: 1280, height: 800 })
  const nameBox = page.getByRole('textbox', { name: 'Name box' })
  const formulaBar = page.getByRole('textbox', { name: 'Formula bar' })
  const grid = page.getByRole('grid', { name: 'Spreadsheet grid' })
  await nameBox.fill('B2')
  await nameBox.press('Enter')
  await expect(grid).toHaveAttribute('aria-activedescendant', 'grid-cell-B2')
  await formulaBar.fill('=SUM(1,2)')
  await formulaBar.press('Enter')
  await expect(page.getByRole('gridcell', { name: 'B2, 3' })).toBeVisible()
  await expect(formulaBar).toHaveValue('=SUM(1,2)')
})
