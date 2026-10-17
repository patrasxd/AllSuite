import { zlibSync } from 'fflate'

// Synthetic RGBA image: no fixture assets or user documents are required.
export function generatedPNG(width = 8, height = 4, noiseSeed?: number) {
  const be = (value: number) => new Uint8Array([value >>> 24, value >>> 16, value >>> 8, value])
  const chunk = (tag: string, content: Uint8Array) => {
    const bytes = new Uint8Array(12 + content.length)
    bytes.set(be(content.length))
    bytes.set(new TextEncoder().encode(tag), 4)
    bytes.set(content, 8)
    let crc = 0xffffffff
    for (const byte of bytes.subarray(4, bytes.length - 4)) {
      crc ^= byte
      for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0)
    }
    bytes.set(be((crc ^ 0xffffffff) >>> 0), bytes.length - 4)
    return bytes
  }
  const header = new Uint8Array(13)
  header.set(be(width))
  header.set(be(height), 4)
  header.set([8, 6], 8)
  const pixels = new Uint8Array(height * (1 + width * 4))
  let seed = noiseSeed || 1
  const random = () => {
    seed ^= seed << 13
    seed ^= seed >>> 17
    seed ^= seed << 5
    return seed & 255
  }
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++)
      pixels.set(
        noiseSeed ? [random(), random(), random(), 255] : [40 + (x % 100), 100 + (y % 100), 190, 255],
        y * (1 + width * 4) + 1 + x * 4,
      )
  const parts = [
    new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', header),
    chunk('IDAT', zlibSync(pixels)),
    chunk('IEND', new Uint8Array()),
  ]
  const result = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0))
  let offset = 0
  for (const part of parts) {
    result.set(part, offset)
    offset += part.length
  }
  return result
}
