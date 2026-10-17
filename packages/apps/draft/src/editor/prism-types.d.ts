declare module 'prismjs' {
  type PrismToken = string | { type: string; content: PrismToken | PrismToken[]; alias?: string | string[] }
  type PrismGrammar = Record<string, unknown>
  const Prism: {
    languages: Record<string, PrismGrammar | undefined>
    tokenize(source: string, grammar: PrismGrammar): PrismToken[]
  }
  export default Prism
}

declare module 'prismjs/components/*'
