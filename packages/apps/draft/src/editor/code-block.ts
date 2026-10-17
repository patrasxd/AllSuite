import CodeBlock from '@tiptap/extension-code-block'
import { mergeAttributes } from '@tiptap/core'
import { Plugin, PluginKey, type EditorState } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'
import type { Node as ProseMirrorNode } from '@tiptap/pm/model'
import type PrismType from 'prismjs'

export const codeLanguages = [
  'javascript',
  'typescript',
  'python',
  'json',
  'css',
  'markup',
  'bash',
  'sql',
  'yaml',
] as const
export type CodeLanguage = (typeof codeLanguages)[number]
type PrismApi = typeof PrismType
type PrismToken = string | { type: string; content: PrismToken | PrismToken[]; alias?: string | string[] }

const key = new PluginKey<DecorationSet>('draftCodeHighlight')
const grammarPromises = new Map<CodeLanguage, Promise<void>>()
let prismPromise: Promise<PrismApi> | undefined

const languageAliases: Record<string, CodeLanguage> = {
  bash: 'bash',
  css: 'css',
  html: 'markup',
  javascript: 'javascript',
  js: 'javascript',
  json: 'json',
  markup: 'markup',
  python: 'python',
  py: 'python',
  sh: 'bash',
  sql: 'sql',
  ts: 'typescript',
  typescript: 'typescript',
  xml: 'markup',
  yaml: 'yaml',
  yml: 'yaml',
}

export function normalizeCodeLanguage(value: unknown): CodeLanguage | null {
  if (typeof value !== 'string') return null
  return languageAliases[value.trim().toLowerCase()] || null
}

async function loadGrammar(prism: PrismApi, language: CodeLanguage) {
  const loads: Record<CodeLanguage, () => Promise<unknown>> = {
    bash: () => import('prismjs/components/prism-bash'),
    css: () => import('prismjs/components/prism-css'),
    javascript: () => import('prismjs/components/prism-javascript'),
    json: () => import('prismjs/components/prism-json'),
    markup: () => import('prismjs/components/prism-markup'),
    python: () => import('prismjs/components/prism-python'),
    sql: () => import('prismjs/components/prism-sql'),
    typescript: async () => {
      await loadGrammar(prism, 'javascript')
      return import('prismjs/components/prism-typescript')
    },
    yaml: () => import('prismjs/components/prism-yaml'),
  }
  let pending = grammarPromises.get(language)
  if (!pending) {
    pending = loads[language]().then(() => undefined)
    grammarPromises.set(language, pending)
  }
  await pending
}

async function loadPrism(language: CodeLanguage): Promise<PrismApi> {
  prismPromise ||= import('prismjs').then((module) => module.default as PrismApi)
  const prism = await prismPromise
  await loadGrammar(prism, language)
  return prism
}

function hasLabeledCode(state: EditorState) {
  let found = false
  state.doc.descendants((node) => {
    if (node.type.name === 'codeBlock' && normalizeCodeLanguage(node.attrs.language)) found = true
    return !found
  })
  return found
}

function addTokenDecorations(tokens: PrismToken[], from: number, decorations: Decoration[]): number {
  let position = from
  for (const token of tokens) {
    if (typeof token === 'string') {
      position += token.length
      continue
    }
    const start = position
    const content = Array.isArray(token.content) ? token.content : [token.content]
    position = addTokenDecorations(content, position, decorations)
    const tokenType = /^[a-z][a-z0-9-]{0,40}$/i.test(token.type) ? token.type : 'plain'
    if (position > start)
      decorations.push(Decoration.inline(start, position, { class: `draft-code-token draft-code-token--${tokenType}` }))
  }
  return position
}

function codeDecorations(doc: ProseMirrorNode, prism: PrismApi): DecorationSet {
  const decorations: Decoration[] = []
  doc.descendants((node, position) => {
    if (node.type.name !== 'codeBlock') return
    const language = normalizeCodeLanguage(node.attrs.language)
    const grammar = language ? prism.languages[language] : undefined
    if (!language || !grammar || !node.textContent) return
    addTokenDecorations(prism.tokenize(node.textContent, grammar) as PrismToken[], position + 1, decorations)
  })
  return DecorationSet.create(doc, decorations)
}

function highlightPlugin() {
  let prism: PrismApi | undefined
  return new Plugin<DecorationSet>({
    key,
    state: {
      init: () => DecorationSet.empty,
      apply(transaction, previous) {
        if (prism && (transaction.docChanged || transaction.getMeta(key) === 'refresh'))
          return codeDecorations(transaction.doc, prism)
        return transaction.docChanged ? DecorationSet.empty : previous.map(transaction.mapping, transaction.doc)
      },
    },
    props: {
      decorations(state) {
        return key.getState(state) || DecorationSet.empty
      },
    },
    view(view) {
      let destroyed = false
      const loadedLanguages = new Set<CodeLanguage>()
      const pendingLanguages = new Set<CodeLanguage>()
      const load = () => {
        if (destroyed || !hasLabeledCode(view.state)) return
        const languages = new Set<CodeLanguage>()
        view.state.doc.descendants((node) => {
          const language = node.type.name === 'codeBlock' ? normalizeCodeLanguage(node.attrs.language) : null
          if (language) languages.add(language)
        })
        const requested = [...languages].filter(
          (language) => !loadedLanguages.has(language) && !pendingLanguages.has(language),
        )
        if (!requested.length) return
        requested.forEach((language) => pendingLanguages.add(language))
        void Promise.all(requested.map(async (language) => [language, await loadPrism(language)] as const))
          .then((loaded) => {
            if (destroyed || !loaded.length) return
            loaded.forEach(([language, current]) => {
              loadedLanguages.add(language)
              prism = current
            })
            view.dispatch(view.state.tr.setMeta(key, 'refresh'))
          })
          .catch(() => {
            /* Syntax highlighting is optional; plain code remains editable. */
          })
          .finally(() => {
            requested.forEach((language) => pendingLanguages.delete(language))
          })
      }
      load()
      return {
        update: load,
        destroy() {
          destroyed = true
        },
      }
    },
  })
}

function languageFromElement(element: HTMLElement) {
  const code = element.querySelector('code')
  const explicit = element.getAttribute('data-language') || code?.getAttribute('data-language')
  const className = `${element.className} ${code?.className || ''}`
  const match = /(?:language-|lang-)([a-z0-9+#-]+)/i.exec(className)
  return normalizeCodeLanguage(explicit || match?.[1])
}

export const DraftCodeBlock = CodeBlock.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      language: {
        default: null,
        parseHTML: (element) => languageFromElement(element),
        renderHTML: (attributes) => {
          const language = normalizeCodeLanguage(attributes.language)
          return language ? { 'data-language': language } : {}
        },
      },
    }
  },
  parseHTML() {
    return [{ tag: 'pre', preserveWhitespace: 'full' }]
  },
  renderHTML({ node, HTMLAttributes }) {
    const language = normalizeCodeLanguage(node.attrs.language)
    return [
      'pre',
      mergeAttributes(HTMLAttributes, {
        class: 'draft-code-block',
        ...(language ? { 'data-language': language } : {}),
      }),
      ['code', { ...(language ? { class: `language-${language}` } : {}) }, 0],
    ]
  },
  addProseMirrorPlugins() {
    return [...(this.parent?.() || []), highlightPlugin()]
  },
})
