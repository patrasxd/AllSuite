import { describe, expect, it } from 'vitest'
import { getGridButtonTooltip, getGridSheetTabTooltip } from './button-tooltips'

describe('Grid button tooltips', () => {
  it('describes formatting and workbook actions in both supported locales', () => {
    expect(getGridButtonTooltip('en', 'Bold')).toBe('Make selected cell text bold')
    expect(getGridButtonTooltip('en', 'Increase decimal places')).toBe('Show more decimal places')
    expect(getGridButtonTooltip('pl', 'Pogrubienie')).toBe('Pogrub tekst zaznaczonych komórek')
    expect(getGridButtonTooltip('pl', 'Anuluj import')).toBe('Zatrzymaj import tego skoroszytu')
  })

  it('describes dynamic worksheet actions without replacing formula help', () => {
    expect(getGridButtonTooltip('en', 'Insert 2 rows above')).toBe('Insert 2 rows above the selection')
    expect(getGridButtonTooltip('en', 'Insert SUM (SUM)')).toBeUndefined()
  })

  it('describes worksheet tabs and renaming in both supported locales', () => {
    expect(getGridSheetTabTooltip('en', 'Budget')).toBe('Switch to the Budget worksheet. Double-click to rename it')
    expect(getGridSheetTabTooltip('pl', 'Budżet')).toBe('Przejdź do arkusza „Budżet”. Dwuklik zmienia jego nazwę')
  })
})
