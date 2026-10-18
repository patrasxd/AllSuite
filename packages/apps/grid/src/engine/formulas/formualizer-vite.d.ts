declare module 'formualizer/pkg/formualizer_wasm_bg.js' {
  export { Workbook } from 'formualizer'
  export type { ASTNodeData } from 'formualizer'
  export interface ASTNode {
    free(): void
    toJSON(): ASTNodeData
  }
  export function parse(formula: string): ASTNode
  export function __wbg_set_wasm(exports: WebAssembly.Exports): void
}
