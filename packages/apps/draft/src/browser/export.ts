import type { DraftDocument } from '../engine/document-model'
import { bytesToDataURL } from '../engine/images'
import { exportFontFamilies, type ExportFont } from '../engine/export/model'
import fontLicense from '../../../../../licenses/font-license-notices.txt?raw'

export { fontLicense }
// Only this lazy adapter knows asset URLs or performs browser I/O. Converters take bytes as arguments.
const assets = import.meta.glob<string>(
  '../../../../../node_modules/@fontsource/{arimo,caladea,carlito,cousine,tinos}/files/*-latin{,-ext}-{400,700}-{normal,italic}.{woff,woff2}',
  { eager: true, query: '?url', import: 'default' },
)
export async function loadExportFonts(
  document: DraftDocument,
  signal?: AbortSignal,
  format: 'woff' | 'woff2' = 'woff2',
): Promise<ExportFont[]> {
  const families = exportFontFamilies(document)
  const required = Object.entries(assets).filter(
    ([path]) =>
      path.endsWith('.' + format) && families.some((family) => path.includes(`/files/${family.toLowerCase()}-`)),
  )
  if (required.length !== families.length * 8) throw new Error('Export font assets missing')
  return Promise.all(
    required.map(async ([path, url]) => {
      const match = /\/([a-z]+)-(latin(?:-ext)?)-(400|700)-(normal|italic)\.woff2?$/.exec(path)!
      const response = await fetch(url, { signal })
      if (!response.ok) throw new Error('Export font unavailable')
      const bytes = new Uint8Array(await response.arrayBuffer())
      if (String.fromCharCode(...bytes.subarray(0, 4)) !== (format === 'woff2' ? 'wOF2' : 'wOFF'))
        throw new Error('Invalid export font')
      return {
        family: families.find((family) => family.toLowerCase() === match[1])!,
        subset: match[2] as ExportFont['subset'],
        weight: Number(match[3]) as ExportFont['weight'],
        style: match[4] as ExportFont['style'],
        source: bytesToDataURL(bytes, 'font/' + format),
      }
    }),
  )
}

export async function printHTML(target: Window, html: string, signal: AbortSignal, onClose: () => void) {
  if (signal.aborted || target.closed) throw new Error('Print canceled')
  target.document.open()
  target.document.write(html)
  target.document.close()
  let timer: ReturnType<typeof setTimeout> | undefined
  let abort: (() => void) | undefined
  try {
    await Promise.race([
      (async () => {
        await Promise.all(Array.from(target.document.fonts, (font) => font.load()))
        await target.document.fonts.ready
        await Promise.all(Array.from(target.document.images, (image) => image.decode()))
      })(),
      new Promise<never>((_resolve, reject) => {
        abort = () => reject(new DOMException('Canceled', 'AbortError'))
        signal.addEventListener('abort', abort, { once: true })
        timer = setTimeout(() => reject(new Error('Print resources did not load')), 30000)
      }),
    ])
    if (signal.aborted || target.closed) throw new Error('Print canceled')
    target.addEventListener('afterprint', onClose, { once: true })
    target.addEventListener('pagehide', onClose, { once: true })
    target.focus()
    target.print()
  } finally {
    if (timer) clearTimeout(timer)
    if (abort) signal.removeEventListener('abort', abort)
  }
}
