import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { ExportMenu } from './ExportMenu'

afterEach(cleanup)
it('offers four localized formats through AllUI buttons, with keyboard navigation and Escape focus restoration', () => {
  const exportDocument = vi.fn()
  const toggleComments = vi.fn()
  render(<ExportMenu locale="pl" onExport={exportDocument} onToggleCommentsInPDF={toggleComments} />)
  const trigger = screen.getByRole('button', { name: 'Eksportuj', exact: true })
  expect(trigger).toHaveClass('all-btn')
  fireEvent.keyDown(trigger, { key: 'ArrowDown' })
  const items = Array.from(screen.getByRole('menu').querySelectorAll('button'))
  expect(screen.getAllByRole('menuitem')).toHaveLength(4)
  expect(screen.getByRole('menuitemcheckbox', { name: 'Dołącz komentarze do PDF' })).toHaveAttribute(
    'aria-checked',
    'false',
  )
  expect(items[1]).toHaveFocus()
  fireEvent.keyDown(items[1], { key: 'ArrowUp' })
  expect(items[0]).toHaveFocus()
  fireEvent.keyDown(items[0], { key: 'ArrowDown' })
  expect(items[1]).toHaveFocus()
  fireEvent.keyDown(items[1], { key: 'End' })
  expect(items[4]).toHaveFocus()
  fireEvent.keyDown(items[4], { key: 'ArrowUp' })
  expect(items[3]).toHaveTextContent('Zwykły tekst')
  expect(items[3]).toHaveFocus()
  fireEvent.keyDown(items[3], { key: 'Escape' })
  expect(trigger).toHaveFocus()
  expect(screen.queryByRole('menu')).not.toBeInTheDocument()
  fireEvent.click(trigger)
  const includeComments = screen.getByRole('menuitemcheckbox', { name: 'Dołącz komentarze do PDF' })
  fireEvent.click(includeComments)
  expect(toggleComments).toHaveBeenCalledOnce()
  fireEvent.click(screen.getByRole('menuitem', { name: 'HTML', exact: true }))
  expect(exportDocument).toHaveBeenCalledWith('html')
  expect(screen.queryByRole('menu')).not.toBeInTheDocument()
})
it('closes on outside interaction and disables the trigger while exporting', () => {
  const { rerender } = render(<ExportMenu locale="en" onExport={vi.fn()} />)
  fireEvent.click(screen.getByRole('button', { name: 'Export', exact: true }))
  fireEvent.pointerDown(document.body)
  expect(screen.queryByRole('menu')).not.toBeInTheDocument()
  rerender(<ExportMenu locale="en" busy onExport={vi.fn()} />)
  expect(screen.getByRole('button', { name: 'Export', exact: true })).toBeDisabled()
})
