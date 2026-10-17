import {
  bytesToDataURL,
  imageMime,
  imageSize,
  readImageDataURL,
  sanitizeSVG,
  type ImageAttributes,
  type ImageOptions,
} from './images'
import type { DraftDocument, UnsupportedContent } from './document-model'
import { readPageSetup } from './page-setup'

async function decode(
  blob: Blob,
): Promise<{ source: CanvasImageSource; width: number; height: number; release: () => void }> {
  if (typeof createImageBitmap === 'function') {
    try {
      const bitmap = await createImageBitmap(blob)
      return { source: bitmap, width: bitmap.width, height: bitmap.height, release: () => bitmap.close() }
    } catch {
      /* SVG support varies; the local image decoder is the fallback. */
    }
  }
  const url = URL.createObjectURL(blob)
  try {
    const image = new Image()
    image.src = url
    await image.decode()
    return {
      source: image,
      width: image.naturalWidth,
      height: image.naturalHeight,
      release: () => URL.revokeObjectURL(url),
    }
  } catch (error) {
    URL.revokeObjectURL(url)
    throw error
  }
}

async function png(source: CanvasImageSource, width: number, height: number) {
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  try {
    const context = canvas.getContext('2d')
    if (!context) throw new Error('Image processing unavailable')
    context.drawImage(source, 0, 0, width, height)
    const blob = await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob((result) => (result ? resolve(result) : reject(new Error('Unable to encode image'))), 'image/png'),
    )
    return bytesToDataURL(new Uint8Array(await blob.arrayBuffer()), 'image/png')
  } finally {
    canvas.width = 0
    canvas.height = 0
  }
}

export async function prepareImage(
  file: Blob,
  options: ImageOptions,
  alt = '',
  signal?: AbortSignal,
): Promise<ImageAttributes> {
  if (file.size > 50_000_000) throw new Error('Image exceeds 50 MB')
  let bytes = new Uint8Array(await file.arrayBuffer())
  const mime = imageMime(bytes)
  if (!mime) throw new Error('Choose PNG, JPEG, GIF, WebP or SVG')
  if (mime === 'image/svg+xml') bytes = new TextEncoder().encode(sanitizeSVG(new TextDecoder().decode(bytes)))
  signal?.throwIfAborted()
  const decoded = await decode(new Blob([bytes], { type: mime }))
  let resized: ImageBitmap | undefined
  try {
    signal?.throwIfAborted()
    const size = imageSize(decoded.width, decoded.height, options.maxEdge, options.keepOriginal)
    const downscaled = size.width !== decoded.width || size.height !== decoded.height
    const needsPNG = downscaled || mime === 'image/webp' || mime === 'image/svg+xml'
    if (downscaled && typeof createImageBitmap === 'function') {
      // Native asynchronous resampling keeps large-image scaling out of the JS/UI task.
      resized = await createImageBitmap(decoded.source as ImageBitmapSource, {
        resizeWidth: size.width,
        resizeHeight: size.height,
        resizeQuality: 'high',
      })
      signal?.throwIfAborted()
    }
    const raster = needsPNG ? await png(resized || decoded.source, size.width, size.height) : undefined
    signal?.throwIfAborted()
    return {
      src: downscaled ? raster! : bytesToDataURL(bytes, mime),
      ...size,
      alt,
      alignment: 'inline',
      wrap: 'inline',
      fallbackSrc: !downscaled && needsPNG ? raster : undefined,
    }
  } finally {
    resized?.close()
    decoded.release()
  }
}

export async function prepareImageHTML(html: string, options: ImageOptions, signal?: AbortSignal) {
  const root = document.createElement('div')
  root.innerHTML = html // Caller provides sanitized HTML containing local data images only.
  for (const image of root.querySelectorAll('img')) {
    const data = readImageDataURL(image.getAttribute('src') || '')
    const attrs = await prepareImage(
      new Blob([data.bytes.slice().buffer], { type: data.mime }),
      options,
      image.alt,
      signal,
    )
    const displayWidth = Number(image.getAttribute('width')) || attrs.width
    const displayHeight = Number(image.getAttribute('height')) || attrs.height
    image.src = attrs.src
    image.width = Math.min(displayWidth, attrs.width)
    image.height = Math.min(displayHeight, attrs.height)
    if (attrs.fallbackSrc) image.setAttribute('data-fallback-src', attrs.fallbackSrc)
  }
  return root.innerHTML
}

export async function prepareImportedImages(document: DraftDocument, report: UnsupportedContent[] = []) {
  const visit = async (nodes: DraftDocument['content']) => {
    for (const node of nodes) {
      if (node.type === 'image' && node.attrs?.importChart) {
        const entry = String(node.attrs.importChart)
        try {
          const data = readImageDataURL(String(node.attrs.src))
          const prepared = await prepareImage(new Blob([data.bytes.slice().buffer], { type: data.mime }), {
            maxEdge: 2560,
            keepOriginal: true,
          })
          if (!prepared.fallbackSrc) throw new Error('Chart PNG unavailable')
          node.attrs.src = prepared.fallbackSrc
          delete node.attrs.fallbackSrc
        } catch {
          for (const item of report)
            if (item.kind === entry) item.kind = entry.replace(/converted to images$/, 'could not be rendered')
          node.type = 'text'
          node.text = `${node.attrs.alt}: Chart could not be rendered`
          delete node.attrs
        }
        if (node.attrs) delete node.attrs.importChart
        continue
      }
      if (node.type === 'image' && node.attrs) {
        // DOCX's worker already validates raster media. Only SVG/WebP need a
        // browser rendition; decoding every PNG's base64 here blocked large imports.
        const source = String(node.attrs.src)
        if (
          /^data:image\/(?:webp|svg\+xml);/.test(source) &&
          (!node.attrs.fallbackSrc || !String(node.attrs.fallbackSrc).startsWith('data:image/png;'))
        ) {
          const data = readImageDataURL(source)
          const prepared = await prepareImage(new Blob([data.bytes.slice().buffer], { type: data.mime }), {
            maxEdge: 2560,
            keepOriginal: true,
          })
          node.attrs.fallbackSrc = prepared.fallbackSrc || null
        }
      }
      if (node.content) await visit(node.content)
    }
  }
  await visit(document.content)
  const page = readPageSetup(document)
  if (page.stories) {
    for (const kind of ['header', 'footer'] as const)
      for (const nodes of Object.values(page.stories[kind])) await visit(nodes)
    document.attrs = { ...document.attrs, pageSetup: JSON.stringify(page) }
  }
}
