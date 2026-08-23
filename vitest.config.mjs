import { defineConfig } from 'vitest/config';

export default defineConfig({
    test: {
        testTimeout: 180000,
        coverage: {
            provider: 'v8',
            include: ['src/**/*.ts'],
            reportsDirectory: './test-results/coverage',
            thresholds: {
                statements: 95,
                lines: 95,
                functions: 95,
                branches: 95,
            },
        },
    },
});
