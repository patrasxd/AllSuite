import { describe, expect, it } from 'vitest'
import { canonicalizeFormulaInput, getFormulaFunctionHelp } from './locale'

describe('localized formula tokenization', () => {
  it('normalizes Polish function names, decimal commas and separators independent of UI language', () => {
    expect(canonicalizeFormulaInput('=SUMA(1,5; 2,5)', 'en')).toEqual({
      canonicalExpression: '=SUM(1.5, 2.5)',
      supportedSyntax: true,
      detectedLocale: 'pl',
    })
    expect(canonicalizeFormulaInput('=SUM(1.5, 2.5)', 'pl')).toEqual({
      canonicalExpression: '=SUM(1.5, 2.5)',
      supportedSyntax: true,
      detectedLocale: 'en',
    })
  })

  it('normalizes nested IF and aggregation calls without editing quoted text or sheet names', () => {
    const source = `=JEŻELI('Arkusz,; 1'!$A$1>0;SUMA(1,5;2,5);"tekst,; ""SUMA()""")`
    const result = canonicalizeFormulaInput(source, 'en')
    expect(result).toEqual({
      canonicalExpression: `=IF('Arkusz,; 1'!$A$1>0,SUM(1.5,2.5),"tekst,; ""SUMA()""")`,
      supportedSyntax: true,
      detectedLocale: 'pl',
    })
  })

  it('does not translate an unsupported expression or array constant', () => {
    const unknownFunction = '=FUTUREFUNC(SUMA(1,5;2,5);"IF(A1,1,0)")'
    expect(canonicalizeFormulaInput(unknownFunction, 'pl')).toMatchObject({
      canonicalExpression: unknownFunction,
      supportedSyntax: false,
      unsupportedReason: 'unknown-function',
    })
    const array = '={1,2;3,4}'
    expect(canonicalizeFormulaInput(array, 'pl')).toMatchObject({
      canonicalExpression: array,
      supportedSyntax: false,
      unsupportedReason: 'array-constant',
    })

    const structuredReference = '=JEŻELI([Book.xlsx]Sheet1!A1>0;1,5;0)'
    expect(canonicalizeFormulaInput(structuredReference, 'en')).toMatchObject({
      canonicalExpression: structuredReference,
      supportedSyntax: false,
      unsupportedReason: 'opaque-reference',
    })

    const malformed = '=SUMA(1,5;2,5'
    expect(canonicalizeFormulaInput(malformed, 'en')).toMatchObject({
      canonicalExpression: malformed,
      supportedSyntax: false,
      unsupportedReason: 'malformed-token',
    })
  })

  it('preserves strings with doubled quotes and error tokens while converting surrounding tokens', () => {
    const source = '=JEŻELI(A1=#N/D;"cudzysłów "" i ;,";A1)'
    expect(canonicalizeFormulaInput(source, 'en').canonicalExpression).toBe('=IF(A1=#N/D,"cudzysłów "" i ;,",A1)')
  })

  it('keeps a Polish decimal formula usable when the UI is Polish and exposes localized help aliases', async () => {
    expect(canonicalizeFormulaInput('=1,25+0,75', 'pl')).toMatchObject({
      canonicalExpression: '=1.25+0.75',
      supportedSyntax: true,
      detectedLocale: 'pl',
    })
    expect(getFormulaFunctionHelp('pl').find((functionHelp) => functionHelp.canonicalName === 'IF')).toMatchObject({
      localizedName: 'JEŻELI',
    })
  })

  it('tokenizes every displayed Polish alias from the verified function palette', () => {
    const functions = getFormulaFunctionHelp('pl')
    expect(functions).toHaveLength(34)
    for (const item of functions) {
      expect(canonicalizeFormulaInput(`=${item.localizedName}(1;2)`, 'en')).toMatchObject({
        canonicalExpression: `=${item.canonicalName}(1,2)`,
        supportedSyntax: true,
      })
    }
  })
})
