import { defineConfig } from 'vitest/config';

export default defineConfig({
    test: {
        testTimeout: 180000,
        coverage: {
            provider: 'v8',
            include: ['src/**/*.ts'],
            // pageRenderWorker runs inside worker threads: the integration tests exercise it,
            // but V8 coverage only instruments the main process, so it would always read 0%.
            exclude: ['src/types/**/*.ts', 'src/pageRenderWorker.ts'],
            reportsDirectory: './test-results/coverage',
            thresholds: {
                lines: 90,
                functions: 90,
                branches: 85,
            },
        },
    },
});
