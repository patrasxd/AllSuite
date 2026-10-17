import { inflateSync } from 'node:zlib'

/** Small evidence reader for PDFs emitted by Chromium in these tests, not an import engine. */
export function chromiumPDFPages(bytes: Buffer): string[] {
  const raw = bytes.toString('latin1')
  const objects = new Map([...raw.matchAll(/(\d+) 0 obj\s*([\s\S]*?)endobj/g)].map((match) => [match[1], match[2]]))
  const stream = (object: string) => {
    const start = /stream\r?\n/.exec(object)
    const length = Number(/\/Length (\d+)/.exec(object)?.[1] || 0)
    // A compressed payload may itself end with CR: delimiter matching would lose that byte.
    const data = start ? object.slice(start.index + start[0].length, start.index + start[0].length + length) : ''
    return object.includes('/FlateDecode') ? inflateSync(Buffer.from(data, 'latin1')).toString('latin1') : data
  }
  const maps = new Map<string, Map<string, string>>()
  const unicode = (hex: string) =>
    hex
      .match(/.{4}/g)
      ?.map((unit) => String.fromCharCode(parseInt(unit, 16)))
      .join('') || ''
  for (const [id, object] of objects) {
    const cmapId = /\/ToUnicode (\d+) 0 R/.exec(object)?.[1]
    if (!cmapId) continue
    const cmap = stream(objects.get(cmapId)!),
      map = new Map<string, string>()
    for (const block of cmap.matchAll(/beginbfchar([\s\S]*?)endbfchar/g))
      for (const match of block[1].matchAll(/<([\da-f]+)>\s*<([\da-f]+)>/gi))
        map.set(match[1].toUpperCase(), unicode(match[2]))
    for (const block of cmap.matchAll(/beginbfrange([\s\S]*?)endbfrange/g))
      for (const match of block[1].matchAll(/<([\da-f]+)>\s*<([\da-f]+)>\s*<([\da-f]+)>/gi)) {
        const start = parseInt(match[1], 16),
          end = parseInt(match[2], 16),
          target = parseInt(match[3], 16)
        for (let code = start; code <= end && code - start < 65536; code++)
          map.set(
            code.toString(16).padStart(match[1].length, '0').toUpperCase(),
            String.fromCharCode(target + code - start),
          )
      }
    maps.set(id, map)
  }
  return [...objects.values()]
    .filter((object) => /\/Type\s*\/Page\b/.test(object))
    .map((page) => {
      const fonts = new Map([...page.matchAll(/\/(F\d+) (\d+) 0 R/g)].map((match) => [match[1], maps.get(match[2])]))
      const contentId = /\/Contents (\d+) 0 R/.exec(page)?.[1]
      const content = contentId ? stream(objects.get(contentId)!) : ''
      let font = '',
        text = ''
      for (const token of content.matchAll(/\/(F\d+) [\d.]+ Tf|<([\da-f]+)>\s*Tj|\[([^\]]+)\]\s*TJ/gi)) {
        if (token[1]) {
          font = token[1]
          continue
        }
        const hexes = token[2] ? [token[2]] : [...token[3].matchAll(/<([\da-f]+)>/gi)].map((match) => match[1])
        for (const hex of hexes)
          for (const code of hex.match(/.{4}/g) || []) text += fonts.get(font)?.get(code.toUpperCase()) || '�'
      }
      return text
    })
}
