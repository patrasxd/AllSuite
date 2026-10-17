import { Node, mergeAttributes } from '@tiptap/core'
import type { Node as ProseMirrorNode } from '@tiptap/pm/model'
import 'katex/dist/katex.min.css'
import { renderLatex, sanitizeLatexInput } from '../engine/math-render'

function drawMath(element: HTMLElement, latex: string, displayMode: boolean) {
  const source = sanitizeLatexInput(latex)
  const html = source === null ? null : renderLatex(source, displayMode)
  element.replaceChildren()
  if (html) element.innerHTML = html
  else element.textContent = latex
  element.classList.toggle('draft-math-node--error', html === null)
}

function createMathNode(name: string, displayMode: boolean) {
  const tag = displayMode ? 'div' : 'span'
  return Node.create({
    name,
    group: displayMode ? 'block' : 'inline',
    inline: !displayMode,
    atom: true,
    selectable: true,
    defining: displayMode,
    addAttributes() {
      return {
        latex: {
          default: '',
          parseHTML: (element: HTMLElement) => sanitizeLatexInput(element.getAttribute('data-latex') || '') || '',
          renderHTML: (attributes: { latex?: unknown }) => ({
            'data-latex': sanitizeLatexInput(String(attributes.latex || '')) || '',
          }),
        },
      }
    },
    parseHTML() {
      return [{ tag: `[data-draft-math="${displayMode ? 'block' : 'inline'}"]` }]
    },
    renderHTML({ node, HTMLAttributes }) {
      const latex = sanitizeLatexInput(String(node.attrs.latex || '')) || ''
      return [tag, mergeAttributes(HTMLAttributes, { 'data-draft-math': displayMode ? 'block' : 'inline' }), latex]
    },
    addNodeView() {
      return ({ node: initial }) => {
        let current: ProseMirrorNode = initial
        const element = document.createElement(tag)
        element.className = `draft-math-node${displayMode ? ' draft-math-node--block' : ' draft-math-node--inline'}`
        element.contentEditable = 'false'
        element.setAttribute('data-draft-math', displayMode ? 'block' : 'inline')
        element.setAttribute('aria-label', displayMode ? 'Equation' : 'Inline equation')
        const update = () => {
          const latex = String(current.attrs.latex || '')
          element.setAttribute('data-latex', sanitizeLatexInput(latex) || '')
          drawMath(element, latex, displayMode)
        }
        update()
        return {
          dom: element,
          update(next) {
            if (next.type !== current.type) return false
            current = next
            update()
            return true
          },
          selectNode() {
            element.classList.add('ProseMirror-selectednode')
          },
          deselectNode() {
            element.classList.remove('ProseMirror-selectednode')
          },
          ignoreMutation: () => true,
        }
      }
    },
    renderText: ({ node }) => String(node.attrs.latex || ''),
  })
}

export const InlineMath = createMathNode('mathInline', false)
export const BlockMath = createMathNode('mathBlock', true)
