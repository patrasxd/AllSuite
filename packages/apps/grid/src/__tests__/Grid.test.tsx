import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, vi } from 'vitest'
import { ThemeProvider } from '@all/ui'
import { Grid } from '../Grid'
import { createWorkbook } from '../engine/workbook/model'
import type { XlsxExportResult, XlsxImportPreflight } from '../engine/xlsx/types'
import * as xlsxImport from '../engine/xlsx/worker-client'

beforeEach(() => {
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', {
    configurable: true,
    get() {
      return this.classList.contains('grid-sheet-scroll') ? 800 : 0
    },
  })
  Object.defineProperty(HTMLElement.prototype, 'clientHeight', {
    configurable: true,
    get() {
      return this.classList.contains('grid-sheet-scroll') ? 480 : 0
    },
  })
  Object.defineProperty(HTMLElement.prototype, 'scrollTo', {
    configurable: true,
    value: function (this: HTMLElement, options: ScrollToOptions | number, y?: number) {
      if (typeof options === 'number') {
        this.scrollLeft = options
        this.scrollTop = y ?? 0
      } else {
        this.scrollLeft = options.left ?? this.scrollLeft
        this.scrollTop = options.top ?? this.scrollTop
      }
    },
  })
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function () {
    return this.classList.contains('grid-sheet-scroll') ? new DOMRect(0, 0, 800, 480) : new DOMRect()
  })
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  Reflect.deleteProperty(window, 'showOpenFilePicker')
  Reflect.deleteProperty(window, 'showSaveFilePicker')
  Reflect.deleteProperty(window, 'isSecureContext')
})

function stubExportWorker(result: XlsxExportResult, delayMs = 0) {
  const WorkerMock = class {
    private listeners = new Set<(event: MessageEvent) => void>()
    addEventListener(_type: string, listener: (event: MessageEvent) => void) {
      this.listeners.add(listener)
    }
    postMessage() {
      const respond = () => {
        const event = new MessageEvent('message', { data: { type: 'result', result } })
        this.listeners.forEach((listener) => listener(event))
      }
      if (delayMs > 0) window.setTimeout(respond, delayMs)
      else queueMicrotask(respond)
    }
    terminate() {}
  }
  vi.stubGlobal('Worker', WorkerMock)
}

function stubSuccessfulSavePicker() {
  Object.defineProperty(window, 'isSecureContext', { configurable: true, value: true })
  Object.defineProperty(window, 'showSaveFilePicker', {
    configurable: true,
    value: async () => ({
      name: 'Book1.xlsx',
      createWritable: async () => ({ write: async () => undefined, close: async () => undefined }),
    }),
  })
}

describe('Grid workspace', () => {
  it('shows localized tooltips on worksheet actions and tabs', () => {
    render(<Grid locale="pl" />)

    expect(screen.getByRole('button', { name: 'Pogrubienie' })).toHaveAttribute(
      'title',
      'Pogrub tekst zaznaczonych komórek',
    )
    expect(screen.getByRole('tab', { name: 'Plik', exact: true })).toHaveAttribute(
      'title',
      'Pokaż polecenia plików skoroszytu',
    )
    expect(screen.getByRole('tab', { name: 'Sheet1', exact: true })).toHaveAttribute(
      'title',
      'Przejdź do arkusza „Sheet1”. Dwuklik zmienia jego nazwę',
    )
  })

  it('uses compact AllUI controls to rename a worksheet', () => {
    render(<Grid locale="en" />)
    fireEvent.click(screen.getByRole('button', { name: 'Rename sheet' }))

    const sheetName = screen.getByRole('textbox', { name: 'Sheet name' })
    expect(sheetName.closest('.all-input-container')).toHaveClass('all-input-container--compact')
    expect(screen.getByRole('button', { name: 'Cancel' })).toHaveClass('all-btn--sm')
    expect(screen.getByRole('button', { name: 'Rename' })).toHaveClass('all-btn--sm')
  })

  it('uses the shared compact number-format select and icon actions', () => {
    const { rerender } = render(<Grid locale="en" />)

    const numberFormat = screen.getByRole('combobox', { name: 'Number format' })
    expect(numberFormat).toHaveClass('all-select-field')
    expect(numberFormat.closest('.all-select-container')).toHaveClass('all-select-container--compact')

    const decrease = screen.getByRole('button', { name: 'Decrease decimal places' })
    const increase = screen.getByRole('button', { name: 'Increase decimal places' })
    expect(decrease).toHaveClass('all-icon-btn--sm')
    expect(increase).toHaveClass('all-icon-btn--sm')
    expect(decrease).toHaveAttribute('title', 'Show fewer decimal places')
    expect(increase).toHaveAttribute('title', 'Show more decimal places')
    expect(decrease.querySelector('svg')).toHaveAttribute('viewBox', '0 0 30 18')
    expect(increase.querySelector('svg')).toHaveAttribute('viewBox', '0 0 30 18')
    expect(decrease.querySelector('svg text')).toHaveTextContent('0.0')

    rerender(<Grid locale="pl" />)
    const polishDecrease = screen.getByRole('button', { name: 'Zmniejsz liczbę miejsc dziesiętnych' })
    expect(polishDecrease.querySelector('svg text')).toHaveTextContent('0,0')
  })

  it('cancels an in-flight import on New and ignores a late preflight result', async () => {
    let resolveImport!: (result: XlsxImportPreflight) => void
    const cancel = vi.fn()
    const start = vi.spyOn(xlsxImport, 'startXlsxImport').mockReturnValue({
      promise: new Promise((resolve) => {
        resolveImport = resolve
      }),
      cancel,
    })
    render(<Grid locale="en" />)
    const file = new File(['fixture'], 'later.xlsx')
    Object.defineProperty(file, 'arrayBuffer', { value: async () => new ArrayBuffer(8) })
    fireEvent.change(document.querySelector('input[type="file"]')!, { target: { files: [file] } })
    await waitFor(() => expect(start).toHaveBeenCalledOnce())
    fireEvent.click(screen.getByRole('tab', { name: 'File', exact: true }))
    fireEvent.click(screen.getByRole('button', { name: 'New', exact: true }))
    expect(cancel).toHaveBeenCalledOnce()
    await act(async () => {
      resolveImport({
        workbook: createWorkbook({ firstSheetName: 'Late import' }),
        report: {
          fileName: 'later.xlsx',
          sheetCount: 1,
          cellCount: 0,
          findings: [],
          canOpen: true,
        },
      })
    })
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Late import' })).not.toBeInTheDocument()
    expect(screen.getByRole('gridcell', { name: 'A1, empty' })).toBeVisible()
  })
  it('clears values with Delete and Backspace while retaining styles and reversible history', () => {
    render(<Grid locale="en" />)
    const grid = screen.getByRole('grid', { name: 'Spreadsheet grid' })
    const formulaBar = screen.getByRole('textbox', { name: 'Formula bar' })
    fireEvent.change(formulaBar, { target: { value: 'keep style' } })
    fireEvent.keyDown(formulaBar, { key: 'Enter' })
    const bold = screen.getByRole('button', { name: 'Bold', exact: true })
    fireEvent.click(bold)
    for (const key of ['Delete', 'Backspace']) {
      fireEvent.keyDown(grid, { key })
      expect(screen.getByRole('gridcell', { name: 'A1, empty' })).toHaveStyle({ fontWeight: '700' })
      expect(bold).toHaveAttribute('aria-pressed', 'true')
      fireEvent.keyDown(grid, { key: 'z', ctrlKey: true })
      expect(screen.getByRole('gridcell', { name: 'A1, keep style' })).toHaveStyle({ fontWeight: '700' })
    }
  })
  it('keeps a shared draft through F2 and formula-bar focus, and cancels without a history entry', () => {
    const setIsDirty = vi.fn()
    render(<Grid locale="en" setIsDirty={setIsDirty} />)
    const formulaBar = screen.getByRole('textbox', { name: 'Formula bar' })
    act(() => formulaBar.focus())
    fireEvent.change(formulaBar, { target: { value: 'shared pending text' } })
    fireEvent.keyDown(formulaBar, { key: 'F2' })
    const editor = screen.getByRole('textbox', { name: 'Edit cell A1' })
    expect(editor).toHaveFocus()
    expect(editor).toHaveValue('shared pending text')
    act(() => formulaBar.focus())
    expect(formulaBar).toHaveValue('shared pending text')
    fireEvent.keyDown(formulaBar, { key: 'Escape' })
    expect(screen.getByRole('gridcell', { name: 'A1, empty' })).toBeVisible()
    expect(setIsDirty).toHaveBeenLastCalledWith(false)
    expect(screen.getByRole('button', { name: 'Undo (Ctrl+Z or ⌘Z)' })).toBeDisabled()
  })

  it('does not commit Enter while text composition is active in either editor', () => {
    render(<Grid locale="pl" />)
    const grid = screen.getByRole('grid', { name: 'Siatka arkusza' })
    fireEvent.keyDown(grid, { key: 'F2' })
    const editor = screen.getByRole('textbox', { name: 'Edytuj komórkę A1' })
    fireEvent.change(editor, { target: { value: '日本語' } })
    fireEvent.keyDown(editor, { key: 'Enter', isComposing: true })
    expect(editor).toHaveFocus()
    expect(editor).toHaveValue('日本語')
    const formulaBar = screen.getByRole('textbox', { name: 'Pasek formuły' })
    act(() => formulaBar.focus())
    fireEvent.keyDown(formulaBar, { key: 'Enter', isComposing: true })
    expect(formulaBar).toHaveFocus()
    fireEvent.keyDown(formulaBar, { key: 'Enter' })
    expect(screen.getByRole('gridcell', { name: 'A1, 日本語' })).toBeVisible()
  })

  it('re-edits formatted numbers losslessly and treats unchanged edits as no-ops', () => {
    render(<Grid locale="en" />)
    const grid = screen.getByRole('grid', { name: 'Spreadsheet grid' })
    const formulaBar = screen.getByRole('textbox', { name: 'Formula bar' })
    fireEvent.change(formulaBar, { target: { value: '0.125' } })
    fireEvent.keyDown(formulaBar, { key: 'Enter' })
    fireEvent.change(screen.getByRole('combobox', { name: 'Number format' }), { target: { value: 'percent' } })
    fireEvent.keyDown(grid, { key: 'F2' })
    const editor = screen.getByRole('textbox', { name: 'Edit cell A1' })
    expect(editor).toHaveValue('0.125')
    fireEvent.keyDown(editor, { key: 'Enter' })
    expect(screen.getByRole('gridcell', { name: 'A1, 12.50%' })).toBeVisible()
    fireEvent.keyDown(grid, { key: 'z', ctrlKey: true })
    expect(screen.getByRole('gridcell', { name: 'A1, 0.125' })).toBeVisible()
    fireEvent.keyDown(grid, { key: 'z', ctrlKey: true })
    expect(screen.getByRole('gridcell', { name: 'A1, empty' })).toBeVisible()
  })
  it('extends boundary shortcuts and leaves resize controls in their own keyboard focus flow', () => {
    render(<Grid locale="en" />)
    const grid = screen.getByRole('grid', { name: 'Spreadsheet grid' })
    const nameBox = screen.getByRole('textbox', { name: 'Name box' })
    fireEvent.change(nameBox, { target: { value: 'C3' } })
    fireEvent.keyDown(nameBox, { key: 'Enter' })
    fireEvent.keyDown(grid, { key: 'Home', ctrlKey: true, shiftKey: true })
    expect(nameBox).toHaveValue('A1:C3')
    expect(screen.getByRole('gridcell', { name: 'C3, empty' })).toHaveAttribute('data-range-edges', 'bottom right')
    const slider = screen.getByRole('slider', { name: 'Resize column A', exact: true })
    slider.focus()
    fireEvent.keyDown(slider, { key: 'End' })
    expect(nameBox).toHaveValue('A1:C3')
    expect(slider).toHaveFocus()
    expect(fireEvent.keyDown(slider, { key: 'Tab' })).toBe(true)
  })
  it('switches locale at runtime without losing cell contents or dirty state', () => {
    const setIsDirty = vi.fn()
    const { rerender } = render(<Grid locale="en" setIsDirty={setIsDirty} />)
    const formulaBar = screen.getByRole('textbox', { name: 'Formula bar' })
    fireEvent.change(formulaBar, { target: { value: 'Local workbook' } })
    fireEvent.keyDown(formulaBar, { key: 'Enter' })

    rerender(<Grid locale="pl" isEink setIsDirty={setIsDirty} />)
    expect(screen.getByRole('textbox', { name: 'Pasek formuły' })).toHaveValue('Local workbook')
    expect(screen.getByRole('grid', { name: 'Siatka arkusza' })).toBeVisible()
    expect(setIsDirty).toHaveBeenLastCalledWith(true)

    rerender(<Grid locale="en" setIsDirty={setIsDirty} />)
    expect(screen.getByRole('textbox', { name: 'Formula bar' })).toHaveValue('Local workbook')
    expect(setIsDirty).toHaveBeenLastCalledWith(true)
  })

  it('navigates localized command tabs by keyboard while preserving cell contents, selection and dirty state', () => {
    const setIsDirty = vi.fn()
    render(<Grid locale="pl" setIsDirty={setIsDirty} />)
    const formulaBar = screen.getByRole('textbox', { name: 'Pasek formuły' })
    fireEvent.change(formulaBar, { target: { value: 'Zachowaj' } })
    fireEvent.keyDown(formulaBar, { key: 'Enter' })
    const grid = screen.getByRole('grid', { name: 'Siatka arkusza' })
    const selection = grid.getAttribute('aria-activedescendant')
    const formatTab = screen.getByRole('tab', { name: 'Format', exact: true })
    expect(formatTab).toHaveAttribute('aria-selected', 'true')
    fireEvent.keyDown(formatTab, { key: 'ArrowRight' })
    const fileTab = screen.getByRole('tab', { name: 'Plik', exact: true })
    expect(fileTab).toHaveFocus()
    expect(screen.getByRole('tabpanel', { name: 'Plik', exact: true })).toBeVisible()
    fireEvent.keyDown(fileTab, { key: 'Home' })
    expect(fileTab).toHaveFocus()
    expect(screen.getByRole('button', { name: 'Nowy', exact: true })).toBeVisible()
    expect(screen.getAllByRole('tabpanel')).toHaveLength(1)
    fireEvent.keyDown(fileTab, { key: 'ArrowLeft' })
    expect(formatTab).toHaveFocus()
    expect(formulaBar).toHaveValue('Zachowaj')
    expect(grid).toHaveAttribute('aria-activedescendant', selection)
    expect(setIsDirty).toHaveBeenLastCalledWith(true)
  })

  it('renders English controls and commits formula-bar edits to the in-memory workbook', () => {
    const setIsDirty = vi.fn()
    render(<Grid locale="en" setIsDirty={setIsDirty} />)

    fireEvent.click(screen.getByRole('tab', { name: 'File', exact: true }))
    expect(screen.getByRole('button', { name: 'New' })).toBeVisible()
    fireEvent.click(screen.getByRole('tab', { name: 'Format', exact: true }))
    expect(screen.getByRole('status')).toHaveTextContent('Choose Save or Save As to write an XLSX file')
    const grid = screen.getByRole('grid', { name: 'Spreadsheet grid' })
    expect(grid).toBeVisible()
    expect(grid).toHaveAttribute('aria-rowcount', '101')
    expect(grid).toHaveAttribute('aria-colcount', '27')
    expect(screen.getByRole('gridcell', { name: 'A1, empty' })).toBeVisible()

    fireEvent.keyDown(grid, { key: 'ArrowRight' })
    expect(grid).toHaveAttribute('aria-activedescendant', 'grid-cell-B1')
    expect(screen.getByRole('gridcell', { name: 'B1, empty' })).toBeVisible()
    const formulaBar = screen.getByRole('textbox', { name: 'Formula bar' })
    fireEvent.change(formulaBar, { target: { value: '=SUM(A1:A4)' } })
    expect(setIsDirty).toHaveBeenLastCalledWith(true)
    fireEvent.keyDown(formulaBar, { key: 'Enter' })

    expect(formulaBar).toHaveValue('=SUM(A1:A4)')
    expect(screen.getByRole('gridcell', { name: 'B1, empty' })).toBeVisible()
    expect(screen.getByRole('status')).toHaveTextContent('Cell edit committed')
    expect(setIsDirty).toHaveBeenLastCalledWith(true)
  })

  it('renders Polish labels and a working in-memory New placeholder message', () => {
    render(<Grid locale="pl" />)

    expect(screen.getByRole('textbox', { name: 'Pole nazwy' })).toBeVisible()
    expect(screen.getByRole('textbox', { name: 'Pasek formuły' })).toBeVisible()
    expect(screen.getByRole('status')).toHaveTextContent('Zapisz jako, aby zapisać plik XLSX')
    fireEvent.click(screen.getByRole('tab', { name: 'Plik', exact: true }))
    fireEvent.click(screen.getByRole('button', { name: 'Nowy' }))
    expect(screen.getByRole('status')).toHaveTextContent('Utworzono nowy pusty skoroszyt')
  })

  it('uses localized formula help and keeps entered numbers numeric when formatting is changed', () => {
    render(<Grid locale="pl" />)
    const formulaBar = screen.getByRole('textbox', { name: /Pasek formu/u })
    fireEvent.change(formulaBar, { target: { value: '0,125' } })
    fireEvent.keyDown(formulaBar, { key: 'Enter' })
    expect(screen.getByRole('gridcell', { name: 'A1, 0,125' })).toBeVisible()

    const numberFormat = screen.getByRole('combobox', { name: /Format liczby/u })
    fireEvent.change(numberFormat, { target: { value: 'percent' } })
    expect(screen.getByRole('gridcell', { name: /A1, 12,5/u })).toBeVisible()
    const bold = screen.getByRole('button', { name: 'Pogrubienie' })
    fireEvent.click(bold)
    expect(bold).toHaveAttribute('aria-pressed', 'true')
    fireEvent.click(screen.getByRole('button', { name: 'Wyczyść formaty' }))
    expect(screen.getByRole('gridcell', { name: /A1, 0,125/u })).toBeVisible()
    expect(bold).toHaveAttribute('aria-pressed', 'false')

    fireEvent.click(screen.getByRole('button', { name: 'Funkcje formuł', exact: true }))
    fireEvent.change(screen.getByRole('textbox', { name: 'Szukaj funkcji' }), { target: { value: 'IF' } })
    fireEvent.click(screen.getByRole('button', { name: /Wstaw JEŻELI \(IF\)/u }))
    expect(formulaBar).toHaveValue('=JEŻELI(')
    fireEvent.keyDown(formulaBar, { key: 'Escape' })
    expect(formulaBar).toHaveValue('0,125')
  })

  it('does not flash the export progress strip for a quick save', async () => {
    stubExportWorker({
      bytes: new Uint8Array([1, 2, 3]),
      report: { fileName: 'Book1.xlsx', entries: [], canSave: true, requiresSaveAs: false },
    })
    stubSuccessfulSavePicker()
    render(<Grid locale="en" />)

    fireEvent.click(screen.getByRole('tab', { name: 'File', exact: true }))
    fireEvent.click(screen.getByRole('button', { name: 'Save', exact: true }))
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Workbook saved.'))

    expect(document.querySelector('.grid-import-progress')).not.toBeInTheDocument()
  })

  it('shows export progress after Save As lasts beyond the initial delay', async () => {
    stubExportWorker(
      {
        bytes: new Uint8Array([1, 2, 3]),
        report: { fileName: 'Book1.xlsx', entries: [], canSave: true, requiresSaveAs: false },
      },
      600,
    )
    stubSuccessfulSavePicker()
    render(<Grid locale="en" />)

    fireEvent.click(screen.getByRole('tab', { name: 'File', exact: true }))
    fireEvent.click(screen.getByRole('button', { name: 'Save As', exact: true }))
    expect(document.querySelector('.grid-import-progress')).not.toBeInTheDocument()
    await waitFor(() => expect(document.querySelector('.grid-import-progress')).toBeInTheDocument())
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Workbook saved.'))

    expect(document.querySelector('.grid-import-progress')).not.toBeInTheDocument()
  })

  it('reviews preservation risks before save and keeps changes dirty when canceled', async () => {
    const setIsDirty = vi.fn()
    stubExportWorker({
      bytes: new Uint8Array([1, 2, 3]),
      report: {
        fileName: 'Book1.xlsx',
        entries: [{ category: 'at-risk', code: 'unsafe-part-preserved', partName: 'customXml/item1.xml' }],
        canSave: true,
        requiresSaveAs: true,
      },
    })
    render(<Grid locale="en" setIsDirty={setIsDirty} />)
    const grid = screen.getByRole('grid', { name: 'Spreadsheet grid' })
    fireEvent.keyDown(grid, { key: 'x' })
    const editor = screen.getByRole('textbox', { name: 'Edit cell A1' })
    fireEvent.change(editor, { target: { value: 'keep dirty' } })
    fireEvent.keyDown(editor, { key: 'Enter' })

    fireEvent.click(screen.getByRole('tab', { name: 'File', exact: true }))
    fireEvent.click(screen.getByRole('button', { name: 'Save', exact: true }))
    const dialog = await screen.findByRole('dialog', { name: 'Workbook save review' })
    expect(dialog).toHaveTextContent('customXml/item1.xml')
    expect(dialog).toHaveTextContent('Preservation at risk')
    fireEvent.click(screen.getByRole('button', { name: 'Cancel save' }))
    expect(screen.queryByRole('dialog', { name: 'Workbook save review' })).not.toBeInTheDocument()
    expect(setIsDirty).toHaveBeenLastCalledWith(true)
  })

  it('keeps dirty state when a file writer fails', async () => {
    const setIsDirty = vi.fn()
    stubExportWorker({
      bytes: new Uint8Array([1, 2, 3]),
      report: { fileName: 'Book1.xlsx', entries: [], canSave: true, requiresSaveAs: false },
    })
    Object.defineProperty(window, 'isSecureContext', { configurable: true, value: true })
    const abort = vi.fn(async () => undefined)
    Object.defineProperty(window, 'showSaveFilePicker', {
      configurable: true,
      value: vi.fn(async () => ({
        name: 'Book1.xlsx',
        createWritable: async () => ({
          write: async () => {
            throw new Error('disk full')
          },
          close: async () => undefined,
          abort,
        }),
      })),
    })
    render(<Grid locale="en" setIsDirty={setIsDirty} />)
    const grid = screen.getByRole('grid', { name: 'Spreadsheet grid' })
    fireEvent.keyDown(grid, { key: 'x' })
    const editor = screen.getByRole('textbox', { name: 'Edit cell A1' })
    fireEvent.change(editor, { target: { value: 'unsaved on error' } })
    fireEvent.keyDown(editor, { key: 'Enter' })

    fireEvent.click(screen.getByRole('tab', { name: 'File', exact: true }))
    fireEvent.click(screen.getByRole('button', { name: 'Save', exact: true }))
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Save failed'))
    expect(abort).toHaveBeenCalledOnce()
    expect(setIsDirty).toHaveBeenLastCalledWith(true)
  })

  it('keeps edits made while the writer is closing unsaved', async () => {
    const setIsDirty = vi.fn()
    let finishClose!: () => void
    const close = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finishClose = resolve
        }),
    )
    stubExportWorker({
      bytes: new Uint8Array([1, 2, 3]),
      report: { fileName: 'Book1.xlsx', entries: [], canSave: true, requiresSaveAs: false },
    })
    Object.defineProperty(window, 'isSecureContext', { configurable: true, value: true })
    Object.defineProperty(window, 'showSaveFilePicker', {
      configurable: true,
      value: async () => ({
        name: 'Book1.xlsx',
        createWritable: async () => ({ write: async () => undefined, close }),
      }),
    })
    render(<Grid locale="en" setIsDirty={setIsDirty} />)
    const formula = screen.getByRole('textbox', { name: 'Formula bar' })
    fireEvent.change(formula, { target: { value: 'snapshot' } })
    fireEvent.keyDown(formula, { key: 'Enter' })
    fireEvent.click(screen.getByRole('tab', { name: 'File', exact: true }))
    fireEvent.click(screen.getByRole('button', { name: 'Save', exact: true }))
    await waitFor(() => expect(close).toHaveBeenCalledOnce())
    fireEvent.change(formula, { target: { value: 'newer edit' } })
    fireEvent.keyDown(formula, { key: 'Enter' })
    await act(async () => finishClose())
    expect(screen.getByRole('status')).toHaveTextContent('Newer edits remain unsaved')
    expect(setIsDirty).toHaveBeenLastCalledWith(true)
  })

  it('leaves an explicit Save As cancellation unsaved', async () => {
    const setIsDirty = vi.fn()
    Object.defineProperty(window, 'isSecureContext', { configurable: true, value: true })
    Object.defineProperty(window, 'showSaveFilePicker', {
      configurable: true,
      value: vi.fn(async () => {
        throw new DOMException('Canceled', 'AbortError')
      }),
    })
    render(<Grid locale="en" setIsDirty={setIsDirty} />)
    const grid = screen.getByRole('grid', { name: 'Spreadsheet grid' })
    fireEvent.keyDown(grid, { key: 'x' })
    const editor = screen.getByRole('textbox', { name: 'Edit cell A1' })
    fireEvent.change(editor, { target: { value: 'unsaved after cancel' } })
    fireEvent.keyDown(editor, { key: 'Enter' })

    fireEvent.click(screen.getByRole('tab', { name: 'File', exact: true }))
    fireEvent.click(screen.getByRole('button', { name: 'Save As', exact: true }))
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Save canceled'))
    expect(setIsDirty).toHaveBeenLastCalledWith(true)
  })

  it('shows compatibility preflight before replacing and preserves workbook plus dirty state on cancel', async () => {
    const setIsDirty = vi.fn()
    const importedWorkbook = createWorkbook({ name: 'Imported', firstSheetName: 'Imported sheet' })
    const importedSheet = importedWorkbook.sheetsById.get(importedWorkbook.activeSheetId)!
    importedSheet.cells.set('A1', { value: { kind: 'string', value: 'from file' } })
    importedSheet.dimensions.usedRange = { start: { row: 1, column: 1 }, end: { row: 1, column: 1 } }
    const result: XlsxImportPreflight = {
      workbook: importedWorkbook,
      report: {
        fileName: 'import.xlsx',
        sheetCount: 1,
        cellCount: 1,
        canOpen: true,
        findings: [{ code: 'supported-content', category: 'supported', count: 1, partNames: ['xl/workbook.xml'] }],
      },
    }
    const WorkerMock = class {
      private listeners = new Set<(event: MessageEvent) => void>()
      addEventListener(_type: string, listener: (event: MessageEvent) => void) {
        this.listeners.add(listener)
      }
      postMessage() {
        queueMicrotask(() => {
          const event = new MessageEvent('message', { data: { type: 'result', result } })
          this.listeners.forEach((listener) => listener(event))
        })
      }
      terminate() {}
    }
    vi.stubGlobal('Worker', WorkerMock)
    const { container } = render(<Grid locale="en" setIsDirty={setIsDirty} />)
    const grid = screen.getByRole('grid', { name: 'Spreadsheet grid' })
    fireEvent.keyDown(grid, { key: 'o' })
    const editor = screen.getByRole('textbox', { name: 'Edit cell A1' })
    fireEvent.change(editor, { target: { value: 'old workbook' } })
    fireEvent.keyDown(editor, { key: 'Enter' })
    expect(setIsDirty).toHaveBeenLastCalledWith(true)

    const input = container.querySelector<HTMLInputElement>('input[type="file"]')!
    const file = new File(['zip bytes'], 'import.xlsx')
    Object.defineProperty(file, 'arrayBuffer', { value: async () => new Uint8Array([1, 2, 3]).buffer })
    fireEvent.change(input, { target: { files: [file] } })
    const dialog = await waitFor(() => screen.getByRole('dialog', { name: 'Workbook compatibility check' }))
    expect(dialog).toHaveTextContent('Supported and editable')
    expect(dialog).toHaveTextContent('1 sheets and 1 populated cells')
    expect(screen.getByRole('gridcell', { name: 'A1, old workbook' })).toBeVisible()

    fireEvent.click(screen.getByRole('button', { name: 'Cancel', exact: true }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(screen.getByRole('gridcell', { name: 'A1, old workbook' })).toBeVisible()
    expect(setIsDirty).toHaveBeenLastCalledWith(true)
    expect(screen.queryByRole('button', { name: 'Imported sheet' })).not.toBeInTheDocument()
  })

  it('edits in the cell with one draft and supports cancel, Enter, Tab, and multiline input', () => {
    const setIsDirty = vi.fn()
    render(<Grid locale="en" setIsDirty={setIsDirty} />)
    const grid = screen.getByRole('grid', { name: 'Spreadsheet grid' })

    fireEvent.keyDown(grid, { key: 'x' })
    let editor = screen.getByRole('textbox', { name: 'Edit cell A1' })
    expect(editor).toHaveFocus()
    fireEvent.change(editor, { target: { value: 'discard this' } })
    expect(setIsDirty).toHaveBeenLastCalledWith(true)
    fireEvent.keyDown(editor, { key: 'Escape' })
    expect(screen.getByRole('gridcell', { name: 'A1, empty' })).toBeVisible()
    expect(setIsDirty).toHaveBeenLastCalledWith(false)

    fireEvent.keyDown(grid, { key: 'F2' })
    editor = screen.getByRole('textbox', { name: 'Edit cell A1' })
    fireEvent.change(editor, { target: { value: 'first linesecond line' } })
    editor.setSelectionRange(10, 10)
    fireEvent.keyDown(editor, { key: 'Enter', altKey: true })
    expect(editor).toHaveValue('first line\nsecond line')
    fireEvent.keyDown(editor, { key: 'Tab' })
    expect(screen.getByRole('status')).toHaveTextContent('B1')
    expect(screen.getByRole('gridcell', { name: /A1, first line\s+second line/ })).toBeVisible()

    fireEvent.doubleClick(screen.getByRole('gridcell', { name: 'B1, empty' }))
    editor = screen.getByRole('textbox', { name: 'Edit cell B1' })
    fireEvent.change(editor, { target: { value: 'double click' } })
    fireEvent.keyDown(editor, { key: 'Enter' })
    expect(screen.getByRole('gridcell', { name: 'B1, double click' })).toBeVisible()
  })

  it('fills selected cells as one undoable edit and supports undo/redo shortcuts', () => {
    render(<Grid locale="en" />)
    const grid = screen.getByRole('grid', { name: 'Spreadsheet grid' })
    const nameBox = screen.getByRole('textbox', { name: 'Name box' })
    const formulaBar = screen.getByRole('textbox', { name: 'Formula bar' })

    fireEvent.change(nameBox, { target: { value: 'A1:B2' } })
    fireEvent.keyDown(nameBox, { key: 'Enter' })
    fireEvent.change(formulaBar, { target: { value: 'filled' } })
    fireEvent.keyDown(formulaBar, { key: 'Enter', ctrlKey: true })
    for (const address of ['A1', 'B1', 'A2', 'B2']) {
      expect(screen.getByRole('gridcell', { name: `${address}, filled` })).toBeVisible()
    }

    fireEvent.keyDown(grid, { key: 'z', ctrlKey: true })
    expect(screen.getByRole('gridcell', { name: 'A1, empty' })).toBeVisible()
    fireEvent.keyDown(grid, { key: 'y', ctrlKey: true })
    expect(screen.getByRole('gridcell', { name: 'B2, filled' })).toBeVisible()
    fireEvent.keyDown(grid, { key: 'z', ctrlKey: true })
    expect(screen.getByRole('gridcell', { name: 'A1, empty' })).toBeVisible()
    fireEvent.keyDown(grid, { key: 'z', ctrlKey: true, shiftKey: true })
    expect(screen.getByRole('gridcell', { name: 'B2, filled' })).toBeVisible()
  })

  it('keeps formulas and apostrophe-prefixed literal text distinct when edited again', () => {
    render(<Grid locale="en" />)
    const grid = screen.getByRole('grid', { name: 'Spreadsheet grid' })

    grid.focus()
    fireEvent.keyDown(grid, { key: '=' })
    let editor = screen.getByRole('textbox', { name: 'Edit cell A1' })
    fireEvent.change(editor, { target: { value: '=1+1' } })
    fireEvent.keyDown(editor, { key: 'Enter' })
    expect(screen.getByRole('textbox', { name: 'Formula bar' })).toHaveValue('=1+1')
    expect(screen.getByRole('gridcell', { name: 'A1, empty' })).toBeVisible()

    const formulaBar = screen.getByRole('textbox', { name: 'Formula bar' })
    fireEvent.change(formulaBar, { target: { value: "'=1+1" } })
    fireEvent.keyDown(formulaBar, { key: 'Enter' })
    expect(screen.getByRole('gridcell', { name: 'A1, =1+1' })).toBeVisible()

    fireEvent.keyDown(grid, { key: 'F2' })
    editor = screen.getByRole('textbox', { name: 'Edit cell A1' })
    expect(editor).toHaveValue("'=1+1")
    fireEvent.keyDown(editor, { key: 'Enter' })
    expect(screen.getByRole('gridcell', { name: 'A1, =1+1' })).toBeVisible()
    expect(screen.getByRole('textbox', { name: 'Formula bar' })).toHaveValue('=1+1')
  })

  it('commits a cell draft before switching sheets', () => {
    const setIsDirty = vi.fn()
    render(<Grid locale="en" setIsDirty={setIsDirty} />)
    const grid = screen.getByRole('grid', { name: 'Spreadsheet grid' })

    grid.focus()
    fireEvent.keyDown(grid, { key: 't' })
    const editor = screen.getByRole('textbox', { name: 'Edit cell A1' })
    fireEvent.change(editor, { target: { value: 'kept on Sheet1' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add sheet' }))
    expect(screen.getByRole('tab', { name: 'Sheet2' })).toHaveAttribute('aria-selected', 'true')
    expect(setIsDirty).toHaveBeenLastCalledWith(true)

    fireEvent.click(screen.getByRole('tab', { name: 'Sheet1' }))
    expect(screen.getByRole('gridcell', { name: 'A1, kept on Sheet1' })).toBeVisible()
  })

  it('inserts a selected block of rows as one undoable context-menu action', () => {
    render(<Grid locale="en" />)
    const grid = screen.getByRole('grid', { name: 'Spreadsheet grid' })
    const nameBox = screen.getByRole('textbox', { name: 'Name box' })
    const formulaBar = screen.getByRole('textbox', { name: 'Formula bar' })

    fireEvent.change(nameBox, { target: { value: 'A2:A3' } })
    fireEvent.keyDown(nameBox, { key: 'Enter' })
    fireEvent.change(formulaBar, { target: { value: 'bulk' } })
    fireEvent.keyDown(formulaBar, { key: 'Enter', ctrlKey: true })

    fireEvent.contextMenu(document.querySelector('[data-row-header="2"]')!)
    fireEvent.click(screen.getByRole('menuitem', { name: 'Insert 2 rows above' }))
    expect(screen.getByRole('gridcell', { name: 'A4, bulk' })).toBeVisible()
    expect(screen.getByRole('gridcell', { name: 'A5, bulk' })).toBeVisible()

    fireEvent.keyDown(grid, { key: 'z', ctrlKey: true })
    expect(screen.getByRole('gridcell', { name: 'A2, bulk' })).toBeVisible()
    expect(screen.getByRole('gridcell', { name: 'A3, bulk' })).toBeVisible()
  })

  it('opens an accessible context menu with honest disabled clipboard placeholders', () => {
    render(<Grid locale="pl" />)
    const grid = screen.getByRole('grid', { name: 'Siatka arkusza' })
    fireEvent.contextMenu(screen.getByRole('gridcell', { name: 'A1, pusta' }))

    expect(screen.getByRole('menu', { name: 'Działania na komórkach' })).toBeVisible()
    expect(screen.getByRole('menuitem', { name: 'Kopiowanie (jeszcze niedostępne)' })).toBeDisabled()
    expect(screen.getByRole('menuitem', { name: 'Wycinanie (jeszcze niedostępne)' })).toBeDisabled()
    expect(screen.getByRole('menuitem', { name: 'Wklejanie (jeszcze niedostępne)' })).toBeDisabled()
    fireEvent.keyDown(screen.getByRole('menu'), { key: 'Escape' })
    expect(grid).toHaveFocus()
  })

  it('announces the optional touch range-selection mode', () => {
    render(<Grid locale="en" />)
    const toggle = screen.getByRole('button', { name: 'Toggle touch range selection' })

    expect(toggle).toHaveAttribute('aria-pressed', 'false')
    fireEvent.click(toggle)
    expect(toggle).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('status')).toHaveTextContent('Drag across cells to select a range')
    expect(document.querySelector('.grid-app')).toHaveAttribute('data-range-selection', 'true')
  })

  it('renders only a bounded virtual subset of the finite sheet window', () => {
    render(<Grid locale="en" />)
    const grid = screen.getByRole('grid', { name: 'Spreadsheet grid' })
    const mountedCells = screen.getAllByRole('gridcell')

    expect(Number(grid.getAttribute('aria-rowcount')) * Number(grid.getAttribute('aria-colcount'))).toBeGreaterThan(
      2_000,
    )
    expect(mountedCells.length).toBeLessThan(2_000)
  })

  it('supports spreadsheet navigation, Shift ranges, name-box jumps, and viewport edges', () => {
    render(<Grid locale="en" />)
    const grid = screen.getByRole('grid', { name: 'Spreadsheet grid' })
    grid.focus()

    fireEvent.keyDown(grid, { key: 'ArrowRight' })
    fireEvent.keyDown(grid, { key: 'ArrowDown', shiftKey: true })
    expect(grid).toHaveAttribute('aria-activedescendant', 'grid-cell-B2')
    expect(screen.getByRole('gridcell', { name: 'B2, empty' })).toHaveAttribute('aria-selected', 'true')

    fireEvent.keyDown(grid, { key: 'Tab' })
    expect(grid).toHaveAttribute('aria-activedescendant', 'grid-cell-C2')
    fireEvent.keyDown(grid, { key: 'Enter', shiftKey: true })
    expect(screen.getByRole('status')).toHaveTextContent('C1')
    fireEvent.keyDown(grid, { key: 'Home' })
    expect(grid).toHaveAttribute('aria-activedescendant', 'grid-cell-A1')
    expect(screen.getByRole('gridcell', { name: 'A1, empty' })).toBeVisible()
    fireEvent.keyDown(grid, { key: 'End' })
    expect(screen.getByRole('status')).toHaveTextContent('Z1')
    fireEvent.keyDown(grid, { key: 'Home', ctrlKey: true })
    expect(grid).toHaveAttribute('aria-activedescendant', 'grid-cell-A1')

    const nameBox = screen.getByRole('textbox', { name: 'Name box' })
    fireEvent.change(nameBox, { target: { value: 'A1:D20' } })
    fireEvent.keyDown(nameBox, { key: 'Enter' })
    expect(nameBox).toHaveValue('A1:D20')
    expect(screen.getByRole('status')).toHaveTextContent('D20')
    expect(screen.getByRole('gridcell', { name: 'D20, empty' })).toHaveAttribute('aria-selected', 'true')
  })

  it('keeps focus on the grid after adding and switching sheets', () => {
    render(<Grid locale="en" />)
    const grid = screen.getByRole('grid', { name: 'Spreadsheet grid' })
    fireEvent.click(screen.getByRole('button', { name: 'Add sheet' }))
    expect(screen.getByRole('tab', { name: 'Sheet2' })).toHaveAttribute('aria-selected', 'true')
    expect(document.activeElement).toBe(grid)

    fireEvent.click(screen.getByRole('tab', { name: 'Sheet1' }))
    expect(document.activeElement).toBe(grid)
    expect(grid).toHaveAttribute('aria-activedescendant', 'grid-cell-A1')
  })

  it.each([
    ['dark', false, 'dark'],
    ['light', false, 'light'],
    ['e-ink-light', true, 'e-ink-light'],
    ['e-ink-dark', true, 'e-ink-dark'],
  ] as const)('uses the shared %s theme tokens', (theme, isEink, expected) => {
    render(
      <ThemeProvider defaultTheme={theme} storageKey={`grid-test-${theme}`}>
        <Grid locale="en" isEink={isEink} />
      </ThemeProvider>,
    )

    expect(document.querySelector('.grid-app')).toHaveAttribute('data-theme', expected)
  })
})
