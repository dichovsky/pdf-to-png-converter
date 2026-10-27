import typescriptEslint from '@typescript-eslint/eslint-plugin';
import tsParser from '@typescript-eslint/parser';
import js from '@eslint/js';
import { fileURLToPath } from 'node:url';

// tsc already reports undefined names, redeclarations (including valid overloads) and the like in TypeScript, so
// typescript-eslint's `eslint-recommended` preset switches those core rules off (otherwise `no-undef` rejects valid
// Node globals such as `setTimeout`) and turns on `no-var` and `prefer-const`. `no-unreachable` stays on because tsc
// only reports unreachable code as an editor hint by default.
const typescriptCoreRules = {
    ...typescriptEslint.configs['flat/eslint-recommended'].rules,
    'no-unreachable': 'error',
};

export default [
    {
        ignores: ['**/*.js', '**/*.d.ts'],
    },
    {
        // scripts/ is in the tsconfig.json program, so it gets the same type-aware rules as src/. The exception is
        // scripts/benchmark.ts: it imports the built `../out/index.js`, which `npm run clean` deletes before the
        // type-check, so it cannot be in that program and is linted by the untyped block below.
        files: ['src/**/*.ts', 'scripts/**/*.ts'],
        ignores: ['scripts/benchmark.ts'],
        languageOptions: {
            parser: tsParser,
            parserOptions: {
                ecmaVersion: 'latest',
                sourceType: 'module',
                project: true,
                tsconfigRootDir: fileURLToPath(new URL('.', import.meta.url)),
            },
        },
        plugins: {
            '@typescript-eslint': typescriptEslint,
        },
        rules: {
            ...js.configs.recommended.rules,
            ...typescriptCoreRules,
            ...typescriptEslint.configs.recommended.rules,
            // Enforce no CommonJS require() in TypeScript source — the package uses nodenext modules
            '@typescript-eslint/no-var-requires': 'error',
            // Hard error: use `unknown` and narrow it instead of `any`
            '@typescript-eslint/no-explicit-any': 'error',
            // Strict TypeScript rules
            '@typescript-eslint/explicit-function-return-type': [
                'warn',
                {
                    allowExpressions: true,
                    allowTypedFunctionExpressions: true,
                    allowHigherOrderFunctions: true,
                },
            ],
            '@typescript-eslint/explicit-member-accessibility': [
                'warn',
                {
                    accessibility: 'explicit',
                    overrides: {
                        constructors: 'no-public',
                    },
                },
            ],
            '@typescript-eslint/no-floating-promises': 'error',
            '@typescript-eslint/no-misused-promises': 'error',
            '@typescript-eslint/await-thenable': 'error',
            '@typescript-eslint/consistent-type-assertions': 'warn',
            '@typescript-eslint/prefer-nullish-coalescing': 'warn',
            '@typescript-eslint/prefer-optional-chain': 'warn',
            '@typescript-eslint/consistent-type-imports': [
                'warn',
                {
                    prefer: 'type-imports',
                    fixStyle: 'separate-type-imports',
                },
            ],
            '@typescript-eslint/no-shadow': 'warn',
            '@typescript-eslint/no-unused-vars': [
                'warn',
                {
                    argsIgnorePattern: '^_',
                    varsIgnorePattern: '^_',
                    caughtErrorsIgnorePattern: '^_',
                },
            ],
        },
    },
    {
        files: ['__tests__/**/*.ts', 'scripts/benchmark.ts'],
        languageOptions: {
            parser: tsParser,
            parserOptions: {
                ecmaVersion: 'latest',
                sourceType: 'module',
            },
        },
        plugins: {
            '@typescript-eslint': typescriptEslint,
        },
        rules: {
            ...js.configs.recommended.rules,
            ...typescriptCoreRules,
            ...typescriptEslint.configs.recommended.rules,
            '@typescript-eslint/no-var-requires': 0,
            '@typescript-eslint/no-explicit-any': 0,
            '@typescript-eslint/explicit-function-return-type': 0,
            '@typescript-eslint/explicit-member-accessibility': 0,
        },
    },
];
