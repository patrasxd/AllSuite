export type PageView = 'print' | 'web'
export type PageZoom = number | 'fit'
export const clampZoom = (value: number) => Math.max(50, Math.min(200, Math.round(value)))

export const pageViewLabels = {
  en: {
    view: 'Document view',
    print: 'Print layout',
    web: 'Web view',
    fit: 'Fit width',
    current: 'Current page',
    pagination: 'Page flow',
    keepNext: 'Keep with next',
    keepLines: 'Keep lines together',
    widowControl: 'Widow/orphan control',
    marginPreset: 'Margin preset',
    normal: 'Normal (20 mm)',
    narrow: 'Narrow (12.7 mm)',
    wide: 'Wide (25.4 mm)',
    custom: 'Custom',
  },
  pl: {
    view: 'Widok dokumentu',
    print: 'Układ wydruku',
    web: 'Widok internetowy',
    fit: 'Dopasuj szerokość',
    current: 'Bieżąca strona',
    pagination: 'Podział akapitów',
    keepNext: 'Razem z następnym',
    keepLines: 'Zachowaj wiersze razem',
    widowControl: 'Kontrola wdów i sierot',
    marginPreset: 'Zestaw marginesów',
    normal: 'Normalne (20 mm)',
    narrow: 'Wąskie (12,7 mm)',
    wide: 'Szerokie (25,4 mm)',
    custom: 'Niestandardowe',
  },
} as const
