import { defineConfig } from 'vitest/config';

export default defineConfig({
    test: {
        // Keep discovery anchored to this checkout. Local review tools may place full repository
        // worktrees under hidden folders, and Vitest's default **/*.{test,spec} glob would run
        // those copied integration tests concurrently against the same test-results paths.
        include: ['__tests__/**/*.test.ts'],
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
