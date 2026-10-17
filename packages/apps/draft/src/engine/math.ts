import katex from 'katex'
import { DOMParser, type Element as XmlElement, type Node as XmlNode } from '@xmldom/xmldom'
import { sanitizeLatexInput } from './math-safety'

const mathNamespace = 'http://www.w3.org/1998/Math/MathML'
const officeMathNamespace = 'http://schemas.openxmlformats.org/officeDocument/2006/math'

const renderOptions = {
  throwOnError: true,
  trust: false,
  strict: 'ignore' as const,
  maxExpand: 1_000,
  maxSize: 20,
}

function localName(node: XmlNode): string {
  return (node as XmlElement).localName || node.nodeName.split(':').at(-1) || ''
}

function elementChildren(node: XmlNode): XmlElement[] {
  return Array.from(node.childNodes).filter((child): child is XmlElement => child.nodeType === 1)
}

function escapedXml(text: string): string {
  return text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
}

function ommlRun(text: string): string {
  if (!text) return ''
  return `<m:r><m:t xml:space="preserve">${escapedXml(text)}</m:t></m:r>`
}

function mmlToOmml(element: XmlElement): string {
  const tag = localName(element)
  const children = elementChildren(element)
  const content = () => children.map(mmlToOmml).join('')
  if (['math', 'semantics', 'mrow', 'mstyle', 'mpadded', 'mphantom', 'merror'].includes(tag))
    return tag === 'semantics'
      ? children
          .filter((child) => localName(child) !== 'annotation')
          .slice(0, 1)
          .map(mmlToOmml)
          .join('')
      : content()
  if (tag === 'annotation' || tag === 'annotation-xml') return ''
  if (['mi', 'mn', 'mo', 'mtext', 'ms', 'mglyph'].includes(tag)) return ommlRun(element.textContent || '')
  if (tag === 'mspace') return ommlRun(' ')
  if (tag === 'msup')
    return `<m:sSup><m:e>${mmlToOmml(children[0])}</m:e><m:sup>${mmlToOmml(children[1])}</m:sup></m:sSup>`
  if (tag === 'msub')
    return `<m:sSub><m:e>${mmlToOmml(children[0])}</m:e><m:sub>${mmlToOmml(children[1])}</m:sub></m:sSub>`
  if (tag === 'msubsup')
    return `<m:sSubSup><m:e>${mmlToOmml(children[0])}</m:e><m:sub>${mmlToOmml(children[1])}</m:sub><m:sup>${mmlToOmml(children[2])}</m:sup></m:sSubSup>`
  if (tag === 'mfrac') {
    const noBar = element.getAttribute('linethickness') === '0'
    return `<m:f><m:fPr>${noBar ? '<m:type m:val="noBar"/>' : ''}</m:fPr><m:num>${mmlToOmml(children[0])}</m:num><m:den>${mmlToOmml(children[1])}</m:den></m:f>`
  }
  if (tag === 'msqrt') return `<m:rad><m:radPr><m:degHide m:val="1"/></m:radPr><m:deg/><m:e>${content()}</m:e></m:rad>`
  if (tag === 'mroot')
    return `<m:rad><m:radPr/><m:deg>${mmlToOmml(children[1])}</m:deg><m:e>${mmlToOmml(children[0])}</m:e></m:rad>`
  if (tag === 'munder')
    return `<m:limLow><m:e>${mmlToOmml(children[0])}</m:e><m:lim>${mmlToOmml(children[1])}</m:lim></m:limLow>`
  if (tag === 'mover')
    return `<m:limUpp><m:e>${mmlToOmml(children[0])}</m:e><m:lim>${mmlToOmml(children[1])}</m:lim></m:limUpp>`
  if (tag === 'munderover')
    return `<m:limUpp><m:e><m:limLow><m:e>${mmlToOmml(children[0])}</m:e><m:lim>${mmlToOmml(children[1])}</m:lim></m:limLow></m:e><m:lim>${mmlToOmml(children[2])}</m:lim></m:limUpp>`
  if (tag === 'mfenced') {
    const open = element.getAttribute('open') ?? '('
    const close = element.getAttribute('close') ?? ')'
    return `<m:d><m:dPr><m:begChr m:val="${escapedXml(open)}"/><m:endChr m:val="${escapedXml(close)}"/></m:dPr><m:e>${content()}</m:e></m:d>`
  }
  if (tag === 'mtable')
    return `<m:m><m:mPr/><m:mr>${children
      .map((row) =>
        elementChildren(row)
          .map((cell) => `<m:e>${mmlToOmml(cell)}</m:e>`)
          .join(''),
      )
      .join('</m:mr><m:mr>')}</m:mr></m:m>`
  if (tag === 'mtr' || tag === 'mtd') return content()
  if (tag === 'menclose') return `<m:borderBox><m:borderBoxPr/><m:e>${content()}</m:e></m:borderBox>`
  return ommlRun(element.textContent || '')
}

export function latexToOmml(latex: string, displayMode = false): string | null {
  const source = sanitizeLatexInput(latex)
  if (source === null) return null
  try {
    const mathml = katex.renderToString(source, { ...renderOptions, displayMode, output: 'mathml' })
    const parsed = new DOMParser().parseFromString(mathml, 'text/xml')
    const math = parsed.getElementsByTagNameNS(mathNamespace, 'math').item(0)
    if (!math) return null
    const expression = mmlToOmml(math)
    const omath = `<m:oMath xmlns:m="${officeMathNamespace}">${expression}</m:oMath>`
    return displayMode ? `<m:oMathPara xmlns:m="${officeMathNamespace}">${omath}</m:oMathPara>` : omath
  } catch {
    return null
  }
}

function readOmml(element: XmlElement): string {
  const tag = localName(element)
  const children = elementChildren(element)
  const child = (name: string) => children.find((item) => localName(item) === name)
  const inside = (name: string) => (child(name) ? readOmml(child(name)!) : '')
  if (tag === 'r')
    return Array.from(element.getElementsByTagNameNS(officeMathNamespace, 't'))
      .map((node) => node.textContent || '')
      .join('')
  if (tag === 'f') return `\\frac{${inside('num')}}{${inside('den')}}`
  if (tag === 'sSup') return `{${inside('e')}}^{${inside('sup')}}`
  if (tag === 'sSub') return `{${inside('e')}}_{${inside('sub')}}`
  if (tag === 'sSubSup') return `{${inside('e')}}_{${inside('sub')}}^{${inside('sup')}}`
  if (tag === 'rad') {
    const degree = inside('deg')
    return degree ? `\\sqrt[${degree}]{${inside('e')}}` : `\\sqrt{${inside('e')}}`
  }
  if (tag === 'limLow') return `\\underset{${inside('lim')}}{${inside('e')}}`
  if (tag === 'limUpp') return `\\overset{${inside('lim')}}{${inside('e')}}`
  if (tag === 'd') {
    const begin = attrValue(child('dPr'), 'begChr') || '('
    const end = attrValue(child('dPr'), 'endChr') || ')'
    return `\\left${begin}${inside('e')}\\right${end}`
  }
  if (tag === 'm')
    return `\\begin{matrix}${children
      .filter((row) => localName(row) === 'mr')
      .map((row) => elementChildren(row).map(readOmml).join(' & '))
      .join(' \\\\ ')}\\end{matrix}`
  if (tag === 'e' || tag === 'num' || tag === 'den' || tag === 'sub' || tag === 'sup' || tag === 'deg' || tag === 'lim')
    return children.map(readOmml).join('')
  if (tag === 'oMath' || tag === 'oMathPara' || tag === 'mr') return children.map(readOmml).join('')
  return children.map(readOmml).join('')
}

const supportedOmmlElements = new Set([
  'oMath',
  'oMathPara',
  'r',
  't',
  'sSup',
  'sSub',
  'sSubSup',
  'e',
  'sup',
  'sub',
  'f',
  'fPr',
  'type',
  'num',
  'den',
  'rad',
  'radPr',
  'degHide',
  'deg',
  'limLow',
  'limUpp',
  'lim',
  'd',
  'dPr',
  'begChr',
  'endChr',
  'm',
  'mPr',
  'mr',
  'borderBox',
  'borderBoxPr',
  'ctrlPr',
  'rPr',
  'sty',
  'scr',
  'nor',
  'lit',
  'brk',
])

function hasUnsupportedOmml(math: XmlElement): boolean {
  const elements = math.getElementsByTagName('*')
  for (let index = 0; index < elements.length; index++) {
    const element = elements.item(index)
    if (element && !supportedOmmlElements.has(localName(element as XmlElement))) return true
  }
  return false
}

function attrValue(element: XmlElement | undefined, local: string): string | undefined {
  if (!element) return undefined
  const property = elementChildren(element).find((child) => localName(child) === local)
  return property?.getAttributeNS(officeMathNamespace, 'val') || property?.getAttribute('m:val') || undefined
}

export function ommlToLatex(xml: string): string | null {
  try {
    const parsed = new DOMParser().parseFromString(xml, 'text/xml')
    const math = parsed.getElementsByTagNameNS(officeMathNamespace, 'oMath').item(0)
    if (!math) return null
    return ommlElementToLatex(math)
  } catch {
    return null
  }
}

export function ommlElementToLatex(math: XmlElement): string | null {
  if (hasUnsupportedOmml(math)) return null
  return sanitizeLatexInput(readOmml(math))
}

export const MATHML_NAMESPACE = mathNamespace
