import {
  PDFDocument,
  PDFName,
  PDFHexString,
  PDFString,
  PDFDict,
  rgb,
  pushGraphicsState,
  popGraphicsState,
  rectangle,
  clip,
  endPath,
  concatTransformationMatrix,
  type PDFFont,
} from 'pdf-lib'
import { create } from 'fontkit'
import type { PrintLayout, Box } from './print-layout'
import type { ExportFont } from './export/model'
import { safeLink } from './references'

const adapter: Parameters<PDFDocument['registerFontkit']>[0] = {
  create(bytes) {
    const font = create(bytes),
      subset = font.createSubset.bind(font)
    font.createSubset = () => {
      const result = subset()
      // Fontkit 2 exposes synchronous encode; pdf-lib's older interface expects an event stream.
      result.encodeStream = () => {
        const handlers: Record<string, (data?: Uint8Array | Error) => void> = {}
        const stream = {
          on(event: string, handler: (data?: Uint8Array | Error) => void) {
            handlers[event] = handler
            return stream
          },
        }
        queueMicrotask(() => {
          try {
            handlers.data?.(result.encode())
            handlers.end?.()
          } catch (error) {
            handlers.error?.(error as Error)
          }
        })
        return stream as ReturnType<typeof result.encodeStream>
      }
      return result
    }
    return font
  },
}
const color = (value: string) => {
  const hex = /^#([\da-f]{6})$/i.exec(value)
  const values = hex
    ? [0, 2, 4].map((index) => parseInt(hex[1].slice(index, index + 2), 16))
    : (value.match(/[\d.]+/g) || ['0', '0', '0']).slice(0, 3).map(Number)
  return rgb(...(values.map((value) => Math.max(0, Math.min(1, value / 255))) as [number, number, number]))
}
const dataBytes = (source: string) =>
  Uint8Array.from(atob(source.slice(source.indexOf(',') + 1)), (char) => char.charCodeAt(0))

/** Vector, selectable PDF using the already-resolved editor page coordinates. No PDF reflow. */
export async function exportPaginatedPDF(
  layout: PrintLayout,
  assets: ExportFont[],
  signal?: AbortSignal,
): Promise<Uint8Array> {
  const pdf = await PDFDocument.create()
  pdf.registerFontkit(adapter)
  pdf.setTitle(layout.title)
  pdf.setLanguage(layout.language)
  pdf.setCreator('AllSuite Draft')
  pdf.setProducer('AllSuite Draft')
  const fonts = new Map<string, PDFFont>(),
    images = new Map<string, Awaited<ReturnType<typeof pdf.embedPng>>>()
  const font = async (family: string, bold: boolean, italic: boolean, text: string) => {
    const candidates = assets.filter(
      (asset) =>
        asset.family === family &&
        asset.weight === (bold ? 700 : 400) &&
        asset.style === (italic ? 'italic' : 'normal'),
    )
    for (const asset of candidates) {
      const key = `${family}:${asset.weight}:${asset.style}:${asset.subset}`
      let loaded = fonts.get(key)
      if (!loaded) {
        loaded = await pdf.embedFont(dataBytes(asset.source), { subset: true })
        fonts.set(key, loaded)
      }
      const characters = new Set(loaded.getCharacterSet())
      if (Array.from(text).every((char) => characters.has(char.codePointAt(0)!))) return loaded
    }
    throw new Error(`Font glyph unavailable: ${family} ${text}`)
  }
  const pages = layout.pages.map(() => pdf.addPage([layout.width * 0.75, layout.height * 0.75]))
  for (let index = 0; index < pages.length; index++) {
    if (signal?.aborted) throw new DOMException('Canceled', 'AbortError')
    const page = pages[index],
      height = page.getHeight()
    const coords = (box: Box) => ({
      x: box.x * 0.75,
      y: height - (box.y + box.height) * 0.75,
      width: box.width * 0.75,
      height: box.height * 0.75,
    })
    for (const item of layout.pages[index].items) {
      page.pushOperators(pushGraphicsState())
      if (item.clip) {
        const c = coords(item.clip)
        page.pushOperators(rectangle(c.x, c.y, c.width, c.height), clip(), endPath())
      }
      if (item.kind === 'rect') {
        if (item.dash)
          page.drawLine({
            start: { x: item.x * 0.75, y: height - item.y * 0.75 },
            end: {
              x: (item.x + (item.width > item.height ? item.width : 0)) * 0.75,
              y: height - (item.y + (item.height >= item.width ? item.height : 0)) * 0.75,
            },
            thickness: Math.min(item.width, item.height) * 0.75,
            dashArray: item.dash === 'dotted' ? [0.75, 1.5] : [3, 2.25],
            color: color(item.color),
          })
        else page.drawRectangle({ ...coords(item), color: color(item.color) })
      } else if (item.kind === 'image') {
        let image = images.get(item.source)
        if (!image) {
          image = await pdf.embedPng(dataBytes(item.source))
          images.set(item.source, image)
        }
        page.drawImage(image, coords(item))
      } else {
        const face = await font(item.family, item.bold, item.italic, item.text),
          size = item.size * 0.75
        const naturalWidth = face.widthOfTextAtSize(item.text, size),
          scale = naturalWidth ? (item.width * 0.75) / naturalWidth : 1
        page.pushOperators(concatTransformationMatrix(scale, 0, 0, 1, item.x * 0.75, height - item.baseline * 0.75))
        page.drawText(item.text, { x: 0, y: 0, size, font: face, color: color(item.color) })
        if (item.underline)
          page.drawLine({
            start: { x: 0, y: -size * 0.12 },
            end: { x: naturalWidth, y: -size * 0.12 },
            thickness: 0.5,
            color: color(item.color),
          })
        if (item.strike)
          page.drawLine({
            start: { x: 0, y: size * 0.3 },
            end: { x: naturalWidth, y: size * 0.3 },
            thickness: 0.5,
            color: color(item.color),
          })
      }
      page.pushOperators(popGraphicsState())
    }
    for (const link of layout.pages[index].links) {
      if (!safeLink(link.href)) continue
      const box = coords(link),
        target = layout.destinations[link.href.slice(1)]
      if (link.href.startsWith('#') && !target) continue
      const annotation = pdf.context.obj({
        Type: 'Annot',
        Subtype: 'Link',
        Rect: [box.x, box.y, box.x + box.width, box.y + box.height],
        Border: [0, 0, 0],
        ...(link.href.startsWith('#')
          ? { Dest: [pages[target.page].ref, PDFName.of('XYZ'), target.x * 0.75, height - target.y * 0.75, null] }
          : { A: { Type: 'Action', S: 'URI', URI: PDFString.of(link.href) } }),
      })
      page.node.addAnnot(pdf.context.register(annotation))
    }
    // Yield between physical pages; export does not monopolize the UI on long documents.
    if (index % 10 === 9) await new Promise((resolve) => setTimeout(resolve, 0))
  }
  if (layout.headings.length) {
    const root = pdf.context.obj({ Type: 'Outlines' }),
      rootRef = pdf.context.register(root)
    const stack: Array<{ level: number; dict: PDFDict; ref: typeof rootRef; children: Array<typeof rootRef> }> = [
      { level: 0, dict: root, ref: rootRef, children: [] },
    ]
    for (const heading of layout.headings) {
      while (stack.length > 1 && stack[stack.length - 1].level >= heading.level) stack.pop()
      const parent = stack[stack.length - 1],
        dict = pdf.context.obj({
          Title: PDFHexString.fromText(heading.title),
          Parent: parent.ref,
          Dest: [
            pages[heading.page].ref,
            PDFName.of('XYZ'),
            heading.x * 0.75,
            (layout.height - heading.y) * 0.75,
            null,
          ],
        }),
        ref = pdf.context.register(dict)
      const previous = parent.children.at(-1)
      if (previous) {
        dict.set(PDFName.of('Prev'), previous)
        pdf.context.lookup(previous, PDFDict).set(PDFName.of('Next'), ref)
      } else parent.dict.set(PDFName.of('First'), ref)
      parent.dict.set(PDFName.of('Last'), ref)
      parent.children.push(ref)
      for (const ancestor of stack) {
        const count = ancestor.dict.get(PDFName.of('Count'))
        ancestor.dict.set(PDFName.of('Count'), pdf.context.obj((count ? Number(count.toString()) : 0) + 1))
      }
      stack.push({ level: heading.level, dict, ref, children: [] })
    }
    pdf.catalog.set(PDFName.of('Outlines'), rootRef)
    pdf.catalog.set(PDFName.of('PageMode'), PDFName.of('UseOutlines'))
  }
  return pdf.save({ useObjectStreams: false })
}
