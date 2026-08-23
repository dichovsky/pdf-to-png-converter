import { defineConfig } from 'vitest/config';

export default defineConfig({
    test: {
        testTimeout: 180000,
        coverage: {
            provider: 'v8',
            include: ['src/**/*.ts'],
            reportsDirectory: './test-results/coverage',
            thresholds: {
                statements: 98,
                lines: 98,
                functions: 98,
                branches: 98,
            },
        },
    },
});
