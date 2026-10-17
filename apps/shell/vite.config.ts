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
      const modules = Object.keys(chunk.modules).join('\n').replaceAll('\\', '/')
      const editor = modules.includes('/@tiptap/') || modules.includes('/draft/src/DocumentEditor')
      const docx = modules.includes('/node_modules/docx/')
      const mammoth = modules.includes('/node_modules/mammoth/')
      const fonts = modules.includes('/node_modules/@fontsource/') || modules.includes('/draft/src/fonts/')
      if (chunk.isEntry && (editor || docx || mammoth || fonts))
        this.error('Office runtime leaked into the shell entry chunk')
      return {
        file: chunk.fileName,
        entry: chunk.isEntry,
        bytes: Buffer.byteLength(chunk.code),
        editor,
        docx,
        mammoth,
        fonts,
        imports: chunk.imports,
        dynamicImports: chunk.dynamicImports,
      }
    })
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
  plugins: [
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
        globPatterns: ['**/*.{js,css,html,svg,woff,woff2,webmanifest}', 'third-party-licenses.txt'],
        maximumFileSizeToCacheInBytes: 4 * 1024 * 1024,
        runtimeCaching: [],
      },
    }),
  ],
  resolve: {
    alias: {
      '@allsuite/draft/metadata': fileURLToPath(new URL('../../packages/apps/draft/src/metadata.ts', import.meta.url)),
      '@allsuite/draft': fileURLToPath(new URL('../../packages/apps/draft/src', import.meta.url)),
    },
    dedupe: ['react', 'react-dom', 'framer-motion'],
  },
})
