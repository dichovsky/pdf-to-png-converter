import type { Config } from 'jest';

export default async (): Promise<Config> => {
    return {
        collectCoverage: true,
        coverageDirectory: './test-results/coverage',
        preset: 'ts-jest',
        testEnvironment: 'node',
        verbose: false,
    };
};
