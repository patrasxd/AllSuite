import initializeWasmBinary from 'formualizer/pkg/formualizer_wasm_bg.wasm?init'
import * as formualizerBindings from 'formualizer/pkg/formualizer_wasm_bg.js'
import { __wbg_set_wasm, parse as parseRaw, Workbook } from 'formualizer/pkg/formualizer_wasm_bg.js'
import type { ASTNodeData } from 'formualizer'

let initialization: Promise<void> | undefined

// The pinned wasm-bindgen glue includes a dynamic Function fallback for locating
// the global object. Modern module workers have globalThis; never expose that
// fallback (or any workbook-supplied string) to a JavaScript compiler.
const calculationBindings = { ...formualizerBindings } as Record<string, WebAssembly.ImportValue>
for (const name of Object.keys(calculationBindings)) {
  if (name.startsWith('__wbg_new_no_args_'))
    calculationBindings[name] = () => {
      throw new Error('Dynamic JavaScript compilation is disabled in Grid calculation.')
    }
}

export function initializeWasm(): Promise<void> {
  initialization ??= initializeWasmBinary({ './formualizer_wasm_bg.js': calculationBindings }).then((instance) => {
    __wbg_set_wasm(instance.exports)
    const start = Reflect.get(instance.exports, '__wbindgen_start')
    if (typeof start === 'function') start()
  })
  return initialization
}

export function parse(formula: string): ASTNodeData {
  const ast = parseRaw(formula)
  try {
    return ast.toJSON()
  } finally {
    ast.free()
  }
}

export { Workbook }
export type { ASTNodeData } from 'formualizer'
