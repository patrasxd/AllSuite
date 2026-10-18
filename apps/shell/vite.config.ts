import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'
import { fileURLToPath } from 'node:url'
import { readFileSync } from 'node:fs'

const csp: Plugin = {
  name: 'production-csp',
  apply: 'build',
  transformIndexHtml: () => [
    {
      tag: 'meta',
      attrs: {
        'http-equiv': 'Content-Security-Policy',
        content:
          "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self' blob: data:; worker-src 'self' blob:; manifest-src 'self'; object-src 'none'; base-uri 'self'; form-action 'none'; frame-src 'none'",
      },
      injectTo: 'head-prepend',
    },
  ],
}

const formualizerWasmBridge: Plugin = {
  name: 'formualizer-vite-wasm-bridge',
  enforce: 'pre',
  resolveId(source, importer) {
    const normalizedImporter = importer?.replaceAll('\\', '/')
    if (
      source === 'formualizer' &&
      normalizedImporter?.includes('/packages/apps/grid/src/engine/formulas/runtime.ts')
    ) {
      return fileURLToPath(
        new URL('../../packages/apps/grid/src/engine/formulas/formualizer-vite-adapter.ts', import.meta.url),
      )
    }
    return null
  },
}

const officeChunkBoundary: Plugin = {
  name: 'office-chunk-boundary',
  generateBundle(_options, bundle) {
    this.emitFile({
      type: 'asset',
      fileName: 'third-party-licenses.txt',
      source: [
        readFileSync(new URL('../../licenses/editor-license-notices.txt', import.meta.url), 'utf8'),
        readFileSync(new URL('../../licenses/font-license-notices.txt', import.meta.url), 'utf8'),
      ].join('\n\n'),
    })
    const chunks = Object.values(bundle).filter((asset) => asset.type === 'chunk')
    const report = chunks.map((chunk) => {
      const moduleIds = Object.keys(chunk.modules).map((id) => id.replaceAll('\\', '/'))
      const modules = moduleIds.join('\n')
      const editor = modules.includes('/@tiptap/') || modules.includes('/draft/src/DocumentEditor')
      const docx = modules.includes('/node_modules/docx/')
      const mammoth = modules.includes('/node_modules/mammoth/')
      const fonts = modules.includes('/node_modules/@fontsource/') || modules.includes('/draft/src/fonts/')
      const gridMetadata = moduleIds.some((id) => id.includes('/packages/apps/grid/src/metadata.ts'))
      const gridRenderer = moduleIds.some((id) => id.includes('/packages/apps/grid/src/Grid.tsx'))
      const gridWorkbook = moduleIds.some((id) => id.includes('/packages/apps/grid/src/engine/workbook/'))
      const gridXlsx = moduleIds.some((id) => id.includes('/packages/apps/grid/src/engine/xlsx/'))
      const gridFormula =
        moduleIds.some((id) => id.includes('/packages/apps/grid/src/engine/formulas/')) ||
        modules.includes('/node_modules/formualizer/')
      const gridZip = modules.includes('/node_modules/fflate/')
      const gridWasm = /formualizer_wasm_bg[^\s"']*\.wasm/.test(chunk.code)
      if (chunk.isEntry && (editor || docx || mammoth || fonts))
        this.error('Office runtime leaked into the shell entry chunk')
      if (chunk.isEntry && (gridRenderer || gridWorkbook || gridXlsx || gridFormula || gridZip || gridWasm))
        this.error('Grid runtime leaked into the shell entry chunk')
      return {
        file: chunk.fileName,
        entry: chunk.isEntry,
        bytes: Buffer.byteLength(chunk.code),
        editor,
        docx,
        mammoth,
        fonts,
        gridMetadata,
        gridRenderer,
        gridWorkbook,
        gridXlsx,
        gridFormula,
        gridZip,
        gridWasm,
        imports: chunk.imports,
        dynamicImports: chunk.dynamicImports,
      }
    })
    for (const asset of Object.values(bundle)) {
      if (asset.type !== 'asset' || !asset.fileName.endsWith('.wasm')) continue
      report.push({
        file: asset.fileName,
        entry: false,
        bytes: Buffer.byteLength(asset.source),
        editor: false,
        docx: false,
        mammoth: false,
        fonts: false,
        gridMetadata: false,
        gridRenderer: false,
        gridWorkbook: false,
        gridXlsx: false,
        gridFormula: true,
        gridZip: false,
        gridWasm: true,
        imports: [],
        dynamicImports: [],
      })
    }
    this.emitFile({ type: 'asset', fileName: 'bundle-report.json', source: JSON.stringify(report, null, 2) })
  },
}

export default defineConfig({
  base: '/AllSuite/',
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          // A lazy editor-only dependency: keep it separate from both shell and editor engine.
          if (id.replaceAll('\\', '/').includes('/node_modules/dompurify/')) return 'draft-paste-sanitizer'
          // Shared math rendering/conversion code must not pull the editor chunk into DOCX exports.
          const normalizedId = id.replaceAll('\\', '/')
          if (normalizedId.includes('/node_modules/@xmldom/xmldom/')) return 'draft-xml-runtime'
          if (
            normalizedId.includes('/node_modules/katex/') ||
            normalizedId.endsWith('/draft/src/engine/math-safety.ts')
          )
            return 'draft-math-runtime'
        },
      },
    },
  },
  worker: {
    plugins: () => [formualizerWasmBridge],
  },
  plugins: [
    formualizerWasmBridge,
    react(),
    csp,
    officeChunkBoundary,
    VitePWA({
      registerType: 'prompt',
      injectRegister: 'auto',
      includeAssets: ['icons/*.svg'],
      manifest: {
        name: 'AllSuite',
        short_name: 'AllSuite',
        description: 'Private browser office suite. No accounts, ads or tracking.',
        theme_color: '#0a0a0a',
        background_color: '#0a0a0a',
        display: 'standalone',
        scope: '/AllSuite/',
        start_url: '/AllSuite/',
        categories: ['productivity'],
        icons: [{ src: 'icons/favicon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' }],
      },
      workbox: {
        clientsClaim: true,
        globPatterns: ['**/*.{js,css,html,svg,woff,woff2,webmanifest,wasm}', 'third-party-licenses.txt'],
        maximumFileSizeToCacheInBytes: 12 * 1024 * 1024,
        runtimeCaching: [],
      },
    }),
  ],
  resolve: {
    alias: {
      '@allsuite/draft/metadata': fileURLToPath(new URL('../../packages/apps/draft/src/metadata.ts', import.meta.url)),
      '@allsuite/draft': fileURLToPath(new URL('../../packages/apps/draft/src', import.meta.url)),
      '@allsuite/grid/metadata': fileURLToPath(new URL('../../packages/apps/grid/src/metadata.ts', import.meta.url)),
      '@allsuite/grid': fileURLToPath(new URL('../../packages/apps/grid/src', import.meta.url)),
    },
    dedupe: ['react', 'react-dom', 'framer-motion'],
  },
})
