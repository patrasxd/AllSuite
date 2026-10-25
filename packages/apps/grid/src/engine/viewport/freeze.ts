/** Retain original virtual indices, never create another representation of a cell. */
export function includeFrozenIndex(indices: number[], frozen: boolean): number[] {
  return frozen && indices[0] !== 0 ? [0, ...indices] : indices
}

export function frozenAxisPosition(index: number, start: number, offset: number, frozen: boolean): number {
  return frozen && index === 0 ? offset : start
}

/** Clip scrolled content at the data band, so covered cells cannot receive pointer input. */
export function frozenAxisClip(index: number, start: number, offset: number, frozenSize: number): number {
  return index === 0 || frozenSize === 0 ? 0 : Math.max(0, offset + frozenSize - start)
}
