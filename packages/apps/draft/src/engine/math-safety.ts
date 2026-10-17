const MAX_LATEX_LENGTH = 10_000
const forbiddenCommands = new Set([
  'def',
  'edef',
  'gdef',
  'xdef',
  'let',
  'futurelet',
  'csname',
  'input',
  'include',
  'includegraphics',
  'write',
  'openout',
  'read',
  'usepackage',
  'href',
  'url',
  'html',
  'htmlclass',
  'htmlid',
  'htmlstyle',
  'htmldata',
])

export function sanitizeLatexInput(value: string): string | null {
  if (typeof value !== 'string' || value.length > MAX_LATEX_LENGTH || value.includes('\0')) return null
  for (let index = 0; index < value.length; index++) {
    if (value[index] !== '\\') continue
    if (value[index + 1] === '\\') {
      index++
      continue
    }
    const match = /^[A-Za-z]+/.exec(value.slice(index + 1))
    if (!match) continue
    if (forbiddenCommands.has(match[0].toLowerCase())) return null
    index += match[0].length
  }
  return value
}
