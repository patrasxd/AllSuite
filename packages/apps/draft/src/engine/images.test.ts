import { afterEach, describe, expect, it, vi } from 'vitest'
import { Blob as NodeBlob } from 'node:buffer'
import { generatedPNG } from '../../../../../tests/fixtures/png'
import { bytesToDataURL, imageSize, readImageDataURL, safeImageSource, sanitizeSVG } from './images'
import { prepareImage } from './image-processing'

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})
describe('in-memory images', () => {
  it('fits the longest edge, preserves proportions and allows keeping original dimensions', () => {
    expect(imageSize(6000, 3000, 2560)).toEqual({ width: 2560, height: 1280 })
    expect(imageSize(60, 30, 2560)).toEqual({ width: 60, height: 30 })
    expect(imageSize(6000, 3000, 2560, true)).toEqual({ width: 6000, height: 3000 })
    expect(() => imageSize(Infinity, 1, 200)).toThrow()
  })
  it('sanitizes SVG scripts, event handlers, external resources and CSS references before decoding', () => {
    const clean = sanitizeSVG(
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 80 40" onload="evil()"><script>evil()</script><foreignObject><div>bad</div></foreignObject><image href="https://unsafe.test/i"/><use href="https://unsafe.test/x"/><rect width="80" height="40" fill="url(https://unsafe.test/paint)" style="filter:url(x)"/><path id="local" d="M0 0L1 1"/><use href="#local"/></svg>`,
    )
    expect(clean).not.toMatch(/script|foreignObject|onload|unsafe|style=|<image/i)
    expect(clean).toContain('href="#local"')
    expect(clean).toContain('width="80"')
    expect(() => sanitizeSVG('<!DOCTYPE svg><svg/>')).toThrow()
  })
  it('accepts only supported embedded formats and checks declared MIME against bytes', () => {
    const png = generatedPNG()
    expect(readImageDataURL(bytesToDataURL(png, 'image/png')).bytes).toEqual(png)
    expect(safeImageSource(bytesToDataURL(png, 'image/jpeg'))).toBeNull()
    for (const source of ['https://unsafe.test/a.png', 'blob:test', 'data:text/html;base64,PHNjcmlwdD4='])
      expect(safeImageSource(source)).toBeNull()
  })
  it('closes decoded bitmaps after success, encoding errors and cancellation', async () => {
    const close = vi.fn()
    vi.stubGlobal('createImageBitmap', vi.fn().mockResolvedValue({ width: 6000, height: 3000, close }))
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
      drawImage: vi.fn(),
    } as unknown as CanvasRenderingContext2D)
    vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation((callback) =>
      callback(new NodeBlob([generatedPNG(64, 32)], { type: 'image/png' }) as unknown as Blob),
    )
    const file = new NodeBlob([generatedPNG()]) as unknown as Blob
    const result = await prepareImage(file, { maxEdge: 64, keepOriginal: false })
    expect(result).toMatchObject({ width: 64, height: 32 })
    expect(close).toHaveBeenCalledTimes(2)
    expect(createImageBitmap).toHaveBeenCalledWith(expect.objectContaining({ width: 6000 }), {
      resizeWidth: 64,
      resizeHeight: 32,
      resizeQuality: 'high',
    })
    const original = await prepareImage(file, { maxEdge: 64, keepOriginal: true })
    expect(original.width).toBe(6000)
    expect(close).toHaveBeenCalledTimes(3)
    vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation((callback) => callback(null))
    await expect(prepareImage(file, { maxEdge: 64, keepOriginal: false })).rejects.toThrow()
    expect(close).toHaveBeenCalledTimes(5)
    const controller = new AbortController()
    vi.stubGlobal(
      'createImageBitmap',
      vi.fn(async () => {
        controller.abort()
        return { width: 8, height: 4, close }
      }),
    )
    await expect(prepareImage(file, { maxEdge: 64, keepOriginal: false }, '', controller.signal)).rejects.toThrow()
    expect(close).toHaveBeenCalledTimes(6)
  })
  it('revokes fallback decoder object URLs on success and failure', async () => {
    vi.stubGlobal('createImageBitmap', undefined)
    const revoke = vi.fn()
    vi.stubGlobal('URL', { createObjectURL: () => 'blob:temporary', revokeObjectURL: revoke })
    vi.stubGlobal(
      'Image',
      class {
        src = ''
        naturalWidth = 8
        naturalHeight = 4
        decode = async () => {}
      },
    )
    const file = new NodeBlob([generatedPNG()]) as unknown as Blob
    await prepareImage(file, { maxEdge: 64, keepOriginal: true })
    expect(revoke).toHaveBeenCalledWith('blob:temporary')
    vi.stubGlobal(
      'Image',
      class {
        src = ''
        decode = async () => {
          throw new Error('Invalid')
        }
      },
    )
    await expect(prepareImage(file, { maxEdge: 64, keepOriginal: true })).rejects.toThrow('Invalid')
    expect(revoke).toHaveBeenCalledTimes(2)
  })
})
