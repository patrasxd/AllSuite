import { defineConfig } from '@playwright/test'
export default defineConfig({
  testDir: './tests',
  testMatch: '*.spec.ts',
  testIgnore: '**/legacy/**',
  workers: 1,
  use: { baseURL: 'http://127.0.0.1:4176/AllSuite/', channel: process.env.PLAYWRIGHT_CHANNEL || undefined },
  webServer: {
    command: 'node node_modules/vite/bin/vite.js preview apps/shell --host 127.0.0.1 --port 4176',
    url: 'http://127.0.0.1:4176/AllSuite/',
    reuseExistingServer: !process.env.CI,
  },
})
