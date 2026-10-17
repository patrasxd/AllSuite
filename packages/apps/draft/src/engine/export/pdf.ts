import type { DraftDocument } from '../document-model'
import { exportHTML } from './html'
import { exportFontFamilies, type ExportOptions } from './model'

// A pure print-document conversion; the browser adapter owns native printing, never this engine.
export function exportPDF(document: DraftDocument, options: ExportOptions): string {
  for (const family of exportFontFamilies(document))
    for (const weight of [400, 700])
      for (const style of ['normal', 'italic'])
        for (const subset of ['latin', 'latin-ext']) {
          if (
            !options.fonts?.some(
              (font) =>
                font.family === family && font.weight === weight && font.style === style && font.subset === subset,
            )
          )
            throw new Error(`Missing embedded font: ${family} ${weight} ${style} ${subset}`)
        }
  return exportHTML(document, options)
}
