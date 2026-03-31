import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    testTimeout: 90000,
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/types/**/*.ts'],
      thresholds: {
        lines: 90,
        functions: 90,
        branches: 85,
      },
    },
  },
})