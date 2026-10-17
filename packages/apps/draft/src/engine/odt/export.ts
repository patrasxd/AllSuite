import { strToU8, zipSync } from 'fflate'
import type { DraftDocument, DraftMark, DraftNode } from '../document-model'
import { readImageDataURL } from '../images'
import { paragraphStyleId, stylesForDocument, type DocumentStyle, type StyleFormat } from '../styles'
import { readPageSetup, twipsToMM } from '../page-setup'

const mimeType = 'application/vnd.oasis.opendocument.text'
const ns = {
  office: 'urn:oasis:names:tc:opendocument:xmlns:office:1.0',
  style: 'urn:oasis:names:tc:opendocument:xmlns:style:1.0',
  text: 'urn:oasis:names:tc:opendocument:xmlns:text:1.0',
  table: 'urn:oasis:names:tc:opendocument:xmlns:table:1.0',
  draw: 'urn:oasis:names:tc:opendocument:xmlns:drawing:1.0',
  fo: 'urn:oasis:names:tc:opendocument:xmlns:xsl-fo-compatible:1.0',
  xlink: 'http://www.w3.org/1999/xlink',
  svg: 'urn:oasis:names:tc:opendocument:xmlns:svg-compatible:1.0',
  dc: 'http://purl.org/dc/elements/1.1/',
  meta: 'urn:oasis:names:tc:opendocument:xmlns:meta:1.0',
}
const esc = (value: unknown) =>
  String(value ?? '').replace(
    /[&<>"']/g,
    (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[character]!,
  )
const styleName = (id: unknown) => {
  const value = String(id || 'Normal')
    .replace(/[^A-Za-z0-9_-]/g, '_')
    .replace(/^[^A-Za-z_]+/, '')
  return value.slice(0, 160) || 'Normal'
}
const xmlLength = (points: number) => `${(points / 72).toFixed(3).replace(/0+$/, '').replace(/\.$/, '')}in`

function paragraphProperties(format: StyleFormat) {
  const attrs: string[] = []
  const length = (key: keyof StyleFormat, xmlName: string) => {
    const value = format[key]
    if (typeof value === 'number' && Number.isFinite(value)) attrs.push(`fo:${xmlName}="${value}pt"`)
  }
  length('spacingBefore', 'margin-top')
  length('spacingAfter', 'margin-bottom')
  length('indentLeft', 'margin-left')
  length('indentRight', 'margin-right')
  if (typeof format.indentFirstLine === 'number') attrs.push(`fo:text-indent="${format.indentFirstLine}pt"`)
  else if (typeof format.indentHanging === 'number') attrs.push(`fo:text-indent="-${format.indentHanging}pt"`)
  if (format.textAlign) attrs.push(`fo:text-align="${format.textAlign}"`)
  if (typeof format.lineSpacing === 'number') attrs.push(`fo:line-height="${Math.round(format.lineSpacing * 100)}%"`)
  if (format.keepNext) attrs.push('fo:keep-with-next="always"')
  if (format.keepLines) attrs.push('fo:keep-together="always"')
  return attrs.length ? `<style:paragraph-properties ${attrs.join(' ')}/>` : ''
}
function textProperties(format: StyleFormat) {
  const attrs: string[] = []
  if (format.fontFamily) attrs.push(`style:font-name="${esc(format.fontFamily.split(',')[0].trim())}"`)
  if (typeof format.fontSize === 'number') attrs.push(`fo:font-size="${format.fontSize}pt"`)
  if (format.color) attrs.push(`fo:color="${esc(format.color)}"`)
  if (format.bold !== undefined) attrs.push(`fo:font-weight="${format.bold ? 'bold' : 'normal'}"`)
  if (format.italic !== undefined) attrs.push(`fo:font-style="${format.italic ? 'italic' : 'normal'}"`)
  return attrs.length ? `<style:text-properties ${attrs.join(' ')}/>` : ''
}
function styleDefinition(style: DocumentStyle) {
  const family = style.kind === 'character' ? 'text' : 'paragraph'
  const parent = style.basedOn ? ` style:parent-style-name="${esc(styleName(style.basedOn))}"` : ''
  return `<style:style style:name="${esc(styleName(style.id))}" style:family="${family}"${parent}>${family === 'paragraph' ? paragraphProperties(style.format) : ''}${textProperties(style.format)}</style:style>`
}

type Context = {
  images: Record<string, Uint8Array>
  imageTypes: Array<{ path: string; mime: string }>
  inlineStyles: string[]
}
function runStyle(marks: DraftMark[], context: Context) {
  const values: StyleFormat = {}
  const colors: string[] = []
  for (const mark of marks) {
    if (mark.type === 'bold') values.bold = true
    if (mark.type === 'italic') values.italic = true
    if (mark.type === 'textStyle') {
      if (typeof mark.attrs?.fontFamily === 'string') values.fontFamily = mark.attrs.fontFamily
      if (typeof mark.attrs?.fontSize === 'string') values.fontSize = Number.parseFloat(mark.attrs.fontSize)
      if (typeof mark.attrs?.color === 'string') values.color = mark.attrs.color
    }
    if (mark.type === 'highlight' && typeof mark.attrs?.color === 'string') colors.push(mark.attrs.color)
  }
  const byType = new Set(marks.map((mark) => mark.type))
  const attrs: string[] = []
  if (values.fontFamily) attrs.push(`style:font-name="${esc(values.fontFamily.split(',')[0].trim())}"`)
  if (values.fontSize) attrs.push(`fo:font-size="${values.fontSize}pt"`)
  if (values.color) attrs.push(`fo:color="${esc(values.color)}"`)
  if (byType.has('bold')) attrs.push('fo:font-weight="bold"')
  if (byType.has('italic')) attrs.push('fo:font-style="italic"')
  if (byType.has('underline')) attrs.push('style:text-underline-style="solid"')
  if (byType.has('strike')) attrs.push('style:text-line-through-style="solid"')
  if (byType.has('subscript')) attrs.push('style:text-position="sub 58%"')
  if (byType.has('superscript')) attrs.push('style:text-position="super 58%"')
  if (colors[0]) attrs.push(`fo:background-color="${esc(colors[0])}"`)
  const characterStyle = marks.find((mark) => mark.type === 'characterStyle')?.attrs?.styleId
  if (characterStyle) return styleName(characterStyle)
  if (!attrs.length) return undefined
  const id = `DraftRun${context.inlineStyles.length + 1}`
  context.inlineStyles.push(
    `<style:style style:name="${id}" style:family="text"><style:text-properties ${attrs.join(' ')}/></style:style>`,
  )
  return id
}
function textContent(value: string) {
  const parts: string[] = []
  let ordinary = ''
  const flush = () => {
    if (ordinary) parts.push(esc(ordinary))
    ordinary = ''
  }
  for (let index = 0; index < value.length;) {
    const character = value[index]
    if (character === '\n') {
      flush()
      parts.push('<text:line-break/>')
      index++
    } else if (character === '\t') {
      flush()
      parts.push('<text:tab/>')
      index++
    } else if (character === ' ') {
      let end = index + 1
      while (value[end] === ' ') end++
      const count = end - index
      if (count === 1) ordinary += ' '
      else {
        flush()
        parts.push(`<text:s text:c="${count}"/>`)
      }
      index = end
    } else {
      ordinary += character
      index++
    }
  }
  flush()
  return parts.join('')
}
function imagePath(node: DraftNode, context: Context) {
  try {
    const source = String(node.attrs?.src || '')
    let image = readImageDataURL(source)
    if (image.mime === 'image/webp') image = readImageDataURL(String(node.attrs?.fallbackSrc || ''))
    const ext =
      image.mime === 'image/jpeg'
        ? 'jpg'
        : image.mime === 'image/gif'
          ? 'gif'
          : image.mime === 'image/svg+xml'
            ? 'svg'
            : 'png'
    const path = `Pictures/image-${context.imageTypes.length + 1}.${ext}`
    context.images[path] = image.bytes
    context.imageTypes.push({ path, mime: image.mime })
    return path
  } catch {
    return undefined
  }
}
function inline(nodes: DraftNode[] | undefined, context: Context): string {
  return (nodes || [])
    .map((node) => {
      if (node.type === 'text') {
        const value = textContent(node.text || '')
        const marks = node.marks || []
        const style = runStyle(marks, context)
        const content = style ? `<text:span text:style-name="${esc(style)}">${value}</text:span>` : value
        const href = marks.find((mark) => mark.type === 'link')?.attrs?.href
        return typeof href === 'string' && /^(https?:|mailto:|tel:)/i.test(href)
          ? `<text:a xlink:href="${esc(href)}" xlink:type="simple">${content}</text:a>`
          : content
      }
      if (node.type === 'hardBreak') return '<text:line-break/>'
      if (node.type === 'image') {
        const path = imagePath(node, context)
        if (!path) return textContent(String(node.attrs?.alt || '[Image]'))
        const width = Math.max(1, Math.min(16384, Number(node.attrs?.width) || 300))
        const height = Math.max(1, Math.min(16384, Number(node.attrs?.height) || 150))
        return `<draw:frame draw:style-name="DraftImage" draw:name="${esc(node.attrs?.alt || '')}" text:anchor-type="as-char" svg:width="${xmlLength((width / 96) * 72)}" svg:height="${xmlLength((height / 96) * 72)}"><svg:title>${esc(node.attrs?.alt || '')}</svg:title><draw:image xlink:href="${path}" xlink:type="simple" xlink:show="embed" xlink:actuate="onLoad"/></draw:frame>`
      }
      if (node.type === 'bookmark')
        return `<text:bookmark text:name="${esc(node.attrs?.id)}"/>${inline(node.content, context)}`
      if (node.type === 'captionNumber')
        return textContent(
          `${node.attrs?.showLabel === false ? '' : `${node.attrs?.label || 'Figure'} `}${node.attrs?.number || 1}`,
        )
      if (node.type === 'crossReference') return textContent(String(node.attrs?.label || '[Missing reference]'))
      if (node.type === 'noteReference') return textContent(String(node.attrs?.number || 1))
      if (node.type === 'mathInline') return textContent(String(node.attrs?.latex || ''))
      if (node.type === 'tocEntry')
        return `${inline(node.content, context)}<text:tab/>${textContent(String(node.attrs?.pageNumber || '?'))}`
      return inline(node.content, context)
    })
    .join('')
}
function paragraph(node: DraftNode, context: Context, heading = 0, anchor = '') {
  const id = node.type === 'codeBlock' ? 'Code' : paragraphStyleId(node)
  const style = styleName(id)
  const outline = heading ? ` text:outline-level="${heading}"` : ''
  const name = heading ? 'h' : 'p'
  const mark = anchor || node.attrs?.anchorId
  const anchored =
    typeof mark === 'string' && /^[A-Za-z_][\w-]{0,159}$/.test(mark)
      ? `<text:bookmark-start text:name="${esc(mark)}"/>${inline(node.content, context)}<text:bookmark-end text:name="${esc(mark)}"/>`
      : inline(node.content, context)
  return `<text:${name} text:style-name="${esc(style)}"${outline}>${anchored}</text:${name}>`
}
function list(node: DraftNode, context: Context): string {
  const name = node.type === 'orderedList' ? 'DraftNumbers' : 'DraftBullets'
  const items = (node.content || [])
    .filter((item) => item.type === 'listItem')
    .map(
      (item) =>
        `<text:list-item>${(item.content || []).map((child) => block(child, context)).join('')}</text:list-item>`,
    )
  return `<text:list text:style-name="${name}">${items.join('')}</text:list>`
}
function tableXml(node: DraftNode, context: Context): string {
  const tableRows = (node.content || []).filter((row) => row.type === 'tableRow')
  const rows = tableRows.map((row) => {
    const cells = (row.content || [])
      .filter((cell) => ['tableCell', 'tableHeader'].includes(cell.type))
      .map((cell) => {
        const span = Math.max(1, Math.min(100, Number(cell.attrs?.colspan) || 1))
        return `<table:table-cell office:value-type="string"${span > 1 ? ` table:number-columns-spanned="${span}"` : ''}>${(cell.content || []).map((child) => block(child, context)).join('')}${Array.from({ length: span - 1 }, () => '<table:covered-table-cell/>').join('')}</table:table-cell>`
      })
    return `<table:table-row>${cells.join('')}</table:table-row>`
  })
  const headerCount = tableRows.findIndex((row) => (row.content || []).some((cell) => cell.type !== 'tableHeader'))
  const split = headerCount < 0 ? rows.length : headerCount
  const headerRows = rows.slice(0, split).join('')
  const bodyRows = rows.slice(split).join('')
  return `<table:table table:name="DraftTable">${headerRows ? `<table:table-header-rows>${headerRows}</table:table-header-rows>` : ''}${bodyRows}</table:table>`
}
function block(node: DraftNode, context: Context): string {
  if (node.type === 'paragraph') return paragraph(node, context)
  if (node.type === 'heading') return paragraph(node, context, Math.max(1, Math.min(6, Number(node.attrs?.level) || 1)))
  if (node.type === 'codeBlock') return paragraph(node, context)
  if (node.type === 'bulletList' || node.type === 'orderedList') return list(node, context)
  if (node.type === 'table') return tableXml(node, context)
  if (node.type === 'mathBlock')
    return `<text:p text:style-name="Code">${textContent(String(node.attrs?.latex || ''))}</text:p>`
  if (node.type === 'pageBreak') return '<text:p text:style-name="DraftPageBreak"/>'
  if (node.type === 'horizontalRule') return '<text:p text:style-name="DraftRule">────────────────────────</text:p>'
  if (node.type === 'blockquote')
    return `<text:section text:style-name="DraftQuote">${(node.content || []).map((child) => block(child, context)).join('')}</text:section>`
  if (node.type === 'hardBreak') return '<text:p><text:line-break/></text:p>'
  if (node.type === 'image') return `<text:p>${inline([node], context)}</text:p>`
  if (node.type === 'note')
    return `<text:p>${(node.content || []).map((child) => inline(child.content, context)).join(' ')}</text:p>`
  if (node.type === 'tableOfContents')
    return `<text:section text:style-name="DraftToc">${(node.content || []).map((entry) => paragraph(entry, context)).join('')}</text:section>`
  if (node.type === 'text') return `<text:p>${inline([node], context)}</text:p>`
  return (node.content || []).map((child) => block(child, context)).join('')
}
function pageStyle(document: DraftDocument) {
  const page = readPageSetup(document)
  const dimension = (value: number) => `${twipsToMM(value).toFixed(2).replace(/0+$/, '').replace(/\.$/, '')}mm`
  return `<style:page-layout style:name="DraftPage"><style:page-layout-properties fo:page-width="${dimension(page.width)}" fo:page-height="${dimension(page.height)}" fo:margin-top="${dimension(page.top)}" fo:margin-right="${dimension(page.right)}" fo:margin-bottom="${dimension(page.bottom)}" fo:margin-left="${dimension(page.left)}"/></style:page-layout>`
}
function manifest(context: Context) {
  return `<?xml version="1.0" encoding="UTF-8"?><manifest:manifest xmlns:manifest="urn:oasis:names:tc:opendocument:xmlns:manifest:1.0" manifest:version="1.3"><manifest:file-entry manifest:full-path="/" manifest:media-type="${mimeType}"/><manifest:file-entry manifest:full-path="content.xml" manifest:media-type="text/xml"/><manifest:file-entry manifest:full-path="styles.xml" manifest:media-type="text/xml"/><manifest:file-entry manifest:full-path="meta.xml" manifest:media-type="text/xml"/>${context.imageTypes.map(({ path, mime }) => `<manifest:file-entry manifest:full-path="${esc(path)}" manifest:media-type="${esc(mime)}"/>`).join('')}</manifest:manifest>`
}

export function exportOdt(document: DraftDocument, language = 'en-US'): Uint8Array {
  const context: Context = { images: {}, imageTypes: [], inlineStyles: [] }
  const definitions = stylesForDocument(document)
  const content = document.content
    .filter((node) => node.type !== 'note')
    .map((node) => block(node, context))
    .join('')
  const styleXml = definitions.map(styleDefinition).join('')
  const contentXml = `<?xml version="1.0" encoding="UTF-8"?><office:document-content xmlns:office="${ns.office}" xmlns:style="${ns.style}" xmlns:text="${ns.text}" xmlns:table="${ns.table}" xmlns:draw="${ns.draw}" xmlns:fo="${ns.fo}" xmlns:xlink="${ns.xlink}" xmlns:svg="${ns.svg}" office:version="1.3"><office:font-face-decls/><office:automatic-styles>${styleXml}${context.inlineStyles.join('')}<text:list-style style:name="DraftBullets"><text:list-level-style-bullet text:level="1" text:bullet-char="•"/></text:list-style><text:list-style style:name="DraftNumbers"><text:list-level-style-number text:level="1" style:num-format="1" style:num-suffix="."/></text:list-style><style:style style:name="DraftPageBreak" style:family="paragraph"><style:paragraph-properties fo:break-before="page"/></style:style><style:style style:name="DraftRule" style:family="paragraph"><style:paragraph-properties fo:border-bottom="0.6pt solid #808080"/></style:style><style:style style:name="DraftQuote" style:family="section"/><style:style style:name="DraftToc" style:family="section"/></office:automatic-styles><office:body><office:text>${content}</office:text></office:body></office:document-content>`
  const page = pageStyle(document)
  const stylesXml = `<?xml version="1.0" encoding="UTF-8"?><office:document-styles xmlns:office="${ns.office}" xmlns:style="${ns.style}" xmlns:text="${ns.text}" xmlns:fo="${ns.fo}" office:version="1.3"><office:font-face-decls/><office:styles><style:default-style style:family="paragraph"><style:text-properties fo:language="${esc(language.slice(0, 35))}"/></style:default-style></office:styles><office:automatic-styles>${page}</office:automatic-styles><office:master-styles><style:master-page style:name="Standard" style:page-layout-name="DraftPage"/></office:master-styles></office:document-styles>`
  const metaXml = `<?xml version="1.0" encoding="UTF-8"?><office:document-meta xmlns:office="${ns.office}" xmlns:meta="${ns.meta}" xmlns:dc="${ns.dc}" office:version="1.3"><office:meta><dc:language>${esc(language)}</dc:language></office:meta></office:document-meta>`
  const files: Record<string, Uint8Array> = {
    mimetype: strToU8(mimeType),
    'META-INF/manifest.xml': strToU8(manifest(context)),
    'content.xml': strToU8(contentXml),
    'styles.xml': strToU8(stylesXml),
    'meta.xml': strToU8(metaXml),
    ...context.images,
  }
  // ODF requires mimetype as the first, uncompressed ZIP member. level 0 keeps it stored.
  return zipSync(files, { level: 0 })
}
