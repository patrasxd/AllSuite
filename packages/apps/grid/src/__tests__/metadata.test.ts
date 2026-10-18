import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import ts from 'typescript'
import { metadata } from '../metadata'

describe('Grid metadata', () => {
  it('provides a bilingual, local catalog entry', () => {
    expect(metadata.slug).toBe('grid')
    expect(metadata.name).toEqual({ en: 'Grid', pl: 'Grid' })
    expect(metadata.description.en).toContain('development')
    expect(metadata.description.pl).toContain('przygotowaniu')
    expect(metadata.icon).toBeTruthy()
  })

  it('stays separate from the lazy runtime and workbook engines', () => {
    const source = readFileSync(resolve(process.cwd(), 'packages/apps/grid/src/metadata.ts'), 'utf8')
    expect(source).not.toMatch(/from\s+['"]\.\/(?:Grid|index)/)
    expect(source).not.toMatch(/xlsx|formula|workbook|zip/i)
    const module = ts.createSourceFile('metadata.ts', source, ts.ScriptTarget.Latest, true)
    const runtimeImports = module.statements.flatMap((statement) => {
      if (!ts.isImportDeclaration(statement) || statement.importClause?.isTypeOnly) return []
      return ts.isStringLiteral(statement.moduleSpecifier) ? [statement.moduleSpecifier.text] : []
    })
    expect(runtimeImports).toEqual(['react'])
    expect(module.statements.some(ts.isExportDeclaration)).toBe(false)
  })
})
