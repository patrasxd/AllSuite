import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: true,
    include: ['packages/apps/**/*.test.ts', 'packages/apps/**/*.test.tsx'],
    setupFiles: './tests/setup.ts',
  },
})
