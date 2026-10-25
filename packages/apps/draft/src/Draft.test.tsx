import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import { afterEach, describe, expect, it } from 'vitest'
import { Draft } from './Draft'
import { translations } from './i18n'

afterEach(cleanup)

describe('Draft editor', () => {
  it.each(['en', 'pl'] as const)('renders the %s editor with file controls', async (locale) => {
    const t = translations[locale]
    render(<Draft locale={locale} isEink />)

    expect(await screen.findByRole('textbox', { name: t.editor }, { timeout: 5000 })).toBeVisible()
    expect(screen.getByRole('region', { name: t.document })).toBeVisible()
    expect(screen.getByRole('status')).toHaveTextContent(t.clean)
    expect(screen.getByRole('button', { name: t.file })).toBeVisible()
    fireEvent.click(screen.getByRole('button', { name: t.file }))
    expect(screen.getByRole('button', { name: t.save })).toBeEnabled()
  })
})
