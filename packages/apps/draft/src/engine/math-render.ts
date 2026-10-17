import katex from 'katex'
import { sanitizeLatexInput } from './math-safety'

export { sanitizeLatexInput } from './math-safety'

const renderOptions = {
  throwOnError: true,
  trust: false,
  strict: 'ignore' as const,
  maxExpand: 1_000,
  maxSize: 20,
}

export function renderLatex(latex: string, displayMode = false): string | null {
  const source = sanitizeLatexInput(latex)
  if (source === null) return null
  try {
    return katex.renderToString(source, { ...renderOptions, displayMode, output: 'htmlAndMathml' })
  } catch {
    return null
  }
}
