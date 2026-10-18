import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { readFile, writeFile } from 'node:fs/promises'
import { DOMParser, XMLSerializer } from '@xmldom/xmldom'
import { unzipSync, zipSync, strToU8, strFromU8 } from 'fflate'
import * as bindings from 'formualizer/pkg/formualizer_wasm_bg.js'

const scratch = new URL('../../../../tmp/grid-review/', import.meta.url)
const ExcelJS = createRequire(import.meta.url)(fileURLToPath(new URL('exceljs.cjs', scratch)))
const XLSX = await import(new URL('sheetjs.mjs', scratch))
const parser = new DOMParser()
const ns = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'
const relNs = 'http://schemas.openxmlformats.org/package/2006/relationships'
const officeRel = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/'
const initial = new ExcelJS.Workbook()
const input = initial.addWorksheet('Input')
initial.addWorksheet('Calc').getCell('A1').value = { formula: 'Input!A2*2', result: 10 }
input.getCell('A1').value = 'Label'
input.getCell('A1').font = { bold: true }
input.mergeCells('A1:B1')
input.getCell('A2').value = 5
input.getCell('A2').note = 'Keep this note'
input.getCell('A2').dataValidation = { type: 'whole', operator: 'between', formulae: [0, 100] }
const original = unzipSync(new Uint8Array(await initial.xlsx.writeBuffer()))
const xml = (parts, path) => parser.parseFromString(strFromU8(parts[path]), 'application/xml')
const store = (parts, path, doc) => {
  parts[path] = strToU8(new XMLSerializer().serializeToString(doc))
}
function append(parts, path, parent, child) {
  const doc = xml(parts, path)
  const fragment = parser.parseFromString(child, 'application/xml').documentElement
  doc.getElementsByTagName(parent)[0].appendChild(doc.importNode(fragment, true))
  store(parts, path, doc)
}
original['customXml/item1.xml'] = strToU8(
  '<vendor:opaque xmlns:vendor="urn:spike" keep="verbatim">unsupported</vendor:opaque>',
)
append(
  original,
  'xl/_rels/workbook.xml.rels',
  'Relationships',
  `<Relationship xmlns="${relNs}" Id="opaque" Type="urn:spike:opaque" Target="../customXml/item1.xml"/>`,
)
// Synthetic native pivot graph: tests retention, not schema/consumer compatibility.
original['xl/pivotCache/pivotCacheDefinition1.xml'] = strToU8(
  `<pivotCacheDefinition xmlns="${ns}" xmlns:r="${officeRel.slice(0, -1)}" r:id="records" refreshOnLoad="1" recordCount="1"><cacheSource type="worksheet"><worksheetSource ref="A1:A2" sheet="Input"/></cacheSource><cacheFields count="1"><cacheField name="Label"><sharedItems containsNumber="1"><n v="5"/></sharedItems></cacheField></cacheFields></pivotCacheDefinition>`,
)
original['xl/pivotCache/pivotCacheRecords1.xml'] = strToU8(
  `<pivotCacheRecords xmlns="${ns}" count="1"><r><x v="0"/></r></pivotCacheRecords>`,
)
original['xl/pivotCache/_rels/pivotCacheDefinition1.xml.rels'] = strToU8(
  `<Relationships xmlns="${relNs}"><Relationship Id="records" Type="${officeRel}pivotCacheRecords" Target="pivotCacheRecords1.xml"/></Relationships>`,
)
original['xl/pivotTables/pivotTable1.xml'] = strToU8(
  `<pivotTableDefinition xmlns="${ns}" name="SpikePivot" cacheId="1" dataCaption="Values"><location ref="D1:D2" firstHeaderRow="1" firstDataRow="1" firstDataCol="0"/><pivotFields count="1"><pivotField dataField="1"/></pivotFields><dataFields count="1"><dataField name="Sum" fld="0" subtotal="sum"/></dataFields></pivotTableDefinition>`,
)
original['xl/pivotTables/_rels/pivotTable1.xml.rels'] = strToU8(
  `<Relationships xmlns="${relNs}"><Relationship Id="cache" Type="${officeRel}pivotCacheDefinition" Target="../pivotCache/pivotCacheDefinition1.xml"/></Relationships>`,
)
append(
  original,
  'xl/workbook.xml',
  'workbook',
  `<pivotCaches xmlns="${ns}" xmlns:r="${officeRel.slice(0, -1)}"><pivotCache cacheId="1" r:id="cache"/></pivotCaches>`,
)
append(
  original,
  'xl/_rels/workbook.xml.rels',
  'Relationships',
  `<Relationship xmlns="${relNs}" Id="cache" Type="${officeRel}pivotCacheDefinition" Target="pivotCache/pivotCacheDefinition1.xml"/>`,
)
append(
  original,
  'xl/worksheets/sheet1.xml',
  'worksheet',
  `<pivotTableParts xmlns="${ns}" xmlns:r="${officeRel.slice(0, -1)}" count="1"><pivotTablePart r:id="pivot"/></pivotTableParts>`,
)
append(
  original,
  'xl/worksheets/_rels/sheet1.xml.rels',
  'Relationships',
  `<Relationship xmlns="${relNs}" Id="pivot" Type="${officeRel}pivotTable" Target="../pivotTables/pivotTable1.xml"/>`,
)
for (const [part, type] of [
  ['pivotCache/pivotCacheDefinition1.xml', 'pivotCacheDefinition'],
  ['pivotCache/pivotCacheRecords1.xml', 'pivotCacheRecords'],
  ['pivotTables/pivotTable1.xml', 'pivotTable'],
]) {
  append(
    original,
    '[Content_Types].xml',
    'Types',
    `<Override xmlns="http://schemas.openxmlformats.org/package/2006/content-types" PartName="/xl/${part}" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.${type}+xml"/>`,
  )
}
const fixture = zipSync(original)
await writeFile(new URL('fixture.xlsx', scratch), fixture)
const openedExcel = new ExcelJS.Workbook()
await openedExcel.xlsx.load(fixture)
openedExcel.getWorksheet('Input').getCell('A2').value = 7
const excelSaved = new Uint8Array(await openedExcel.xlsx.writeBuffer())
const openedSheet = XLSX.read(fixture, { type: 'array', cellStyles: true })
openedSheet.Sheets.Input.A2.v = 7
const sheetSaved = XLSX.write(openedSheet, { type: 'array', bookType: 'xlsx', cellStyles: true })
// Deliberately narrow overlay: only an existing numeric cell; no structural edits.
const overlay = unzipSync(fixture)
const changed = xml(overlay, 'xl/worksheets/sheet1.xml')
const a2 = Array.from(changed.getElementsByTagName('c')).find((c) => c.getAttribute('r') === 'A2')
a2.getElementsByTagName('v')[0].textContent = '7'
store(overlay, 'xl/worksheets/sheet1.xml', changed)
// The chosen calculation engine owns dependencies; the overlay owns only serialization.
const wasmBytes = await readFile(
  new URL('../../../../node_modules/formualizer/pkg/formualizer_wasm_bg.wasm', import.meta.url),
)
const { instance } = await WebAssembly.instantiate(wasmBytes, { './formualizer_wasm_bg.js': bindings })
bindings.__wbg_set_wasm(instance.exports)
instance.exports.__wbindgen_start()
const engine = new bindings.Workbook({ cycleDetection: 'runtime', cyclePolicy: 'error' })
engine.addSheet('Input')
engine.addSheet('Calc')
engine.setValue('Input', 2, 1, 5)
engine.setFormula('Calc', 1, 1, '=Input!A2*2')
engine.evaluateAll()
assert.equal(engine.sheet('Calc').getValue(1, 1), 10)
engine.setValue('Input', 2, 1, 7)
engine.evaluateAll()
const formulaResult = engine.sheet('Calc').getValue(1, 1)
assert.equal(formulaResult, 14)
const calculatedSheet = xml(overlay, 'xl/worksheets/sheet2.xml')
calculatedSheet.getElementsByTagName('v')[0].textContent = String(formulaResult)
store(overlay, 'xl/worksheets/sheet2.xml', calculatedSheet)
engine.free()
// Keep fullCalcOnLoad for consumers; opaque pivot caches are stale and require refresh.
const workbook = xml(overlay, 'xl/workbook.xml')
const calc = workbook.getElementsByTagName('calcPr')[0]
calc.setAttribute('fullCalcOnLoad', '1')
store(overlay, 'xl/workbook.xml', workbook)
const overlaySaved = zipSync(overlay)
const results = []
for (const [writer, bytes] of [
  ['ExcelJS 4.4.0 browser bundle', excelSaved],
  ['SheetJS CE 0.20.3', sheetSaved],
  ['fflate/xmldom narrow overlay', overlaySaved],
]) {
  const saved = unzipSync(new Uint8Array(bytes))
  const reopened = new ExcelJS.Workbook()
  await reopened.xlsx.load(bytes)
  assert.deepEqual(
    reopened.worksheets.map((s) => s.name),
    ['Input', 'Calc'],
  )
  assert.equal(reopened.getWorksheet('Input').getCell('A2').value, 7)
  assert.equal(reopened.getWorksheet('Calc').getCell('A1').value.formula, 'Input!A2*2')
  const missingParts = Object.keys(original).filter((path) => !(path in saved))
  const changedParts = Object.keys(original).filter(
    (path) => path in saved && !Buffer.from(original[path]).equals(Buffer.from(saved[path])),
  )
  const record = {
    writer,
    missingParts,
    changedParts,
    bold: reopened.getWorksheet('Input').getCell('A1').font?.bold || false,
    merged: reopened.getWorksheet('Input').getCell('B1').isMerged,
    comment: !!reopened.getWorksheet('Input').getCell('A2').note,
    validation: reopened.getWorksheet('Input').getCell('A2').dataValidation?.type || null,
    cachedFormulaResult: reopened.getWorksheet('Calc').getCell('A1').value.result,
  }
  if (writer.startsWith('fflate')) {
    assert.deepEqual(missingParts, [])
    assert.deepEqual(changedParts.sort(), ['xl/workbook.xml', 'xl/worksheets/sheet1.xml', 'xl/worksheets/sheet2.xml'])
    assert.equal(record.bold, true)
    assert.equal(record.merged, true)
    assert.equal(record.comment, true)
    assert.equal(record.validation, 'whole')
    assert.equal(record.cachedFormulaResult, 14)
  } else assert.ok(missingParts.includes('customXml/item1.xml'))
  results.push(record)
}
await writeFile(new URL('roundtrip-results.json', import.meta.url), JSON.stringify(results, null, 2) + '\n')
console.log(JSON.stringify(results, null, 2))
