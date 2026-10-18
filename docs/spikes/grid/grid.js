const ROWS = 100
const COLUMNS = 100
const CELL_WIDTH = 112
const ROW_HEIGHT = 32
const OVERSCAN = 2
const grid = document.querySelector('#grid')
const world = document.querySelector('#world')
const header = document.querySelector('#column-head-inner')
const status = document.querySelector('#selection-status')
const announcement = document.querySelector('#announcement')
const values = new Map()
let selectedRow = 0
let selectedColumn = 0
let editing = false

world.style.width = `${COLUMNS * CELL_WIDTH}px`
world.style.height = `${ROWS * ROW_HEIGHT}px`
header.style.width = `${COLUMNS * CELL_WIDTH}px`

function columnName(index) {
  let value = index + 1
  let name = ''
  while (value > 0) {
    value -= 1
    name = String.fromCharCode(65 + (value % 26)) + name
    value = Math.floor(value / 26)
  }
  return name
}

function address(row, column) {
  return `${columnName(column)}${row + 1}`
}

function cellValue(row, column) {
  const key = `${row}:${column}`
  return values.get(key) ?? (row === 0 && column === 0 ? 'Grid proof' : `${row + 1}, ${columnName(column)}`)
}

function setSelection(row, column) {
  selectedRow = Math.max(0, Math.min(ROWS - 1, row))
  selectedColumn = Math.max(0, Math.min(COLUMNS - 1, column))
  const top = selectedRow * ROW_HEIGHT
  const left = selectedColumn * CELL_WIDTH
  if (top < grid.scrollTop) grid.scrollTop = top
  else if (top + ROW_HEIGHT > grid.scrollTop + grid.clientHeight) grid.scrollTop = top + ROW_HEIGHT - grid.clientHeight
  if (left < grid.scrollLeft) grid.scrollLeft = left
  else if (left + CELL_WIDTH > grid.scrollLeft + grid.clientWidth)
    grid.scrollLeft = left + CELL_WIDTH - grid.clientWidth
  const activeId = `cell-${selectedRow}-${selectedColumn}`
  grid.setAttribute('aria-activedescendant', activeId)
  status.textContent = address(selectedRow, selectedColumn)
  announcement.textContent = `${address(selectedRow, selectedColumn)}, ${cellValue(selectedRow, selectedColumn)}`
  render()
  const active = document.getElementById(activeId)
  active?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
}

function renderHeader() {
  const firstColumn = Math.max(0, Math.floor(grid.scrollLeft / CELL_WIDTH) - OVERSCAN)
  const visibleColumns = Math.ceil(grid.clientWidth / CELL_WIDTH) + OVERSCAN * 2 + 1
  const lastColumn = Math.min(COLUMNS, firstColumn + visibleColumns)
  header.replaceChildren()
  for (let column = firstColumn; column < lastColumn; column += 1) {
    const label = document.createElement('div')
    label.className = 'column-label'
    label.style.left = `${column * CELL_WIDTH}px`
    label.textContent = columnName(column)
    header.append(label)
  }
}

function render() {
  const firstRow = Math.max(0, Math.floor(grid.scrollTop / ROW_HEIGHT) - OVERSCAN)
  const firstColumn = Math.max(0, Math.floor(grid.scrollLeft / CELL_WIDTH) - OVERSCAN)
  const visibleRows = Math.ceil(grid.clientHeight / ROW_HEIGHT) + OVERSCAN * 2 + 1
  const visibleColumns = Math.ceil(grid.clientWidth / CELL_WIDTH) + OVERSCAN * 2 + 1
  const lastRow = Math.min(ROWS, firstRow + visibleRows)
  const lastColumn = Math.min(COLUMNS, firstColumn + visibleColumns)
  const rowIndices = Array.from({ length: lastRow - firstRow }, (_, index) => firstRow + index)
  const columnIndices = Array.from({ length: lastColumn - firstColumn }, (_, index) => firstColumn + index)
  if (!rowIndices.includes(selectedRow)) rowIndices.push(selectedRow)
  if (!columnIndices.includes(selectedColumn)) columnIndices.push(selectedColumn)
  rowIndices.sort((left, right) => left - right)
  columnIndices.sort((left, right) => left - right)
  const fragment = document.createDocumentFragment()

  for (const row of rowIndices) {
    const rowElement = document.createElement('div')
    rowElement.className = 'grid-row'
    rowElement.setAttribute('role', 'row')
    rowElement.setAttribute('aria-rowindex', String(row + 1))
    rowElement.style.top = `${row * ROW_HEIGHT}px`
    for (const column of columnIndices) {
      const cell = document.createElement('div')
      const cellId = `cell-${row}-${column}`
      cell.className = 'grid-cell'
      cell.id = cellId
      cell.setAttribute('role', 'gridcell')
      cell.setAttribute('aria-rowindex', String(row + 1))
      cell.setAttribute('aria-colindex', String(column + 1))
      cell.setAttribute('aria-selected', String(row === selectedRow && column === selectedColumn))
      cell.setAttribute('aria-label', `${address(row, column)} ${cellValue(row, column)}`)
      cell.style.left = `${column * CELL_WIDTH}px`
      cell.textContent = cellValue(row, column)
      if (row === selectedRow && column === selectedColumn) {
        if (editing) {
          const input = document.createElement('input')
          input.value = String(cellValue(row, column))
          input.setAttribute('aria-label', `Edit ${address(row, column)}`)
          input.dataset.editor = 'true'
          cell.replaceChildren(input)
        }
      }
      cell.addEventListener('click', () => {
        grid.focus()
        setSelection(row, column)
      })
      rowElement.append(cell)
    }
    fragment.append(rowElement)
  }
  world.replaceChildren(fragment)
  renderHeader()
  if (editing) {
    const input = world.querySelector('[data-editor="true"]')
    input?.focus()
    input?.select()
  }
}

function finishEdit(commit) {
  const input = world.querySelector('[data-editor="true"]')
  if (commit && input) values.set(`${selectedRow}:${selectedColumn}`, input.value)
  editing = false
  render()
  grid.focus()
  announcement.textContent = `${address(selectedRow, selectedColumn)}, ${cellValue(selectedRow, selectedColumn)}`
}

grid.addEventListener('scroll', render, { passive: true })
grid.addEventListener('keydown', (event) => {
  if (editing) return
  let row = selectedRow
  let column = selectedColumn
  if (event.key === 'ArrowDown') row += 1
  else if (event.key === 'ArrowUp') row -= 1
  else if (event.key === 'ArrowRight') column += 1
  else if (event.key === 'ArrowLeft') column -= 1
  else if (event.key === 'Home') column = event.ctrlKey ? 0 : 0
  else if (event.key === 'End') column = COLUMNS - 1
  else if (event.key === 'Tab') column += event.shiftKey ? -1 : 1
  else if (event.key === 'Enter' || event.key === 'F2') {
    event.preventDefault()
    editing = true
    render()
    return
  } else return
  event.preventDefault()
  if (event.ctrlKey && event.key === 'Home') {
    row = 0
    column = 0
  }
  if (event.ctrlKey && event.key === 'End') {
    row = ROWS - 1
    column = COLUMNS - 1
  }
  setSelection(row, column)
})

world.addEventListener('keydown', (event) => {
  if (event.target?.dataset?.editor !== 'true') return
  if (event.key === 'Enter') {
    event.preventDefault()
    event.stopPropagation()
    finishEdit(true)
  }
  if (event.key === 'Escape') {
    event.preventDefault()
    event.stopPropagation()
    finishEdit(false)
  }
})

render()
setSelection(0, 0)
