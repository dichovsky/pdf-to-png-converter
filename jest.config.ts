import type { Config } from 'jest';

export default async (): Promise<Config> => {
    return {
        testTimeout: 30000,
        collectCoverage: true,
        coverageDirectory: './test-results/coverage',
        preset: 'ts-jest',
        testEnvironment: 'node',
        verbose: false,
    };
};
