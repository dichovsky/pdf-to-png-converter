# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run build          # Compile TypeScript to ./out/ (runs clean first via prebuild)
npm run build:test     # Type-check without emitting files
npm run clean          # Delete ./out, ./coverage, ./test-results
npm test               # Build then run all tests with v8 coverage (vitest)
npm run lint           # ESLint (src/**/*.ts only; .js and .d.ts are ignored)

# Run a single test file
npx vitest run __tests__/pdf.to.png.buffer.readfile.test.ts

# Docker
npm run docker:build   # Build Docker image
npm run docker:run     # Run tests inside container, mount ./test-results
npm run test:docker    # clean + docker:build + docker:run
npm run test:license   # Check all production deps use permitted SPDX licenses
```

## Architecture

Zero-native-binary Node.js library that converts PDF pages to PNG images.
Published to npm as `pdf-to-png-converter`. Entry: `out/index.js`, types: `out/index.d.ts`.

**Data flow:**
1. `pdfToPng(pdfFile, props?)` in `src/pdfToPng.ts` — sole public entry point
2. `getPdfFileBuffer()` — reads file path via `fsPromises.readFile` or passes `ArrayBufferLike` through; normalises Node `Buffer` → `ArrayBuffer`
3. `getPdfDocument()` — dynamically imports `pdfjs-dist/legacy/build/pdf.mjs`, calls `getDocument()` with params from `propsToPdfDocInitParams()`
4. Invalid page numbers (< 1 or > numPages) in `pagesToProcess` are silently filtered before the render loop
5. `processPdfPage()` — when `returnMetadataOnly` is true returns dimensions and rotation immediately (no canvas, no render); otherwise creates a canvas via `NodeCanvasFactory`, renders via `page.render()`, encodes to PNG via `canvas.toBuffer('image/png')`, cleans up in `finally`
6. `savePNGfile()` — joins `outputFolder` + `name`, validates `content !== undefined`, writes with `fsPromises.writeFile`
7. Returns `PngPageOutput[]` — one entry per processed page

**Concurrency:** when `processPagesInParallel: true`, pages are chunked into batches of `concurrencyLimit` (default 4) and each batch runs via `Promise.all`. Sequential (default) processes pages one at a time.

**`outputFolder` + `returnPageContent` + `returnMetadataOnly` interaction:**
- When `returnMetadataOnly: true`, no rendering occurs, no output folder is created, no files are written, `content` is always `undefined`
- When `outputFolder` is set, content is always retrieved internally (even if `returnPageContent: false`) so it can be written to disk; after writing, if `returnPageContent === false`, `content` is set to `undefined` to free memory
- `shouldReturnContent` resolves as: `returnMetadataOnly ? false : outputFolder ? true : (returnPageContent ?? true)`

## Source Structure

```
src/
├── index.ts                  # Public API — re-exports only
├── pdfToPng.ts               # All conversion logic (exported + private helpers)
├── node.canvas.factory.ts    # NodeCanvasFactory — pdfjs canvas contract via @napi-rs/canvas
├── propsToPdfDocInitParams.ts # Maps PdfToPngOptions → pdfjs DocumentInitParameters
├── const.ts                  # PDF_TO_PNG_OPTIONS_DEFAULTS, DOCUMENT_INIT_PARAMS_DEFAULTS
├── normalizePath.ts          # resolve() + normalize() + trailing slash
├── interfaces/               # CanvasAndContext, PdfToPngOptions, PngPageOutput
└── types/
    └── verbosity.level.ts    # VerbosityLevel enum — ERRORS=0, WARNINGS=1, INFOS=5
```

**Public API:**
```typescript
export { pdfToPng } from './pdfToPng';
export type { PngPageOutput, PdfToPngOptions } from './interfaces';
export { VerbosityLevel } from './types';
```
`CanvasAndContext` is not re-exported from `src/index.ts`.

## Defaults (`src/const.ts`)

```typescript
PDF_TO_PNG_OPTIONS_DEFAULTS = {
    viewportScale: 1,
    disableFontFace: true,
    useSystemFonts: false,
    enableXfa: true,
    outputFileMask: 'buffer',   // stem used when PDF is supplied as ArrayBufferLike
    pdfFilePassword: undefined,
    concurrencyLimit: 4,
};
```

Always extend `PDF_TO_PNG_OPTIONS_DEFAULTS` using `??` — never hardcode default values in function bodies.

## TypeScript Conventions

- **`"module": "nodenext"` / `"moduleResolution": "node16"`** — use `.js` extensions in all relative imports even though source files are `.ts`:
  ```typescript
  import { normalizePath } from './normalizePath.js';  // correct
  import { normalizePath } from './normalizePath';      // incorrect — fails at runtime
  ```
- **`import type`** for type-only imports — enforced by ESLint `@typescript-eslint/consistent-type-imports`
- Unused variables/parameters must be prefixed with `_`
- All class members need explicit accessibility modifiers (`public`, `private`, etc.)
- All functions in `src/` need explicit return types (`@typescript-eslint/explicit-function-return-type`)
- `tsconfig.json`: `target: es2022`, `strict: true`, `declaration: true`, `outDir: ./out`, `include: ./src/**/*` only
- One file per entity. All object-shape types use `interface`, not `type alias`

## ESLint Key Rules (enforced on `src/**/*.ts`)

- `@typescript-eslint/no-floating-promises: error` — always `await` promises or explicitly void them
- `@typescript-eslint/consistent-type-imports: warn` — use `import type` for type-only imports
- `@typescript-eslint/explicit-function-return-type: warn` — explicit return types on all `src/` functions
- `@typescript-eslint/explicit-member-accessibility: warn` — `public`/`private` on all class members
- `@typescript-eslint/prefer-nullish-coalescing: warn` — prefer `??` over `||` for defaults
- Test files (`__tests__/**/*.ts`) are linted with relaxed rules

## Formatting

4-space indent, single quotes, trailing commas everywhere, 140-char line width, always parentheses around arrow function params.

## Testing

**Framework:** Vitest with `testTimeout: 90000` (PDF rendering is slow). Coverage via v8 provider.

**Run a single test:** `npx vitest run __tests__/<filename>.test.ts`

**Test data (`test-data/`):**
- `sample.pdf` — 2-page sample PDF
- `large_pdf.pdf` — 12-page PDF used in most file output tests
- `large_pdf-protected.pdf` — same PDF, password: `uES69xm545C/HP!`
- `10-page-sample.pdf`, `layers.pdf`, `TAMReview.pdf`
- `*/expected/` — reference PNGs for visual comparison

Test output goes to `test-results/` (gitignored).

**Import patterns in tests:**
```typescript
import { expect, test } from 'vitest';
import { pdfToPng } from '../src/pdfToPng';   // direct src import
import { comparePNG } from './comparePNG';      // shared PNG comparison helper
```

**`comparePNG` helper** (`__tests__/comparePNG.ts`): uses `png-visual-compare`, returns `0` for identical images, creates expected file automatically when `createExpectedFileIfMissing: true`.

**Mocking patterns:**
```typescript
// Mock node:fs
vi.mock('node:fs', () => ({
    promises: { readFile: vi.fn(), mkdir: vi.fn(), writeFile: vi.fn() },
}));

// Mock pdfjs
vi.mock('pdfjs-dist/legacy/build/pdf.mjs', () => ({ getDocument: vi.fn() }));
```

## Key Behaviours and Edge Cases

- **Page filtering:** `pagesToProcess` values outside `[1, numPages]` are silently ignored
- **Output naming:** default mask is `<pdfBasename>_page_<n>.png`; for buffer input it's `buffer_page_<n>.png`; `outputFileMaskFunc` overrides entirely
- **Resource cleanup:** `pdfDocument.cleanup()` always called in `finally`; `page.cleanup()` and `canvasFactory.destroy()` called in `finally` after each page
- **`rotation` field:** always populated from `PDFPageProxy.rotate` (0, 90, 180, or 270 degrees)
- **`path` field:** `''` when `outputFolder` is not set or `returnMetadataOnly` is true; absolute file path after writing
- **CMap / font paths:** resolved via `normalizePath()` relative to `process.cwd()` pointing to `node_modules/pdfjs-dist/cmaps/` and `node_modules/pdfjs-dist/standard_fonts/`
- **Dynamic import:** pdfjs is dynamically imported inside `getPdfDocument()` on each call, not at module top level

## GitHub Actions

- **`test.yml`** — runs on every push: Ubuntu, Node 24; steps: `npm ci` → `npm run build:test && npm run lint` → `npm test`
- **`publish.yml`** — runs on GitHub release: Ubuntu, Node 24; steps: `npm ci` → `npm run build` → `npm publish` (uses `NPM_TOKEN` secret)
