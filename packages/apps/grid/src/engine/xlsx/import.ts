import { Unzip, UnzipInflate, UnzipPassThrough } from 'fflate'
import { DOMParser, type Element as XmlElement, type Node as XmlNode } from '@xmldom/xmldom'
import { dateToSerial } from '../workbook/dates'
import { cellAddressKey, parseCellAddress, parseRangeAddress, parseSheetQualifiedAddress } from '../workbook/address'
import {
  createOpaquePartDescriptor,
  createWorkbook,
  createWorksheet,
  getUsedRange,
  assertNoMergeOverlap,
  validateSheetName,
} from '../workbook/model'
import type {
  Cell,
  CellAddress,
  CellStyle,
  CellValue,
  ConditionalFormatDescriptor,
  DateSystem,
  DefinedName,
  FormulaResult,
  OOXMLPartPreservationDescriptor,
  RowMetadata,
  OOXMLSheetMapping,
  TableDescriptor,
  ValidationDescriptor,
  Worksheet,
} from '../workbook/types'
import type {
  CompatibilityCategory,
  CompatibilityCode,
  CompatibilityFinding,
  XlsxImportPreflight,
  XlsxImportProgress,
} from './types'
import { XlsxImportError } from './types'
import { createBlockedXlsxPreflight, isSupportedXlsxFileName, XLSX_LIMITS } from './policy'

const XMLNS = {
  contentTypes: 'http://schemas.openxmlformats.org/package/2006/content-types',
  relationships: 'http://schemas.openxmlformats.org/package/2006/relationships',
  spreadsheet: 'http://schemas.openxmlformats.org/spreadsheetml/2006/main',
  strictSpreadsheet: 'http://purl.oclc.org/ooxml/spreadsheetml/main',
  officeRelationships: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships',
}

const EXCEL_ERROR_CODES = new Set([
  '#NULL!',
  '#DIV/0!',
  '#VALUE!',
  '#REF!',
  '#NAME?',
  '#NUM!',
  '#N/A',
  '#GETTING_DATA',
  '#SPILL!',
  '#CALC!',
  '#FIELD!',
  '#BLOCKED!',
  '#UNKNOWN!',
  '#CONNECT!',
  '#BUSY!',
  '#PYTHON!',
])

interface CentralEntry {
  name: string
  directory: boolean
  flags: number
  compression: number
  crc: number
  compressedSize: number
  uncompressedSize: number
}

interface ContentTypeEntry {
  partName: string
  contentType: string
  isDefault: boolean
}

interface RelationshipEntry {
  sourcePart: string
  id: string
  type: string
  target: string
  targetMode?: 'Internal' | 'External'
  resolvedTarget?: string
  targetExists: boolean
}

export interface StylesheetMap {
  formats: string[]
  styles: Array<CellStyle | undefined>
  isDate: boolean[]
}

type ParsedXmlDocument = ReturnType<DOMParser['parseFromString']>

interface ImportFindings {
  add(code: CompatibilityCode, category: CompatibilityCategory, count?: number, partName?: string): void
  all(): CompatibilityFinding[]
}

function createFindings(): ImportFindings {
  const found = new Map<CompatibilityCode, CompatibilityFinding>()
  const countedParts = new Map<CompatibilityCode, Set<string>>()
  const partFindings = new Set<CompatibilityCode>([
    'charts',
    'pivots',
    'drawings',
    'images',
    'tables',
    'comments',
    'custom-xml',
    'unknown-parts',
    'extensions',
    'active-content',
    'embedded-objects',
  ])
  const severity: Record<CompatibilityCategory, number> = {
    supported: 0,
    'readable-not-editable': 1,
    'preservable-opaque': 2,
    'at-risk': 3,
    blocked: 4,
  }
  return {
    add(code, category, count = 1, partName) {
      const finding = found.get(code) ?? { code, category, count: 0, partNames: [] }
      if (severity[category] > severity[finding.category]) finding.category = category
      const parts = countedParts.get(code) ?? new Set<string>()
      if (!partName || !partFindings.has(code) || !parts.has(partName)) finding.count += count
      if (partName) parts.add(partName)
      countedParts.set(code, parts)
      if (partName && !finding.partNames.includes(partName)) {
        finding.partNames.push(partName)
      }
      found.set(code, finding)
    },
    all: () => [...found.values()],
  }
}

export async function parseXlsxWorkbook(
  fileName: string,
  archiveBytes: Uint8Array,
  onProgress: (progress: XlsxImportProgress) => void = () => {},
): Promise<XlsxImportPreflight> {
  const findings = createFindings()
  try {
    if (!isSupportedXlsxFileName(fileName)) return createBlockedXlsxPreflight(fileName, 'unsupported-extension')
    if (archiveBytes.byteLength > XLSX_LIMITS.archiveBytes) return createBlockedXlsxPreflight(fileName, 'archive-limit')
    if (archiveBytes.byteLength >= 8 && hasOleMagic(archiveBytes))
      return createBlockedXlsxPreflight(fileName, 'encrypted')
    if (archiveBytes.byteLength < 22) return createBlockedXlsxPreflight(fileName, 'archive-invalid')

    onProgress({ phase: 'inspect', percent: 3 })
    const entries = inspectCentralDirectory(archiveBytes)
    const sourceParts = await decompressEntries(archiveBytes, entries, onProgress)
    if (!sourceParts.has('[Content_Types].xml') || !sourceParts.has('_rels/.rels')) {
      return createBlockedXlsxPreflight(fileName, 'invalid-workbook')
    }

    onProgress({ phase: 'map', percent: 57 })
    const contentTypes = parseContentTypes(sourceParts.get('[Content_Types].xml')!, findings)
    const relationships = parseRelationships(sourceParts, findings)
    // Opaque XML is still untrusted input. Validate it before retaining any package for later use.
    for (const [partName, bytes] of sourceParts) {
      const contentType = getContentType(contentTypes, partName)
      if (/\.(?:xml|rels|vml)$/i.test(partName) || /(?:\+xml|\/xml)$/i.test(contentType)) {
        const root = requireXmlRoot(parseXml(bytes, partName))
        inspectForeignNodes(root, partName, findings, relationships)
      }
    }
    validateRelationships(relationships, sourceParts, findings)
    if (findings.all().some((finding) => finding.category === 'blocked')) {
      return {
        report: { fileName, sheetCount: 0, cellCount: 0, findings: findings.all(), canOpen: false },
      }
    }

    const workbookPart = findOfficeDocumentPart(relationships)
    const mainContentType = getContentType(contentTypes, workbookPart)
    if (/spreadsheetml\.sheet\.main\+xml\.strict/i.test(mainContentType)) {
      findings.add('unsupported-version', 'blocked', 1, workbookPart)
      return { report: { fileName, sheetCount: 0, cellCount: 0, findings: findings.all(), canOpen: false } }
    }
    if (/macroEnabled|sheet\.main\+xml\.bin/i.test(mainContentType)) {
      findings.add('active-content', 'blocked', 1, workbookPart)
    }
    if (mainContentType !== 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml') {
      findings.add('unsupported-version', 'blocked', 1, workbookPart)
      return { report: { fileName, sheetCount: 0, cellCount: 0, findings: findings.all(), canOpen: false } }
    }

    const workbookDoc = parseXmlPart(sourceParts, workbookPart)
    const workbookRoot = requireXmlRoot(workbookDoc)
    if (workbookRoot.namespaceURI === XMLNS.strictSpreadsheet) {
      findings.add('unsupported-version', 'blocked', 1, workbookPart)
      return { report: { fileName, sheetCount: 0, cellCount: 0, findings: findings.all(), canOpen: false } }
    }
    if (workbookRoot.namespaceURI !== XMLNS.spreadsheet || localName(workbookRoot) !== 'workbook') {
      findings.add('unsupported-version', 'blocked', 1, workbookPart)
      return { report: { fileName, sheetCount: 0, cellCount: 0, findings: findings.all(), canOpen: false } }
    }
    inspectUnknownRootChildren(
      workbookRoot,
      new Set([
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
      ]),
      workbookPart,
      findings,
    )
    if (firstChild(workbookRoot, 'extLst')) findings.add('extensions', 'at-risk', 1, workbookPart)

    const workbookRels = relationships.filter((relationship) => relationship.sourcePart === workbookPart)
    const sheetRefs = children(firstChild(workbookRoot, 'sheets')).filter((element) => localName(element) === 'sheet')
    if (sheetRefs.length < 1 || sheetRefs.length > XLSX_LIMITS.sheets) {
      findings.add(sheetRefs.length ? 'archive-limit' : 'invalid-workbook', 'blocked', 1, workbookPart)
      return { report: { fileName, sheetCount: 0, cellCount: 0, findings: findings.all(), canOpen: false } }
    }

    const dateSystem: DateSystem = boolAttribute(firstChild(workbookRoot, 'workbookPr'), 'date1904') ? '1904' : '1900'
    const sharedStringsPart = relatedPart(workbookRels, 'sharedStrings')
    const stylesPart = relatedPart(workbookRels, 'styles')
    const sharedStrings = sharedStringsPart ? parseSharedStrings(sourceParts, findings, sharedStringsPart) : []
    const styles = parseStyles(sourceParts, findings, stylesPart ?? '')
    const name = fileName.replace(/\.xlsx$/i, '') || 'Book1'
    const workbook = createWorkbook({ name, firstSheetName: 'Sheet1', dateSystem })
    workbook.sheetsById.clear()
    workbook.sheetOrder = []
    workbook.definedNames = []
    const worksheetParts = new Map<string, string>()
    const sheetMappings: OOXMLSheetMapping[] = []
    const activeTabIndex = Number(
      firstChild(firstChild(workbookRoot, 'bookViews'), 'workbookView')?.getAttribute('activeTab') ?? 0,
    )
    let cellCount = 0

    sheetRefs.forEach((sheetRef, index) => {
      const sheetName = sheetRef.getAttribute('name') ?? ''
      try {
        validateSheetName(
          sheetName,
          [...workbook.sheetsById.values()].map((sheet) => sheet.name),
        )
      } catch {
        findings.add('invalid-workbook', 'blocked', 1, workbookPart)
        return
      }
      const relationshipId =
        attributeByNamespace(sheetRef, XMLNS.officeRelationships, 'id') ?? sheetRef.getAttribute('r:id') ?? ''
      const relationship = workbookRels.find((candidate) => candidate.id === relationshipId)
      if (!relationship || !relationship.type.endsWith('/worksheet') || !relationship.resolvedTarget) {
        findings.add('unsafe-relationship', 'blocked', 1, workbookPart)
        return
      }
      if (sheetMappings.some((mapping) => mapping.partName === relationship.resolvedTarget)) {
        findings.add('invalid-workbook', 'blocked', 1, workbookPart)
        return
      }
      const id = `xlsx-sheet-${index + 1}`
      const sourceSheetId = sheetRef.getAttribute('sheetId') ?? String(index + 1)
      if (
        !/^[1-9]\d*$/.test(sourceSheetId) ||
        sheetMappings.some((mapping) => mapping.sourceSheetId === sourceSheetId)
      ) {
        findings.add('invalid-workbook', 'blocked', 1, workbookPart)
        return
      }
      const sheet = createWorksheet(id, sheetName)
      const state = sheetRef.getAttribute('state')
      sheet.visibility = state === 'veryHidden' ? 'veryHidden' : state === 'hidden' ? 'hidden' : 'visible'
      if (sheet.visibility !== 'visible')
        findings.add('hidden-sheets', 'readable-not-editable', 1, relationship.resolvedTarget)
      workbook.sheetsById.set(id, sheet)
      workbook.sheetOrder.push(id)
      worksheetParts.set(id, relationship.resolvedTarget)
      sheetMappings.push({ sheetId: id, partName: relationship.resolvedTarget, relationshipId, sourceSheetId })
    })

    if (findings.all().some((finding) => finding.category === 'blocked')) {
      return { report: { fileName, sheetCount: 0, cellCount: 0, findings: findings.all(), canOpen: false } }
    }

    const activeSheetIndex =
      Number.isInteger(activeTabIndex) && activeTabIndex >= 0 && activeTabIndex < workbook.sheetOrder.length
        ? activeTabIndex
        : 0
    const activeSheetId = workbook.sheetOrder[activeSheetIndex]
    const firstVisibleSheetId = workbook.sheetOrder.find(
      (sheetId) => workbook.sheetsById.get(sheetId)?.visibility === 'visible',
    )
    if (!firstVisibleSheetId)
      throw new XlsxImportError('invalid-workbook', 'A workbook must contain a visible worksheet.')
    workbook.activeSheetId =
      workbook.sheetsById.get(activeSheetId)?.visibility === 'visible' ? activeSheetId : firstVisibleSheetId
    for (const definedNameElement of descendants(firstChild(workbookRoot, 'definedNames'), 'definedName')) {
      const definedName = readDefinedName(definedNameElement, workbook.sheetOrder, workbook.sheetsById)
      if (definedName) {
        if (
          workbook.definedNames.some(
            (name) =>
              name.scopeSheetId === definedName.scopeSheetId &&
              name.name.toLowerCase() === definedName.name.toLowerCase(),
          )
        )
          throw new XlsxImportError('invalid-workbook', 'Duplicate defined name in the same scope.')
        workbook.definedNames.push(definedName)
        findings.add('defined-names', 'readable-not-editable', 1, workbookPart)
      }
    }
    if (firstChild(workbookRoot, 'externalReferences')) {
      findings.add(
        'external-references',
        'at-risk',
        children(firstChild(workbookRoot, 'externalReferences')).length,
        workbookPart,
      )
    }

    for (const [index, sheetId] of workbook.sheetOrder.entries()) {
      const sheet = workbook.sheetsById.get(sheetId)!
      const partName = worksheetParts.get(sheetId)!
      const worksheetDoc = parseXmlPart(sourceParts, partName)
      const worksheetRoot = requireXmlRoot(worksheetDoc)
      if (worksheetRoot.namespaceURI !== XMLNS.spreadsheet || localName(worksheetRoot) !== 'worksheet') {
        findings.add('unsupported-version', 'blocked', 1, partName)
        continue
      }
      inspectUnknownRootChildren(
        worksheetRoot,
        new Set([
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
        ]),
        partName,
        findings,
      )
      if (firstChild(worksheetRoot, 'extLst')) findings.add('extensions', 'at-risk', 1, partName)
      const sheetFormat = firstChild(worksheetRoot, 'sheetFormatPr')
      if (sheetFormat) {
        const defaultRowHeight = finiteAttribute(sheetFormat, 'defaultRowHeight')
        const defaultColumnWidth = finiteAttribute(sheetFormat, 'defaultColWidth')
        if (defaultRowHeight !== undefined) sheet.dimensions.defaultRowHeight = defaultRowHeight
        if (defaultColumnWidth !== undefined) sheet.dimensions.defaultColumnWidth = defaultColumnWidth
      }
      readFrozenPane(worksheetRoot, sheet)
      readColumns(worksheetRoot, sheet)
      const rows = children(firstChild(worksheetRoot, 'sheetData')).filter((element) => localName(element) === 'row')
      const seenRows = new Set<number>()
      const seenCells = new Set<string>()
      for (const rowElement of rows) {
        inspectUnknownRootChildren(rowElement, new Set(['c', 'extLst']), partName, findings)
        const rowNumber = positiveInteger(rowElement.getAttribute('r'))
        if (!rowNumber || rowNumber > sheet.dimensions.rowLimit || seenRows.has(rowNumber))
          throw new XlsxImportError('invalid-workbook', 'Invalid or duplicate worksheet row index.')
        seenRows.add(rowNumber)
        const rowMetadata = readRowMetadata(rowElement)
        if (rowMetadata) sheet.rowMetadata.set(rowNumber, rowMetadata)
        for (const cellElement of children(rowElement).filter((element) => localName(element) === 'c')) {
          inspectUnknownRootChildren(cellElement, new Set(['f', 'v', 'is', 'extLst']), partName, findings)
          if (++cellCount > XLSX_LIMITS.populatedCells)
            throw new XlsxImportError('archive-limit', 'Cell limit exceeded.')
          const rawAddress = cellElement.getAttribute('r')
          if (!rawAddress) throw new XlsxImportError('invalid-workbook', 'Cell address is missing.')
          let address: CellAddress
          try {
            address = parseCellAddress(rawAddress)
          } catch {
            throw new XlsxImportError('invalid-workbook', 'Invalid cell address.')
          }
          if (address.row !== rowNumber)
            throw new XlsxImportError('invalid-workbook', 'Cell address does not match its row.')
          const key = cellAddressKey(address)
          if (seenCells.has(key)) throw new XlsxImportError('invalid-workbook', 'Duplicate cell address.')
          seenCells.add(key)
          const styleIndex = Number(cellElement.getAttribute('s') ?? 0)
          if (!Number.isInteger(styleIndex) || styleIndex < 0 || styleIndex >= styles.styles.length) {
            findings.add('unsupported-style-details', 'at-risk', 1, partName)
          }
          const style = styles.styles[styleIndex]
          const formulaElement = firstChild(cellElement, 'f')
          const valueElement = firstChild(cellElement, 'v')
          const valueText = valueElement?.textContent ?? ''
          const cellType = cellElement.getAttribute('t') ?? 'n'
          const inlineString = firstChild(cellElement, 'is')
          const cached =
            cellType === 'inlineStr'
              ? {
                  kind: 'string' as const,
                  value: readRichText(inlineString),
                }
              : parseScalarValue(
                  cellType,
                  valueText,
                  sharedStrings,
                  style,
                  styles.isDate[styleIndex],
                  dateSystem,
                  findings,
                  partName,
                )
          let value: CellValue
          if (formulaElement) {
            findings.add('formula-cache', 'readable-not-editable', 1, partName)
            const formulaSourceText = formulaElement.textContent ?? ''
            const formulaSource = `=${formulaSourceText}`
            if (formulaElement.getAttribute('t') === 'shared')
              findings.add('shared-formula', 'readable-not-editable', 1, partName)
            if (!isBalancedFormula(formulaSourceText))
              findings.add('malformed-formula', 'readable-not-editable', 1, partName)
            value = {
              kind: 'formula',
              formula: {
                source: formulaSource,
                canonicalExpression: formulaSource,
                ast: null,
                cachedResult: cached,
                calculationStatus: 'unsupported',
              },
            }
          } else {
            value = cached
          }
          const cell: Cell = { value, ...(style ? { style: structuredClone(style) } : {}) }
          if (value.kind !== 'blank' || (cellElement.hasAttribute('s') && style)) sheet.cells.set(key, cell)
        }
      }
      sheet.dimensions.usedRange = getUsedRange(sheet.cells, sheet.merges)
      readMerges(worksheetRoot, sheet, findings, partName)
      sheet.dimensions.usedRange = getUsedRange(sheet.cells, sheet.merges)
      readAutoFilter(worksheetRoot, sheet, partName)
      readHyperlinks(
        worksheetRoot,
        sheet,
        relationships.filter((relationship) => relationship.sourcePart === partName),
        findings,
        partName,
      )
      sheet.validations = readValidations(worksheetRoot, findings, partName)
      sheet.conditionalFormats = readConditionalFormats(worksheetRoot, findings, partName)
      sheet.printSettings = readPrintSettings(worksheetRoot)
      readComments(
        sheet,
        relationships.filter((relationship) => relationship.sourcePart === partName),
        sourceParts,
        findings,
      )
      readTables(
        sheet,
        relationships.filter((relationship) => relationship.sourcePart === partName),
        sourceParts,
        findings,
      )
      readDrawingsAndPivots(sheet, worksheetRoot, relationships, sourceParts, findings, partName)
      onProgress({ phase: 'map', percent: 60 + Math.round(((index + 1) / workbook.sheetOrder.length) * 35) })
      await yieldTask()
    }

    for (const definedName of workbook.definedNames) {
      const targetSheet = definedName.scopeSheetId ? workbook.sheetsById.get(definedName.scopeSheetId) : undefined
      if (!targetSheet || !/^_xlnm\.Print_(?:Area|Titles)$/i.test(definedName.name)) continue
      targetSheet.printSettings = {
        ...targetSheet.printSettings,
        ...(definedName.name.toLowerCase() === '_xlnm.print_area'
          ? { printArea: definedName.formula ?? '' }
          : { printTitles: definedName.formula ?? '' }),
      }
    }

    for (const [partName, bytes] of sourceParts) {
      if (partName.endsWith('.xml') && /<\s*(?:[\w.-]+:)?extLst\b/i.test(decodeUtf8(bytes, partName))) {
        findings.add('extensions', 'at-risk', 1, partName)
      }
    }
    detectPackageFeatures(sourceParts, contentTypes, relationships, findings)
    workbook.preservation = {
      originalArchiveBytes: archiveBytes,
      parts: makePartDescriptors(entries, contentTypes, relationships, findings.all()),
      sheetMappings,
      inventory: { contentTypes, relationships },
    }
    findings.add('supported-content', 'supported', 1, workbookPart)
    const reportFindings = findings.all()
    onProgress({ phase: 'map', percent: 100 })
    return {
      ...(!reportFindings.some((finding) => finding.category === 'blocked') ? { workbook } : {}),
      report: {
        fileName,
        sheetCount: workbook.sheetOrder.length,
        cellCount,
        findings: reportFindings,
        canOpen: !reportFindings.some((finding) => finding.category === 'blocked'),
      },
    }
  } catch (error) {
    const code = error instanceof XlsxImportError ? toCompatibilityCode(error.code) : 'archive-invalid'
    return createBlockedXlsxPreflight(fileName, code)
  }
}

function hasOleMagic(bytes: Uint8Array): boolean {
  return (
    bytes[0] === 0xd0 &&
    bytes[1] === 0xcf &&
    bytes[2] === 0x11 &&
    bytes[3] === 0xe0 &&
    bytes[4] === 0xa1 &&
    bytes[5] === 0xb1 &&
    bytes[6] === 0x1a &&
    bytes[7] === 0xe1
  )
}

function toCompatibilityCode(code: string): CompatibilityCode {
  switch (code) {
    case 'unsupported-extension':
      return 'unsupported-extension'
    case 'legacy-format':
      return 'unsupported-version'
    case 'encrypted':
      return 'encrypted'
    case 'archive-limit':
      return 'archive-limit'
    case 'unsupported-version':
      return 'unsupported-version'
    case 'active-content':
      return 'active-content'
    case 'unsafe-relationship':
      return 'unsafe-relationship'
    case 'invalid-workbook':
      return 'invalid-workbook'
    case 'malformed-xml':
      return 'malformed-xml'
    case 'broken-shared-string':
      return 'broken-shared-string'
    default:
      return 'archive-invalid'
  }
}

function inspectCentralDirectory(bytes: Uint8Array): CentralEntry[] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const eocdOffset = findEndOfCentralDirectory(view)
  if (eocdOffset < 0) throw new XlsxImportError('archive-invalid', 'ZIP end record was not found.')
  const diskNumber = view.getUint16(eocdOffset + 4, true)
  const centralDisk = view.getUint16(eocdOffset + 6, true)
  const diskEntries = view.getUint16(eocdOffset + 8, true)
  const totalEntries = view.getUint16(eocdOffset + 10, true)
  const centralSize = view.getUint32(eocdOffset + 12, true)
  const centralOffset = view.getUint32(eocdOffset + 16, true)
  const commentLength = view.getUint16(eocdOffset + 20, true)
  if (
    eocdOffset + 22 + commentLength !== bytes.byteLength ||
    diskNumber !== 0 ||
    centralDisk !== 0 ||
    diskEntries !== totalEntries
  ) {
    throw new XlsxImportError('archive-invalid', 'ZIP has trailing data or multiple disks.')
  }
  if (totalEntries === 0xffff || centralSize === 0xffffffff || centralOffset === 0xffffffff) {
    throw new XlsxImportError('archive-limit', 'ZIP64 workbooks are not supported by the bounded importer.')
  }
  if (totalEntries < 1 || totalEntries > XLSX_LIMITS.entries || centralOffset + centralSize !== eocdOffset) {
    throw new XlsxImportError('archive-limit', 'ZIP entry count or directory size is outside the supported limit.')
  }

  const entries: CentralEntry[] = []
  const localRanges: Array<{ start: number; end: number }> = []
  const seen = new Set<string>()
  let cursor = centralOffset
  let totalUncompressed = 0
  for (let index = 0; index < totalEntries; index += 1) {
    if (cursor + 46 > eocdOffset || view.getUint32(cursor, true) !== 0x02014b50) {
      throw new XlsxImportError('archive-invalid', 'Malformed ZIP central directory.')
    }
    const flags = view.getUint16(cursor + 8, true)
    const compression = view.getUint16(cursor + 10, true)
    const crc = view.getUint32(cursor + 16, true)
    const compressedSize = view.getUint32(cursor + 20, true)
    const uncompressedSize = view.getUint32(cursor + 24, true)
    const nameLength = view.getUint16(cursor + 28, true)
    const extraLength = view.getUint16(cursor + 30, true)
    const entryCommentLength = view.getUint16(cursor + 32, true)
    const diskStart = view.getUint16(cursor + 34, true)
    const externalAttributes = view.getUint32(cursor + 38, true)
    const end = cursor + 46 + nameLength + extraLength + entryCommentLength
    if (end > eocdOffset || diskStart !== 0)
      throw new XlsxImportError('archive-invalid', 'Invalid ZIP central directory entry.')
    if (flags & 0x41) throw new XlsxImportError('encrypted', 'Encrypted ZIP entries are not supported.')
    if (compressedSize === 0xffffffff || uncompressedSize === 0xffffffff) {
      throw new XlsxImportError('archive-limit', 'ZIP64 entries are not supported by the bounded importer.')
    }
    if (compression !== 0 && compression !== 8)
      throw new XlsxImportError('archive-invalid', 'Unsupported ZIP compression method.')
    if (((externalAttributes >>> 16) & 0xf000) === 0xa000)
      throw new XlsxImportError('archive-invalid', 'Symbolic links are not allowed in workbooks.')
    const nameBytes = bytes.subarray(cursor + 46, cursor + 46 + nameLength)
    const name = decodeZipName(nameBytes, Boolean(flags & 0x800))
    const normalized = validateZipPath(name)
    const localOffset = view.getUint32(cursor + 42, true)
    if (localOffset + 30 > centralOffset || view.getUint32(localOffset, true) !== 0x04034b50)
      throw new XlsxImportError('archive-invalid', 'Invalid ZIP local header offset.')
    const localFlags = view.getUint16(localOffset + 6, true)
    if (localFlags & 0x41) throw new XlsxImportError('encrypted', 'Encrypted ZIP entries are not supported.')
    const localNameLength = view.getUint16(localOffset + 26, true)
    const localExtraLength = view.getUint16(localOffset + 28, true)
    const payloadStart = localOffset + 30 + localNameLength + localExtraLength
    const payloadEnd = payloadStart + compressedSize
    if (payloadEnd > centralOffset || localFlags !== flags || view.getUint16(localOffset + 8, true) !== compression)
      throw new XlsxImportError('archive-invalid', 'ZIP local header disagrees with its directory record.')
    const localName = decodeZipName(
      bytes.subarray(localOffset + 30, localOffset + 30 + localNameLength),
      Boolean(localFlags & 0x800),
    )
    if (
      localName !== name ||
      (!(flags & 8) &&
        (view.getUint32(localOffset + 14, true) !== crc ||
          view.getUint32(localOffset + 18, true) !== compressedSize ||
          view.getUint32(localOffset + 22, true) !== uncompressedSize))
    )
      throw new XlsxImportError('archive-invalid', 'ZIP local entry metadata is inconsistent.')
    localRanges.push({ start: localOffset, end: payloadEnd })
    if (seen.has(normalized.toLocaleLowerCase('en-US')))
      throw new XlsxImportError('archive-invalid', 'Duplicate ZIP entry names are not allowed.')
    seen.add(normalized.toLocaleLowerCase('en-US'))
    const directory = normalized.endsWith('/')
    if (uncompressedSize > XLSX_LIMITS.entryBytes)
      throw new XlsxImportError('archive-limit', 'A ZIP entry exceeds the size limit.')
    if (
      !directory &&
      uncompressedSize > 0 &&
      (compressedSize === 0 || uncompressedSize / compressedSize > XLSX_LIMITS.compressionRatio)
    ) {
      throw new XlsxImportError('archive-limit', 'A ZIP entry exceeds the compression-ratio limit.')
    }
    totalUncompressed += uncompressedSize
    if (totalUncompressed > XLSX_LIMITS.totalUncompressedBytes)
      throw new XlsxImportError('archive-limit', 'Workbook expands beyond the size limit.')
    entries.push({ name: normalized, directory, flags, compression, crc, compressedSize, uncompressedSize })
    cursor = end
  }
  if (cursor !== centralOffset + centralSize)
    throw new XlsxImportError('archive-invalid', 'ZIP central directory length is inconsistent.')
  localRanges.sort((left, right) => left.start - right.start)
  if (localRanges.some((range, index) => index > 0 && range.start < localRanges[index - 1].end))
    throw new XlsxImportError('archive-invalid', 'ZIP local entries overlap.')
  return entries
}

function findEndOfCentralDirectory(view: DataView): number {
  const min = Math.max(0, view.byteLength - 65_557)
  for (let offset = view.byteLength - 22; offset >= min; offset -= 1) {
    if (view.getUint32(offset, true) === 0x06054b50) return offset
  }
  return -1
}

function decodeZipName(bytes: Uint8Array, utf8: boolean): string {
  if (!utf8 && bytes.some((byte) => byte > 0x7f))
    throw new XlsxImportError('archive-invalid', 'Non-UTF-8 ZIP paths are not supported.')
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch {
    throw new XlsxImportError('archive-invalid', 'ZIP entry name is not valid UTF-8.')
  }
}

function validateZipPath(name: string): string {
  const path = name.replace(/\/$/, '')
  if (!name || name.includes('\\') || name.includes('\0') || path.startsWith('/') || /^[A-Za-z]:/.test(path)) {
    throw new XlsxImportError('archive-invalid', 'ZIP contains an unsafe path.')
  }
  const parts = path.split('/')
  if (parts.some((part) => !part || part === '.' || part === '..' || part.includes(':'))) {
    throw new XlsxImportError('archive-invalid', 'ZIP path traversal is not allowed.')
  }
  return name.endsWith('/') ? `${parts.join('/')}/` : parts.join('/')
}

async function decompressEntries(
  bytes: Uint8Array,
  entries: CentralEntry[],
  onProgress: (progress: XlsxImportProgress) => void,
): Promise<Map<string, Uint8Array>> {
  const expected = new Map(entries.map((entry) => [entry.name, entry]))
  const seen = new Set<string>()
  const files = new Map<string, Uint8Array>()
  let localCount = 0
  let totalActual = 0
  let failure: XlsxImportError | undefined
  const unzip = new Unzip((file) => {
    if (failure) {
      file.terminate()
      return
    }
    try {
      const name = validateZipPath(file.name)
      const central = expected.get(name)
      if (!central || seen.has(name) || central.compression !== file.compression) {
        throw new XlsxImportError('archive-invalid', 'ZIP local entries do not match the central directory.')
      }
      seen.add(name)
      localCount += 1
      if (file.size !== undefined && file.size !== central.compressedSize) {
        throw new XlsxImportError('archive-invalid', 'ZIP local and central compressed sizes differ.')
      }
      if (file.originalSize !== undefined && file.originalSize !== central.uncompressedSize) {
        throw new XlsxImportError('archive-invalid', 'ZIP local and central uncompressed sizes differ.')
      }
      if (central.directory) return
      const chunks: Uint8Array[] = []
      let actualSize = 0
      file.ondata = (error, data, final) => {
        if (error) {
          failure = new XlsxImportError('archive-invalid', 'ZIP decompression failed.')
          return
        }
        if (data?.byteLength) {
          actualSize += data.byteLength
          totalActual += data.byteLength
          if (actualSize > XLSX_LIMITS.entryBytes || totalActual > XLSX_LIMITS.totalUncompressedBytes) {
            failure = new XlsxImportError('archive-limit', 'Workbook expanded beyond its declared size limit.')
            file.terminate()
            return
          }
          chunks.push(data.slice())
        }
        if (final) {
          if (actualSize !== central.uncompressedSize) {
            failure = new XlsxImportError('archive-invalid', 'ZIP entry size does not match its directory record.')
            return
          }
          const combined = new Uint8Array(actualSize)
          let offset = 0
          for (const chunk of chunks) {
            combined.set(chunk, offset)
            offset += chunk.byteLength
          }
          if (crc32Bytes(combined) !== central.crc) {
            failure = new XlsxImportError('archive-invalid', 'ZIP entry checksum is invalid.')
            return
          }
          files.set(name, combined)
        }
      }
      file.start()
    } catch (error) {
      failure =
        error instanceof XlsxImportError
          ? error
          : new XlsxImportError('archive-invalid', 'ZIP entry could not be read.')
      file.terminate()
    }
  })
  unzip.register(UnzipPassThrough)
  unzip.register(UnzipInflate)
  const chunkSize = 256 * 1024
  for (let offset = 0; offset < bytes.byteLength; offset += chunkSize) {
    const end = Math.min(bytes.byteLength, offset + chunkSize)
    try {
      unzip.push(bytes.subarray(offset, end), end === bytes.byteLength)
    } catch (error) {
      if (!failure)
        failure =
          error instanceof XlsxImportError ? error : new XlsxImportError('archive-invalid', 'ZIP archive is malformed.')
    }
    if (failure) throw failure
    onProgress({ phase: 'decompress', percent: 8 + Math.round((end / bytes.byteLength) * 45) })
    await yieldTask()
  }
  if (failure) throw failure
  if (localCount !== entries.length || seen.size !== expected.size)
    throw new XlsxImportError('archive-invalid', 'ZIP entries are incomplete.')
  for (const entry of entries) {
    if (!entry.directory && !files.has(entry.name))
      throw new XlsxImportError('archive-invalid', 'ZIP entry was not decompressed.')
  }
  return files
}

function parseContentTypes(bytes: Uint8Array, findings: ImportFindings): ContentTypeEntry[] {
  const document = parseXml(bytes, '[Content_Types].xml')
  const root = requireXmlRoot(document)
  if (root.namespaceURI !== XMLNS.contentTypes || localName(root) !== 'Types')
    throw new XlsxImportError('invalid-workbook', 'Missing OPC content types.')
  const entries: ContentTypeEntry[] = []
  for (const element of children(root)) {
    if (localName(element) === 'Default') {
      const extension = element.getAttribute('Extension')
      const contentType = element.getAttribute('ContentType')
      if (!extension || !contentType) throw new XlsxImportError('malformed-xml', 'Invalid default content type.')
      if (entries.some((candidate) => candidate.isDefault && candidate.partName === `*.${extension.toLowerCase()}`))
        throw new XlsxImportError('malformed-xml', 'Duplicate default content type.')
      entries.push({ partName: `*.${extension.toLowerCase()}`, contentType, isDefault: true })
    } else if (localName(element) === 'Override') {
      const partName = normalizePartUri(element.getAttribute('PartName'))
      const contentType = element.getAttribute('ContentType')
      if (!partName || !contentType) throw new XlsxImportError('malformed-xml', 'Invalid override content type.')
      if (entries.some((candidate) => !candidate.isDefault && candidate.partName === partName)) {
        throw new XlsxImportError('malformed-xml', 'Duplicate content type override.')
      }
      entries.push({ partName, contentType, isDefault: false })
    } else {
      findings.add('unknown-nodes', 'at-risk', 1, '[Content_Types].xml')
    }
  }
  return entries
}

function normalizePartUri(value: string | null): string | undefined {
  if (!value) return undefined
  const withoutLeading = value.startsWith('/') ? value.slice(1) : value
  try {
    const decoded = withoutLeading
      .split('/')
      .map((part) => decodeURIComponent(part))
      .join('/')
    return validateZipPath(decoded)
  } catch {
    throw new XlsxImportError('unsafe-relationship', 'A package part path is unsafe.')
  }
}

function parseRelationships(sourceParts: Map<string, Uint8Array>, findings: ImportFindings): RelationshipEntry[] {
  const output: RelationshipEntry[] = []
  for (const [partName, bytes] of sourceParts) {
    if (partName !== '_rels/.rels' && !/_rels\/[^/]+\.rels$/i.test(partName)) continue
    const sourcePart = relationshipSource(partName)
    if (sourcePart && !sourceParts.has(sourcePart))
      throw new XlsxImportError('unsafe-relationship', 'Relationship source part is missing.')
    const document = parseXml(bytes, partName)
    const root = requireXmlRoot(document)
    if (root.namespaceURI !== XMLNS.relationships || localName(root) !== 'Relationships')
      throw new XlsxImportError('malformed-xml', 'Invalid relationship file.')
    const seenIds = new Set<string>()
    for (const relation of children(root)) {
      if (localName(relation) !== 'Relationship') {
        findings.add('unknown-nodes', 'at-risk', 1, partName)
        continue
      }
      const id = relation.getAttribute('Id')
      const type = relation.getAttribute('Type')
      const target = relation.getAttribute('Target')
      const targetModeValue = relation.getAttribute('TargetMode')
      if (!id || !type || !target || seenIds.has(id))
        throw new XlsxImportError('malformed-xml', 'Invalid or duplicate relationship id.')
      seenIds.add(id)
      if (targetModeValue && targetModeValue !== 'External' && targetModeValue !== 'Internal') {
        throw new XlsxImportError('unsafe-relationship', 'Unknown relationship target mode.')
      }
      const targetMode = targetModeValue === 'External' ? 'External' : 'Internal'
      if (targetMode === 'External') {
        output.push({ sourcePart, id, type, target, targetMode, targetExists: true })
        findings.add(type.endsWith('/hyperlink') ? 'external-targets' : 'external-references', 'at-risk', 1, partName)
      } else {
        const resolvedTarget = resolveInternalTarget(sourcePart, target)
        output.push({
          sourcePart,
          id,
          type,
          target,
          targetMode,
          resolvedTarget,
          targetExists: sourceParts.has(resolvedTarget),
        })
      }
    }
  }
  return output
}

function relationshipSource(relsPart: string): string {
  if (relsPart === '_rels/.rels') return ''
  const marker = relsPart.lastIndexOf('/_rels/')
  if (marker < 0) throw new XlsxImportError('unsafe-relationship', 'Invalid relationship part path.')
  const prefix = relsPart.slice(0, marker)
  const sourceName = relsPart.slice(marker + '/_rels/'.length).replace(/\.rels$/i, '')
  if (!sourceName || sourceName.includes('/'))
    throw new XlsxImportError('unsafe-relationship', 'Invalid relationship part path.')
  return `${prefix ? `${prefix}/` : ''}${sourceName}`
}

function resolveInternalTarget(sourcePart: string, target: string): string {
  if (target.includes('\\') || target.includes('?') || /^[A-Za-z][A-Za-z0-9+.-]*:/.test(target)) {
    throw new XlsxImportError('unsafe-relationship', 'An internal relationship target is not a package path.')
  }
  const hash = target.indexOf('#')
  const path = hash >= 0 ? target.slice(0, hash) : target
  let decodedSegments: string[]
  try {
    decodedSegments = path.split('/').map((segment) => decodeURIComponent(segment))
  } catch {
    throw new XlsxImportError('unsafe-relationship', 'An internal relationship target has invalid encoding.')
  }
  if (decodedSegments.some((segment) => segment.includes('\\') || segment.includes('\0') || segment.includes(':'))) {
    throw new XlsxImportError('unsafe-relationship', 'An internal relationship target is unsafe.')
  }
  const result = path.startsWith('/') ? [] : sourcePart.split('/').slice(0, -1)
  for (const segment of decodedSegments) {
    if (!segment || segment === '.') continue
    if (segment === '..') {
      if (!result.length)
        throw new XlsxImportError('unsafe-relationship', 'An internal relationship escapes the package root.')
      result.pop()
    } else result.push(segment)
  }
  if (!result.length) throw new XlsxImportError('unsafe-relationship', 'An internal relationship target is empty.')
  return validateZipPath(result.join('/'))
}

function validateRelationships(
  relationships: RelationshipEntry[],
  sourceParts: Map<string, Uint8Array>,
  findings: ImportFindings,
): void {
  for (const relationship of relationships) {
    if (relationship.targetMode === 'External') continue
    if (!relationship.targetExists) {
      findings.add('unsafe-relationship', 'blocked', 1, relationship.sourcePart || '_rels/.rels')
    }
  }
  if (!sourceParts.has('[Content_Types].xml')) findings.add('invalid-workbook', 'blocked')
}

function findOfficeDocumentPart(relationships: RelationshipEntry[]): string {
  const relationship = relationships.find(
    (candidate) => candidate.sourcePart === '' && candidate.type.endsWith('/officeDocument'),
  )
  if (!relationship || !relationship.resolvedTarget)
    throw new XlsxImportError('invalid-workbook', 'Workbook relationship is missing.')
  return relationship.resolvedTarget
}

function getContentType(entries: ContentTypeEntry[], partName: string): string {
  const override = entries.find((entry) => !entry.isDefault && entry.partName === partName)
  if (override) return override.contentType
  const extension = partName.split('.').at(-1)?.toLowerCase() ?? ''
  return entries.find((entry) => entry.isDefault && entry.partName === `*.${extension}`)?.contentType ?? ''
}

function relatedPart(relationships: RelationshipEntry[], type: string): string | undefined {
  const matches = relationships.filter((relationship) => relationship.type.endsWith(`/${type}`))
  if (matches.length > 1 || matches.some((relationship) => !relationship.resolvedTarget))
    throw new XlsxImportError('unsafe-relationship', `Invalid ${type} relationship.`)
  return matches[0]?.resolvedTarget
}

function parseSharedStrings(
  sourceParts: Map<string, Uint8Array>,
  findings: ImportFindings,
  partName: string,
): string[] {
  const bytes = sourceParts.get(partName)
  if (!bytes) return []
  const document = parseXml(bytes, partName)
  const root = requireXmlRoot(document)
  if (root.namespaceURI !== XMLNS.spreadsheet || localName(root) !== 'sst')
    throw new XlsxImportError('malformed-xml', 'Invalid shared strings part.')
  inspectUnknownRootChildren(root, new Set(['si', 'extLst']), partName, findings)
  if (firstChild(root, 'extLst')) findings.add('extensions', 'at-risk', 1, partName)
  return children(root)
    .filter((element) => localName(element) === 'si')
    .map(readRichText)
}

function readRichText(element: XmlElement | undefined): string {
  return children(element)
    .filter((child) => child.namespaceURI === XMLNS.spreadsheet)
    .map((child) => {
      if (localName(child) === 't') return child.textContent ?? ''
      if (localName(child) === 'r')
        return children(child)
          .filter((node) => localName(node) === 't' && node.namespaceURI === XMLNS.spreadsheet)
          .map((node) => node.textContent ?? '')
          .join('')
      return ''
    })
    .join('')
}

function parseStyles(
  sourceParts: Map<string, Uint8Array>,
  findings: ImportFindings,
  partName = 'xl/styles.xml',
): StylesheetMap {
  const bytes = sourceParts.get(partName)
  if (!bytes) return { formats: ['General'], styles: [undefined], isDate: [false] }
  const document = parseXml(bytes, partName)
  const root = requireXmlRoot(document)
  if (/(?:theme|indexed)\s*=/i.test(decodeUtf8(bytes, partName))) {
    findings.add('unsupported-style-details', 'at-risk', 1, partName)
  }
  if (root.namespaceURI !== XMLNS.spreadsheet || localName(root) !== 'styleSheet')
    throw new XlsxImportError('malformed-xml', 'Invalid shared styles part.')
  inspectUnknownRootChildren(
    root,
    new Set([
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
    ]),
    partName,
    findings,
  )
  if (firstChild(root, 'extLst')) findings.add('extensions', 'at-risk', 1, partName)
  const customFormats = new Map<number, string>()
  for (const format of descendants(firstChild(root, 'numFmts'), 'numFmt')) {
    const id = Number(format.getAttribute('numFmtId'))
    if (Number.isInteger(id) && id >= 0) customFormats.set(id, format.getAttribute('formatCode') ?? 'General')
  }
  const fonts = children(firstChild(root, 'fonts'))
    .filter((element) => localName(element) === 'font')
    .map(parseFont)
  const fills = children(firstChild(root, 'fills'))
    .filter((element) => localName(element) === 'fill')
    .map(parseFill)
  const borders = children(firstChild(root, 'borders'))
    .filter((element) => localName(element) === 'border')
    .map(parseBorder)
  const xfs = children(firstChild(root, 'cellXfs')).filter((element) => localName(element) === 'xf')
  if (xfs.length === 0) return { formats: ['General'], styles: [undefined], isDate: [false] }
  const styles: Array<CellStyle | undefined> = []
  const formats: string[] = []
  const isDate: boolean[] = []
  xfs.forEach((xf, index) => {
    const numFmtId = Number(xf.getAttribute('numFmtId') ?? 0)
    const format = customFormats.get(numFmtId) ?? builtinNumberFormat(numFmtId)
    formats[index] = format
    isDate[index] = isDateFormat(format, numFmtId)
    const style: CellStyle = {}
    if (format && format !== 'General') style.numberFormat = format
    const font = fonts[Number(xf.getAttribute('fontId') ?? 0)]
    const fill = fills[Number(xf.getAttribute('fillId') ?? 0)]
    const border = borders[Number(xf.getAttribute('borderId') ?? 0)]
    if (font && Object.keys(font).length) style.font = font
    if (fill && Object.keys(fill).length) style.fill = fill
    if (border && Object.keys(border).length) style.border = border
    const alignment = firstChild(xf, 'alignment')
    if (alignment) {
      const horizontal = alignment.getAttribute('horizontal')
      const vertical = alignment.getAttribute('vertical')
      style.alignment = {
        ...(horizontal === 'left' || horizontal === 'center' || horizontal === 'right' ? { horizontal } : {}),
        ...(vertical === 'top' || vertical === 'center' ? { vertical: vertical === 'center' ? 'middle' : 'top' } : {}),
        ...(vertical === 'bottom' ? { vertical: 'bottom' as const } : {}),
        ...(boolAttribute(alignment, 'wrapText') ? { wrapText: true } : {}),
      }
    }
    styles[index] = Object.keys(style).length ? style : undefined
  })
  return { formats, styles, isDate }
}

export function parseXlsxStyles(sourceParts: Map<string, Uint8Array>): StylesheetMap {
  return parseStyles(sourceParts, createFindings())
}

function parseFont(element: XmlElement): CellStyle['font'] {
  const color = colorValue(firstChild(element, 'color'))
  return {
    ...(firstChild(element, 'name')?.getAttribute('val')
      ? { name: firstChild(element, 'name')!.getAttribute('val')! }
      : {}),
    ...(finiteAttribute(firstChild(element, 'sz'), 'val') !== undefined
      ? { size: finiteAttribute(firstChild(element, 'sz'), 'val') }
      : {}),
    ...(boolElement(firstChild(element, 'b')) ? { bold: true } : {}),
    ...(boolElement(firstChild(element, 'i')) ? { italic: true } : {}),
    ...(boolElement(firstChild(element, 'u')) ? { underline: true } : {}),
    ...(color ? { color } : {}),
  }
}

function parseFill(element: XmlElement): CellStyle['fill'] {
  const pattern = firstChild(element, 'patternFill')
  const color = colorValue(firstChild(pattern, 'fgColor'))
  return {
    ...(pattern?.getAttribute('patternType') ? { pattern: pattern.getAttribute('patternType')! } : {}),
    ...(color ? { color } : {}),
  }
}

function parseBorder(element: XmlElement): CellStyle['border'] {
  const border: NonNullable<CellStyle['border']> = {}
  for (const sideName of ['left', 'right', 'top', 'bottom'] as const) {
    const side = firstChild(element, sideName)
    const style = side?.getAttribute('style')
    const color = colorValue(firstChild(side, 'color'))
    if (style) border[sideName] = color ? `${style}:${color}` : style
  }
  return border
}

function colorValue(element: XmlElement | undefined): string | undefined {
  const rgb = element?.getAttribute('rgb')
  if (!rgb) return undefined
  const normalized = rgb.length === 8 ? rgb.slice(2) : rgb
  return /^[a-f\d]{6}$/i.test(normalized) ? `#${normalized}` : undefined
}

function builtinNumberFormat(id: number): string {
  const formats: Record<number, string> = {
    0: 'General',
    1: '0',
    2: '0.00',
    3: '#,##0',
    4: '#,##0.00',
    9: '0%',
    10: '0.00%',
    11: '0.00E+00',
    12: '# ?/?',
    13: '# ??/??',
    14: 'm/d/yy',
    15: 'd-mmm-yy',
    16: 'd-mmm',
    17: 'mmm-yy',
    18: 'h:mm AM/PM',
    19: 'h:mm:ss AM/PM',
    20: 'h:mm',
    21: 'h:mm:ss',
    22: 'm/d/yy h:mm',
    37: '#,##0 ;(#,##0)',
    38: '#,##0 ;[Red](#,##0)',
    39: '#,##0.00;(#,##0.00)',
    40: '#,##0.00;[Red](#,##0.00)',
    45: 'mm:ss',
    46: '[h]:mm:ss',
    47: 'mmss.0',
  }
  return formats[id] ?? `General#${id}`
}

function isDateFormat(format: string, id: number): boolean {
  if (
    [
      14, 15, 16, 17, 18, 19, 20, 21, 22, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 45, 46, 47, 50, 51, 52, 53, 54, 55,
      56, 57, 58,
    ].includes(id)
  )
    return true
  const clean = format
    .replace(/"[^"]*"/g, '')
    .replace(/\\./g, '')
    .replace(/\[[^\]]*\]/g, (part) => (/^\[(?:h+|m+|s+)\]$/i.test(part) ? part : ''))
  return /[ydhs]/i.test(clean) || /m{1,4}/i.test(clean)
}

function parseScalarValue(
  cellType: string,
  rawValue: string,
  sharedStrings: string[],
  style: CellStyle | undefined,
  isDate: boolean | undefined,
  dateSystem: DateSystem,
  findings: ImportFindings,
  partName: string,
): FormulaResult {
  if (cellType === 's') {
    const index = Number(rawValue)
    if (!/^\d+$/.test(rawValue) || !Number.isInteger(index) || index < 0 || index >= sharedStrings.length) {
      throw new XlsxImportError('broken-shared-string', 'Shared string index is invalid.')
    }
    return { kind: 'string', value: sharedStrings[index] }
  }
  if (cellType === 'str') return { kind: 'string', value: rawValue }
  if (cellType === 'b') return { kind: 'boolean', value: rawValue === '1' || rawValue.toLowerCase() === 'true' }
  if (cellType === 'e') {
    return {
      kind: 'error',
      code: rawValue,
      ...(!EXCEL_ERROR_CODES.has(rawValue) ? { message: `Unrecognized workbook error code: ${rawValue}` } : {}),
    }
  }
  if (cellType === 'd') {
    const parsed = Date.parse(rawValue)
    if (!Number.isFinite(parsed)) throw new XlsxImportError('invalid-workbook', 'Invalid ISO date cell value.')
    try {
      return {
        kind: 'date',
        serial: dateToSerial(new Date(parsed), dateSystem),
        numberFormat: style?.numberFormat ?? 'yyyy-mm-dd',
      }
    } catch {
      findings.add('unsupported-cell-types', 'readable-not-editable', 1, partName)
      return { kind: 'string', value: rawValue }
    }
  }
  if (cellType !== 'n' && cellType !== '') {
    findings.add('unsupported-cell-types', 'readable-not-editable', 1, partName)
    return { kind: 'string', value: rawValue }
  }
  if (rawValue === '') return { kind: 'blank' }
  const number = Number(rawValue)
  if (!Number.isFinite(number)) throw new XlsxImportError('invalid-workbook', 'Numeric cell value is invalid.')
  if (isDate && number >= 0) return { kind: 'date', serial: number, numberFormat: style?.numberFormat ?? 'm/d/yy' }
  return { kind: 'number', value: number }
}

function isBalancedFormula(formula: string): boolean {
  if (!formula.trim()) return false
  let parentheses = 0
  let brackets = 0
  let braces = 0
  let inString = false
  let inSheetName = false
  for (let index = 0; index < formula.length; index += 1) {
    const character = formula[index]
    if (character === '"' && !inSheetName) {
      if (formula[index + 1] === '"' && inString) index += 1
      else inString = !inString
      continue
    }
    if (inString) continue
    if (character === "'") {
      if (formula[index + 1] === "'" && inSheetName) index += 1
      else inSheetName = !inSheetName
      continue
    }
    if (inSheetName) continue
    if (character === '(') parentheses += 1
    if (character === ')' && --parentheses < 0) return false
    if (character === '[') brackets += 1
    if (character === ']' && --brackets < 0) return false
    if (character === '{') braces += 1
    if (character === '}' && --braces < 0) return false
  }
  return !inString && !inSheetName && parentheses === 0 && brackets === 0 && braces === 0
}

function readFrozenPane(root: XmlElement, sheet: Worksheet): void {
  const pane = firstChild(firstChild(firstChild(root, 'sheetViews'), 'sheetView'), 'pane')
  if (!pane) return
  sheet.frozenPane = {
    xSplit: finiteAttribute(pane, 'xSplit') ?? 0,
    ySplit: finiteAttribute(pane, 'ySplit') ?? 0,
    topLeftCell: pane.getAttribute('topLeftCell') ?? 'A1',
    ...(pane.getAttribute('activePane') ? { activePane: pane.getAttribute('activePane')! } : {}),
    ...(pane.getAttribute('state') ? { state: pane.getAttribute('state')! } : {}),
  }
}

function readColumns(root: XmlElement, sheet: Worksheet): void {
  for (const column of descendants(firstChild(root, 'cols'), 'col')) {
    const min = positiveInteger(column.getAttribute('min'))
    const max = positiveInteger(column.getAttribute('max'))
    if (!min || !max || max < min || max > 16_384)
      throw new XlsxImportError('invalid-workbook', 'Invalid column metadata range.')
    const width = finiteAttribute(column, 'width')
    const hidden = boolAttribute(column, 'hidden')
    const outlineLevel = finiteAttribute(column, 'outlineLevel')
    for (let index = min; index <= max; index += 1) {
      sheet.columnMetadata.set(index, {
        ...(width !== undefined ? { width } : {}),
        ...(hidden ? { hidden: true } : {}),
        ...(outlineLevel !== undefined ? { outlineLevel } : {}),
      })
    }
  }
}

function readRowMetadata(row: XmlElement): RowMetadata | undefined {
  const height = finiteAttribute(row, 'ht')
  const hidden = boolAttribute(row, 'hidden')
  const outlineLevel = finiteAttribute(row, 'outlineLevel')
  if (height === undefined && !hidden && outlineLevel === undefined) return undefined
  return {
    ...(height !== undefined ? { height } : {}),
    ...(hidden ? { hidden: true } : {}),
    ...(outlineLevel !== undefined ? { outlineLevel } : {}),
  }
}

function readMerges(root: XmlElement, sheet: Worksheet, findings: ImportFindings, partName: string): void {
  for (const merge of descendants(firstChild(root, 'mergeCells'), 'mergeCell')) {
    const reference = merge.getAttribute('ref')
    try {
      if (!reference) throw new Error('Missing merge range')
      const range = parseRangeAddress(reference)
      assertNoMergeOverlap(sheet, range)
      sheet.merges.push(range)
    } catch {
      findings.add('invalid-workbook', 'blocked', 1, partName)
    }
  }
}

function readAutoFilter(root: XmlElement, sheet: Worksheet, partName: string): void {
  const autoFilter = firstChild(root, 'autoFilter')
  const reference = autoFilter?.getAttribute('ref')
  if (!reference) return
  try {
    sheet.autoFilter = { range: parseRangeAddress(reference), sourcePartName: partName }
  } catch {
    throw new XlsxImportError('invalid-workbook', 'Invalid worksheet filter range.')
  }
}

function readHyperlinks(
  root: XmlElement,
  sheet: Worksheet,
  relationships: RelationshipEntry[],
  findings: ImportFindings,
  partName: string,
): void {
  const hyperlinks = descendants(firstChild(root, 'hyperlinks'), 'hyperlink')
  if (!hyperlinks.length) return
  sheet.hyperlinks = []
  for (const hyperlink of hyperlinks) {
    const reference = hyperlink.getAttribute('ref')
    const relationshipId =
      attributeByNamespace(hyperlink, XMLNS.officeRelationships, 'id') ?? hyperlink.getAttribute('r:id')
    const relationship = relationships.find((candidate) => candidate.id === relationshipId)
    try {
      if (!reference) throw new Error('Missing hyperlink range')
      sheet.hyperlinks.push({
        range: parseRangeAddress(reference),
        ...(relationshipId ? { relationshipId } : {}),
        ...(relationship ? { target: relationship.target, targetMode: relationship.targetMode } : {}),
        ...(hyperlink.getAttribute('display') ? { display: hyperlink.getAttribute('display')! } : {}),
        ...(hyperlink.getAttribute('tooltip') ? { tooltip: hyperlink.getAttribute('tooltip')! } : {}),
        ...(hyperlink.getAttribute('location') ? { location: hyperlink.getAttribute('location')! } : {}),
      })
      if (relationshipId && !relationship) findings.add('unsafe-relationship', 'blocked', 1, partName)
    } catch {
      findings.add('invalid-workbook', 'blocked', 1, partName)
    }
  }
}

function readValidations(root: XmlElement, findings: ImportFindings, partName: string): ValidationDescriptor[] {
  const output: ValidationDescriptor[] = []
  for (const validation of descendants(firstChild(root, 'dataValidations'), 'dataValidation')) {
    const ranges = (validation.getAttribute('sqref') ?? '').trim().split(/\s+/).filter(Boolean)
    for (const [index, rangeText] of ranges.entries()) {
      try {
        const type = validation.getAttribute('type') ?? 'any'
        output.push({
          id: `${partName}-validation-${output.length + 1}`,
          range: parseRangeAddress(rangeText),
          type: isValidationType(type) ? type : 'custom',
          ...(validation.getAttribute('operator') ? { operator: validation.getAttribute('operator')! } : {}),
          ...(firstChild(validation, 'formula1')
            ? { formula1: firstChild(validation, 'formula1')!.textContent ?? '' }
            : {}),
          ...(firstChild(validation, 'formula2')
            ? { formula2: firstChild(validation, 'formula2')!.textContent ?? '' }
            : {}),
          allowBlank: boolAttribute(validation, 'allowBlank'),
          showErrorMessage: boolAttribute(validation, 'showErrorMessage'),
          ...(validation.getAttribute('errorTitle') ? { errorTitle: validation.getAttribute('errorTitle')! } : {}),
          ...(validation.getAttribute('error') ? { errorMessage: validation.getAttribute('error')! } : {}),
          rangeStatus: 'safe',
        })
      } catch {
        findings.add('validations', 'readable-not-editable', 1, partName)
      }
      if (index === 0) findings.add('validations', 'readable-not-editable', 1, partName)
    }
  }
  return output
}

function isValidationType(value: string): value is ValidationDescriptor['type'] {
  return ['any', 'whole', 'decimal', 'list', 'date', 'time', 'textLength', 'custom'].includes(value)
}

function readConditionalFormats(
  root: XmlElement,
  findings: ImportFindings,
  partName: string,
): ConditionalFormatDescriptor[] {
  const output: ConditionalFormatDescriptor[] = []
  for (const conditional of descendants(root, 'conditionalFormatting')) {
    const ranges = (conditional.getAttribute('sqref') ?? '').trim().split(/\s+/).filter(Boolean)
    const rules = children(conditional).filter((element) => localName(element) === 'cfRule')
    for (const rangeText of ranges) {
      for (const rule of rules) {
        try {
          output.push({
            id: `${partName}-conditional-format-${output.length + 1}`,
            range: parseRangeAddress(rangeText),
            ruleType: rule.getAttribute('type') ?? 'unknown',
            ...(firstChild(rule, 'formula') ? { formula: firstChild(rule, 'formula')!.textContent ?? '' } : {}),
            ...(finiteAttribute(rule, 'priority') !== undefined ? { priority: finiteAttribute(rule, 'priority') } : {}),
            rangeStatus: 'safe',
          })
        } catch {
          findings.add('conditional-formats', 'readable-not-editable', 1, partName)
        }
      }
    }
  }
  if (output.length) findings.add('conditional-formats', 'readable-not-editable', output.length, partName)
  return output
}

function readPrintSettings(root: XmlElement): NonNullable<Worksheet['printSettings']> | undefined {
  const margins = firstChild(root, 'pageMargins')
  const setup = firstChild(root, 'pageSetup')
  const printOptions = firstChild(root, 'printOptions')
  const headerFooter = firstChild(root, 'headerFooter')
  if (!margins && !setup && !printOptions && !headerFooter) return undefined
  const numbers: Record<string, number> = {}
  if (margins) {
    for (const key of ['left', 'right', 'top', 'bottom', 'header', 'footer']) {
      const value = finiteAttribute(margins, key)
      if (value !== undefined) numbers[key] = value
    }
  }
  return {
    ...(margins ? { pageMargins: numbers } : {}),
    ...(setup ? { pageSetup: attributes(setup) } : {}),
    ...(printOptions ? { printOptions: attributes(printOptions) } : {}),
    ...(headerFooter
      ? {
          headerFooter: {
            ...(firstChild(headerFooter, 'oddHeader')
              ? { oddHeader: firstChild(headerFooter, 'oddHeader')!.textContent ?? '' }
              : {}),
            ...(firstChild(headerFooter, 'oddFooter')
              ? { oddFooter: firstChild(headerFooter, 'oddFooter')!.textContent ?? '' }
              : {}),
            ...(firstChild(headerFooter, 'evenHeader')
              ? { evenHeader: firstChild(headerFooter, 'evenHeader')!.textContent ?? '' }
              : {}),
            ...(firstChild(headerFooter, 'evenFooter')
              ? { evenFooter: firstChild(headerFooter, 'evenFooter')!.textContent ?? '' }
              : {}),
          },
        }
      : {}),
    ...(boolAttribute(firstChild(firstChild(root, 'sheetPr'), 'pageSetUpPr'), 'fitToPage') ? { fitToPage: true } : {}),
  }
}

function readDefinedName(
  element: XmlElement,
  sheetOrder: string[],
  sheets: Map<string, Worksheet>,
): DefinedName | undefined {
  const name = element.getAttribute('name')
  if (!name) return undefined
  const localSheetId = element.getAttribute('localSheetId')
  if (localSheetId !== null && (!/^\d+$/.test(localSheetId) || !sheetOrder[Number(localSheetId)]))
    throw new XlsxImportError('invalid-workbook', 'Defined name has an invalid worksheet scope.')
  const scopeSheetId = localSheetId !== null ? sheetOrder[Number(localSheetId)] : undefined
  const formula = element.textContent ?? ''
  let target: Pick<DefinedName, 'targetSheetId' | 'range'> = {}
  try {
    const qualified = parseSheetQualifiedAddress(formula.replace(/^=/, ''))
    const sheet = [...sheets.values()].find((sheet) => sheet.name.toLowerCase() === qualified.sheetName.toLowerCase())
    if (sheet) target = { targetSheetId: sheet.id, range: qualified.range }
  } catch {
    /* Expressions and print-title ranges remain opaque source text. */
  }
  return { name, ...(scopeSheetId ? { scopeSheetId } : {}), ...target, formula }
}

function readComments(
  sheet: Worksheet,
  relationships: RelationshipEntry[],
  sourceParts: Map<string, Uint8Array>,
  findings: ImportFindings,
): void {
  const commentsRel = relationships.find(
    (relationship) => relationship.type.endsWith('/comments') && relationship.resolvedTarget,
  )
  if (commentsRel?.resolvedTarget) {
    const bytes = sourceParts.get(commentsRel.resolvedTarget)
    if (!bytes) return
    const document = parseXml(bytes, commentsRel.resolvedTarget)
    const root = requireXmlRoot(document)
    const authors = descendants(root, 'author').map((author) => author.textContent ?? '')
    sheet.comments = []
    for (const comment of descendants(root, 'comment')) {
      const authorId = Number(comment.getAttribute('authorId') ?? 0)
      const address = comment.getAttribute('ref') ?? ''
      try {
        parseCellAddress(address)
        sheet.comments.push({
          address,
          author: authors[authorId] ?? '',
          text: descendants(comment, 't')
            .map((text) => text.textContent ?? '')
            .join(''),
          sourcePartName: commentsRel.resolvedTarget,
        })
      } catch {
        findings.add('comments', 'readable-not-editable', 1, commentsRel.resolvedTarget)
      }
    }
    if (sheet.comments.length)
      findings.add('comments', 'readable-not-editable', sheet.comments.length, commentsRel.resolvedTarget)
  }
  if (relationships.some((relationship) => relationship.type.endsWith('/threadedComment'))) {
    findings.add('comments', 'preservable-opaque', 1, sheet.id)
  }
}

function readTables(
  sheet: Worksheet,
  relationships: RelationshipEntry[],
  sourceParts: Map<string, Uint8Array>,
  findings: ImportFindings,
): void {
  const tableRels = relationships.filter(
    (relationship) => relationship.type.endsWith('/table') && relationship.resolvedTarget,
  )
  if (!tableRels.length) return
  sheet.tables = []
  for (const [index, relationship] of tableRels.entries()) {
    const bytes = sourceParts.get(relationship.resolvedTarget!)
    if (!bytes) continue
    const document = parseXml(bytes, relationship.resolvedTarget!)
    const root = requireXmlRoot(document)
    const name = root.getAttribute('name') ?? root.getAttribute('displayName') ?? `Table${index + 1}`
    const reference = root.getAttribute('ref') ?? ''
    try {
      const columns = descendants(firstChild(root, 'tableColumns'), 'tableColumn').map((column, columnIndex) => ({
        id: column.getAttribute('id') ?? `${columnIndex + 1}`,
        name: column.getAttribute('name') ?? `Column${columnIndex + 1}`,
        ...(firstChild(column, 'calculatedColumnFormula')
          ? { totalsFormula: firstChild(column, 'calculatedColumnFormula')!.textContent ?? '' }
          : {}),
      }))
      const table: TableDescriptor = {
        id: relationship.resolvedTarget!,
        name,
        range: parseRangeAddress(reference),
        columns,
        ...(firstChild(root, 'tableStyleInfo')?.getAttribute('name')
          ? { styleName: firstChild(root, 'tableStyleInfo')!.getAttribute('name')! }
          : {}),
        autoFilter: Boolean(firstChild(root, 'autoFilter')),
        rangeStatus: 'safe',
      }
      sheet.tables.push(table)
    } catch {
      findings.add('tables', 'readable-not-editable', 1, relationship.resolvedTarget!)
    }
  }
  if (sheet.tables.length) findings.add('tables', 'readable-not-editable', sheet.tables.length, sheet.tables[0].id)
}

function readDrawingsAndPivots(
  sheet: Worksheet,
  root: XmlElement,
  relationships: RelationshipEntry[],
  sourceParts: Map<string, Uint8Array>,
  findings: ImportFindings,
  partName: string,
): void {
  const drawingRefs = descendants(root, 'drawing')
  if (drawingRefs.length) {
    const drawingRels = relationships.filter(
      (relationship) =>
        relationship.sourcePart === partName && relationship.type.endsWith('/drawing') && relationship.resolvedTarget,
    )
    sheet.drawings = []
    for (const [index, relationship] of drawingRels.entries()) {
      const drawingBytes = sourceParts.get(relationship.resolvedTarget!)
      if (!drawingBytes) continue
      const drawingDoc = parseXml(drawingBytes, relationship.resolvedTarget!)
      const drawingRelationships = relationshipsForPart(relationship.resolvedTarget!, relationships)
      for (const [drawingIndex, item] of descendants(requireXmlRoot(drawingDoc), 'graphicFrame').entries()) {
        const chartRef = descendants(item, 'chart')[0]
        const chartId = chartRef
          ? (attributeByNamespace(chartRef, XMLNS.officeRelationships, 'id') ?? chartRef.getAttribute('r:id'))
          : undefined
        const chartRel = drawingRelationships.find((candidate) => candidate.id === chartId)
        const chartPart = chartRel?.resolvedTarget
        sheet.drawings.push({
          id: `${relationship.resolvedTarget!}-graphic-${drawingIndex + 1}`,
          range: emptyRange(),
          kind: chartPart ? 'chart' : 'unknown',
          sourcePartName: chartPart ?? relationship.resolvedTarget,
          ...(chartId ? { relationshipId: chartId } : {}),
          preservationStatus: 'safe',
          rangeStatus: 'unsafe',
        })
      }
      for (const imageRel of drawingRelationships.filter(
        (candidate) => candidate.type.endsWith('/image') && candidate.resolvedTarget,
      )) {
        sheet.drawings.push({
          id: `${relationship.resolvedTarget!}-image-${index + 1}`,
          range: emptyRange(),
          kind: 'image',
          sourcePartName: imageRel.resolvedTarget,
          relationshipId: imageRel.id,
          preservationStatus: 'safe',
          rangeStatus: 'unsafe',
        })
      }
      findings.add('drawings', 'at-risk', 1, relationship.resolvedTarget!)
    }
  }
  const pivotRefs = descendants(firstChild(root, 'pivotTableParts'), 'pivotTablePart')
  if (pivotRefs.length) {
    const pivotRels = relationships.filter(
      (relationship) =>
        relationship.sourcePart === partName &&
        relationship.type.endsWith('/pivotTable') &&
        relationship.resolvedTarget,
    )
    sheet.pivots = []
    for (const [index, relationship] of pivotRels.entries()) {
      const bytes = sourceParts.get(relationship.resolvedTarget!)
      if (!bytes) continue
      const document = parseXml(bytes, relationship.resolvedTarget!)
      const rootElement = requireXmlRoot(document)
      const location = firstChild(rootElement, 'location')
      const range = location?.getAttribute('ref') ?? 'A1'
      const name = rootElement.getAttribute('name') ?? `PivotTable${index + 1}`
      sheet.pivots.push({
        id: `${relationship.resolvedTarget!}-pivot-${index + 1}`,
        range: safeRange(range),
        name,
        ...(finiteAttribute(rootElement, 'cacheId') !== undefined
          ? { cacheId: finiteAttribute(rootElement, 'cacheId') }
          : {}),
        sourcePartName: relationship.resolvedTarget,
        preservationStatus: 'safe',
        rangeStatus: 'unsafe',
      })
    }
  }
}

function detectPackageFeatures(
  sourceParts: Map<string, Uint8Array>,
  contentTypes: ContentTypeEntry[],
  relationships: RelationshipEntry[],
  findings: ImportFindings,
): void {
  for (const partName of sourceParts.keys()) {
    const lower = partName.toLowerCase()
    const contentType = getContentType(contentTypes, partName).toLowerCase()
    if (/vbaProject|macroenabled|activeX|ctrlProps/i.test(`${partName} ${contentType}`)) {
      findings.add('active-content', 'blocked', 1, partName)
    } else if (/embeddings\/|oleobject|package\.bin/i.test(`${partName} ${contentType}`)) {
      findings.add('embedded-objects', 'blocked', 1, partName)
    } else if (lower.includes('/pivottables/') || lower.includes('/pivotcache/')) {
      findings.add('pivots', 'at-risk', 1, partName)
    } else if (lower.includes('/charts/')) {
      findings.add('charts', 'at-risk', 1, partName)
    } else if (lower.includes('/drawings/')) {
      findings.add('drawings', 'at-risk', 1, partName)
    } else if (lower.includes('/media/')) {
      findings.add('images', 'at-risk', 1, partName)
    } else if (lower.includes('/tables/')) {
      findings.add('tables', 'readable-not-editable', 1, partName)
    } else if (lower.includes('/externallinks/')) {
      findings.add('external-references', 'at-risk', 1, partName)
    } else if (lower.startsWith('customxml/')) {
      findings.add('custom-xml', 'preservable-opaque', 1, partName)
    } else if (lower.includes('threadedcomment') || lower.includes('/person/')) {
      findings.add('comments', 'preservable-opaque', 1, partName)
    } else if (lower.includes('/comments')) {
      findings.add('comments', 'readable-not-editable', 1, partName)
    } else if (!isRecognizedPart(partName, relationships)) {
      findings.add('unknown-parts', 'preservable-opaque', 1, partName)
    }
    if (contentType.includes('macroenabled') || contentType.includes('vba'))
      findings.add('active-content', 'blocked', 1, partName)
    if (contentType.includes('drawingml.chart')) findings.add('charts', 'at-risk', 1, partName)
    if (contentType.includes('pivot')) findings.add('pivots', 'at-risk', 1, partName)
    if (contentType.includes('externalLink')) findings.add('external-references', 'at-risk', 1, partName)
    if (contentType.includes('customXml')) findings.add('custom-xml', 'preservable-opaque', 1, partName)
  }
  if (relationships.some((relationship) => relationship.type.endsWith('/externalLink'))) {
    findings.add('external-references', 'at-risk', 1, 'xl/workbook.xml')
  }
}

function isRecognizedPart(partName: string, relationships: RelationshipEntry[]): boolean {
  return (
    partName === '[Content_Types].xml' ||
    partName === '_rels/.rels' ||
    /(?:^|\/)_rels\/[^/]+\.rels$/i.test(partName) ||
    relationships.some(
      (relationship) =>
        relationship.resolvedTarget === partName &&
        /\/(?:officeDocument|worksheet|sharedStrings|styles|theme|core-properties|extended-properties)$/.test(
          relationship.type,
        ),
    )
  )
}

function makePartDescriptors(
  entries: CentralEntry[],
  contentTypes: ContentTypeEntry[],
  relationships: RelationshipEntry[],
  compatibilityFindings: CompatibilityFinding[],
): OOXMLPartPreservationDescriptor[] {
  return entries
    .filter((entry) => !entry.directory)
    .map((entry) => {
      const partName = entry.name
      const type = getContentType(contentTypes, partName)
      const lower = partName.toLowerCase()
      let classification: NonNullable<OOXMLPartPreservationDescriptor['classification']> = 'supported'
      if (/vbaProject|macroenabled|activeX|ctrlProps|embeddings\/|oleobject/i.test(`${partName} ${type}`))
        classification = 'blocked'
      else if (/charts|pivot|drawings|media|externalLinks/i.test(partName)) classification = 'at-risk'
      else if (/^xl\/tables\//i.test(partName)) classification = 'readable-not-editable'
      else if (lower.startsWith('customxml/') || !isRecognizedPart(partName, relationships))
        classification = 'preservable-opaque'
      else if (
        compatibilityFindings.some((finding) => finding.partNames.includes(partName) && finding.category === 'at-risk')
      )
        classification = 'at-risk'
      else if (
        compatibilityFindings.some(
          (finding) => finding.partNames.includes(partName) && finding.category === 'readable-not-editable',
        )
      )
        classification = 'readable-not-editable'
      else if (
        compatibilityFindings.some(
          (finding) => finding.partNames.includes(partName) && finding.category === 'preservable-opaque',
        )
      )
        classification = 'preservable-opaque'
      const partFindings = compatibilityFindings.filter((finding) => finding.partNames.includes(partName))
      if (partFindings.some((finding) => finding.category === 'blocked')) classification = 'blocked'
      else if (partFindings.some((finding) => finding.category === 'at-risk')) classification = 'at-risk'
      else if (partFindings.some((finding) => finding.category === 'preservable-opaque'))
        classification = 'preservable-opaque'
      const relationshipIds = relationships
        .filter((relationship) => relationship.resolvedTarget === partName)
        .map((relationship) => relationship.id)
      const dependsOn =
        classification === 'supported'
          ? (['cell-values', 'cell-styles', 'cell-addresses', 'sheet-names', 'sheet-order', 'sheet-structure'] as const)
          : (['all'] as const)
      return {
        ...createOpaquePartDescriptor({ partName, contentType: type || undefined, relationshipIds }),
        compressedSize: entry.compressedSize,
        uncompressedSize: entry.uncompressedSize,
        classification,
        dependsOn: [...dependsOn],
        status: 'safe' as const,
        unsafeReasons: [],
      }
    })
}

function parseXmlPart(sourceParts: Map<string, Uint8Array>, partName: string): ParsedXmlDocument {
  const bytes = sourceParts.get(partName)
  if (!bytes) throw new XlsxImportError('invalid-workbook', `Required package part is missing: ${partName}`)
  if (bytes.byteLength > XLSX_LIMITS.xmlEntryBytes)
    throw new XlsxImportError('archive-limit', 'An XML part exceeds the size limit.')
  return parseXml(bytes, partName)
}

function parseXml(bytes: Uint8Array, partName: string): ParsedXmlDocument {
  if (bytes.byteLength > XLSX_LIMITS.xmlEntryBytes)
    throw new XlsxImportError('archive-limit', 'An XML part exceeds the size limit.')
  const source = decodeUtf8(bytes, partName)
  if (/<!\s*(?:DOCTYPE|ENTITY)\b/i.test(source))
    throw new XlsxImportError('malformed-xml', 'DTD and entity declarations are disabled.')
  let parseError: string | undefined
  let document: ParsedXmlDocument
  try {
    document = new DOMParser({
      onError: (level, message) => {
        parseError = `${level}: ${message}`
      },
    }).parseFromString(source, 'application/xml')
  } catch {
    throw new XlsxImportError('malformed-xml', `Malformed XML in ${partName}.`)
  }
  if (parseError || !document.documentElement)
    throw new XlsxImportError('malformed-xml', `Malformed XML in ${partName}.`)
  return document
}

function requireXmlRoot(document: ParsedXmlDocument): XmlElement {
  if (!document.documentElement) throw new XlsxImportError('malformed-xml', 'XML document has no root element.')
  return document.documentElement
}

function decodeUtf8(bytes: Uint8Array, partName: string): string {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch {
    throw new XlsxImportError('malformed-xml', `XML is not UTF-8 in ${partName}.`)
  }
}

function inspectUnknownRootChildren(
  root: XmlElement,
  known: Set<string>,
  partName: string,
  findings: ImportFindings,
): void {
  for (const child of children(root)) {
    if (!known.has(localName(child))) findings.add('unknown-nodes', 'at-risk', 1, partName)
  }
}

function inspectForeignNodes(
  root: XmlElement,
  partName: string,
  findings: ImportFindings,
  relationships: RelationshipEntry[],
): void {
  const mapped =
    root.namespaceURI === XMLNS.spreadsheet && ['workbook', 'worksheet', 'sst', 'styleSheet'].includes(localName(root))
  const stack = [root]
  const known = new Set(
    `workbook workbookPr bookViews workbookView sheets sheet definedNames definedName calcPr worksheet sheetPr sheetFormatPr sheetViews sheetView pane selection dimension cols col sheetData row c f v is t r rPr mergeCells mergeCell hyperlinks hyperlink autoFilter filterColumn filters filter customFilters customFilter dynamicFilter colorFilter iconFilter top10 sortState sortCondition pageSetUpPr pageMargins pageSetup printOptions headerFooter oddHeader oddFooter evenHeader evenFooter firstHeader firstFooter styleSheet numFmts numFmt fonts font name sz b i u color family charset scheme fills fill patternFill fgColor bgColor borders border left right top bottom diagonal alignment xf cellXfs cellStyleXfs cellStyles cellStyle dxfs dxf tableStyles tableStyle sst si conditionalFormatting cfRule formula dataValidations dataValidation formula1 formula2 drawing legacyDrawing tableParts tablePart pivotTableParts pivotTablePart extLst`.split(
      ' ',
    ),
  )
  const ids = new Set(
    relationships.filter((relationship) => relationship.sourcePart === partName).map((relationship) => relationship.id),
  )
  while (stack.length) {
    const element = stack.pop()!
    const name = localName(element)
    if (name === 'extLst') findings.add('extensions', 'at-risk', 1, partName)
    if (mapped && (element.namespaceURI !== XMLNS.spreadsheet || !known.has(name)))
      findings.add('unknown-nodes', 'at-risk', 1, partName)
    for (let index = 0; index < element.attributes.length; index += 1) {
      const attribute = element.attributes.item(index)
      if (attribute?.namespaceURI === XMLNS.officeRelationships && !ids.has(attribute.value))
        findings.add('unsafe-relationship', 'blocked', 1, partName)
    }
    if (element.namespaceURI === XMLNS.spreadsheet && ['oleObjects', 'oleObject', 'controls', 'control'].includes(name))
      findings.add('active-content', 'blocked', 1, partName)
    for (const child of children(element)) stack.push(child)
  }
}

function relationshipsForPart(partName: string, relationships: RelationshipEntry[]): RelationshipEntry[] {
  return relationships.filter((relationship) => relationship.sourcePart === partName)
}

function safeRange(reference: string) {
  try {
    return parseRangeAddress(reference)
  } catch {
    return emptyRange()
  }
}

function emptyRange() {
  const address = { row: 1, column: 1 }
  return { start: address, end: address }
}

function attributes(element: XmlElement): Record<string, string> {
  const output: Record<string, string> = {}
  for (let index = 0; index < element.attributes.length; index += 1) {
    const attribute = element.attributes.item(index)
    if (attribute) output[attribute.name] = attribute.value
  }
  return output
}

function attributeByNamespace(element: XmlElement, namespace: string, local: string): string | undefined {
  const value = element.getAttributeNS(namespace, local)
  return value || undefined
}

function boolAttribute(element: XmlElement | undefined, name: string): boolean {
  const value = element?.getAttribute(name)
  return value === '1' || value === 'true'
}

function boolElement(element: XmlElement | undefined): boolean {
  return element !== undefined && element.getAttribute('val') !== '0' && element.getAttribute('val') !== 'false'
}

function finiteAttribute(element: XmlElement | undefined, name: string): number | undefined {
  if (!element?.hasAttribute(name)) return undefined
  const value = Number(element.getAttribute(name))
  return Number.isFinite(value) ? value : undefined
}

function positiveInteger(value: string | null): number | undefined {
  if (value === null || !/^\d+$/.test(value)) return undefined
  const parsed = Number(value)
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : undefined
}

function localName(element: XmlNode | null | undefined): string {
  return element?.localName ?? element?.nodeName.split(':').at(-1) ?? ''
}

function children(element: XmlElement | undefined): XmlElement[] {
  if (!element) return []
  const output: XmlElement[] = []
  for (let index = 0; index < element.childNodes.length; index += 1) {
    const child = element.childNodes.item(index)
    if (child?.nodeType === 1) output.push(child as XmlElement)
  }
  return output
}

function firstChild(element: XmlElement | undefined, name: string): XmlElement | undefined {
  return children(element).find((child) => localName(child) === name)
}

function descendants(element: XmlElement | undefined, name: string): XmlElement[] {
  if (!element) return []
  const output: XmlElement[] = []
  const visit = (current: XmlElement) => {
    for (const child of children(current)) {
      if (localName(child) === name) output.push(child)
      visit(child)
    }
  }
  visit(element)
  return output
}

function yieldTask(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0))
}

function crc32Bytes(bytes: Uint8Array): number {
  let crc = -1
  for (const byte of bytes) {
    crc ^= byte
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0)
  }
  return (crc ^ -1) >>> 0
}
