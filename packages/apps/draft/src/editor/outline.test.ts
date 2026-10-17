import { afterEach, describe, expect, it } from 'vitest'
import { Editor } from '@tiptap/core'
import { editorExtensions } from './extensions'
import { moveOutlineSection, moveOutlineSectionBefore, outlineSectionMoves } from './outline'

let editor: Editor | undefined
afterEach(() => {
  editor?.destroy()
  editor = undefined
})

function createEditor(content: string) {
  editor = new Editor({ content, extensions: editorExtensions({ requestPlainPaste: () => {}, requestLink: () => {} }) })
  return editor
}

function topLevelHeadings(current: Editor) {
  return current.state.doc.content.content
    .filter((node) => node.type.name === 'heading')
    .map((node) => node.textContent)
}

describe('outline section ordering', () => {
  it('moves a heading section with its nested headings using the keyboard move action', () => {
    const current = createEditor(
      '<h1 id="alpha">Alpha</h1><p>Alpha text</p><h1 id="beta">Beta</h1><p>Beta text</p><h2 id="detail">Detail</h2><p>Detail text</p><h1 id="gamma">Gamma</h1>',
    )

    expect(outlineSectionMoves(current).get('beta')).toEqual({ up: true, down: true })
    expect(moveOutlineSection(current, 'beta', -1)).toBe(true)
    expect(topLevelHeadings(current)).toEqual(['Beta', 'Detail', 'Alpha', 'Gamma'])
    expect(current.getText()).toMatch(/Beta[\s\S]*Beta text[\s\S]*Detail[\s\S]*Detail text[\s\S]*Alpha/)

    expect(moveOutlineSection(current, 'beta', 1)).toBe(true)
    expect(topLevelHeadings(current)).toEqual(['Alpha', 'Beta', 'Detail', 'Gamma'])
  })

  it('supports drag reorder before a same-level heading and preserves section content', () => {
    const current = createEditor(
      '<h1 id="alpha">Alpha</h1><p>A body</p><h1 id="beta">Beta</h1><p>B body</p><h1 id="gamma">Gamma</h1>',
    )

    expect(moveOutlineSectionBefore(current, 'gamma', 'alpha')).toBe(true)
    expect(topLevelHeadings(current)).toEqual(['Gamma', 'Alpha', 'Beta'])
    expect(current.getText()).toMatch(/Alpha[\s\S]*A body/)
    expect(current.getText()).toMatch(/Beta[\s\S]*B body/)
    expect(moveOutlineSectionBefore(current, 'alpha', 'alpha')).toBe(false)
  })

  it('does not move headings across table or list containers', () => {
    const current = createEditor(
      '<table><tbody><tr><td><h2 id="cell-heading">Cell heading</h2></td></tr></tbody></table><ul><li><h2 id="list-heading">List heading</h2></li></ul>',
    )

    expect(outlineSectionMoves(current).get('cell-heading')).toEqual({ up: false, down: false })
    expect(outlineSectionMoves(current).get('list-heading')).toEqual({ up: false, down: false })
    expect(moveOutlineSectionBefore(current, 'cell-heading', 'list-heading')).toBe(false)
  })
})
