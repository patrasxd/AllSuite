import { createCanvas, DOMMatrix, Path2D, ImageData } from '@napi-rs/canvas'
import { writeFileSync } from 'node:fs'

export async function inspectPDF(bytes: Uint8Array, prefix?: string) {
  Object.assign(globalThis, { DOMMatrix, Path2D, ImageData })
  const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs')
  const loading = getDocument({ data: new Uint8Array(bytes), useSystemFonts: false, isEvalSupported: false })
  const document = await loading.promise
  try {
    const pages = []
    for (let index = 1; index <= document.numPages; index++) {
      const page = await document.getPage(index),
        viewport = page.getViewport({ scale: 96 / 72 })
      const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height))
      await page.render({ canvas: canvas as never, canvasContext: canvas.getContext('2d') as never, viewport }).promise
      const png = canvas.toBuffer('image/png')
      if (prefix) writeFileSync(`${prefix}-${index}.png`, png)
      const content = await page.getTextContent()
      pages.push({
        png,
        text: content.items.map((item) => ('str' in item ? item.str : '')).join(''),
        glyphs: content.items.flatMap((item) => ('str' in item ? [{ text: item.str, transform: item.transform }] : [])),
        links: await page.getAnnotations(),
        width: viewport.width,
        height: viewport.height,
      })
      page.cleanup()
    }
    return { pages, outline: await document.getOutline(), title: await document.getMetadata() }
  } finally {
    await loading.destroy()
  }
}
