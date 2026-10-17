import { describe, expect, it } from 'vitest'
import { latexToOmml, ommlToLatex } from './math'
import { renderLatex } from './math-render'
import { sanitizeLatexInput } from './math-safety'

describe('LaTeX math rendering and safety', () => {
  it('renders an expression with KaTeX and produces Office Math markup', () => {
    const source = '\\frac{x_1}{\\sqrt{y^2}}'
    const html = renderLatex(source)
    const inline = latexToOmml(source)
    const block = latexToOmml(source, true)

    expect(html).toContain('class="katex"')
    expect(html).toContain('class="katex-mathml"')
    expect(inline).toContain('<m:oMath')
    expect(inline).toContain('<m:f>')
    expect(inline).toContain('<m:rad>')
    expect(inline).toContain('<m:sSub>')
    expect(block).toContain('<m:oMathPara')
  })

  it('rejects active LaTeX commands and caps input before rendering', () => {
    for (const source of [
      '\\href{javascript:alert(1)}{run}',
      '\\htmlClass{attack}{x}',
      '\\includegraphics{remote.svg}',
      '\\input{/etc/passwd}',
      '\\def\\x{unsafe}\\x',
      'x'.repeat(10_001),
    ]) {
      expect(sanitizeLatexInput(source)).toBeNull()
      expect(renderLatex(source)).toBeNull()
      expect(latexToOmml(source)).toBeNull()
    }
  })

  it('keeps escaped command separators safe and rejects markup as invalid math', () => {
    expect(sanitizeLatexInput('a\\\\href')).toBe('a\\\\href')
    const html = renderLatex('<img src=x onerror=alert(1)>')
    expect(html).toContain('&lt;img')
    expect(html).not.toContain('<img')
  })

  it('round-trips the supported OMML subset and rejects unknown structures', () => {
    const xml = latexToOmml('\\frac{a}{b}')!
    expect(ommlToLatex(xml)).toContain('\\frac')
    expect(
      ommlToLatex(
        '<m:oMath xmlns:m="http://schemas.openxmlformats.org/officeDocument/2006/math"><m:func><m:e><m:r><m:t>x</m:t></m:r></m:e></m:func></m:oMath>',
      ),
    ).toBeNull()
  })
})
