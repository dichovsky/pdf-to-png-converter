/**
 * Minimal stub for the `pngjs` types, kept only so that `npm run build:strict` passes.
 * Nothing in this repository imports `pngjs`.
 *
 * Why it is needed: tsconfig.strict.json sets `skipLibCheck: false`, so TypeScript also checks the declaration files of
 * dependencies. `comparePNG.ts` imports `png-visual-compare`, whose entry point re-exports the deprecated `LoadedPng` type
 * (out/index.d.ts -> out/types/index.d.ts -> out/types/png.data.d.ts -> out/pipeline/types.d.ts), and that last file has
 * `import type { PNG, PNGWithMetadata } from 'pngjs'`. `pngjs` ships no typings and `@types/pngjs` is not installed, so
 * without this file strict mode fails with TS7016 ("Could not find a declaration file for module 'pngjs'").
 * `npm run build:test` (`skipLibCheck: true`) does not need it. The declarations below are deliberately minimal: they
 * only have to make that import resolve.
 *
 * When to remove it: png-visual-compare (checked against 7.2.1) marks `LoadedPng` as deprecated and announces its
 * removal in 8.0.0. After upgrading to a version without that export, delete this file and run `npm run build:strict`;
 * if it still passes, the stub is dead. Adding `@types/pngjs` as a devDependency would replace it as well.
 */
declare module 'pngjs' {
    export interface PNG {
        data: Uint8Array;
        width: number;
        height: number;
    }

    export interface PNGWithMetadata extends PNG {}
}
