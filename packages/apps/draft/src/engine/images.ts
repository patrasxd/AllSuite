import { DOMParser, XMLSerializer } from '@xmldom/xmldom'

export const IMAGE_ACCEPT = '.png,.jpg,.jpeg,.gif,.webp,.svg,image/png,image/jpeg,image/gif,image/webp,image/svg+xml'
export const DEFAULT_IMAGE_MAX_EDGE = 2560
export type ImageOptions = { maxEdge: number; keepOriginal: boolean }
export type ImageAttributes = {
  src: string
  width: number
  height: number
  alt: string
  alignment: string
  wrap: string
  fallbackSrc?: string
}

export function imageSize(width: number, height: number, maxEdge: number, keepOriginal = false) {
  if (!(width > 0 && height > 0 && Number.isFinite(width + height))) throw new Error('Invalid image dimensions')
  const scale = keepOriginal
    ? 1
    : Math.min(1, Math.max(64, Math.min(16384, maxEdge || DEFAULT_IMAGE_MAX_EDGE)) / Math.max(width, height))
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) }
}

export function sanitizeSVG(input: string): string {
  if (/<!DOCTYPE|<!ENTITY/i.test(input)) throw new Error('SVG declarations are unsupported')
  const doc = new DOMParser().parseFromString(input, 'image/svg+xml')
  const root = doc.documentElement
  if (!root || root.localName !== 'svg' || root.namespaceURI !== 'http://www.w3.org/2000/svg')
    throw new Error('Invalid SVG')
  const tags = new Set(
    'svg g defs path rect circle ellipse line polyline polygon text tspan title desc linearGradient radialGradient stop clipPath mask use symbol'.split(
      ' ',
    ),
  )
  const attrs = new Set(
    'id x y x1 x2 y1 y2 cx cy r rx ry d points width height viewBox preserveAspectRatio transform fill fill-opacity fill-rule stroke stroke-width stroke-linecap stroke-linejoin stroke-dasharray stroke-opacity opacity offset stop-color stop-opacity gradientUnits gradientTransform clip-path mask font-family font-size font-weight text-anchor xmlns href'.split(
      ' ',
    ),
  )
  const clean = (element: typeof root) => {
    // Convert safe presentation declarations to attributes; discard executable/resource CSS.
    const presentation = new Set(
      'fill fill-opacity fill-rule stroke stroke-width stroke-linecap stroke-linejoin stroke-dasharray stroke-opacity opacity stop-color stop-opacity font-family font-size font-weight text-anchor'.split(
        ' ',
      ),
    )
    for (const declaration of (element.getAttribute('style') || '').split(';')) {
      const colon = declaration.indexOf(':')
      const key = declaration.slice(0, colon).trim().toLowerCase()
      const value = declaration.slice(colon + 1).trim()
      if (colon > 0 && presentation.has(key)) element.setAttribute(key, value)
    }
    for (const attribute of Array.from(element.attributes)) {
      const value = attribute.value
      const localReference = /^#[A-Za-z_][\w:.-]*$/.test(value)
      const localPaint = /^url\(#[A-Za-z_][\w:.-]*\)$/.test(value)
      if (
        attribute.localName === 'href' &&
        attribute.namespaceURI === 'http://www.w3.org/1999/xlink' &&
        localReference
      ) {
        element.setAttribute('href', value)
        element.removeAttributeNode(attribute)
        continue
      }
      if (
        !attrs.has(attribute.name) ||
        (attribute.namespaceURI && attribute.name !== 'xmlns') ||
        (attribute.name === 'href' && !localReference) ||
        (/url\s*\(|(?:https?:|data:|javascript:|\/\/)|[\\]/i.test(value) && !localPaint)
      )
        element.removeAttributeNode(attribute)
    }
    for (const child of Array.from(element.childNodes)) {
      if (child.nodeType === 1) {
        const elementChild = child as typeof root
        if (!tags.has(elementChild.localName || '') || elementChild.namespaceURI !== root.namespaceURI)
          element.removeChild(child)
        else clean(elementChild)
      } else if (child.nodeType !== 3) element.removeChild(child)
    }
  }
  clean(root)
  root.setAttribute('xmlns', 'http://www.w3.org/2000/svg')
  const viewBox = (root.getAttribute('viewBox') || '')
    .trim()
    .split(/[\s,]+/)
    .map(Number)
  for (const [key, fallback] of [
    ['width', viewBox[2] || 300],
    ['height', viewBox[3] || 150],
  ] as const) {
    const value = root.getAttribute(key) || ''
    if (!/^\d+(?:\.\d+)?(?:px)?$/.test(value) || Number.parseFloat(value) <= 0) root.setAttribute(key, String(fallback))
  }
  // Serialize only the cleaned root: processing instructions outside it cannot survive.
  return new XMLSerializer().serializeToString(root)
}

export function bytesToDataURL(bytes: Uint8Array, mime: string) {
  let binary = ''
  for (let offset = 0; offset < bytes.length; offset += 8192)
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 8192))
  return `data:${mime};base64,${btoa(binary)}`
}

export function imageMime(bytes: Uint8Array): string | undefined {
  if (bytes[0] === 137 && bytes[1] === 80 && bytes[2] === 78 && bytes[3] === 71) return 'image/png'
  if (bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) return 'image/jpeg'
  const start = String.fromCharCode(...bytes.subarray(0, 12))
  if (/^GIF8[79]a/.test(start)) return 'image/gif'
  if (start.startsWith('RIFF') && start.slice(8) === 'WEBP') return 'image/webp'
  if (/^(?:\uFEFF)?\s*(?:<\?xml[^>]*>\s*)?<svg[\s>]/i.test(new TextDecoder().decode(bytes.subarray(0, 1024))))
    return 'image/svg+xml'
}

export function readImageDataURL(source: string): { bytes: Uint8Array; mime: string } {
  const match = /^data:(image\/(?:png|jpeg|gif|webp|svg\+xml))(?:;charset=utf-8)?(;base64)?,([\s\S]+)$/i.exec(source)
  if (!match || source.length > 70_000_000) throw new Error('Unsupported image data')
  if (!match[2] && match[1].toLowerCase() !== 'image/svg+xml') throw new Error('Raster image data must be base64')
  const bytes = match[2]
    ? Uint8Array.from(atob(match[3]), (character) => character.charCodeAt(0))
    : new TextEncoder().encode(decodeURIComponent(match[3]))
  const mime = imageMime(bytes)
  if (mime !== match[1].toLowerCase()) throw new Error('Image format does not match its content')
  return {
    bytes: mime === 'image/svg+xml' ? new TextEncoder().encode(sanitizeSVG(new TextDecoder().decode(bytes))) : bytes,
    mime,
  }
}

export function safeImageSource(source: string): string | null {
  try {
    const { bytes, mime } = readImageDataURL(source)
    return bytesToDataURL(bytes, mime)
  } catch {
    return null
  }
}
