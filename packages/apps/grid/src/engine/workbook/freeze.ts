import type { Worksheet } from './types'

/** Only the PP10 subset is rendered/changed; other imported views remain opaque. */
export function supportedFrozenPane(pane: Worksheet['frozenPane']): boolean {
  if (!pane) return true
  const { xSplit: x, ySplit: y } = pane
  return (
    (x === 0 || x === 1) &&
    (y === 0 || y === 1) &&
    Boolean(x || y) &&
    pane.state === 'frozen' &&
    pane.topLeftCell === `${x ? 'B' : 'A'}${y ? 2 : 1}` &&
    (!pane.activePane || pane.activePane === (x ? (y ? 'bottomRight' : 'topRight') : 'bottomLeft'))
  )
}

export function frozenAxes(sheet: Worksheet): { rows: boolean; columns: boolean } {
  if (sheet.unsupportedSheetViews || !supportedFrozenPane(sheet.frozenPane)) return { rows: false, columns: false }
  return { rows: sheet.frozenPane?.ySplit === 1, columns: sheet.frozenPane?.xSplit === 1 }
}

export function createFrozenPane(rows: boolean, columns: boolean): Worksheet['frozenPane'] {
  if (!rows && !columns) return undefined
  return {
    xSplit: Number(columns),
    ySplit: Number(rows),
    topLeftCell: `${columns ? 'B' : 'A'}${rows ? 2 : 1}`,
    activePane: columns ? (rows ? 'bottomRight' : 'topRight') : 'bottomLeft',
    state: 'frozen',
  }
}
