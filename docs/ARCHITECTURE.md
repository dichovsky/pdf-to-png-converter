# Architecture

## Overview

`pdf-to-png-converter` is a CJS-only Node.js library and CLI for converting PDF pages into PNG images or page metadata.

The codebase is organized around one public library entrypoint (`pdfToPng`) plus a thin CLI adapter. The library normalizes options first, loads the PDF through `pdfjs-dist`, processes pages sequentially or through a sliding-window scheduler, and routes rendered PNG buffers either to disk or an in-memory/null sink.

## Public surfaces

| Surface | File | Purpose |
| --- | --- | --- |
| Library API | `src/index.ts` | Re-exports `pdfToPng`, `PdfToPngOptions`, `PngPageOutput`, and `VerbosityLevel` |
| CLI | `src/cli.ts` | Parses flags, normalizes options, runs conversions, prints output/errors |
| Published package | `package.json` | CJS-only package contract: `main`, `types`, `exports`, and CLI `bin` |

## Runtime flow

1. `pdfToPng(pdfFile, props?)` in `src/pdfToPng.ts` calls `normalizePdfToPngOptions()`.
2. `getPdfFileBuffer()` in `src/pdfInput.ts` loads a file path via `fs.promises.readFile()` or accepts `ArrayBufferLike` / `Uint8Array` input directly.
3. `getPdfDocument()` in `src/pdfjsLoader.ts` dynamically imports `pdfjs-dist/legacy/build/pdf.mjs`, creates the loading task, and destroys that task on load failure.
4. `pdfToPng()` resolves `pagesToProcess`, filters page numbers above `pdfDocument.numPages`, prepares the default filename mask, and creates the output sink:
   - `FilesystemSink` when `outputFolder` is set
   - `NullSink` when content is retained in memory but nothing is written
   - no sink when the caller requested neither files nor page content
5. `processAndSavePage()` in `src/pageOrchestrator.ts` coordinates one page:
   - metadata-only path: `getPageMetadata()`
   - render path: `renderPdfPage()`
   - optional sink write
   - final conversion to the discriminated output shape
6. `pageRenderer.ts` obtains the page, computes the viewport, normalizes `rotation`, renders through `NodeCanvasFactory`, and returns an in-memory page result.
7. `outputWriter.ts` validates filename containment, checks realpaths, writes via `fs.promises.open(..., 'wx')`, and returns the absolute file path.
8. `pdfToPng()` always calls `pdfDocument.destroy()` in `finally`.

## Module map

| Module | Responsibility | Key exports |
| --- | --- | --- |
| `src/pdfToPng.ts` | Top-level orchestration, sink selection, page scheduling | `pdfToPng` |
| `src/normalizePdfToPngOptions.ts` | Option validation and defaulting | `normalizePdfToPngOptions` |
| `src/pdfInput.ts` | Input loading and buffer normalization | `getPdfFileBuffer` |
| `src/pdfjsLoader.ts` | Dynamic `pdfjs-dist` loading and document lifecycle | `getPdfDocument` |
| `src/pageOrchestrator.ts` | Per-page naming, render/metadata branching, sink integration | `resolvePageName`, `processAndSavePage` |
| `src/pageRenderer.ts` | Page metadata extraction, rendering, rotation normalization | `normalizeRotation`, `getPageMetadata`, `renderPdfPage` |
| `src/outputWriter.ts` | Path-containment enforcement and secure file writes | `isEscapingRelativePath`, `savePNGfile` |
| `src/filesystemSink.ts` | Disk-backed sink using `savePNGfile()` | `FilesystemSink` |
| `src/nullSink.ts` | No-op sink for in-memory workflows | `NullSink` |
| `src/node.canvas.factory.ts` | `pdfjs-dist` canvas adapter backed by `@napi-rs/canvas` | `NodeCanvasFactory` |
| `src/propsToPdfDocInitParams.ts` | Maps library options to `pdfjs-dist` init params | `propsToPdfDocInitParams` |
| `src/cli.ts` | CLI adapter and reusable CLI helpers | `run`, `buildPdfToPngOptions`, `executeConversion`, `getVersion` |

## Output model

`PngPageOutput` is a discriminated union:

| `kind` | Meaning | `content` | `path` |
| --- | --- | --- | --- |
| `metadata` | Metadata-only page | `undefined` | `''` |
| `content` | Rendered page retained in memory | `Buffer \| undefined` | `''` |
| `file` | Rendered page written to disk | `Buffer \| undefined` | absolute file path |

Notes:
- `content` may be `undefined` for `kind: 'file'` when `returnPageContent === false`.
- `returnMetadataOnly: true` bypasses all sink creation and all rendering work.

## Concurrency model

- Default mode is sequential page processing in document order.
- Parallel mode uses `processPagesWithSlidingWindow()` in `src/pdfToPng.ts`.
- The scheduler keeps up to `concurrencyLimit` page tasks active and preserves output order by writing results into a fixed array by page index.

## Security model

### Option boundary

`normalizePdfToPngOptions()` is the single validation boundary for:
- `viewportScale`
- `outputFolder`
- `verbosityLevel`
- `pagesToProcess`
- `concurrencyLimit`

### Output containment

`savePNGfile()` enforces:
- no absolute output filenames
- no `..` path escapes
- realpath containment of the target directory inside the intended output folder
- a final realpath re-check before writing
- exclusive-create writes (`'wx'`) so pre-existing targets, including symlinks, fail with `EEXIST`

Residual risk remains for directory-component swaps between checks; the library documents this and assumes callers use a private output directory on shared systems.

## CLI architecture

`src/cli.ts` is intentionally thin:

1. `safeParseArgs()` parses argv.
2. `buildPdfToPngOptions()` converts CLI values into a normalized `PdfToPngOptions` object.
3. `executeConversion()` delegates to `pdfToPng()`.
4. `run()` handles process exit codes and output formatting.
5. `getVersion()` treats missing/malformed `package.json` as a packaging defect and exits with an error.

## Packaging and build

- Package format: CommonJS-only (`"type": "commonjs"`).
- Build output: `out/` via `tsconfig.prod.json`.
- Normal typecheck: `tsconfig.json` with `skipLibCheck: true`.
- Strict release-time typecheck: `tsconfig.strict.json` with `skipLibCheck: false`.
- The strict config includes DOM lib types to satisfy `pdfjs-dist`’s public declarations and keeps a single local suppression for the `pdfjs-dist` / `@napi-rs/canvas` canvas-context mismatch in `src/pageRenderer.ts`.

## Generated indexes

- `CODEMAP.md` is generated by `npm run codemap`.
- The generator lives in `scripts/generate-codemap.ts` and produces a machine-readable symbol index for coding agents.
