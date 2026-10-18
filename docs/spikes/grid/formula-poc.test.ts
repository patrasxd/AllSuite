import { describe, expect, it } from 'vitest'

type Cell = { value?: number; formula?: string }
type Workbook = Record<string, Record<string, Cell>>

function tokenizeFormula(formula: string, locale: 'en' | 'pl'): string {
  const names =
    locale === 'pl'
      ? new Map([
          ['SUMA', 'SUM'],
          ['ŚREDNIA', 'AVERAGE'],
        ])
      : new Map<string, string>()
  let output = ''
  let token = ''
  let quoted = false
  const flush = () => {
    if (!token) return
    const next = names.get(token.toLocaleUpperCase('pl-PL')) ?? token
    output += next
    token = ''
  }
  for (let index = 0; index < formula.length; index += 1) {
    const char = formula[index]!
    if (char === '"') {
      flush()
      quoted = !quoted
      output += char
    } else if (!quoted && /[A-Za-zĄĆĘŁŃÓŚŹŻąćęłńóśźż_]/u.test(char)) token += char
    else {
      const wasToken = Boolean(token)
      flush()
      output += !quoted && char === ';' ? ',' : char
      if (wasToken && char === '!' && output.endsWith(',')) output = output.slice(0, -1) + '!'
    }
  }
  flush()
  return output.startsWith('=') ? output : `=${output}`
}

type Token = { kind: 'number' | 'reference' | 'operator' | 'left' | 'right'; value: string }
function parseTokens(formula: string): Token[] {
  const source = formula.replace(/^=/, '')
  const pattern = /\s*('(?:[^']|'')+'|[A-Za-z_][A-Za-z0-9 _]*![A-Z]+[1-9]\d*|[A-Z]+[1-9]\d*|\d+(?:\.\d+)?|[()+*/-])/gy
  const tokens: Token[] = []
  let offset = 0
  while (offset < source.length) {
    pattern.lastIndex = offset
    const match = pattern.exec(source)
    if (!match) throw new Error(`Unsupported formula syntax near ${source.slice(offset)}`)
    const value = match[1]!
    const kind: Token['kind'] =
      value === '('
        ? 'left'
        : value === ')'
          ? 'right'
          : /^[0-9]/.test(value)
            ? 'number'
            : /^[+*/-]$/.test(value)
              ? 'operator'
              : 'reference'
    tokens.push({ kind, value })
    offset = pattern.lastIndex
  }
  return tokens
}

function recalculate(
  workbook: Workbook,
  sheetName: string,
  address: string,
  stack = new Set<string>(),
): number | '#CIRC!' {
  const identity = `${sheetName}!${address}`
  if (stack.has(identity)) return '#CIRC!'
  const cell = workbook[sheetName]?.[address]
  if (!cell) return 0
  if (cell.formula === undefined) return cell.value ?? 0
  const nextStack = new Set(stack).add(identity)
  const tokens = parseTokens(cell.formula)
  let cursor = 0
  const primary = (): number | '#CIRC!' => {
    const token = tokens[cursor++]
    if (!token) throw new Error('Expected value')
    if (token.kind === 'number') return Number(token.value)
    if (token.kind === 'reference') {
      const separator = token.value.lastIndexOf('!')
      const targetSheet =
        separator < 0 ? sheetName : token.value.slice(0, separator).replace(/^'|'$/g, '').replaceAll("''", "'")
      const targetAddress = separator < 0 ? token.value : token.value.slice(separator + 1)
      return recalculate(workbook, targetSheet, targetAddress, nextStack)
    }
    if (token.kind === 'operator' && token.value === '-') {
      const result = primary()
      return result === '#CIRC!' ? result : -result
    }
    if (token.kind === 'left') {
      const result = expression()
      if (tokens[cursor++]?.kind !== 'right') throw new Error('Expected closing parenthesis')
      return result
    }
    throw new Error(`Unexpected token ${token.value}`)
  }
  const term = (): number | '#CIRC!' => {
    let result = primary()
    while (tokens[cursor]?.value === '*' || tokens[cursor]?.value === '/') {
      const operator = tokens[cursor++]!.value
      const right = primary()
      if (result === '#CIRC!' || right === '#CIRC!') return '#CIRC!'
      result = operator === '*' ? result * right : result / right
    }
    return result
  }
  const expression = (): number | '#CIRC!' => {
    let result = term()
    while (tokens[cursor]?.value === '+' || tokens[cursor]?.value === '-') {
      const operator = tokens[cursor++]!.value
      const right = term()
      if (result === '#CIRC!' || right === '#CIRC!') return '#CIRC!'
      result = operator === '+' ? result + right : result - right
    }
    return result
  }
  return expression()
}

describe('Grid formula adapter spike', () => {
  it('normalizes Polish function tokens and separators but leaves sheet names and text alone', () => {
    expect(tokenizeFormula('=SUMA(Dane!A1;"SUMA;";Dane!A2)', 'pl')).toBe('=SUM(Dane!A1,"SUMA;",Dane!A2)')
  })

  it('recalculates dependent cells and cross-sheet references after a precedent changes', () => {
    const workbook: Workbook = {
      Data: { A1: { value: 3 }, A2: { value: 4 } },
      Summary: { A1: { formula: '=Data!A1+Data!A2' }, B1: { formula: '=A1*2' } },
    }
    expect(recalculate(workbook, 'Summary', 'B1')).toBe(14)
    workbook.Data.A1!.value = 8
    expect(recalculate(workbook, 'Summary', 'B1')).toBe(24)
  })

  it('detects direct and indirect cycles', () => {
    const workbook: Workbook = {
      Sheet1: { A1: { formula: '=B1+1' }, B1: { formula: '=A1+1' }, C1: { formula: '=C1' } },
    }
    expect(recalculate(workbook, 'Sheet1', 'A1')).toBe('#CIRC!')
    expect(recalculate(workbook, 'Sheet1', 'C1')).toBe('#CIRC!')
  })
})
