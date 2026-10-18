import { fileURLToPath } from 'node:url'
import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: fileURLToPath(new URL('.', import.meta.url)),
  testMatch: 'grid.spec.ts',
  use: { browserName: 'chromium', headless: true },
  webServer: {
    command: 'node node_modules/vite/bin/vite.js --config docs/spikes/grid/review/vite.config.ts',
    url: 'http://127.0.0.1:5187/docs/spikes/grid/grid-poc.html',
    cwd: process.cwd(),
    reuseExistingServer: false,
  },
})
