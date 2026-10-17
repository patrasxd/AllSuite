import type { Locale } from '../types'

export type AutoformatReplacement = { deleteBefore: number; insert: string }

export function autoformatReplacement(textBefore: string, input: string, locale: Locale): AutoformatReplacement | null {
  if (input === '.' && textBefore.endsWith('..')) return { deleteBefore: 2, insert: '…' }
  if (input === '-' && textBefore.endsWith('–')) return { deleteBefore: 1, insert: '—' }
  if (input === '-' && textBefore.endsWith('-')) return { deleteBefore: 1, insert: '–' }
  if (input === '"') {
    const opening = !textBefore || /[\s([{]$/u.test(textBefore)
    if (locale === 'pl') return { deleteBefore: 0, insert: opening ? '„' : '”' }
    return { deleteBefore: 0, insert: opening ? '“' : '”' }
  }
  if (input === "'") {
    const opening = !textBefore || /[\s([{]$/u.test(textBefore)
    if (locale === 'pl') return { deleteBefore: 0, insert: opening ? '‚' : '’' }
    return { deleteBefore: 0, insert: opening ? '‘' : '’' }
  }
  return null
}

export function isBlockAutoformatTrigger(textBefore: string, input: string) {
  return input === ' ' && /^(?:1\.|-|#{1,6})$/u.test(textBefore)
}
