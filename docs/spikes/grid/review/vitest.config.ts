import { defineConfig } from 'vitest/config'
export default defineConfig({
  test: {
    environment: 'node',
    include: ['docs/spikes/grid/*-poc.test.ts'],
  },
})
