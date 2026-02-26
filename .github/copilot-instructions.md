# Copilot Instructions

## Commands

```bash
npm run build          # Compile TypeScript to ./out/
npm run build:test     # Type-check without emitting
npm test               # Run all tests with coverage (vitest)
npm run lint           # ESLint

# Run a single test file
npx vitest run __tests__/pdf.to.png.buffer.readfile.test.ts
```

## Architecture

This is a zero-native-binary Node.js library that converts PDF pages to PNG images.

**Data flow:**
1. `pdfToPng(pdfFile, props?)` in `src/pdfToPng.ts` is the single public entry point
2. PDF input is either a file path (string) or `ArrayBufferLike` → loaded into buffer via `getPdfFileBuffer()`
3. `pdfjs-dist` opens the buffer as a `PDFDocumentProxy`
4. Each requested page is rendered to a canvas via `@napi-rs/canvas` (Node canvas factory in `src/node.canvas.factory.ts`)
5. Canvas is encoded to PNG bytes and returned as `PngPageOutput[]`
6. Optionally written to disk if `props.outputFolder` is set

**Key files:**
- `src/pdfToPng.ts` — all conversion logic (entry point, page loop, canvas rendering, file writing)
- `src/node.canvas.factory.ts` — creates/destroys `@napi-rs/canvas` instances for pdfjs
- `src/propsToPdfDocInitParams.ts` — maps `PdfToPngOptions` → pdfjs `DocumentInitParameters`
- `src/const.ts` — `PDF_TO_PNG_OPTIONS_DEFAULTS` and `DOCUMENT_INIT_PARAMS_DEFAULTS` (cMap/font paths resolve relative to `process.cwd()`)
- `src/types/` — `PdfToPngOptions`, `PngPageOutput`, `VerbosityLevel`, `CanvasAndContext`
- `src/index.ts` — re-exports only (public API surface)

**Concurrency:** when `processPagesInParallel: true`, pages are chunked using `concurrencyLimit` (default 4) and processed with `Promise.all` per chunk. Sequential is the default.

## Key Conventions

**TypeScript:**
- `"module": "nodenext"` / `"moduleResolution": "node16"` — use `.js` extensions in relative imports even for `.ts` source files
- Prefer `import type` for type-only imports (enforced by ESLint `@typescript-eslint/consistent-type-imports`)
- Unused variables must be prefixed with `_`

**Formatting (Prettier):**
- 4-space indent, single quotes, trailing commas everywhere, 140-char line width, semicolons

**Testing:**
- Test files live in `__tests__/`, named `<description>.test.ts` (kebab/dot separated)
- One `.test.js` file exists (`pdf.to.file.test.js`) — JavaScript tests are also valid
- Tests use `vitest` with a 90-second timeout (PDF rendering is slow)
- `comparePNG.ts` in `__tests__/` is a shared helper, not a test file itself
- Reference PDFs and expected PNGs live in `test-data/`; test output goes to `output/` or `tmp/`
- Mock `node:fs` with `vi.mock` when testing file I/O paths without real PDFs

**Options defaults** are centralized in `src/const.ts` — always extend `PDF_TO_PNG_OPTIONS_DEFAULTS` rather than hardcoding values in function signatures.

**`outputFileMask`** defaults to `'buffer'` when input is an `ArrayBufferLike`; defaults to the PDF filename stem when input is a file path.
