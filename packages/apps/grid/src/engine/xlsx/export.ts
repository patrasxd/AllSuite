import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate'
import { DOMParser, XMLSerializer, type Element as XmlElement, type Node as XmlNode } from '@xmldom/xmldom'
import { formatRangeAddress, formatSheetQualifiedAddress, parseCellAddress } from '../workbook/address'
import type {
  Cell,
  CellStyle,
  CellValue,
  FormulaResult,
  OOXMLPreservationState,
  OOXMLSheetMapping,
  RowMetadata,
  Workbook,
  Worksheet,
} from '../workbook/types'
import { parseXlsxWorkbook, parseXlsxStyles } from './import'
import type { StylesheetMap } from './import'
import { XLSX_LIMITS } from './policy'
import type { XlsxExportProgress, XlsxExportResult, XlsxSaveDiffCode, XlsxSaveDiffEntry } from './types'

const NS = {
  contentTypes: 'http://schemas.openxmlformats.org/package/2006/content-types',
  packageRelationships: 'http://schemas.openxmlformats.org/package/2006/relationships',
  spreadsheet: 'http://schemas.openxmlformats.org/spreadsheetml/2006/main',
  officeRelationships: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships',
  xml: 'http://www.w3.org/XML/1998/namespace',
}
const WORKSHEET_CHILD_ORDER = [
  'sheetPr',
  'dimension',
  'sheetViews',
  'sheetFormatPr',
  'cols',
  'sheetData',
  'sheetCalcPr',
  'sheetProtection',
  'protectedRanges',
  'scenarios',
  'autoFilter',
  'sortState',
  'dataConsolidate',
  'customSheetViews',
  'mergeCells',
  'phoneticPr',
  'conditionalFormatting',
  'dataValidations',
  'hyperlinks',
  'printOptions',
  'pageMargins',
  'pageSetup',
  'headerFooter',
  'rowBreaks',
  'colBreaks',
  'customProperties',
  'cellWatches',
  'ignoredErrors',
  'smartTags',
  'drawing',
  'legacyDrawing',
  'legacyDrawingHF',
  'picture',
  'oleObjects',
  'controls',
  'webPublishItems',
  'tableParts',
  'extLst',
]
const WORKBOOK_CHILD_ORDER = [
  'fileVersion',
  'fileSharing',
  'workbookPr',
  'workbookProtection',
  'bookViews',
  'sheets',
  'functionGroups',
  'externalReferences',
  'definedNames',
  'calcPr',
  'oleSize',
  'customWorkbookViews',
  'pivotCaches',
  'smartTagPr',
  'smartTagTypes',
  'webPublishing',
  'fileRecoveryPr',
  'webPublishObjects',
  'extLst',
]

type XmlDocument = ReturnType<DOMParser['parseFromString']>
type Parts = Record<string, Uint8Array>

interface MutableSaveReport {
  fileName: string
  entries: XlsxSaveDiffEntry[]
  canSave: boolean
  requiresSaveAs: boolean
  outputBytes?: number
}

export async function exportXlsxWorkbook(
  workbook: Workbook,
  fileName: string,
  onProgress: (progress: XlsxExportProgress) => void = () => {},
): Promise<XlsxExportResult> {
  const report: MutableSaveReport = {
    fileName,
    entries: [],
    canSave: false,
    requiresSaveAs: false,
  }
  try {
    const originalBytes = workbook.preservation?.originalArchiveBytes
    if (!originalBytes) {
      onProgress({ phase: 'patch', percent: 10 })
      const parts = createBlankPackage(workbook)
      for (const partName of Object.keys(parts).sort()) {
        report.entries.push({
          category: 'intentionally-updated',
          code: 'part-updated',
          partName,
        })
      }
      const bytes = zipSync(parts)
      const checked = await validateExport(bytes, fileName, workbook, report, onProgress)
      return checked
    }

    const originalArchive = originalBytes.slice()
    if (originalArchive.byteLength > XLSX_LIMITS.archiveBytes) return cannotPreserve(fileName, 'output-invalid')
    onProgress({ phase: 'inspect', percent: 3 })
    const source = await parseXlsxWorkbook('source.xlsx', originalArchive)
    if (!source.report.canOpen || !source.workbook) return cannotPreserve(fileName, 'output-invalid')
    const sourceWorkbook = source.workbook
    const parts = Object.assign(Object.create(null), unzipSync(originalArchive)) as Parts
    const sourceMappings = sourceWorkbook.preservation?.sheetMappings ?? []
    const currentMappings = workbook.preservation?.sheetMappings ?? []
    const sourceByPart = new Map(
      sourceMappings.flatMap((mapping) => {
        const sheet = sourceWorkbook.sheetsById.get(mapping.sheetId)
        return sheet ? [[mapping.partName, sheet] as const] : []
      }),
    )
    const currentMappingById = new Map(currentMappings.map((mapping) => [mapping.sheetId, mapping]))
    const modelChanged = !sameWorkbookContent(workbook, sourceWorkbook, currentMappingById, sourceByPart)
    const formulaCounts = countFormulaStatuses(workbook)
    if (!modelChanged) {
      appendSourceDiff(report, parts, workbook.preservation, new Set(), false)
      appendFormulaDiff(report, formulaCounts)
      report.canSave = true
      report.outputBytes = originalArchive.byteLength
      report.requiresSaveAs = false
      onProgress({ phase: 'validate', percent: 100 })
      return {
        bytes: originalArchive,
        report,
        preservation: stripOriginalBytes(workbook.preservation),
      }
    }

    onProgress({ phase: 'patch', percent: 10 })
    const updatedParts = new Set<string>()
    if (!removeCalculationChain(parts, sourceWorkbook.preservation, updatedParts, report))
      return cannotPreserve(fileName, 'unsupported-sheet-feature')
    const stylePath = relationshipTargetForType(workbook.preservation, 'styles') ?? 'xl/styles.xml'
    const styleWriter = new StyleWriter(parts, stylePath)
    const sheetResult = patchWorksheets(workbook, sourceWorkbook, sourceByPart, currentMappingById, parts, styleWriter)
    if (!sheetResult.ok) return cannotPreserve(fileName, sheetResult.code)
    for (const partName of sheetResult.updatedParts) updatedParts.add(partName)

    const workbookResult = patchWorkbookParts(
      workbook,
      sourceWorkbook,
      currentMappingById,
      parts,
      [...updatedParts],
      sheetResult.createdParts,
    )
    if (!workbookResult.ok) return cannotPreserve(fileName, workbookResult.code)
    for (const partName of workbookResult.updatedParts) updatedParts.add(partName)
    for (const partName of sheetResult.createdParts.values()) {
      ensureContentType(parts, partName, 'application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml')
      updatedParts.add('[Content_Types].xml')
    }

    if (styleWriter.changed) {
      parts[stylePath] = styleWriter.serialize()
      updatedParts.add(stylePath)
      ensureContentType(parts, stylePath, 'application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml')
      updatedParts.add('[Content_Types].xml')
      ensureWorkbookRelationship(parts, workbookResult.workbookPart, stylePath, 'styles')
      updatedParts.add(relationshipPart(workbookResult.workbookPart))
    }

    const sharedStringsPath = relationshipTargetForType(workbook.preservation, 'sharedStrings')
    if (sharedStringsPath && parts[sharedStringsPath]) {
      const oldBytes = parts[sharedStringsPath]
      const activeSheetParts = new Set([
        ...currentMappings.map((mapping) => mapping.partName),
        ...sheetResult.createdParts.values(),
      ])
      const updatedBytes = updateSharedStringCounts(parts, sharedStringsPath, activeSheetParts)
      if (!bytesEqual(oldBytes, updatedBytes)) {
        parts[sharedStringsPath] = updatedBytes
        updatedParts.add(sharedStringsPath)
      }
    }

    appendSourceDiff(report, parts, workbook.preservation, updatedParts, true)
    appendFormulaDiff(report, formulaCounts)
    const archive = zipSync(parts)
    const checked = await validateExport(archive, fileName, workbook, report, onProgress)
    if (!checked.report.canSave) return checked
    checked.report.requiresSaveAs = report.entries.some(
      (entry) => entry.category === 'at-risk' || entry.category === 'stale-calculation',
    )
    checked.report.outputBytes = archive.byteLength
    return checked
  } catch {
    return cannotPreserve(fileName, 'output-invalid')
  }
}

function cannotPreserve(fileName: string, code: XlsxSaveDiffCode): XlsxExportResult {
  return {
    report: {
      fileName,
      entries: [{ category: 'cannot-preserve', code }],
      canSave: false,
      requiresSaveAs: false,
    },
  }
}

async function validateExport(
  bytes: Uint8Array,
  fileName: string,
  workbook: Workbook,
  report: MutableSaveReport,
  onProgress: (progress: XlsxExportProgress) => void,
): Promise<XlsxExportResult> {
  onProgress({ phase: 'validate', percent: 90 })
  if (bytes.byteLength > XLSX_LIMITS.archiveBytes) return cannotPreserve(fileName, 'output-invalid')
  const parsed = await parseXlsxWorkbook('exported.xlsx', bytes)
  if (!parsed.report.canOpen || !parsed.workbook || !supportedValuesMatch(workbook, parsed.workbook)) {
    return {
      report: {
        fileName,
        entries: [...report.entries, { category: 'cannot-preserve', code: 'output-invalid' }],
        canSave: false,
        requiresSaveAs: false,
      },
    }
  }
  const currentIds = workbook.sheetOrder
  const preservation = stripOriginalBytes(parsed.workbook.preservation)
  if (preservation?.sheetMappings) {
    preservation.sheetMappings = preservation.sheetMappings.map((mapping, index) => ({
      ...mapping,
      sheetId: currentIds[index] ?? mapping.sheetId,
    }))
  }
  report.canSave = true
  report.outputBytes = bytes.byteLength
  onProgress({ phase: 'validate', percent: 100 })
  return { bytes, report, preservation }
}

function supportedValuesMatch(expected: Workbook, actual: Workbook): boolean {
  if (expected.dateSystem !== actual.dateSystem || expected.sheetOrder.length !== actual.sheetOrder.length) return false
  const scalar = (value: CellValue | FormulaResult): unknown =>
    value.kind === 'date' ? { kind: 'number', value: value.serial } : value
  const equal = (left: CellValue, right: CellValue): boolean => {
    if (left.kind === 'formula' && right.kind === 'formula') {
      const expression = left.formula.canonicalExpression || left.formula.source
      return (
        right.formula.canonicalExpression === (expression.startsWith('=') ? expression : `=${expression}`) &&
        deepEqual(scalar(left.formula.cachedResult), scalar(right.formula.cachedResult))
      )
    }
    return deepEqual(scalar(left), scalar(right))
  }
  return expected.sheetOrder.every((id, index) => {
    const left = expected.sheetsById.get(id)
    const right = actual.sheetsById.get(actual.sheetOrder[index])
    if (
      !left ||
      !right ||
      left.name !== right.name ||
      (left.visibility ?? 'visible') !== (right.visibility ?? 'visible')
    )
      return false
    for (const [address, cell] of left.cells) {
      const reopened = right.cells.get(address)
      if (!reopened ? cell.value.kind !== 'blank' : !equal(cell.value, reopened.value)) return false
    }
    return [...right.cells].every(([address, cell]) => cell.value.kind === 'blank' || left.cells.has(address))
  })
}

function removeCalculationChain(
  parts: Parts,
  preservation: OOXMLPreservationState | undefined,
  updated: Set<string>,
  report: MutableSaveReport,
): boolean {
  const relationships = preservation?.inventory?.relationships ?? []
  for (const chain of relationships.filter((relationship) => relationship.type.endsWith('/calcChain'))) {
    if (!chain.resolvedTarget || !parts[chain.resolvedTarget]) return false
    const document = parseXml(parts[chain.resolvedTarget], chain.resolvedTarget)
    if (!document.documentElement) return false
    if (
      localName(document.documentElement) !== 'calcChain' ||
      document.documentElement.namespaceURI !== NS.spreadsheet ||
      parts[relationshipPart(chain.resolvedTarget)] ||
      Array.from(document.documentElement.attributes).some((attribute) => !/^xmlns(?::|$)/u.test(attribute.name)) ||
      directChildren(document.documentElement).some(
        (node) =>
          localName(node) !== 'c' ||
          node.namespaceURI !== NS.spreadsheet ||
          directChildren(node).length > 0 ||
          Array.from(node.attributes).some(
            (attribute) => attribute.namespaceURI || !['r', 'i', 's'].includes(attribute.name),
          ),
      )
    )
      return false
    if (
      relationships.some(
        (relationship) =>
          relationship.resolvedTarget === chain.resolvedTarget && !relationship.type.endsWith('/calcChain'),
      )
    )
      return false
    const relPath = relationshipPart(chain.sourcePart)
    const relDoc = parseXml(parts[relPath], relPath)
    for (const node of directChildren(relDoc.documentElement))
      if (node.getAttribute('Id') === chain.id) node.parentNode!.removeChild(node)
    parts[relPath] = encodeXml(relDoc)
    const typeDoc = parseXml(parts['[Content_Types].xml'], '[Content_Types].xml')
    for (const node of directChildren(typeDoc.documentElement))
      if (node.getAttribute('PartName') === `/${chain.resolvedTarget}`) node.parentNode!.removeChild(node)
    parts['[Content_Types].xml'] = encodeXml(typeDoc)
    delete parts[chain.resolvedTarget]
    updated.add(relPath)
    updated.add('[Content_Types].xml')
    report.entries.push({ category: 'intentionally-updated', code: 'part-removed', partName: chain.resolvedTarget })
  }
  return true
}

function stripOriginalBytes(
  preservation?: OOXMLPreservationState,
): Omit<OOXMLPreservationState, 'originalArchiveBytes'> | undefined {
  if (!preservation) return undefined
  const { originalArchiveBytes: _originalArchiveBytes, ...rest } = structuredClone(preservation)
  return rest
}

function appendSourceDiff(
  report: MutableSaveReport,
  parts: Parts,
  preservation: OOXMLPreservationState | undefined,
  updatedParts: Set<string>,
  modelChanged: boolean,
): void {
  const descriptors = new Map((preservation?.parts ?? []).map((part) => [part.partName, part]))
  for (const partName of Object.keys(parts).sort()) {
    const descriptor = descriptors.get(partName)
    if (updatedParts.has(partName)) {
      report.entries.push({
        category: 'intentionally-updated',
        code: 'part-updated',
        partName,
      })
      if (
        descriptor?.status === 'unsafe' &&
        (descriptor.classification === 'preservable-opaque' || descriptor.classification === 'at-risk')
      )
        report.entries.push({ category: 'at-risk', code: 'unsafe-part-preserved', partName })
      continue
    }
    if (modelChanged && descriptor?.status === 'unsafe' && descriptor.classification !== 'supported') {
      report.entries.push({
        category: 'at-risk',
        code: 'unsafe-part-preserved',
        partName,
      })
    } else if (
      descriptor?.classification === 'preservable-opaque' ||
      descriptor?.classification === 'readable-not-editable' ||
      descriptor?.classification === 'at-risk'
    ) {
      report.entries.push({
        category: 'unsupported-preserved',
        code: 'unsupported-part-preserved',
        partName,
      })
    } else {
      report.entries.push({
        category: 'preserved',
        code: 'part-preserved',
        partName,
      })
    }
  }
}

function appendFormulaDiff(report: MutableSaveReport, formulaCounts: { stale: number; unsupported: number }): void {
  if (formulaCounts.stale) {
    report.entries.push({
      category: 'stale-calculation',
      code: 'formula-cache-stale',
      count: formulaCounts.stale,
    })
  }
  if (formulaCounts.unsupported) {
    report.entries.push({
      category: 'stale-calculation',
      code: 'formula-not-recalculated',
      count: formulaCounts.unsupported,
    })
  }
}

function countFormulaStatuses(workbook: Workbook): {
  stale: number
  unsupported: number
} {
  let stale = 0
  let unsupported = 0
  for (const sheet of workbook.sheetsById.values()) {
    for (const cell of sheet.cells.values()) {
      if (cell.value.kind !== 'formula') continue
      if (cell.value.formula.calculationStatus === 'stale') stale += 1
      else if (cell.value.formula.calculationStatus === 'unsupported') unsupported += 1
    }
  }
  return { stale, unsupported }
}

function sameWorkbookContent(
  current: Workbook,
  original: Workbook,
  currentMappings: Map<string, OOXMLSheetMapping>,
  originalByPart: Map<string, Worksheet>,
): boolean {
  if (current.dateSystem !== original.dateSystem || current.sheetOrder.length !== original.sheetOrder.length)
    return false
  const currentPartOrder: string[] = []
  for (const id of current.sheetOrder) {
    const mapping = currentMappings.get(id)
    const currentSheet = current.sheetsById.get(id)
    const originalSheet = mapping ? originalByPart.get(mapping.partName) : undefined
    if (!mapping || !currentSheet || !originalSheet) return false
    currentPartOrder.push(mapping.partName)
    if (!sameSheetContent(currentSheet, originalSheet)) return false
  }
  const originalPartOrder = original.sheetOrder.flatMap((id) => {
    const mapping = original.preservation?.sheetMappings?.find((candidate) => candidate.sheetId === id)
    return mapping ? [mapping.partName] : []
  })
  if (!arrayEqual(currentPartOrder, originalPartOrder)) return false
  return sameDefinedNames(
    current,
    original,
    currentMappings,
    new Map((original.preservation?.sheetMappings ?? []).map((m) => [m.sheetId, m])),
  )
}

function sameSheetContent(left: Worksheet, right: Worksheet): boolean {
  return (
    left.name === right.name &&
    (left.visibility ?? 'visible') === (right.visibility ?? 'visible') &&
    deepEqual(left.frozenPane, right.frozenPane) &&
    deepEqual(left.printSettings, right.printSettings) &&
    deepEqual(left.autoFilter, right.autoFilter) &&
    deepEqual(left.dimensions, right.dimensions) &&
    deepEqual(left.merges, right.merges) &&
    mapEqual(left.rowMetadata, right.rowMetadata) &&
    mapEqual(left.columnMetadata, right.columnMetadata) &&
    cellMapEqual(left.cells, right.cells) &&
    deepEqual(left.hyperlinks, right.hyperlinks) &&
    deepEqual(left.tables, right.tables) &&
    deepEqual(left.validations, right.validations) &&
    deepEqual(left.conditionalFormats, right.conditionalFormats) &&
    deepEqual(left.drawings, right.drawings) &&
    deepEqual(left.pivots, right.pivots) &&
    deepEqual(left.comments, right.comments)
  )
}

function sameDefinedNames(
  current: Workbook,
  original: Workbook,
  currentMappings: Map<string, OOXMLSheetMapping>,
  originalMappings: Map<string, OOXMLSheetMapping>,
): boolean {
  const normalize = (workbook: Workbook, mappings: Map<string, OOXMLSheetMapping>) =>
    workbook.definedNames.map((name) => ({
      name: name.name,
      formula: name.formula,
      range: name.range,
      scope: name.scopeSheetId ? mappings.get(name.scopeSheetId)?.partName : undefined,
      target: name.targetSheetId ? mappings.get(name.targetSheetId)?.partName : undefined,
    }))
  return deepEqual(normalize(current, currentMappings), normalize(original, originalMappings))
}

function cellMapEqual(left: Map<string, Cell>, right: Map<string, Cell>): boolean {
  if (left.size !== right.size) return false
  for (const [address, cell] of left) {
    const other = right.get(address)
    if (!other || !sameCell(cell, other)) return false
  }
  return true
}

function sameCell(left: Cell, right: Cell): boolean {
  return deepEqual(left.style, right.style) && sameCellValue(left.value, right.value)
}

function sameCellValue(left: CellValue, right: CellValue): boolean {
  if (left.kind !== right.kind) return false
  if (left.kind !== 'formula' || right.kind !== 'formula') return deepEqual(left, right)
  return (
    left.formula.source === right.formula.source &&
    left.formula.canonicalExpression === right.formula.canonicalExpression &&
    deepEqual(left.formula.cachedResult, right.formula.cachedResult)
  )
}

function mapEqual<T>(left: Map<number, T>, right: Map<number, T>): boolean {
  if (left.size !== right.size) return false
  for (const [key, value] of left) if (!right.has(key) || !deepEqual(value, right.get(key))) return false
  return true
}

function deepEqual(left: unknown, right: unknown): boolean {
  if (left === right) return true
  try {
    return JSON.stringify(left) === JSON.stringify(right)
  } catch {
    return false
  }
}

function arrayEqual<T>(left: T[], right: T[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index])
}

function patchWorksheets(
  workbook: Workbook,
  original: Workbook,
  originalByPart: Map<string, Worksheet>,
  mappings: Map<string, OOXMLSheetMapping>,
  parts: Parts,
  styleWriter: StyleWriter,
): { ok: true; updatedParts: string[]; createdParts: Map<string, string> } | { ok: false; code: XlsxSaveDiffCode } {
  const updatedParts: string[] = []
  const createdParts = new Map<string, string>()
  const usedPaths = new Set(Object.keys(parts))
  let nextSheetNumber = nextAvailableSheetNumber(usedPaths)
  for (const sheetId of workbook.sheetOrder) {
    const sheet = workbook.sheetsById.get(sheetId)
    if (!sheet) return { ok: false, code: 'output-invalid' }
    const mapping = mappings.get(sheetId)
    if (!mapping) {
      if (sheet.tables.length || sheet.drawings.length || sheet.pivots.length || sheet.comments?.length) {
        return { ok: false, code: 'unsupported-sheet-feature' }
      }
      const partName = nextSheetPath(usedPaths, nextSheetNumber++)
      const document = newXmlDocument('worksheet', NS.spreadsheet)
      const root = document.documentElement!
      root.setAttribute('xmlns:r', NS.officeRelationships)
      const sheetFormat = document.createElementNS(NS.spreadsheet, 'sheetFormatPr')
      setNumberAttribute(sheetFormat, 'defaultRowHeight', sheet.dimensions.defaultRowHeight)
      setNumberAttribute(sheetFormat, 'defaultColWidth', sheet.dimensions.defaultColumnWidth)
      root.appendChild(sheetFormat)
      const sheetData = document.createElementNS(NS.spreadsheet, 'sheetData')
      root.appendChild(sheetData)
      if (!patchWorksheetDocument(document, sheet, undefined, styleWriter)) {
        return { ok: false, code: 'unsupported-style' }
      }
      writeNewSheetFeatures(parts, partName, document, sheet)
      parts[partName] = encodeXml(document)
      createdParts.set(sheetId, partName)
      updatedParts.push(partName)
      usedPaths.add(partName)
      continue
    }
    const originalSheet = originalByPart.get(mapping.partName)
    const sourceBytes = parts[mapping.partName]
    if (!originalSheet || !sourceBytes) return { ok: false, code: 'output-invalid' }
    if (sameSheetContent(sheet, originalSheet)) continue
    const document = parseXml(sourceBytes, mapping.partName)
    if (!patchWorksheetDocument(document, sheet, originalSheet, styleWriter)) {
      return { ok: false, code: 'unsupported-sheet-feature' }
    }
    parts[mapping.partName] = encodeXml(document)
    updatedParts.push(mapping.partName)
  }
  return { ok: true, updatedParts, createdParts }
}

function patchWorksheetDocument(
  document: XmlDocument,
  sheet: Worksheet,
  original?: Worksheet,
  styleWriter?: StyleWriter,
): boolean {
  const root = document.documentElement
  if (!root || root.namespaceURI !== NS.spreadsheet || localName(root) !== 'worksheet') return false
  if (!patchSheetData(root, sheet, original, styleWriter)) return false
  patchSheetFormat(root, sheet, original)
  if (!patchColumns(root, sheet, original, styleWriter)) return false
  if (!patchMerges(root, sheet, original)) return false
  patchFrozenPane(root, sheet, original)
  patchDimension(root, sheet, original)
  return true
}

function patchSheetData(
  root: XmlElement,
  sheet: Worksheet,
  original: Worksheet | undefined,
  styleWriter: StyleWriter | undefined,
): boolean {
  const document = root.ownerDocument!
  let sheetData = directChild(root, 'sheetData')
  if (!sheetData) {
    sheetData = document.createElementNS(NS.spreadsheet, 'sheetData')
    insertInWorksheetOrder(root, sheetData, [
      'sheetData',
      'autoFilter',
      'mergeCells',
      'phoneticPr',
      'conditionalFormatting',
    ])
  }
  if (directChildren(sheetData).some((node) => localName(node) !== 'row')) return false
  const sourceCells = new Map<string, XmlElement>()
  const rowElements = directChildren(sheetData).filter((node) => localName(node) === 'row')
  for (const row of rowElements) {
    for (const cell of directChildren(row).filter((node) => localName(node) === 'c')) {
      const address = cell.getAttribute('r')
      if (address) sourceCells.set(address.toUpperCase(), cell)
    }
  }
  const currentAddresses = new Set(sheet.cells.keys())
  for (const [address, element] of sourceCells) {
    if (currentAddresses.has(address)) continue
    const sourceFormula = directChild(element, 'f')
    if (sourceFormula && ['shared', 'array'].includes(sourceFormula.getAttribute('t') ?? '')) return false
    if (directChildren(element).some((node) => !['f', 'v', 'is'].includes(localName(node)))) return false
    element.parentNode?.removeChild(element)
  }
  const byRow = new Map<number, Array<[string, Cell]>>()
  for (const [address, cell] of sheet.cells) {
    const parsedAddress = parseCellAddress(address)
    const entries = byRow.get(parsedAddress.row) ?? []
    entries.push([address, cell])
    byRow.set(parsedAddress.row, entries)
  }
  for (const [rowNumber, entries] of byRow) {
    let row = rowElements.find((candidate) => Number(candidate.getAttribute('r')) === rowNumber)
    if (!row) {
      row = document.createElementNS(NS.spreadsheet, 'row')
      row.setAttribute('r', String(rowNumber))
      sheetData.appendChild(row)
    }
    entries.sort((left, right) => parseCellAddress(left[0]).column - parseCellAddress(right[0]).column)
    for (const [address, cell] of entries) {
      const existing = sourceCells.get(address.toUpperCase())
      const originalCell = original?.cells.get(address)
      if (existing && originalCell && sameCellValue(cell.value, originalCell.value)) {
        if (deepEqual(cell.style, originalCell.style)) continue
        if (!setCellStyle(existing, cell.style, styleWriter, originalCell.style)) return false
        continue
      }
      if (existing && originalCell && sameCellValue(cell.value, originalCell.value)) {
        if (!setCellStyle(existing, cell.style, styleWriter, originalCell.style)) return false
        continue
      }
      if (existing && formulaStructureWouldBreak(existing, originalCell)) return false
      const cellElement = existing ?? document.createElementNS(NS.spreadsheet, 'c')
      cellElement.setAttribute('r', address.toUpperCase())
      if (!writeCellValue(cellElement, cell.value)) return false
      if (!setCellStyle(cellElement, effectiveStyle(cell), styleWriter, originalCell?.style)) return false
      if (!existing) row.appendChild(cellElement)
    }
  }
  for (const row of directChildren(sheetData).filter((node) => localName(node) === 'row')) {
    const rowNumber = Number(row.getAttribute('r'))
    const metadata = sheet.rowMetadata.get(rowNumber)
    const oldMetadata = original?.rowMetadata.get(rowNumber)
    if (!deepEqual(metadata, oldMetadata) && !patchRowMetadata(row, metadata, styleWriter)) return false
    const hasCells = directChildren(row).some((node) => localName(node) === 'c')
    const hasMetadata = metadata !== undefined
    const hasUnknownChildren = Array.from(row.childNodes).some(
      (node) =>
        node.nodeType === 1 && localName(node as XmlElement) !== 'c' && localName(node as XmlElement) !== 'extLst',
    )
    if (!hasCells && !hasMetadata && !hasUnknownChildren && !row.hasAttribute('customFormat')) {
      row.parentNode?.removeChild(row)
    }
  }
  sortRowAndCellElements(sheetData)
  return true
}

function formulaStructureWouldBreak(sourceCell: XmlElement, original: Cell | undefined): boolean {
  const formula = directChild(sourceCell, 'f')
  if (!formula || !original || original.value.kind !== 'formula') return false
  const formulaType = formula.getAttribute('t')
  return (
    formulaType === 'shared' ||
    formulaType === 'array' ||
    formulaType === 'dataTable' ||
    formula.attributes.length > 0 ||
    directChildren(formula).length > 0
  )
}

function effectiveStyle(cell: Cell): CellStyle | undefined {
  const value = cell.value.kind === 'formula' ? cell.value.formula.cachedResult : cell.value
  return value.kind === 'date' ? { ...cell.style, numberFormat: value.numberFormat } : cell.style
}

function writeCellValue(cellElement: XmlElement, value: CellValue): boolean {
  for (const child of directChildren(cellElement)) {
    if (['f', 'v', 'is'].includes(localName(child))) cellElement.removeChild(child)
  }
  cellElement.removeAttribute('t')
  const document = cellElement.ownerDocument!
  let formulaResult: FormulaResult | undefined
  if (value.kind === 'formula') {
    const expression = value.formula.canonicalExpression || value.formula.source
    const formulaText = expression.startsWith('=') ? expression.slice(1) : expression
    if (containsInvalidXmlCharacters(formulaText)) return false
    const formula = document.createElementNS(NS.spreadsheet, 'f')
    formula.appendChild(document.createTextNode(formulaText))
    insertCellChild(cellElement, formula)
    formulaResult = value.formula.cachedResult
    if (value.formula.calculationStatus === 'fresh' && value.formula.cachedResult.kind === 'blank') return true
  } else if (value.kind === 'string') {
    if (containsInvalidXmlCharacters(value.value)) return false
    cellElement.setAttribute('t', 'inlineStr')
    const inline = document.createElementNS(NS.spreadsheet, 'is')
    const text = document.createElementNS(NS.spreadsheet, 't')
    if (/^\s|\s$/u.test(value.value)) text.setAttributeNS(NS.xml, 'xml:space', 'preserve')
    text.appendChild(document.createTextNode(value.value))
    inline.appendChild(text)
    insertCellChild(cellElement, inline)
    return true
  } else if (value.kind === 'boolean') {
    cellElement.setAttribute('t', 'b')
    appendValue(cellElement, value.value ? '1' : '0')
    return true
  } else if (value.kind === 'error') {
    cellElement.setAttribute('t', 'e')
    appendValue(cellElement, value.code)
    return true
  } else if (value.kind === 'number' || value.kind === 'date') {
    if (!Number.isFinite(value.kind === 'number' ? value.value : value.serial)) return false
    appendValue(cellElement, String(value.kind === 'number' ? value.value : value.serial))
    return true
  } else {
    return true
  }
  if (formulaResult && formulaResult.kind !== 'blank') {
    if (formulaResult.kind === 'string') cellElement.setAttribute('t', 'str')
    else if (formulaResult.kind === 'boolean') cellElement.setAttribute('t', 'b')
    else if (formulaResult.kind === 'error') cellElement.setAttribute('t', 'e')
    const resultText =
      formulaResult.kind === 'number' || formulaResult.kind === 'date'
        ? String(formulaResult.kind === 'number' ? formulaResult.value : formulaResult.serial)
        : formulaResult.kind === 'string'
          ? formulaResult.value
          : formulaResult.kind === 'boolean'
            ? formulaResult.value
              ? '1'
              : '0'
            : formulaResult.kind === 'error'
              ? formulaResult.code
              : ''
    if (containsInvalidXmlCharacters(resultText)) return false
    appendValue(cellElement, resultText)
  }
  return true
}

function setCellStyle(
  element: XmlElement,
  style: CellStyle | undefined,
  styleWriter: StyleWriter | undefined,
  oldStyle: CellStyle | undefined,
): boolean {
  if (deepEqual(style, oldStyle)) return true
  if (!style) {
    element.removeAttribute('s')
    return true
  }
  if (!styleWriter) return false
  const index = styleWriter.indexFor(style)
  if (index === undefined) return false
  if (index) element.setAttribute('s', String(index))
  else element.removeAttribute('s')
  return true
}

function patchRowMetadata(row: XmlElement, metadata: RowMetadata | undefined, styleWriter?: StyleWriter): boolean {
  setNumberAttribute(row, 'ht', metadata?.height)
  setBooleanAttribute(row, 'hidden', metadata?.hidden)
  setNumberAttribute(row, 'outlineLevel', metadata?.outlineLevel)
  if (metadata?.height !== undefined) row.setAttribute('customHeight', '1')
  else row.removeAttribute('customHeight')
  if (metadata?.style) {
    if (!styleWriter) return false
    const styleIndex = styleWriter.indexFor(metadata.style)
    if (styleIndex === undefined) return false
    row.setAttribute('s', String(styleIndex))
    row.setAttribute('customFormat', '1')
  } else {
    row.removeAttribute('s')
    row.removeAttribute('customFormat')
  }
  return true
}

function patchSheetFormat(root: XmlElement, sheet: Worksheet, original?: Worksheet): void {
  if (
    original &&
    sheet.dimensions.defaultRowHeight === original.dimensions.defaultRowHeight &&
    sheet.dimensions.defaultColumnWidth === original.dimensions.defaultColumnWidth
  )
    return
  const document = root.ownerDocument!
  const format = directChild(root, 'sheetFormatPr') ?? document.createElementNS(NS.spreadsheet, 'sheetFormatPr')
  setNumberAttribute(format, 'defaultRowHeight', sheet.dimensions.defaultRowHeight)
  setNumberAttribute(format, 'defaultColWidth', sheet.dimensions.defaultColumnWidth)
  if (!format.parentNode) insertInWorksheetOrder(root, format, ['sheetFormatPr', 'cols', 'sheetData'])
}

function patchColumns(root: XmlElement, sheet: Worksheet, original?: Worksheet, styleWriter?: StyleWriter): boolean {
  if (original && mapEqual(sheet.columnMetadata, original.columnMetadata)) return true
  const document = root.ownerDocument!
  const old = directChild(root, 'cols')
  const cols = old ?? document.createElementNS(NS.spreadsheet, 'cols')
  const allowedAttributes = new Set([
    'min',
    'max',
    'width',
    'hidden',
    'bestFit',
    'customWidth',
    'style',
    'outlineLevel',
    'collapsed',
    'phonetic',
  ])
  if (
    directChildren(cols).some((child) => localName(child) !== 'col') ||
    directChildren(cols).some((column) =>
      Array.from({ length: column.attributes.length }, (_, index) => column.attributes.item(index)?.name ?? '').some(
        (name) => !allowedAttributes.has(name),
      ),
    )
  ) {
    return false
  }
  for (const child of directChildren(cols)) if (localName(child) === 'col') cols.removeChild(child)
  const entries = [...sheet.columnMetadata.entries()].sort((left, right) => left[0] - right[0])
  let index = 0
  while (index < entries.length) {
    const start = entries[index][0]
    let end = start
    const metadata = entries[index][1]
    while (
      index + 1 < entries.length &&
      entries[index + 1][0] === end + 1 &&
      deepEqual(entries[index + 1][1], metadata)
    ) {
      end = entries[index + 1][0]
      index += 1
    }
    const column = document.createElementNS(NS.spreadsheet, 'col')
    column.setAttribute('min', String(start))
    column.setAttribute('max', String(end))
    setNumberAttribute(column, 'width', metadata.width)
    setBooleanAttribute(column, 'hidden', metadata.hidden)
    setNumberAttribute(column, 'outlineLevel', metadata.outlineLevel)
    if (metadata.width !== undefined) column.setAttribute('customWidth', '1')
    if (metadata.style) {
      if (!styleWriter) return false
      const styleIndex = styleWriter.indexFor(metadata.style)
      if (styleIndex === undefined) return false
      column.setAttribute('style', String(styleIndex))
    }
    cols.appendChild(column)
    index += 1
  }
  if (directChildren(cols).length === 0) {
    cols.parentNode?.removeChild(cols)
  } else if (!cols.parentNode) {
    insertInWorksheetOrder(root, cols, ['cols', 'sheetData'])
  }
  return true
}

function patchMerges(root: XmlElement, sheet: Worksheet, original?: Worksheet): boolean {
  if (original && deepEqual(sheet.merges, original.merges)) return true
  const document = root.ownerDocument!
  let merges = directChild(root, 'mergeCells')
  if (!sheet.merges.length) {
    if (merges && directChildren(merges).some((child) => localName(child) !== 'mergeCell')) return false
    merges?.parentNode?.removeChild(merges)
    return true
  }
  if (!merges) {
    merges = document.createElementNS(NS.spreadsheet, 'mergeCells')
    insertInWorksheetOrder(root, merges, ['mergeCells', 'phoneticPr', 'conditionalFormatting'])
  }
  if (
    directChildren(merges).some((child) => localName(child) !== 'mergeCell') ||
    directChildren(merges).some(
      (merge) =>
        Array.from({ length: merge.attributes.length }, (_, index) => merge.attributes.item(index)?.name ?? '').some(
          (name) => name !== 'ref',
        ) || directChildren(merge).length > 0,
    )
  ) {
    return false
  }
  for (const child of directChildren(merges)) merges.removeChild(child)
  for (const range of sheet.merges) {
    const merge = document.createElementNS(NS.spreadsheet, 'mergeCell')
    merge.setAttribute('ref', formatRangeAddress(range))
    merges.appendChild(merge)
  }
  merges.setAttribute('count', String(sheet.merges.length))
  return true
}

function patchFrozenPane(root: XmlElement, sheet: Worksheet, original?: Worksheet): void {
  if (original && deepEqual(sheet.frozenPane, original.frozenPane)) return
  const document = root.ownerDocument!
  let sheetViews = directChild(root, 'sheetViews')
  if (!sheet.frozenPane) {
    directChild(directChild(sheetViews, 'sheetView'), 'pane')?.parentNode?.removeChild(
      directChild(directChild(sheetViews, 'sheetView'), 'pane')!,
    )
    return
  }
  if (!sheetViews) {
    sheetViews = document.createElementNS(NS.spreadsheet, 'sheetViews')
    const sheetView = document.createElementNS(NS.spreadsheet, 'sheetView')
    sheetView.setAttribute('workbookViewId', '0')
    sheetViews.appendChild(sheetView)
    insertInWorksheetOrder(root, sheetViews, ['sheetViews', 'sheetFormatPr', 'cols'])
  }
  let sheetView = directChild(sheetViews, 'sheetView')
  if (!sheetView) {
    sheetView = document.createElementNS(NS.spreadsheet, 'sheetView')
    sheetView.setAttribute('workbookViewId', '0')
    sheetViews.appendChild(sheetView)
  }
  let pane = directChild(sheetView, 'pane')
  if (!pane) {
    pane = document.createElementNS(NS.spreadsheet, 'pane')
    const selection = directChild(sheetView, 'selection')
    sheetView.insertBefore(pane, selection ?? null)
  }
  setNumberAttribute(pane, 'xSplit', sheet.frozenPane.xSplit || undefined)
  setNumberAttribute(pane, 'ySplit', sheet.frozenPane.ySplit || undefined)
  pane.setAttribute('topLeftCell', sheet.frozenPane.topLeftCell)
  if (sheet.frozenPane.activePane) pane.setAttribute('activePane', sheet.frozenPane.activePane)
  else pane.removeAttribute('activePane')
  if (sheet.frozenPane.state) pane.setAttribute('state', sheet.frozenPane.state)
  else pane.removeAttribute('state')
}

function patchDimension(root: XmlElement, sheet: Worksheet, original?: Worksheet): void {
  if (original && deepEqual(sheet.dimensions.usedRange, original.dimensions.usedRange)) return
  const document = root.ownerDocument!
  let dimension = directChild(root, 'dimension')
  if (!sheet.dimensions.usedRange) {
    dimension?.parentNode?.removeChild(dimension)
    return
  }
  if (!dimension) {
    dimension = document.createElementNS(NS.spreadsheet, 'dimension')
    insertInWorksheetOrder(root, dimension, ['dimension', 'sheetViews', 'sheetFormatPr', 'cols', 'sheetData'])
  }
  dimension.setAttribute('ref', formatRangeAddress(sheet.dimensions.usedRange))
}

function sortRowAndCellElements(sheetData: XmlElement): void {
  const rows = directChildren(sheetData)
    .filter((node) => localName(node) === 'row')
    .sort((left, right) => Number(left.getAttribute('r')) - Number(right.getAttribute('r')))
  for (const row of rows) {
    const cells = directChildren(row)
      .filter((node) => localName(node) === 'c')
      .sort(
        (left, right) =>
          parseCellAddress(left.getAttribute('r') ?? 'A1').column -
          parseCellAddress(right.getAttribute('r') ?? 'A1').column,
      )
    for (const cell of cells) row.removeChild(cell)
    const firstNonCell = directChildren(row)[0] ?? null
    for (const cell of cells) row.insertBefore(cell, firstNonCell)
    sheetData.appendChild(row)
  }
}

function insertCellChild(cell: XmlElement, child: XmlElement): void {
  const before = directChildren(cell).find((candidate) => !['f', 'v', 'is'].includes(localName(candidate)))
  cell.insertBefore(child, before ?? null)
}

function appendValue(cell: XmlElement, value: string): void {
  const node = cell.ownerDocument!.createElementNS(NS.spreadsheet, 'v')
  node.appendChild(cell.ownerDocument!.createTextNode(value))
  const formula = directChild(cell, 'f')
  if (formula) cell.insertBefore(node, formula.nextSibling)
  else insertCellChild(cell, node)
}

function setNumberAttribute(element: XmlElement, name: string, value: number | undefined): void {
  if (value === undefined || !Number.isFinite(value)) element.removeAttribute(name)
  else element.setAttribute(name, String(value))
}

function setBooleanAttribute(element: XmlElement, name: string, value: boolean | undefined): void {
  if (value) element.setAttribute(name, '1')
  else element.removeAttribute(name)
}

function containsInvalidXmlCharacters(value: string): boolean {
  for (const character of value) {
    const codePoint = character.codePointAt(0)!
    if (
      (codePoint < 0x20 && codePoint !== 0x09 && codePoint !== 0x0a && codePoint !== 0x0d) ||
      (codePoint >= 0xd800 && codePoint <= 0xdfff) ||
      codePoint === 0xfffe ||
      codePoint === 0xffff
    ) {
      return true
    }
  }
  return false
}

class StyleWriter {
  changed = false
  private readonly document: XmlDocument
  private readonly sourceStyles: StylesheetMap
  private readonly styles: Array<CellStyle | undefined>

  constructor(
    private readonly parts: Parts,
    readonly path: string,
  ) {
    const source = parts[path]
    if (source) {
      this.document = parseXml(source, path)
      const map = new Map(Object.entries(parts))
      map.set('xl/styles.xml', source)
      this.sourceStyles = parseXlsxStyles(map)
      this.styles = [...this.sourceStyles.styles]
    } else {
      this.document = newXmlDocument('styleSheet', NS.spreadsheet)
      appendStyleCollection(this.document, 'numFmts')
      const fonts = appendStyleCollection(this.document, 'fonts')
      fonts.setAttribute('count', '1')
      fonts.appendChild(this.document.createElementNS(NS.spreadsheet, 'font'))
      const fills = appendStyleCollection(this.document, 'fills')
      fills.setAttribute('count', '2')
      for (const pattern of ['none', 'gray125']) {
        const fill = this.document.createElementNS(NS.spreadsheet, 'fill')
        const patternFill = this.document.createElementNS(NS.spreadsheet, 'patternFill')
        patternFill.setAttribute('patternType', pattern)
        fill.appendChild(patternFill)
        fills.appendChild(fill)
      }
      const borders = appendStyleCollection(this.document, 'borders')
      borders.setAttribute('count', '1')
      borders.appendChild(this.document.createElementNS(NS.spreadsheet, 'border'))
      const styleXfs = appendStyleCollection(this.document, 'cellStyleXfs')
      styleXfs.setAttribute('count', '1')
      const baseXf = this.document.createElementNS(NS.spreadsheet, 'xf')
      baseXf.setAttribute('numFmtId', '0')
      baseXf.setAttribute('fontId', '0')
      baseXf.setAttribute('fillId', '0')
      baseXf.setAttribute('borderId', '0')
      styleXfs.appendChild(baseXf)
      const cellXfs = appendStyleCollection(this.document, 'cellXfs')
      cellXfs.setAttribute('count', '1')
      const cellXf = this.document.createElementNS(NS.spreadsheet, 'xf')
      for (const [name, value] of Object.entries({
        numFmtId: 0,
        fontId: 0,
        fillId: 0,
        borderId: 0,
        xfId: 0,
      })) {
        cellXf.setAttribute(name, String(value))
      }
      cellXfs.appendChild(cellXf)
      const cellStyles = appendStyleCollection(this.document, 'cellStyles')
      cellStyles.setAttribute('count', '1')
      const cellStyle = this.document.createElementNS(NS.spreadsheet, 'cellStyle')
      cellStyle.setAttribute('name', 'Normal')
      cellStyle.setAttribute('xfId', '0')
      cellStyle.setAttribute('builtinId', '0')
      cellStyles.appendChild(cellStyle)
      this.sourceStyles = {
        formats: ['General'],
        styles: [undefined],
        isDate: [false],
      }
      this.styles = [undefined]
    }
  }

  indexFor(style: CellStyle): number | undefined {
    const existing = this.styles.findIndex((candidate) => deepEqual(candidate, style))
    if (existing >= 0) return existing
    if (!isSupportedStyle(style)) return undefined
    const root = this.document.documentElement
    const fonts = directChild(root, 'fonts')
    const fills = directChild(root, 'fills')
    const borders = directChild(root, 'borders')
    const cellXfs = directChild(root, 'cellXfs')
    if (!fonts || !fills || !borders || !cellXfs) return undefined
    const fontId = appendFont(this.document, fonts, style.font)
    const fillId = appendFill(this.document, fills, style.fill)
    const borderId = appendBorder(this.document, borders, style.border)
    const numFmtId = style.numberFormat ? appendNumberFormat(this.document, root!, style.numberFormat) : 0
    const xf = this.document.createElementNS(NS.spreadsheet, 'xf')
    for (const [name, value] of Object.entries({
      numFmtId,
      fontId,
      fillId,
      borderId,
      xfId: 0,
    })) {
      xf.setAttribute(name, String(value))
    }
    if (style.font && Object.keys(style.font).length) xf.setAttribute('applyFont', '1')
    if (style.fill && Object.keys(style.fill).length) xf.setAttribute('applyFill', '1')
    if (style.border && Object.keys(style.border).length) xf.setAttribute('applyBorder', '1')
    if (style.numberFormat) xf.setAttribute('applyNumberFormat', '1')
    if (style.alignment) {
      xf.setAttribute('applyAlignment', '1')
      const alignment = this.document.createElementNS(NS.spreadsheet, 'alignment')
      if (style.alignment.horizontal) alignment.setAttribute('horizontal', style.alignment.horizontal)
      if (style.alignment.vertical)
        alignment.setAttribute('vertical', style.alignment.vertical === 'middle' ? 'center' : style.alignment.vertical)
      if (style.alignment.wrapText) alignment.setAttribute('wrapText', '1')
      xf.appendChild(alignment)
    }
    cellXfs.appendChild(xf)
    cellXfs.setAttribute('count', String(directChildren(cellXfs).length))
    const index = this.styles.length
    this.styles.push(structuredClone(style))
    this.changed = true
    return index
  }

  serialize(): Uint8Array {
    return encodeXml(this.document)
  }
}

function isSupportedStyle(style: CellStyle): boolean {
  if (!Object.keys(style).every((key) => ['numberFormat', 'font', 'fill', 'border', 'alignment'].includes(key)))
    return false
  if (style.numberFormat !== undefined && containsInvalidXmlCharacters(style.numberFormat)) return false
  if (style.font) {
    if (
      !Object.keys(style.font).every((key) => ['name', 'size', 'bold', 'italic', 'underline', 'color'].includes(key)) ||
      (style.font.name !== undefined && containsInvalidXmlCharacters(style.font.name)) ||
      (style.font.size !== undefined && (!Number.isFinite(style.font.size) || style.font.size <= 0)) ||
      (style.font.underline !== undefined && typeof style.font.underline !== 'boolean') ||
      (style.font.color !== undefined && !isHexColor(style.font.color))
    ) {
      return false
    }
  }
  if (style.fill) {
    const patterns = new Set([
      'none',
      'solid',
      'gray125',
      'gray0625',
      'darkGray',
      'mediumGray',
      'lightGray',
      'darkHorizontal',
      'darkVertical',
      'darkDown',
      'darkUp',
      'darkGrid',
      'darkTrellis',
      'lightHorizontal',
      'lightVertical',
      'lightDown',
      'lightUp',
      'lightGrid',
      'lightTrellis',
    ])
    if (
      !Object.keys(style.fill).every((key) => ['color', 'pattern'].includes(key)) ||
      (style.fill.pattern !== undefined && !patterns.has(style.fill.pattern)) ||
      (style.fill.color !== undefined && !isHexColor(style.fill.color))
    ) {
      return false
    }
  }
  if (style.alignment) {
    if (
      !Object.keys(style.alignment).every((key) => ['horizontal', 'vertical', 'wrapText'].includes(key)) ||
      (style.alignment.horizontal !== undefined && !['left', 'center', 'right'].includes(style.alignment.horizontal)) ||
      (style.alignment.vertical !== undefined && !['top', 'middle', 'bottom'].includes(style.alignment.vertical)) ||
      (style.alignment.wrapText !== undefined && typeof style.alignment.wrapText !== 'boolean')
    ) {
      return false
    }
  }
  if (style.border) {
    const borderStyles = new Set([
      'thin',
      'medium',
      'dashed',
      'dotted',
      'thick',
      'double',
      'hair',
      'mediumDashed',
      'dashDot',
      'mediumDashDot',
      'dashDotDot',
      'mediumDashDotDot',
      'slantDashDot',
    ])
    if (
      !Object.keys(style.border).every((key) => ['top', 'right', 'bottom', 'left'].includes(key)) ||
      Object.values(style.border).some(
        (value) =>
          typeof value !== 'string' ||
          (value !== '' && !borderStyles.has(value.split(':', 1)[0])) ||
          (value.includes(':') && !isHexColor(value.split(':', 2)[1] ?? '')),
      )
    ) {
      return false
    }
  }
  return true
}

function isHexColor(value: string): boolean {
  return /^#?(?:[0-9a-f]{6})$/iu.test(value)
}

function appendFont(document: XmlDocument, fonts: XmlElement, font?: CellStyle['font']): number {
  if (!font || !Object.keys(font).length) return 0
  const element = document.createElementNS(NS.spreadsheet, 'font')
  if (font.bold) element.appendChild(document.createElementNS(NS.spreadsheet, 'b'))
  if (font.italic) element.appendChild(document.createElementNS(NS.spreadsheet, 'i'))
  if (font.underline) element.appendChild(document.createElementNS(NS.spreadsheet, 'u'))
  if (font.size) {
    const size = document.createElementNS(NS.spreadsheet, 'sz')
    size.setAttribute('val', String(font.size))
    element.appendChild(size)
  }
  if (font.name) {
    const name = document.createElementNS(NS.spreadsheet, 'name')
    name.setAttribute('val', font.name)
    element.appendChild(name)
  }
  if (font.color) {
    const color = document.createElementNS(NS.spreadsheet, 'color')
    color.setAttribute('rgb', `FF${normalizeColor(font.color)}`)
    element.appendChild(color)
  }
  fonts.appendChild(element)
  fonts.setAttribute('count', String(directChildren(fonts).length))
  return directChildren(fonts).length - 1
}

function appendFill(document: XmlDocument, fills: XmlElement, fill?: CellStyle['fill']): number {
  if (!fill || !Object.keys(fill).length) return 0
  const element = document.createElementNS(NS.spreadsheet, 'fill')
  const pattern = document.createElementNS(NS.spreadsheet, 'patternFill')
  pattern.setAttribute('patternType', fill.pattern ?? 'solid')
  if (fill.color) {
    const color = document.createElementNS(NS.spreadsheet, 'fgColor')
    color.setAttribute('rgb', `FF${normalizeColor(fill.color)}`)
    pattern.appendChild(color)
    const background = document.createElementNS(NS.spreadsheet, 'bgColor')
    background.setAttribute('indexed', '64')
    pattern.appendChild(background)
  }
  element.appendChild(pattern)
  fills.appendChild(element)
  fills.setAttribute('count', String(directChildren(fills).length))
  return directChildren(fills).length - 1
}

function appendBorder(document: XmlDocument, borders: XmlElement, border?: CellStyle['border']): number {
  if (!border || !Object.keys(border).length) return 0
  const element = document.createElementNS(NS.spreadsheet, 'border')
  for (const sideName of ['left', 'right', 'top', 'bottom'] as const) {
    const raw = border[sideName]
    const side = document.createElementNS(NS.spreadsheet, sideName)
    if (raw) {
      const [style, color] = raw.split(':', 2)
      side.setAttribute('style', style)
      if (color) {
        const colorElement = document.createElementNS(NS.spreadsheet, 'color')
        colorElement.setAttribute('rgb', `FF${normalizeColor(color)}`)
        side.appendChild(colorElement)
      }
    }
    element.appendChild(side)
  }
  element.appendChild(document.createElementNS(NS.spreadsheet, 'diagonal'))
  borders.appendChild(element)
  borders.setAttribute('count', String(directChildren(borders).length))
  return directChildren(borders).length - 1
}

function appendNumberFormat(document: XmlDocument, root: XmlElement, format: string): number {
  const numFmts = directChild(root, 'numFmts') ?? appendStyleCollection(document, 'numFmts')
  const existing = directChildren(numFmts).find((item) => item.getAttribute('formatCode') === format)
  if (existing) return Number(existing.getAttribute('numFmtId'))
  const ids = directChildren(numFmts)
    .map((item) => Number(item.getAttribute('numFmtId')))
    .filter(Number.isFinite)
  const id = Math.max(163, ...ids) + 1
  const item = document.createElementNS(NS.spreadsheet, 'numFmt')
  item.setAttribute('numFmtId', String(id))
  item.setAttribute('formatCode', format)
  numFmts.appendChild(item)
  numFmts.setAttribute('count', String(directChildren(numFmts).length))
  return id
}

function normalizeColor(value: string): string {
  const color = value.replace(/^#/u, '').toUpperCase()
  return /^[0-9A-F]{6}$/u.test(color) ? color : '000000'
}

function createBlankPackage(workbook: Workbook): Parts {
  const parts: Parts = Object.create(null) as Parts
  const contentTypes = newXmlDocument('Types', NS.contentTypes)
  const defaults = [
    ['rels', 'application/vnd.openxmlformats-package.relationships+xml'],
    ['xml', 'application/xml'],
  ]
  for (const [extension, type] of defaults) {
    const item = contentTypes.createElementNS(NS.contentTypes, 'Default')
    item.setAttribute('Extension', extension)
    item.setAttribute('ContentType', type)
    contentTypes.documentElement!.appendChild(item)
  }
  addContentOverride(
    contentTypes,
    '/xl/workbook.xml',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml',
  )
  addContentOverride(
    contentTypes,
    '/xl/styles.xml',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml',
  )
  parts['[Content_Types].xml'] = encodeXml(contentTypes)

  const rootRels = newXmlDocument('Relationships', NS.packageRelationships)
  addRelationship(rootRels, 'rId1', `${NS.officeRelationships}/officeDocument`, 'xl/workbook.xml')
  parts['_rels/.rels'] = encodeXml(rootRels)

  const book = newXmlDocument('workbook', NS.spreadsheet)
  book.documentElement!.setAttribute('xmlns:r', NS.officeRelationships)
  const bookPr = book.createElementNS(NS.spreadsheet, 'workbookPr')
  if (workbook.dateSystem === '1904') bookPr.setAttribute('date1904', '1')
  book.documentElement!.appendChild(bookPr)
  const views = book.createElementNS(NS.spreadsheet, 'bookViews')
  const view = book.createElementNS(NS.spreadsheet, 'workbookView')
  view.setAttribute('activeTab', String(Math.max(0, workbook.sheetOrder.indexOf(workbook.activeSheetId))))
  views.appendChild(view)
  book.documentElement!.appendChild(views)
  const sheets = book.createElementNS(NS.spreadsheet, 'sheets')
  workbook.sheetOrder.forEach((sheetId, index) => {
    const sheet = workbook.sheetsById.get(sheetId)
    if (!sheet) return
    const item = book.createElementNS(NS.spreadsheet, 'sheet')
    item.setAttribute('name', sheet.name)
    item.setAttribute('sheetId', String(index + 1))
    if (sheet.visibility === 'hidden') item.setAttribute('state', 'hidden')
    if (sheet.visibility === 'veryHidden') item.setAttribute('state', 'veryHidden')
    item.setAttributeNS(NS.officeRelationships, 'r:id', `rId${index + 1}`)
    sheets.appendChild(item)
    addContentOverride(
      contentTypes,
      `/xl/worksheets/sheet${index + 1}.xml`,
      'application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml',
    )
  })
  book.documentElement!.appendChild(sheets)
  if (workbook.definedNames.length) {
    const names = book.createElementNS(NS.spreadsheet, 'definedNames')
    for (const name of workbook.definedNames) {
      const target = workbook.sheetsById.get(name.targetSheetId ?? name.scopeSheetId ?? '')
      const expression = name.range && target ? formatSheetQualifiedAddress(target.name, name.range) : name.formula
      if (!expression || name.stale || containsInvalidXmlCharacters(expression))
        throw new Error('Unsupported defined name.')
      const node = book.createElementNS(NS.spreadsheet, 'definedName')
      node.setAttribute('name', name.name)
      if (name.scopeSheetId) {
        const index = workbook.sheetOrder.indexOf(name.scopeSheetId)
        if (index < 0) throw new Error('Unknown name scope.')
        node.setAttribute('localSheetId', String(index))
      }
      node.appendChild(book.createTextNode(expression))
      names.appendChild(node)
    }
    book.documentElement!.appendChild(names)
  }
  const calcPr = book.createElementNS(NS.spreadsheet, 'calcPr')
  calcPr.setAttribute('calcMode', 'auto')
  calcPr.setAttribute('fullCalcOnLoad', '1')
  calcPr.setAttribute('forceFullCalc', '1')
  book.documentElement!.appendChild(calcPr)
  parts['xl/workbook.xml'] = encodeXml(book)
  parts['xl/_rels/workbook.xml.rels'] = encodeXml(createWorkbookRelationships(workbook.sheetOrder.length, true))
  parts['xl/styles.xml'] = encodeXml(createDefaultStyles())

  const styleWriter = new StyleWriter(parts, 'xl/styles.xml')
  for (let index = 0; index < workbook.sheetOrder.length; index += 1) {
    const sheet = workbook.sheetsById.get(workbook.sheetOrder[index])
    if (!sheet) continue
    const document = newXmlDocument('worksheet', NS.spreadsheet)
    document.documentElement!.setAttribute('xmlns:r', NS.officeRelationships)
    document.documentElement!.appendChild(document.createElementNS(NS.spreadsheet, 'sheetFormatPr'))
    document.documentElement!.appendChild(document.createElementNS(NS.spreadsheet, 'sheetData'))
    if (!patchWorksheetDocument(document, sheet, undefined, styleWriter))
      throw new Error('Unsupported cell content or style.')
    writeNewSheetFeatures(parts, `xl/worksheets/sheet${index + 1}.xml`, document, sheet)
    parts[`xl/worksheets/sheet${index + 1}.xml`] = encodeXml(document)
  }
  if (styleWriter.changed) parts['xl/styles.xml'] = styleWriter.serialize()
  parts['[Content_Types].xml'] = encodeXml(contentTypes)
  return parts
}

function writeNewSheetFeatures(parts: Parts, partName: string, document: XmlDocument, sheet: Worksheet): void {
  if (
    sheet.tables.length ||
    sheet.validations.length ||
    sheet.conditionalFormats.length ||
    sheet.drawings.length ||
    sheet.pivots.length ||
    sheet.comments?.length
  )
    throw new Error('Unsupported worksheet descriptors cannot be silently omitted.')
  const root = document.documentElement!
  const add = (name: string, attributes: Record<string, string | number> = {}) => {
    const node = document.createElementNS(NS.spreadsheet, name)
    for (const [key, value] of Object.entries(attributes)) {
      if (key.includes(':') || containsInvalidXmlCharacters(String(value)))
        throw new Error('Unsupported XML attribute.')
      node.setAttribute(key, String(value))
    }
    insertInWorksheetOrder(root, node, WORKSHEET_CHILD_ORDER)
    return node
  }
  if (sheet.autoFilter) add('autoFilter', { ref: formatRangeAddress(sheet.autoFilter.range) })
  if (sheet.hyperlinks?.length) {
    const links = add('hyperlinks')
    const rels = newXmlDocument('Relationships', NS.packageRelationships)
    let externalCount = 0
    for (const link of sheet.hyperlinks) {
      const node = document.createElementNS(NS.spreadsheet, 'hyperlink')
      node.setAttribute('ref', formatRangeAddress(link.range))
      for (const key of ['display', 'tooltip', 'location'] as const) {
        if (link[key] !== undefined) {
          if (containsInvalidXmlCharacters(link[key]!)) throw new Error('Invalid hyperlink text.')
          node.setAttribute(key, link[key]!)
        }
      }
      if (link.target) {
        if (
          link.targetMode !== 'External' ||
          !/^(?:https?:|mailto:)/i.test(link.target) ||
          containsInvalidXmlCharacters(link.target)
        )
          throw new Error('Unsupported hyperlink target.')
        const id = `rIdLink${++externalCount}`
        addRelationship(rels, id, `${NS.officeRelationships}/hyperlink`, link.target)
        directChildren(rels.documentElement!).at(-1)!.setAttribute('TargetMode', 'External')
        node.setAttributeNS(NS.officeRelationships, 'r:id', id)
      } else if (!link.location) throw new Error('Hyperlink target is missing.')
      links.appendChild(node)
    }
    if (externalCount) parts[relationshipPart(partName)] = encodeXml(rels)
  }
  const print = sheet.printSettings
  if (print?.pageMargins) add('pageMargins', print.pageMargins)
  if (print?.pageSetup) add('pageSetup', print.pageSetup)
  if (print?.printOptions) add('printOptions', print.printOptions)
  if (print?.headerFooter) {
    const headerFooter = add('headerFooter')
    for (const [name, text] of Object.entries(print.headerFooter)) {
      if (containsInvalidXmlCharacters(text)) throw new Error('Invalid header/footer text.')
      const node = document.createElementNS(NS.spreadsheet, name)
      node.appendChild(document.createTextNode(text))
      headerFooter.appendChild(node)
    }
  }
  if (print?.fitToPage !== undefined) {
    const sheetPr = add('sheetPr')
    const page = document.createElementNS(NS.spreadsheet, 'pageSetUpPr')
    page.setAttribute('fitToPage', print.fitToPage ? '1' : '0')
    sheetPr.appendChild(page)
  }
  if (print?.printArea || print?.printTitles) throw new Error('Print ranges require workbook defined names.')
}

function createDefaultStyles(): XmlDocument {
  const document = newXmlDocument('styleSheet', NS.spreadsheet)
  const fonts = appendStyleCollection(document, 'fonts')
  fonts.setAttribute('count', '1')
  fonts.appendChild(document.createElementNS(NS.spreadsheet, 'font'))
  const fills = appendStyleCollection(document, 'fills')
  fills.setAttribute('count', '2')
  for (const patternType of ['none', 'gray125']) {
    const fill = document.createElementNS(NS.spreadsheet, 'fill')
    const pattern = document.createElementNS(NS.spreadsheet, 'patternFill')
    pattern.setAttribute('patternType', patternType)
    fill.appendChild(pattern)
    fills.appendChild(fill)
  }
  const borders = appendStyleCollection(document, 'borders')
  borders.setAttribute('count', '1')
  borders.appendChild(document.createElementNS(NS.spreadsheet, 'border'))
  const styleXfs = appendStyleCollection(document, 'cellStyleXfs')
  styleXfs.setAttribute('count', '1')
  const base = document.createElementNS(NS.spreadsheet, 'xf')
  for (const attr of ['numFmtId', 'fontId', 'fillId', 'borderId']) base.setAttribute(attr, '0')
  styleXfs.appendChild(base)
  const cellXfs = appendStyleCollection(document, 'cellXfs')
  cellXfs.setAttribute('count', '1')
  const cellXf = document.createElementNS(NS.spreadsheet, 'xf')
  for (const attr of ['numFmtId', 'fontId', 'fillId', 'borderId', 'xfId']) cellXf.setAttribute(attr, '0')
  cellXfs.appendChild(cellXf)
  const cellStyles = appendStyleCollection(document, 'cellStyles')
  cellStyles.setAttribute('count', '1')
  const normal = document.createElementNS(NS.spreadsheet, 'cellStyle')
  normal.setAttribute('name', 'Normal')
  normal.setAttribute('xfId', '0')
  normal.setAttribute('builtinId', '0')
  cellStyles.appendChild(normal)
  return document
}

function createWorkbookRelationships(sheetCount: number, includeStyles: boolean): XmlDocument {
  const document = newXmlDocument('Relationships', NS.packageRelationships)
  for (let index = 0; index < sheetCount; index += 1) {
    addRelationship(
      document,
      `rId${index + 1}`,
      `${NS.officeRelationships}/worksheet`,
      `worksheets/sheet${index + 1}.xml`,
    )
  }
  if (includeStyles) {
    addRelationship(document, `rId${sheetCount + 1}`, `${NS.officeRelationships}/styles`, 'styles.xml')
  }
  return document
}

function patchWorkbookParts(
  workbook: Workbook,
  original: Workbook,
  mappings: Map<string, OOXMLSheetMapping>,
  parts: Parts,
  updatedParts: string[],
  createdParts: Map<string, string>,
): { ok: true; workbookPart: string; updatedParts: string[] } | { ok: false; code: XlsxSaveDiffCode } {
  const workbookPart = findWorkbookPart(workbook.preservation ?? original.preservation)
  if (!workbookPart || !parts[workbookPart]) return { ok: false, code: 'output-invalid' }
  if (
    !sameDefinedNames(
      workbook,
      original,
      mappings,
      new Map((original.preservation?.sheetMappings ?? []).map((m) => [m.sheetId, m])),
    )
  ) {
    return { ok: false, code: 'unsupported-sheet-feature' }
  }
  for (const sheetId of workbook.sheetOrder) {
    const sheet = workbook.sheetsById.get(sheetId)
    if (!sheet) return { ok: false, code: 'output-invalid' }
    const mapping = mappings.get(sheetId)
    const originalMapping = mapping
      ? original.preservation?.sheetMappings?.find((candidate) => candidate.partName === mapping.partName)
      : undefined
    const originalSheet = originalMapping ? original.sheetsById.get(originalMapping.sheetId) : undefined
    if (mapping && originalSheet && structuralSheetDependenciesChanged(sheet, originalSheet)) {
      return { ok: false, code: 'unsupported-sheet-feature' }
    }
  }
  const document = parseXml(parts[workbookPart], workbookPart)
  const root = document.documentElement!
  const sheets = directChild(root, 'sheets')
  if (!sheets) return { ok: false, code: 'output-invalid' }
  const relsPath = relationshipPart(workbookPart)
  const rels = parts[relsPath]
    ? parseXml(parts[relsPath], relsPath)
    : newXmlDocument('Relationships', NS.packageRelationships)
  const relRoot = rels.documentElement
  if (!relRoot || relRoot.namespaceURI !== NS.packageRelationships) return { ok: false, code: 'output-invalid' }
  const worksheetNodes = directChildren(sheets).filter((node) => localName(node) === 'sheet')
  if (directChildren(sheets).length !== worksheetNodes.length) return { ok: false, code: 'unsupported-sheet-feature' }
  const sheetNodeByRelationship = new Map(worksheetNodes.map((node) => [getRelId(node), node]))
  for (const node of [...worksheetNodes]) sheets.removeChild(node)
  let nextSheetId = Math.max(0, ...worksheetNodes.map((node) => Number(node.getAttribute('sheetId')) || 0)) + 1
  let nextRelNumber =
    Math.max(
      0,
      ...directChildren(relRoot).map((rel) => Number(((rel.getAttribute('Id') ?? '').match(/(\d+)$/) ?? [])[1]) || 0),
    ) + 1
  const updated: string[] = []
  for (let index = 0; index < workbook.sheetOrder.length; index += 1) {
    const sheetId = workbook.sheetOrder[index]
    const sheet = workbook.sheetsById.get(sheetId)!
    const mapping = mappings.get(sheetId)
    const createdPart = createdParts.get(sheetId)
    let relationshipId = mapping?.relationshipId
    let node = relationshipId ? sheetNodeByRelationship.get(relationshipId) : undefined
    if (!node && createdPart) {
      relationshipId = `rId${nextRelNumber++}`
      addRelationship(
        rels,
        relationshipId,
        `${NS.officeRelationships}/worksheet`,
        relativeTarget(workbookPart, createdPart),
      )
      node = document.createElementNS(NS.spreadsheet, 'sheet')
      node.setAttribute('sheetId', String(nextSheetId++))
      node.setAttributeNS(NS.officeRelationships, 'r:id', relationshipId)
      updated.push(relsPath)
    }
    if (!node || !relationshipId) return { ok: false, code: 'output-invalid' }
    const oldName = node.getAttribute('name')
    if (oldName && oldName !== sheet.name && formulaReferencesSheetName(workbook, oldName)) {
      return { ok: false, code: 'unsupported-sheet-feature' }
    }
    node.setAttribute('name', sheet.name)
    node.setAttribute('state', sheet.visibility === 'visible' || !sheet.visibility ? '' : sheet.visibility)
    if (!node.getAttribute('state')) node.removeAttribute('state')
    sheets.appendChild(node)
  }
  const workbookView = directChild(directChild(root, 'bookViews'), 'workbookView')
  if (workbookView)
    workbookView.setAttribute('activeTab', String(Math.max(0, workbook.sheetOrder.indexOf(workbook.activeSheetId))))
  let workbookPr = directChild(root, 'workbookPr')
  if (!workbookPr) {
    workbookPr = document.createElementNS(NS.spreadsheet, 'workbookPr')
  }
  setBooleanAttribute(workbookPr, 'date1904', workbook.dateSystem === '1904')
  insertInWorkbookOrder(root, workbookPr, WORKBOOK_CHILD_ORDER)
  let calcPr = directChild(root, 'calcPr')
  if (!calcPr) {
    calcPr = document.createElementNS(NS.spreadsheet, 'calcPr')
  }
  calcPr.setAttribute('calcMode', 'auto')
  calcPr.setAttribute('fullCalcOnLoad', '1')
  calcPr.setAttribute('forceFullCalc', '1')
  insertInWorkbookOrder(root, calcPr, WORKBOOK_CHILD_ORDER)
  const outputBook = encodeXml(document)
  if (!bytesEqual(outputBook, parts[workbookPart])) {
    parts[workbookPart] = outputBook
    updated.push(workbookPart)
  }
  if (updated.includes(relsPath)) parts[relsPath] = encodeXml(rels)
  for (const deletedMapping of original.preservation?.sheetMappings ?? []) {
    if (workbook.sheetOrder.some((id) => mappings.get(id)?.partName === deletedMapping.partName)) continue
    const rel = directChildren(relRoot).find((item) => item.getAttribute('Id') === deletedMapping.relationshipId)
    if (rel) {
      relRoot.removeChild(rel)
      if (!updated.includes(relsPath)) updated.push(relsPath)
    }
  }
  if (updated.includes(relsPath)) parts[relsPath] = encodeXml(rels)
  return { ok: true, workbookPart, updatedParts: updated }
}

function structuralSheetDependenciesChanged(left: Worksheet, right: Worksheet): boolean {
  return (
    !deepEqual(left.tables, right.tables) ||
    !deepEqual(left.validations, right.validations) ||
    !deepEqual(left.conditionalFormats, right.conditionalFormats) ||
    !deepEqual(left.drawings, right.drawings) ||
    !deepEqual(left.pivots, right.pivots) ||
    !deepEqual(left.hyperlinks, right.hyperlinks) ||
    !deepEqual(left.autoFilter, right.autoFilter) ||
    !deepEqual(left.printSettings, right.printSettings) ||
    !deepEqual(left.comments, right.comments)
  )
}

function formulaReferencesSheetName(workbook: Workbook, sheetName: string): boolean {
  const lower = sheetName.toLocaleLowerCase('en-US')
  const quoted = `'${sheetName.replaceAll("'", "''")}'!`.toLocaleLowerCase('en-US')
  const simple = /^[A-Za-z_][A-Za-z0-9_.]*$/u.test(sheetName) ? `${lower}!` : undefined
  for (const sheet of workbook.sheetsById.values()) {
    for (const cell of sheet.cells.values()) {
      if (cell.value.kind !== 'formula') continue
      const expression = `${cell.value.formula.source} ${cell.value.formula.canonicalExpression}`.toLocaleLowerCase(
        'en-US',
      )
      if (expression.includes(quoted) || (simple && expression.includes(simple))) return true
    }
  }
  return false
}

function findWorkbookPart(preservation?: OOXMLPreservationState): string | undefined {
  return preservation?.inventory?.relationships.find(
    (relationship) => !relationship.sourcePart && relationship.type.endsWith('/officeDocument'),
  )?.resolvedTarget
}

function relationshipTargetForType(preservation: OOXMLPreservationState | undefined, type: string): string | undefined {
  const workbookPart = findWorkbookPart(preservation)
  if (!workbookPart) return undefined
  return preservation?.inventory?.relationships.find(
    (relationship) => relationship.sourcePart === workbookPart && relationship.type.endsWith(`/${type}`),
  )?.resolvedTarget
}

function relationshipPart(sourcePart: string): string {
  const slash = sourcePart.lastIndexOf('/')
  const folder = slash < 0 ? '' : sourcePart.slice(0, slash + 1)
  const name = sourcePart.slice(slash + 1)
  return `${folder}_rels/${name}.rels`
}

function relativeTarget(sourcePart: string, targetPart: string): string {
  const sourceBase = sourcePart.split('/').slice(0, -1)
  const targetSegments = targetPart.split('/')
  let common = 0
  while (common < sourceBase.length && sourceBase[common] === targetSegments[common]) common += 1
  return [...sourceBase.slice(common).map(() => '..'), ...targetSegments.slice(common)].join('/')
}

function ensureContentType(parts: Parts, partName: string, contentType: string): void {
  const document = parseXml(parts['[Content_Types].xml'], '[Content_Types].xml')
  const root = document.documentElement
  const override = directChildren(root).find(
    (node) => localName(node) === 'Override' && node.getAttribute('PartName') === `/${partName}`,
  )
  if (override) return
  addContentOverride(document, `/${partName}`, contentType)
  parts['[Content_Types].xml'] = encodeXml(document)
}

function addContentOverride(document: XmlDocument, partName: string, contentType: string): void {
  const override = document.createElementNS(NS.contentTypes, 'Override')
  override.setAttribute('PartName', partName)
  override.setAttribute('ContentType', contentType)
  document.documentElement!.appendChild(override)
}

function ensureWorkbookRelationship(parts: Parts, workbookPart: string, targetPart: string, type: string): void {
  const relsPath = relationshipPart(workbookPart)
  const rels = parts[relsPath]
    ? parseXml(parts[relsPath], relsPath)
    : newXmlDocument('Relationships', NS.packageRelationships)
  const existing = directChildren(rels.documentElement).find(
    (node) =>
      node.getAttribute('Type')?.endsWith(`/${type}`) &&
      resolveRelationshipPath(workbookPart, node.getAttribute('Target') ?? '') === targetPart,
  )
  if (existing) return
  const numbers = directChildren(rels.documentElement).map(
    (node) => Number(((node.getAttribute('Id') ?? '').match(/(\d+)$/) ?? [])[1]) || 0,
  )
  const id = `rId${Math.max(0, ...numbers) + 1}`
  addRelationship(rels, id, `${NS.officeRelationships}/${type}`, relativeTarget(workbookPart, targetPart))
  parts[relsPath] = encodeXml(rels)
}

function addRelationship(document: XmlDocument, id: string, type: string, target: string): void {
  const relationship = document.createElementNS(NS.packageRelationships, 'Relationship')
  relationship.setAttribute('Id', id)
  relationship.setAttribute('Type', type)
  relationship.setAttribute('Target', target)
  document.documentElement!.appendChild(relationship)
}

function resolveRelationshipPath(sourcePart: string, target: string): string {
  if (!target || target.includes('\\') || target.includes('?') || /^[A-Za-z][A-Za-z0-9+.-]*:/u.test(target)) return ''
  const segments = target.startsWith('/') ? [] : sourcePart.split('/').slice(0, -1)
  for (const segment of target.split('/')) {
    if (!segment || segment === '.') continue
    if (segment === '..') {
      if (!segments.length) return ''
      segments.pop()
    } else segments.push(segment)
  }
  return segments.join('/')
}

function updateSharedStringCounts(parts: Parts, path: string, activeSheetParts: Set<string>): Uint8Array {
  const document = parseXml(parts[path], path)
  const root = document.documentElement!
  const items = directChildren(root).filter((node) => localName(node) === 'si').length
  let count = 0
  for (const name of activeSheetParts) {
    const bytes = parts[name]
    if (!bytes) throw new Error(`Worksheet part is missing: ${name}`)
    const sheet = parseXml(bytes, name)
    for (const cell of descendantsByName(sheet.documentElement!, 'c')) if (cell.getAttribute('t') === 's') count += 1
  }
  root.setAttribute('count', String(count))
  root.setAttribute('uniqueCount', String(items))
  return encodeXml(document)
}

function descendantsByName(root: XmlElement, name: string): XmlElement[] {
  const output: XmlElement[] = []
  const visit = (element: XmlElement) => {
    for (const child of directChildren(element)) {
      if (localName(child) === name) output.push(child)
      visit(child)
    }
  }
  visit(root)
  return output
}

function nextAvailableSheetNumber(paths: Set<string>): number {
  let next = 1
  while (paths.has(`xl/worksheets/sheet${next}.xml`)) next += 1
  return next
}

function nextSheetPath(paths: Set<string>, first: number): string {
  let next = first
  while (paths.has(`xl/worksheets/sheet${next}.xml`)) next += 1
  return `xl/worksheets/sheet${next}.xml`
}

function newXmlDocument(name: string, namespace: string): XmlDocument {
  const document = new DOMParser().parseFromString(`<${name} xmlns="${namespace}"/>`, 'application/xml')
  if (!document.documentElement) throw new Error('Could not create XML document.')
  return document
}

function parseXml(bytes: Uint8Array, partName: string): XmlDocument {
  const text = strFromU8(bytes)
  if (/<!\s*(?:DOCTYPE|ENTITY)\b/i.test(text)) throw new Error(`Unsafe XML in ${partName}.`)
  let error: string | undefined
  const document = new DOMParser({
    onError: (level, message) => {
      if (level !== 'warning') error = message
    },
  }).parseFromString(text, 'application/xml')
  if (error || !document.documentElement) throw new Error(`Malformed XML in ${partName}.`)
  return document
}

function encodeXml(document: XmlDocument): Uint8Array {
  const serialized = new XMLSerializer().serializeToString(document).replace(/^<\?xml[^?]*\?>/u, '')
  return strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>${serialized}`)
}

function directChildren(parent: XmlElement | null | undefined): XmlElement[] {
  if (!parent) return []
  const output: XmlElement[] = []
  for (let child = parent.firstChild; child; child = child.nextSibling)
    if (child.nodeType === 1) output.push(child as XmlElement)
  return output
}

function directChild(parent: XmlElement | null | undefined, name: string): XmlElement | undefined {
  return directChildren(parent).find((child) => localName(child) === name)
}

function localName(element: XmlNode | null | undefined): string {
  return element?.localName ?? element?.nodeName.split(':').at(-1) ?? ''
}

function getRelId(element: XmlElement): string {
  return element.getAttributeNS(NS.officeRelationships, 'id') || element.getAttribute('r:id') || ''
}

function insertInWorksheetOrder(root: XmlElement, node: XmlElement, order: string[]): void {
  const effectiveOrder = localName(root) === 'worksheet' ? WORKSHEET_CHILD_ORDER : order
  const wanted = effectiveOrder.indexOf(localName(node))
  const following = directChildren(root).find((child) => {
    const index = effectiveOrder.indexOf(localName(child))
    return index >= 0 && index > wanted
  })
  root.insertBefore(node, following ?? null)
}

function insertInWorkbookOrder(root: XmlElement, node: XmlElement, order: string[]): void {
  insertInWorksheetOrder(root, node, order)
}

function appendStyleCollection(document: XmlDocument, name: string): XmlElement {
  const element = document.createElementNS(NS.spreadsheet, name)
  const order = [
    'numFmts',
    'fonts',
    'fills',
    'borders',
    'cellStyleXfs',
    'cellXfs',
    'cellStyles',
    'dxfs',
    'tableStyles',
    'colors',
    'extLst',
  ]
  insertInWorksheetOrder(document.documentElement!, element, order)
  return element
}

function bytesEqual(left: Uint8Array, right: Uint8Array): boolean {
  return left.byteLength === right.byteLength && left.every((value, index) => value === right[index])
}
