export const PAGE_GAP = 24
/** Half-open line ranges; explicit breaks are handled by the caller first. */
export function paragraphRuns(
  lines: Array<{ top: number; bottom: number }>,
  body: number,
  keepLines: boolean,
  widowControl: boolean,
): Array<[number, number]> {
  if (!lines.length) return []
  if (keepLines && lines[lines.length - 1].bottom - lines[0].top <= body) return [[0, lines.length]]
  if (widowControl && lines.length < 4 && lines[lines.length - 1].bottom - lines[0].top <= body)
    return [[0, lines.length]]
  const result: Array<[number, number]> = []
  for (let index = 0; index < lines.length;) {
    const count =
      widowControl &&
      (index === 0 || index === lines.length - 2) &&
      index + 1 < lines.length &&
      lines[index + 1].bottom - lines[index].top <= body
        ? 2
        : 1
    result.push([index, index + count])
    index += count
  }
  return result
}
export interface PageGeometry {
  height: number
  body: number
  pitch: number
}
export function pageGeometry(height: number, top: number, bottom: number): PageGeometry {
  return { height, body: Math.max(24, height - top - bottom - 2), pitch: height + PAGE_GAP }
}

/** Places a measured line/atomic block in a body, reserving the physical margins and inter-page gap. */
export function placeOnPage(
  top: number,
  bottom: number,
  offset: number,
  geometry: PageGeometry,
  force?: 'always' | 'boundary',
  header = 0,
) {
  const y = top + offset
  const page = Math.max(0, Math.floor((y + 0.25) / geometry.pitch))
  const start = page * geometry.pitch
  const overflows = bottom + offset > start + geometry.body + 0.5
  const atStart = Math.abs(y - start) < 0.75
  if (
    (force === 'always' || (force === 'boundary' && !atStart) || (overflows && !atStart)) &&
    bottom - top <= geometry.body + 0.5
  ) {
    const gap = (page + 1) * geometry.pitch - y + header
    return { offset: offset + gap, gap, page: page + 1 }
  }
  return { offset, gap: 0, page }
}
