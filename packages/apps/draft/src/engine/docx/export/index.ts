import {
  AlignmentType,
  Document,
  ExternalHyperlink,
  HeadingLevel,
  HighlightColor,
  LevelFormat,
  LineRuleType,
  Packer,
  Paragraph,
  TextRun,
  UnderlineType,
  TabStopType,
  Tab,
  LeaderType,
  Table,
  TableRow,
  TableCell,
  BorderStyle,
  WidthType,
  VerticalAlignTable,
  ImageRun,
  TextWrappingType,
  TextWrappingSide,
  HorizontalPositionRelativeFrom,
  HorizontalPositionAlign,
  VerticalPositionRelativeFrom,
  Bookmark,
  InternalHyperlink,
  SimpleField,
  ImportedXmlComponent,
  FootnoteReferenceRun,
  EndnoteReferenceRun,
  Header,
  Footer,
  PageBreak,
  type ParagraphChild,
  type IParagraphOptions,
  type IPropertiesOptions,
  type IRunOptions,
} from 'docx'
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate'
import type { DraftDocument, DraftNode } from '../../document-model'
import { commentRangeBoundaries, readCommentThreads, type CommentThread } from '../../comments'
import { lineSpacingToTwips, pointsToTwips } from '../../paragraph'
import { normalizeHexColor } from '../../formatting'
import { readImageDataURL } from '../../images'
import { paragraphStyleId, stylesForDocument, type StyleFormat } from '../../styles'
import {
  updateReferenceFields,
  referenceTargets,
  safeLink,
  validTargetId,
  nodeText,
  captionLabels,
  validCaptionLabel,
} from '../../references'
import { readPageSetup } from '../../page-setup'
import { storiesFor, formatPage, type StoryVariant } from '../../stories'

const word = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'

const highlightMap: Record<string, (typeof HighlightColor)[keyof typeof HighlightColor]> = {
  '#ffff00': HighlightColor.YELLOW,
  '#00ff00': HighlightColor.GREEN,
  '#00ffff': HighlightColor.CYAN,
  '#ff00ff': HighlightColor.MAGENTA,
  '#0000ff': HighlightColor.BLUE,
  '#ff0000': HighlightColor.RED,
  '#000000': HighlightColor.BLACK,
  '#ffffff': HighlightColor.WHITE,
}

function marksFor(node: DraftNode): Omit<IRunOptions, 'text'> {
  const byType = new Map((node.marks || []).map((mark) => [mark.type, mark]))
  const textStyle = byType.get('textStyle')
  return {
    style:
      typeof byType.get('characterStyle')?.attrs?.styleId === 'string'
        ? String(byType.get('characterStyle')!.attrs!.styleId)
        : undefined,
    bold: textStyle?.attrs?.styleBold === false ? false : byType.has('bold') ? true : undefined,
    italics: textStyle?.attrs?.styleItalic === false ? false : byType.has('italic') ? true : undefined,
    strike: byType.has('strike') ? true : undefined,
    underline: byType.has('underline') ? { type: UnderlineType.SINGLE } : undefined,
    subScript: byType.has('subscript'),
    superScript: byType.has('superscript'),
    color: typeof textStyle?.attrs?.color === 'string' ? textStyle.attrs.color.slice(1) : undefined,
    size:
      typeof textStyle?.attrs?.fontSize === 'string'
        ? Math.round(Number.parseFloat(textStyle.attrs.fontSize) * 2)
        : undefined,
    font:
      typeof textStyle?.attrs?.fontFamily === 'string' ? textStyle.attrs.fontFamily.split(',')[0].trim() : undefined,
    highlight:
      typeof byType.get('highlight')?.attrs?.color === 'string'
        ? highlightMap[byType.get('highlight')!.attrs!.color as string]
        : undefined,
  }
}

function imageRun(node: DraftNode) {
  const attrs = node.attrs || {}
  let data = readImageDataURL(String(attrs.src || ''))
  const width = Math.max(1, Math.min(16384, Number(attrs.width) || 300))
  const height = Math.max(1, Math.min(16384, Number(attrs.height) || 150))
  if (data.mime === 'image/webp') data = readImageDataURL(String(attrs.fallbackSrc || ''))
  const common = {
    transformation: { width, height },
    altText: {
      name: `Draft image|${attrs.alignment || 'inline'}|${attrs.wrap || 'inline'}`,
      description: String(attrs.alt || ''),
      title: String(attrs.alt || ''),
    },
    floating:
      attrs.wrap && attrs.wrap !== 'inline'
        ? {
            horizontalPosition: {
              relative: HorizontalPositionRelativeFrom.COLUMN,
              align:
                attrs.wrap === 'square-right' || (attrs.wrap !== 'square-left' && attrs.alignment === 'right')
                  ? HorizontalPositionAlign.RIGHT
                  : attrs.wrap !== 'square-left' && attrs.alignment === 'center'
                    ? HorizontalPositionAlign.CENTER
                    : HorizontalPositionAlign.LEFT,
            },
            verticalPosition: { relative: VerticalPositionRelativeFrom.PARAGRAPH, offset: 0 },
            wrap: {
              type: attrs.wrap === 'top-bottom' ? TextWrappingType.TOP_AND_BOTTOM : TextWrappingType.SQUARE,
              side: attrs.wrap === 'square-right' ? TextWrappingSide.LEFT : TextWrappingSide.RIGHT,
            },
            allowOverlap: false,
          }
        : undefined,
  }
  if (data.mime === 'image/svg+xml') {
    const fallback = readImageDataURL(String(attrs.fallbackSrc || ''))
    return new ImageRun({ ...common, type: 'svg', data: data.bytes, fallback: { type: 'png', data: fallback.bytes } })
  }
  return new ImageRun({
    ...common,
    type: data.mime === 'image/jpeg' ? 'jpg' : data.mime === 'image/gif' ? 'gif' : 'png',
    data: data.bytes,
  })
}

function children(
  nodes: DraftNode[] | undefined,
  boundaries?: ReturnType<typeof commentRangeBoundaries>,
  commentNumbers?: Map<string, number>,
) {
  const result: ParagraphChild[] = []
  for (const node of nodes || []) {
    if (node.type === 'captionNumber' && validCaptionLabel(node.attrs?.label)) {
      const field = new SimpleField(`SEQ "${node.attrs.label}" \\* ARABIC`)
      field.addChildElement(new TextRun({ text: String(node.attrs.number || 1), ...marksFor(node) }))
      const runs: ParagraphChild[] = [
        ...(node.attrs.showLabel === false ? [] : [new TextRun({ text: `${node.attrs.label} `, ...marksFor(node) })]),
        field,
      ]
      result.push(
        ...(validTargetId(node.attrs.numberId) ? [new Bookmark({ id: node.attrs.numberId, children: runs })] : runs),
      )
      continue
    }
    if (node.type === 'storyField') {
      const field = String(node.attrs?.field)
      if (['PAGE', 'NUMPAGES', 'TITLE'].includes(field)) {
        const component = new SimpleField(field)
        component.addChildElement(
          new TextRun({ text: String(node.attrs?.label ?? (field === 'TITLE' ? '' : '1')), ...marksFor(node) }),
        )
        result.push(component)
      }
      continue
    }
    if (node.type === 'bookmark') {
      if (validTargetId(node.attrs?.id))
        result.push(new Bookmark({ id: node.attrs.id, children: children(node.content, boundaries, commentNumbers) }))
      else result.push(...children(node.content, boundaries, commentNumbers))
      continue
    }
    if (node.type === 'crossReference') {
      if (validTargetId(node.attrs?.targetId))
        result.push(
          new SimpleField(
            `${node.attrs.format === 'page' ? 'PAGEREF' : 'REF'} ${node.attrs.fieldTarget || node.attrs.targetId} \\h`,
            String(node.attrs?.label || ''),
          ),
        )
      else result.push(new TextRun(String(node.attrs?.label || '')))
      continue
    }
    if (node.type === 'noteReference') {
      const number = Math.max(1, Number(node.attrs?.number) || 1)
      const run = node.attrs?.kind === 'endnote' ? new EndnoteReferenceRun(number) : new FootnoteReferenceRun(number)
      result.push(validTargetId(node.attrs?.id) ? new Bookmark({ id: node.attrs.id, children: [run] }) : run)
      continue
    }
    if (node.type === 'image') {
      result.push(imageRun(node))
      continue
    }
    if (node.type === 'hardBreak') {
      result.push(new TextRun({ break: 1 }))
      continue
    }
    if (node.type === 'pageBreak') {
      result.push(new PageBreak())
      continue
    }
    if (node.type !== 'text') continue
    const boundary = boundaries?.get(node)
    for (const id of boundary?.start || []) {
      const number = commentNumbers?.get(id)
      if (number !== undefined)
        result.push(new ImportedXmlComponent('w:commentRangeStart', { 'w:id': String(number) }) as ParagraphChild)
    }
    const run = new TextRun({ text: node.text || '', ...marksFor(node) })
    const link = node.marks?.find((mark) => mark.type === 'link')
    const href = safeLink(link?.attrs?.href)
    result.push(
      href
        ? href.startsWith('#')
          ? new InternalHyperlink({ anchor: href.slice(1), children: [run] })
          : new ExternalHyperlink({ link: href, children: [run] })
        : run,
    )
    for (const id of boundary?.end || []) {
      const number = commentNumbers?.get(id)
      if (number !== undefined) {
        result.push(new ImportedXmlComponent('w:commentRangeEnd', { 'w:id': String(number) }) as ParagraphChild)
        result.push(
          new TextRun({ children: [new ImportedXmlComponent('w:commentReference', { 'w:id': String(number) })] }),
        )
      }
    }
  }
  return result
}

function spacing(attrs: DraftNode['attrs']) {
  const before = typeof attrs?.spacingBefore === 'number' ? attrs.spacingBefore : undefined
  const after = typeof attrs?.spacingAfter === 'number' ? attrs.spacingAfter : undefined
  const line = typeof attrs?.lineSpacing === 'number' ? attrs.lineSpacing : undefined
  return before !== undefined || after !== undefined || line !== undefined
    ? {
        before: pointsToTwips(before),
        after: pointsToTwips(after),
        line: lineSpacingToTwips(line),
        lineRule: Number.isFinite(line) ? LineRuleType.AUTO : undefined,
      }
    : undefined
}

function indent(attrs: DraftNode['attrs']) {
  const left = typeof attrs?.indentLeft === 'number' ? attrs.indentLeft : undefined
  const right = typeof attrs?.indentRight === 'number' ? attrs.indentRight : undefined
  const firstLine = typeof attrs?.indentFirstLine === 'number' ? attrs.indentFirstLine : undefined
  const hanging = typeof attrs?.indentHanging === 'number' ? attrs.indentHanging : undefined
  return left !== undefined || right !== undefined || firstLine !== undefined || hanging !== undefined
    ? {
        left: pointsToTwips(left),
        right: pointsToTwips(right),
        firstLine: pointsToTwips(firstLine),
        hanging: pointsToTwips(hanging),
      }
    : undefined
}

function paragraph(
  node: DraftNode,
  list?: { type: 'bulletList' | 'orderedList'; level: number },
  boundaries?: ReturnType<typeof commentRangeBoundaries>,
  commentNumbers?: Map<string, number>,
) {
  const numberedInline = (child: DraftNode): DraftNode => {
    const attrs =
      child.type === 'captionNumber' && validTargetId(node.attrs?.anchorId)
        ? { ...child.attrs, numberId: `${node.attrs.anchorId}_number` }
        : child.attrs
    const content = child.content?.map(numberedInline)
    if (attrs === child.attrs && content === child.content) return child
    return { ...child, ...(attrs ? { attrs } : {}), ...(content ? { content } : {}) }
  }
  const inline = node.content?.map(numberedInline)
  const heading = node.type === 'heading' ? Number(node.attrs?.level) : 0
  const headingLevels = [
    undefined,
    HeadingLevel.HEADING_1,
    HeadingLevel.HEADING_2,
    HeadingLevel.HEADING_3,
    HeadingLevel.HEADING_4,
    HeadingLevel.HEADING_5,
    HeadingLevel.HEADING_6,
  ] as const
  const alignmentMap = {
    left: AlignmentType.LEFT,
    center: AlignmentType.CENTER,
    right: AlignmentType.RIGHT,
    justify: AlignmentType.JUSTIFIED,
  }
  const alignedImage = node.content?.find((child) => child.type === 'image' && child.attrs?.alignment !== 'inline')
  const textAlign = alignedImage?.attrs?.alignment || node.attrs?.textAlign
  const alignment = typeof textAlign === 'string' ? alignmentMap[textAlign as keyof typeof alignmentMap] : undefined
  return new Paragraph({
    children: validTargetId(node.attrs?.anchorId)
      ? [new Bookmark({ id: node.attrs.anchorId, children: children(inline, boundaries, commentNumbers) })]
      : children(inline, boundaries, commentNumbers),
    heading: node.attrs?.styleId ? undefined : headingLevels[heading],
    style: paragraphStyleId(node),
    alignment,
    spacing: spacing(node.attrs),
    pageBreakBefore: Boolean(node.attrs?.pageBreakBefore),
    keepNext: typeof node.attrs?.keepNext === 'boolean' ? node.attrs.keepNext : undefined,
    keepLines: typeof node.attrs?.keepLines === 'boolean' ? node.attrs.keepLines : undefined,
    widowControl: typeof node.attrs?.widowControl === 'boolean' ? node.attrs.widowControl : undefined,
    indent: indent(node.attrs),
    tabStops: Array.isArray(node.attrs?.tabStops)
      ? node.attrs.tabStops.map((position) => ({ type: TabStopType.LEFT, position: pointsToTwips(position)! }))
      : undefined,
    bullet: list?.type === 'bulletList' ? { level: list.level } : undefined,
    numbering: list?.type === 'orderedList' ? { reference: 'draft-numbering', level: list.level } : undefined,
  } satisfies IParagraphOptions)
}

function exportTable(
  node: DraftNode,
  boundaries?: ReturnType<typeof commentRangeBoundaries>,
  commentNumbers?: Map<string, number>,
): Table {
  const rows = node.content || []
  const widths: number[] = []
  const occupied: number[] = []
  rows.forEach((row, rowIndex) => {
    let col = 0
    for (const cell of row.content || []) {
      while ((occupied[col] || 0) > rowIndex) col++
      const span = Number(cell.attrs?.colspan) || 1
      const cellWidths = cell.attrs?.colwidth
      for (let i = 0; i < span; i++) {
        widths[col + i] = (Array.isArray(cellWidths) ? cellWidths[i] : 0) || widths[col + i] || 96
        occupied[col + i] = rowIndex + (Number(cell.attrs?.rowspan) || 1)
      }
      col += span
    }
  })
  const border = (value: unknown) => {
    const css = typeof value === 'string' ? value : '1px solid #808080'
    const size = Number.parseFloat(css) || 0
    const colorValue = /#[\da-f]{6}|rgba?\([^)]+\)/i.exec(css)?.[0]
    const color = normalizeHexColor(colorValue || '')?.slice(1) || '808080'
    return {
      style: /none|hidden/.test(css) || !size ? BorderStyle.NIL : BorderStyle.SINGLE,
      size: Math.round(size * 6),
      color,
    }
  }
  const style = String(node.attrs?.style || '')
  return new Table({
    columnWidths: widths.map((width) => Math.round(width * 15)),
    width: { type: WidthType.DXA, size: widths.reduce((a, b) => a + b, 0) * 15 },
    alignment: style.includes('margin-left: auto')
      ? style.includes('margin-right: auto')
        ? AlignmentType.CENTER
        : AlignmentType.RIGHT
      : AlignmentType.LEFT,
    tableLook: { firstRow: rows[0]?.content?.every((cell) => cell.type === 'tableHeader') || false },
    rows: rows.map(
      (row) =>
        new TableRow({
          tableHeader: Boolean(row.attrs?.repeatHeader),
          children: (row.content || []).map((cell) => {
            const attrs = cell.attrs || {}
            const padding = Number.parseFloat(String(attrs.padding ?? '6')) * 15
            const cellWidths = Array.isArray(attrs.colwidth) ? attrs.colwidth : undefined
            return new TableCell({
              children: documentParagraphs(cell.content, undefined, 9360, boundaries, commentNumbers),
              columnSpan: Number(attrs.colspan) || 1,
              rowSpan: Number(attrs.rowspan) || 1,
              width: cellWidths ? { type: WidthType.DXA, size: cellWidths.reduce((a, b) => a + b, 0) * 15 } : undefined,
              shading:
                typeof attrs.backgroundColor === 'string' && normalizeHexColor(attrs.backgroundColor)
                  ? { fill: normalizeHexColor(attrs.backgroundColor)!.slice(1) }
                  : undefined,
              verticalAlign:
                attrs.verticalAlign === 'middle'
                  ? VerticalAlignTable.CENTER
                  : attrs.verticalAlign === 'bottom'
                    ? VerticalAlignTable.BOTTOM
                    : VerticalAlignTable.TOP,
              margins: { top: padding, right: padding, bottom: padding, left: padding },
              borders: {
                top: border(attrs.borderTop),
                right: border(attrs.borderRight),
                bottom: border(attrs.borderBottom),
                left: border(attrs.borderLeft),
              },
            })
          }),
        }),
    ),
  })
}

function documentParagraphs(
  nodes: DraftNode[] | undefined,
  list?: { type: 'bulletList' | 'orderedList'; level: number },
  bodyWidth = 9360,
  boundaries?: ReturnType<typeof commentRangeBoundaries>,
  commentNumbers?: Map<string, number>,
): Array<Paragraph | Table> {
  const result: Array<Paragraph | Table> = []
  for (const node of nodes || []) {
    if (node.type === 'bulletList' || node.type === 'orderedList') {
      for (const item of node.content || []) {
        const first = item.content?.find((child) => child.type === 'paragraph' || child.type === 'heading')
        if (first)
          result.push(
            paragraph(first, { type: node.type, level: list ? list.level + 1 : 0 }, boundaries, commentNumbers),
          )
        for (const nested of item.content || [])
          if (nested.type === 'bulletList' || nested.type === 'orderedList')
            result.push(
              ...documentParagraphs(
                [nested],
                { type: node.type, level: list ? list.level + 1 : 0 },
                bodyWidth,
                boundaries,
                commentNumbers,
              ),
            )
      }
    } else if (node.type === 'paragraph' || node.type === 'heading')
      result.push(paragraph(node, list, boundaries, commentNumbers))
    else if (node.type === 'table') result.push(exportTable(node, boundaries, commentNumbers))
    else if (node.type === 'tableOfContents') result.push(...tocParagraphs(node, bodyWidth))
  }
  return result
}

function tocParagraphs(node: DraftNode, bodyWidth: number): Paragraph[] {
  const min = Math.max(1, Math.min(6, Number(node.attrs?.minLevel) || 1))
  const max = Math.max(min, Math.min(6, Number(node.attrs?.maxLevel) || 3))
  const raw = (tag: string, attrs: Record<string, string>, text?: string) => {
    const component = new ImportedXmlComponent(tag, attrs)
    if (text) component.push(text)
    return new TextRun({ children: [component] })
  }
  const instruction = validCaptionLabel(node.attrs?.captionLabel)
    ? ` TOC \\c "${node.attrs.captionLabel}" \\h `
    : ` TOC \\o "${min}-${max}" \\h \\z \\u `
  const begin = [
    raw('w:fldChar', { 'w:fldCharType': 'begin', 'w:dirty': 'false' }),
    raw('w:instrText', { 'xml:space': 'preserve' }, instruction),
    raw('w:fldChar', { 'w:fldCharType': 'separate' }),
  ]
  const end = raw('w:fldChar', { 'w:fldCharType': 'end' })
  if (!node.content?.length) return [new Paragraph({ children: [...begin, end] })]
  return node.content.map(
    (entry, index) =>
      new Paragraph({
        indent: { left: (Math.max(1, Number(entry.attrs?.level) || 1) - 1) * 240 },
        tabStops: [{ type: TabStopType.RIGHT, position: bodyWidth, leader: LeaderType.DOT }],
        children: [
          ...(index ? [] : begin),
          ...(validTargetId(entry.attrs?.targetId)
            ? [new InternalHyperlink({ anchor: entry.attrs.targetId, children: [new TextRun(nodeText(entry))] })]
            : [new TextRun(nodeText(entry))]),
          new TextRun({ children: [new Tab()] }),
          ...(validTargetId(entry.attrs?.targetId)
            ? [new SimpleField(`PAGEREF ${entry.attrs.targetId} \\h`, String(entry.attrs.pageNumber || '?'))]
            : [new TextRun(String(entry.attrs?.pageNumber || '?'))]),
          ...(index === node.content!.length - 1 ? [end] : []),
        ],
      }),
  )
}

function escapeXML(value: string) {
  return value.replace(
    /[&<>"']/g,
    (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[character]!,
  )
}

function commentParts(threads: CommentThread[], commentNumbers: Map<string, number>) {
  const records: Array<{
    id: number
    author: string
    text: string
    paraId: string
    parent?: string
    done: boolean
  }> = []
  const paraId = (index: number) => (0x44520000 + index).toString(16).toUpperCase().slice(-8)
  let nextNumber = threads.length
  threads.forEach((thread, index) => {
    const parentPara = paraId(index + 1)
    records.push({
      id: index,
      author: thread.author,
      text: thread.text,
      paraId: parentPara,
      done: thread.resolved,
    })
    for (const reply of thread.replies)
      records.push({
        id: nextNumber++,
        author: reply.author,
        text: reply.text,
        paraId: paraId(nextNumber + 1),
        parent: parentPara,
        done: false,
      })
  })
  for (const record of records) {
    if (record.parent) continue
    const thread = threads.find((item) => commentNumbers.get(item.id) === record.id)
    if (thread) record.done = thread.resolved
  }
  const comments =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<w:comments xmlns:w="${word}" xmlns:w14="http://schemas.microsoft.com/office/word/2010/wordml">` +
    records
      .map(
        (record) =>
          `<w:comment w:id="${record.id}" w:author="${escapeXML(record.author)}"><w:p w14:paraId="${record.paraId}"><w:r><w:t xml:space="preserve">${escapeXML(record.text)}</w:t></w:r></w:p></w:comment>`,
      )
      .join('') +
    '</w:comments>'
  const extended =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<w15:commentsEx xmlns:w15="http://schemas.microsoft.com/office/word/2012/wordml">` +
    records
      .map(
        (record) =>
          `<w15:commentEx w15:paraId="${record.paraId}"${record.parent ? ` w15:paraIdParent="${record.parent}"` : ''}${record.done ? ' w15:done="1"' : ''}/>`,
      )
      .join('') +
    '</w15:commentsEx>'
  return { comments, extended }
}

function attachCommentParts(buffer: ArrayBuffer, threads: CommentThread[], commentNumbers: Map<string, number>) {
  const files = unzipSync(new Uint8Array(buffer))
  const parts = commentParts(threads, commentNumbers)
  files['word/comments.xml'] = strToU8(parts.comments)
  files['word/commentsExtended.xml'] = strToU8(parts.extended)
  const relsPath = 'word/_rels/document.xml.rels'
  const relationships = files[relsPath]
    ? strFromU8(files[relsPath])
    : '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"></Relationships>'
  files[relsPath] = strToU8(
    relationships.replace(
      '</Relationships>',
      '<Relationship Id="rIdDraftComments" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/comments" Target="comments.xml"/><Relationship Id="rIdDraftCommentsExtended" Type="http://schemas.microsoft.com/office/word/2018/wordml/commentsExtended" Target="commentsExtended.xml"/></Relationships>',
    ),
  )
  const contentTypesPath = '[Content_Types].xml'
  const contentTypes = strFromU8(files[contentTypesPath])
  files[contentTypesPath] = strToU8(
    contentTypes.replace(
      '</Types>',
      '<Override PartName="/word/comments.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.comments+xml"/><Override PartName="/word/commentsExtended.xml" ContentType="application/vnd.ms-word.commentsExt+xml"/></Types>',
    ),
  )
  const zipped = zipSync(files, { level: 6 })
  return zipped.buffer.slice(zipped.byteOffset, zipped.byteOffset + zipped.byteLength) as ArrayBuffer
}

export async function exportDocxArrayBuffer(input: DraftDocument, language?: string): Promise<ArrayBuffer> {
  const document = updateReferenceFields(input)
  const targets = referenceTargets(document)
  const annotate = (node: DraftNode) => {
    if (
      node.type === 'crossReference' &&
      node.attrs?.format === 'number' &&
      targets.some((target) => target.id === node.attrs!.targetId && target.kind === 'caption')
    )
      node.attrs = { ...node.attrs, fieldTarget: `${node.attrs.targetId}_number` }
    node.content?.forEach(annotate)
  }
  annotate(document)
  const commentThreads = readCommentThreads(document.attrs?.comments)
  const commentNumbers = new Map(commentThreads.map((thread, index) => [thread.id, index]))
  const boundaries = commentRangeBoundaries(
    document.content.filter((node) => node.type !== 'note'),
    new Set(commentNumbers.keys()),
  )
  const page = readPageSetup(document)
  const stories = storiesFor(page)
  const storyNode = (node: DraftNode): DraftNode => ({
    ...node,
    ...(node.type === 'storyField'
      ? {
          attrs: {
            ...node.attrs,
            label:
              node.attrs?.field === 'TITLE'
                ? stories.title
                : node.attrs?.field === 'PAGE'
                  ? formatPage(stories.start, stories.format)
                  : '1',
          },
        }
      : {}),
    content: node.content?.map(storyNode),
  })
  const storyParts = (kind: 'header' | 'footer') =>
    Object.fromEntries(
      (['default', 'first', 'even'] as StoryVariant[]).map((variant) => [
        variant,
        kind === 'header'
          ? new Header({ children: stories[kind][variant].map((node) => paragraph(storyNode(node))) })
          : new Footer({ children: stories[kind][variant].map((node) => paragraph(storyNode(node))) }),
      ]),
    )
  const definitions = stylesForDocument(document)
  const styleRun = (format: StyleFormat) => ({
    font: format.fontFamily?.split(',')[0],
    size: format.fontSize === undefined ? undefined : format.fontSize * 2,
    color: format.color?.slice(1),
    bold: format.bold,
    italics: format.italic,
  })
  const columns = Math.max(1, Math.min(3, Number(document.attrs?.columns) || 1))
  const options: IPropertiesOptions = {
    customProperties: [{ name: 'AllSuiteCaptionLabels', value: JSON.stringify(captionLabels(document, language)) }],
    title: stories.title,
    evenAndOddHeaderAndFooters: stories.differentEven,
    footnotes: Object.fromEntries(
      document.content
        .filter((node) => node.type === 'note' && node.attrs?.kind !== 'endnote')
        .map((node) => [
          String(node.attrs?.number),
          { children: (node.content || []).map((child) => paragraph(child)) },
        ]),
    ),
    endnotes: Object.fromEntries(
      document.content
        .filter((node) => node.type === 'note' && node.attrs?.kind === 'endnote')
        .map((node) => [
          String(node.attrs?.number),
          { children: (node.content || []).map((child) => paragraph(child)) },
        ]),
    ),
    features: { updateFields: false },
    sections: [
      {
        properties: {
          titlePage: stories.differentFirst,
          column: { count: columns, equalWidth: true },
          page: {
            pageNumbers: { start: stories.start, formatType: stories.format },
            // docx swaps width/height when writing landscape; our model is already oriented.
            size: {
              width: page.orientation === 'landscape' ? page.height : page.width,
              height: page.orientation === 'landscape' ? page.width : page.height,
              orientation: page.orientation,
            },
            margin: {
              top: page.top,
              right: page.right,
              bottom: page.bottom,
              left: page.left,
              header: page.header,
              footer: page.footer,
            },
          },
        },
        headers: storyParts('header'),
        footers: storyParts('footer'),
        children: documentParagraphs(
          document.content.filter((node) => node.type !== 'note'),
          undefined,
          page.width - page.left - page.right,
          boundaries,
          commentNumbers,
        ),
      },
    ],
    numbering: {
      config: [
        {
          reference: 'draft-numbering',
          levels: Array.from({ length: 9 }, (_, level) => ({
            level,
            format: LevelFormat.DECIMAL,
            text: `%${level + 1}.`,
            alignment: AlignmentType.LEFT,
          })),
        },
      ],
    },
    styles: {
      default: { document: { run: { language: language ? { value: language } : undefined } } },
      paragraphStyles: definitions
        .filter((style) => style.kind === 'paragraph')
        .map((style) => ({
          id: style.id,
          name: style.name,
          basedOn: style.basedOn,
          next: style.next,
          quickFormat: true,
          run: styleRun(style.format),
          paragraph: {
            alignment: style.format.textAlign === 'justify' ? AlignmentType.JUSTIFIED : style.format.textAlign,
            spacing: spacing(style.format),
            keepNext: style.format.keepNext,
            keepLines: style.format.keepLines,
            widowControl: style.format.widowControl,
            indent: indent(style.format),
            outlineLevel: style.heading ? style.heading - 1 : undefined,
          },
        })),
      characterStyles: definitions
        .filter((style) => style.kind === 'character')
        .map((style) => ({
          id: style.id,
          name: style.name,
          basedOn: style.basedOn,
          run: styleRun(style.format),
        })),
    },
  }
  const file = new Document(options)
  const result = await Packer.toArrayBuffer(file)
  return commentThreads.length ? attachCommentParts(result, commentThreads, commentNumbers) : result
}

export async function exportDocx(document: DraftDocument, language?: string): Promise<Blob> {
  return new Blob([await exportDocxArrayBuffer(document, language)], {
    type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  })
}
