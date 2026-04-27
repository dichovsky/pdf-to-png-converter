# Copilot Instructions

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
4. Invalid page numbers (< 1 or > numPages) in `pagesToProcess` are silently filtered by `pdfToPng` before the render loop
5. `processPdfPage()` — obtains page from `PDFDocumentProxy`; when `returnMetadataOnly` is true returns dimensions and rotation immediately (no canvas, no render); otherwise creates a canvas via `NodeCanvasFactory`, renders via `page.render()`, encodes to PNG via `canvas.toBuffer('image/png')`, cleans up in `finally`
6. `savePNGfile()` — joins `outputFolder` + `name`, validates `content !== undefined`, writes with `fsPromises.writeFile`
7. Returns `PngPageOutput[]` — one entry per processed page

**Concurrency:** when `processPagesInParallel: true`, pages are chunked into batches of `concurrencyLimit` (default 4) and each batch runs via `Promise.all`. Sequential mode (default) processes pages one at a time in document order.

**`outputFolder` + `returnPageContent` + `returnMetadataOnly` interaction:**

- When `returnMetadataOnly: true`, no rendering occurs, no output folder is created, no files are written, and `content` is always `undefined` — regardless of `outputFolder` or `returnPageContent`
- When `returnMetadataOnly` is false and `outputFolder` is set, content is always retrieved internally (even if `returnPageContent: false`) so it can be written to disk
- After writing, if `returnPageContent === false`, `content` is set to `undefined` on the output object to free memory
- `shouldReturnContent` is resolved as: `returnMetadataOnly ? false : outputFolder ? true : (returnPageContent ?? true)`

## Source Code Structure

```
src/
├── index.ts                  # Public API surface — re-exports only
├── pdfToPng.ts               # All conversion logic (exported + private helpers)
├── node.canvas.factory.ts    # NodeCanvasFactory class — pdfjs canvas contract
├── propsToPdfDocInitParams.ts # Maps PdfToPngOptions → pdfjs DocumentInitParameters
├── const.ts                  # PDF_TO_PNG_OPTIONS_DEFAULTS, DOCUMENT_INIT_PARAMS_DEFAULTS
│                             #   (STANDARD_FONTS, STANDARD_CMAPS → __tests__/test-data-constants.ts)
├── normalizePath.ts          # resolve() + normalize() + trailing slash
├── interfaces/               # Object-shape interfaces (exported publicly or internally)
│   ├── index.ts              # Barrel: re-exports all three interfaces
│   ├── canvas.and.context.ts # CanvasAndContext — canvas + context pair (nullable after destroy)
│   ├── pdf.to.png.options.ts # PdfToPngOptions — all conversion options
│   └── png.page.output.ts    # PngPageOutput — single rendered page result
└── types/
    ├── index.ts              # Barrel: re-exports VerbosityLevel
    └── verbosity.level.ts    # VerbosityLevel enum — ERRORS=0, WARNINGS=1, INFOS=5
```

**Public API (`src/index.ts`):**

```typescript
export { pdfToPng } from './pdfToPng';
export type { PngPageOutput, PdfToPngOptions } from './interfaces';
export { VerbosityLevel } from './types';
```

`CanvasAndContext` is not re-exported from `src/index.ts`; it is available from internal paths for internal use.

**Key private functions in `src/pdfToPng.ts`** (not exported):

- `getPdfFileBuffer(pdfFile)` — file read + ArrayBuffer normalisation
- `getPdfDocument(pdfFileBuffer, props?)` — dynamic pdfjs import + `getDocument()`
- `processPdfPage(pdf, pageName, pageNumber, pageViewportScale, returnPageContent, returnMetadataOnly)` — single page render or metadata-only fast path
- `savePNGfile(pngPageOutput, outputFolder)` — disk write, mutates `pngPageOutput.path`

## Folder Conventions

```
src/types/       — const objects and enums (VerbosityLevel)
src/interfaces/  — TypeScript interfaces for object shapes (CanvasAndContext, PdfToPngOptions, PngPageOutput)
src/             — functions, classes, constants
```

One file per entity. All object-shape types use `interface`, not `type`.

## Defaults (`src/const.ts`)

```typescript
PDF_TO_PNG_OPTIONS_DEFAULTS = {
    viewportScale: 1,
    disableFontFace: true,
    useSystemFonts: false,
    enableXfa: true,
    outputFileMask: 'buffer', // stem used when PDF is supplied as ArrayBufferLike
    pdfFilePassword: undefined,
    concurrencyLimit: 4,
};

DOCUMENT_INIT_PARAMS_DEFAULTS = {
    cMapUrl: normalizePath('./node_modules/pdfjs-dist/cmaps/'),
    cMapPacked: true,
    standardFontDataUrl: normalizePath('./node_modules/pdfjs-dist/standard_fonts/'),
};
```

Always extend `PDF_TO_PNG_OPTIONS_DEFAULTS` using `??` — never hardcode default values in function bodies.
`outputFileMask` defaults to `'buffer'` for `ArrayBufferLike` input; defaults to the PDF filename stem (via `parse(pdfFile).name`) for string input.

## `PdfToPngOptions` → `DocumentInitParameters` Mapping

`propsToPdfDocInitParams()` merges `DOCUMENT_INIT_PARAMS_DEFAULTS` with these mapped fields:

| `PdfToPngOptions` field | `DocumentInitParameters` field | Default                     |
| ----------------------- | ------------------------------ | --------------------------- |
| `verbosityLevel`        | `verbosity`                    | `VerbosityLevel.ERRORS` (0) |
| `disableFontFace`       | `disableFontFace`              | `true`                      |
| `useSystemFonts`        | `useSystemFonts`               | `false`                     |
| `enableXfa`             | `enableXfa`                    | `true`                      |
| `pdfFilePassword`       | `password`                     | `undefined`                 |

Fields `viewportScale`, `outputFolder`, `outputFileMaskFunc`, `pagesToProcess`, `returnPageContent`, `returnMetadataOnly`, `processPagesInParallel`, `concurrencyLimit` are handled entirely within `pdfToPng.ts` and are **not** passed to pdfjs.

## TypeScript Conventions

- **`"module": "nodenext"` / `"moduleResolution": "node16"`** — use `.js` extensions in all relative imports even though the source files are `.ts`
    ```typescript
    import { normalizePath } from './normalizePath.js'; // correct
    import { normalizePath } from './normalizePath'; // incorrect — will fail at runtime
    ```
- **`import type`** for type-only imports — enforced by ESLint `@typescript-eslint/consistent-type-imports`
    ```typescript
    import type { PdfToPngOptions } from './interfaces/pdf.to.png.options.js';
    ```
- Unused variables/parameters must be prefixed with `_` (enforced: `argsIgnorePattern: "^_"`)
- All class members need explicit accessibility modifiers (`public`, `private`, etc.) except constructors
- All functions in `src/` need explicit return types (`@typescript-eslint/explicit-function-return-type`)
- **`tsconfig.json` settings:** `target: es2022`, `lib: [es2024, ESNext.Array, ESNext.Collection, ESNext.Iterator]`, `strict: true`, `declaration: true`, `outDir: ./out`, `include: ./src/**/*` only

## ESLint Rules (enforced on `src/**/*.ts`)

Key rules beyond recommended:

- `@typescript-eslint/no-floating-promises: error` — always `await` promises or explicitly void them
- `@typescript-eslint/no-misused-promises: error` — don't pass async callbacks where sync is expected
- `@typescript-eslint/await-thenable: error` — don't `await` non-Promise values
- `@typescript-eslint/consistent-type-imports: warn` — use `import type` for type-only imports
- `@typescript-eslint/explicit-function-return-type: warn` — explicit return types on all `src/` functions
- `@typescript-eslint/explicit-member-accessibility: warn` — `public`/`private` on all class members
- `@typescript-eslint/prefer-nullish-coalescing: warn` — prefer `??` over `||` for defaults
- `@typescript-eslint/prefer-optional-chain: warn` — prefer `?.` over `&&` chains
- `@typescript-eslint/no-explicit-any: off` — `any` is allowed
- Test files (`__tests__/**/*.ts`) are linted with relaxed rules — no return type or member accessibility requirements

## Formatting (Prettier)

From `.prettierrc`:

```json
{
    "trailingComma": "all",
    "tabWidth": 4,
    "semi": true,
    "singleQuote": true,
    "printWidth": 140,
    "useTabs": false,
    "arrowParens": "always"
}
```

4-space indent, single quotes, trailing commas everywhere, 140-char line width, always parentheses around arrow function params.

## Testing

**Framework:** Vitest with `testTimeout: 90000` (PDF rendering is slow).

**Coverage:** v8 provider, includes `src/**/*.ts`, excludes `src/types/**/*.ts`. Run via `npm test`.

**Test file locations and naming:**

- `__tests__/<description>.test.ts` (kebab/dot-separated, e.g. `pdf.to.png.buffer.readfile.test.ts`)
- Both `.ts` and `.js` test files are valid

**Test data:**

```
test-data/
├── sample.pdf              # 2-page sample PDF
├── large_pdf.pdf           # 12-page PDF used in most file output tests
├── large_pdf-protected.pdf # same PDF, password: 'uES69xm545C/HP!'
├── 10-page-sample.pdf      # 10-page PDF
├── layers.pdf              # 1-page PDF with layers
├── TAMReview.pdf           # additional test PDF
├── sample/expected/        # expected PNGs for sample.pdf tests
├── pdf.to.buffer/expected/ # expected PNGs for buffer output tests
├── pdf.to.file/expected/   # expected PNGs for file output tests
├── protected.pdf/expected/ # expected PNGs for password-protected PDF
└── layers/expected/        # expected PNG for layers.pdf
```

Test output goes to `test-results/` (gitignored). Temporary output goes to `output/` or `tmp/`.

**Import patterns in tests:**

```typescript
import { expect, test } from 'vitest'; // flat tests
import { describe, it, expect, vi } from 'vitest'; // grouped / mock tests
import type { Mock } from 'vitest'; // mock typing
import { pdfToPng } from '../src/pdfToPng'; // direct src import
import { pdfToPng, PngPageOutput } from '../src'; // via barrel
import { comparePNG } from './comparePNG'; // shared PNG comparison helper
```

**`comparePNG` helper (`__tests__/comparePNG.ts`):**

```typescript
comparePNG({
    actualFile: Buffer | string,   // path or buffer of actual PNG
    expectedFile: string,          // path to expected PNG
    createExpectedFileIfMissing: boolean, // when true, writes actual as expected if file missing
    opts?: ComparePngOptions,
}): number  // 0 = identical, >0 = pixel diff count
```

Uses `png-visual-compare` package. Returns `0` for identical images. Creates expected file automatically on first run when `createExpectedFileIfMissing: true`.

**Typical integration test pattern:**

```typescript
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, test } from 'vitest';
import { pdfToPng, PngPageOutput } from '../src';
import { comparePNG } from './comparePNG';

test('should convert PDF to PNG files', async () => {
    const pngPages: PngPageOutput[] = await pdfToPng(resolve('./test-data/large_pdf.pdf'), {
        outputFolder: resolve('./test-results/my-test/actual'),
        processPagesInParallel: false,
    });

    expect(pngPages.length).toBeGreaterThan(0);
    for (const pngPage of pngPages) {
        const compareResult = comparePNG({
            actualFile: readFileSync(pngPage.path),
            expectedFile: resolve('./test-data/pdf.to.file/expected', pngPage.name),
            createExpectedFileIfMissing: true,
        });
        expect(compareResult).to.equal(0);
    }
});
```

**Mocking `node:fs` for unit tests:**

```typescript
vi.mock('node:fs', () => ({
    promises: {
        readFile: vi.fn(),
        mkdir: vi.fn(),
        writeFile: vi.fn(),
    },
}));

// Then in tests:
(fsPromises.readFile as Mock).mockResolvedValue(someBuffer);
```

**Mocking `pdfjs-dist`:**

```typescript
vi.mock('pdfjs-dist/legacy/build/pdf.mjs', () => ({
    getDocument: vi.fn(),
}));
```

**Parameterised tests (data-driven pattern):**

```typescript
const testDataArray = [{ id: 'case 1', props: {...}, expected: {...} }, ...];
for (const testData of testDataArray) {
    test(`should ... when ${testData.id}`, async () => { ... });
}
```

**Key test scenarios covered:**

- Sequential vs. parallel page processing
- `pagesToProcess` with valid, invalid (0, -1, 999999), and out-of-range page numbers
- `returnPageContent: true/false` with and without `outputFolder`
- `returnMetadataOnly: true` — no rendering, no files written, no output folder created; `content` undefined, `path` empty; works with `pagesToProcess`, `processPagesInParallel`, `viewportScale`, and `outputFolder` set
- `outputFileMaskFunc` for custom filenames from both file path and buffer inputs
- Password-protected PDFs (`pdfFilePassword`)
- PDF with layers
- ArrayBuffer and Node `Buffer` as input
- `fs.readFile` returning `ArrayBuffer` vs `Buffer` vs unsupported type
- `NodeCanvasFactory` create/reset/destroy lifecycle and error cases
- `normalizePath` with relative, absolute, empty paths
- All `propsToPdfDocInitParams` option combinations including CMap/font asset verification
- Public exports from `src/index.ts`

## Key Behaviours and Edge Cases

- **Page filtering:** `pagesToProcess` values outside `[1, numPages]` are silently ignored; no error is thrown
- **Output naming:** default mask is `<pdfBasename>_page_<n>.png`; for buffer input it's `buffer_page_<n>.png`; `outputFileMaskFunc` overrides this entirely
- **Resource cleanup:** `pdfDocument.cleanup()` is always called in a `finally` block; `page.cleanup()` is called in `finally` after each page render (both in the normal rendering path and in the `returnMetadataOnly` fast path); canvas is destroyed in `finally` after each normal render
- **`returnMetadataOnly`:** when `true`, `processPdfPage` skips all canvas/render work, calls only `pdf.getPage()` + `page.getViewport()` + `page.rotate`, then cleans up. No `mkdir` is called, no `savePNGfile` is called, `content` is always `undefined`, `path` is always `""`. Works with both sequential and parallel modes and respects `pagesToProcess` and `viewportScale`
- **`rotation` field:** always populated on every `PngPageOutput`; derived from `PDFPageProxy.rotate` which is the intrinsic page rotation in the PDF (0, 90, 180, or 270 degrees)
- **`path` field:** `PngPageOutput.path` is `''` when `outputFolder` is not set or `returnMetadataOnly` is true; set to the absolute file path after writing
- **`content` field:** present as `Buffer` by default; `undefined` when `returnPageContent: false` and no `outputFolder`; `undefined` after memory-free when `returnPageContent: false` + `outputFolder` is set; always `undefined` when `returnMetadataOnly: true`
- **CMap / font paths:** resolved via `normalizePath()` relative to `process.cwd()` at module load time; must point to `node_modules/pdfjs-dist/cmaps/` and `node_modules/pdfjs-dist/standard_fonts/`
- **Dynamic import:** pdfjs is dynamically imported (`await import('pdfjs-dist/legacy/build/pdf.mjs')`) inside `getPdfDocument()` on each call — not a top-level import

## GitHub Actions

**`test.yml`** — runs on every push:

- Ubuntu only, Node 24
- Steps: `npm ci` → `npm run build:test && npm run lint` → `npm test`

**`publish.yml`** — runs on GitHub release creation:

- Ubuntu, Node 24.x
- Steps: `npm ci` → `npm run build` → `npm publish` (uses `NPM_TOKEN` secret)

## Dependencies

**Runtime:**

- `@napi-rs/canvas ~0.1.95` — native Node canvas (no browser required); provides `Canvas`, `SKRSContext2D`
- `pdfjs-dist ~5.4.624` — Mozilla PDF.js; provides `getDocument`, `PDFDocumentProxy`

**Dev:**

- `typescript ^5.9.3`, `vitest ^4.0.18`, `@vitest/coverage-v8 ^4.0.18`
- `eslint ^10.0.2`, `@typescript-eslint/eslint-plugin ^8.56.1`, `@typescript-eslint/parser ^8.56.1`
- `png-visual-compare ^4.0.0` — pixel-level PNG comparison in tests
- `rimraf ^6.1.3` — cross-platform `clean` script
- `@types/node ^25.3.1`

**Node version requirement:** `>=20`
