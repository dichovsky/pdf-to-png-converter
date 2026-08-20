# Architecture

## Overview

`pdf-to-png-converter` is a Node.js 24+ CommonJS library and CLI. It accepts a PDF path or byte container and returns ordered page metadata, PNG buffers, or PNG files. Rendering uses `pdfjs-dist` with its built-in Node canvas factory backed by `@napi-rs/canvas`.

The source tree deliberately has 11 TypeScript modules. `src/pdfToPng.ts` owns conversion policy and orchestration; the other runtime modules own I/O, pdf.js, rendering, or worker-thread boundaries.

## Public surfaces

| Surface     | File           | Contract                                                                                 |
| ----------- | -------------- | ---------------------------------------------------------------------------------------- |
| Library     | `src/index.ts` | Exports `pdfToPng`, `PdfToPngOptions`, `PngPageOutput`, and `VerbosityLevel`             |
| CLI         | `src/cli.ts`   | Parses arguments, delegates to `pdfToPng`, writes progress or metadata JSON, sets status |
| npm package | `package.json` | Publishes CommonJS from `out/` and exposes `out/cli.js` as `pdf-to-png-converter`        |

Internal source paths are not package exports.

## Runtime pipeline

Every library conversion enters `pdfToPng()` in `src/pdfToPng.ts`:

1. `normalizeOptions()` validates and defaults the public options once. It copies `pagesToProcess`, so later caller mutation cannot change an in-flight conversion.
2. `getPdfFileBuffer()` in `src/pdfInput.ts` normalizes the input to an owned `Uint8Array` within `maxInputBytes`.
3. Worker mode retains one copy of those bytes because the main pdf.js loading task may detach its input. `getPdfDocument()` in `src/pdfjsLoader.ts` then creates the main `PDFDocumentProxy`.
4. `pdfToPng()` filters page numbers above `numPages`, resolves the output folder before user filename callbacks run, resolves all observable page names, and preflights disk names and case-insensitive duplicates before creating a directory.
5. The selected execution path produces `PageRenderResult` values:
    - metadata-only: `getPageMetadata()` with no canvas or file output
    - main thread: `renderPdfPage()` through the ordered bounded scheduler
    - worker threads: `renderPagesInWorkerPool()`, with each worker calling the same `getPdfDocument()` and `renderPdfPage()` functions
6. `finalizePage()` in `src/pdfToPng.ts` attaches `kind`, `pageNumber`, `name`, and `path`. File results are written through `savePNGfile()` in `src/outputWriter.ts`; file writes always remain on the main thread.
7. `pdfDocument.loadingTask.destroy()` runs in `finally`. Document-load failures destroy their loading task inside `getPdfDocument()` before propagating.

The CLI is an adapter over this same public path. It does not bypass validation or call an internal core function.

## Execution modes

| Options                                   | Rendering and finalization                                                                                        |
| ----------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `returnMetadataOnly: true`                | Metadata scheduler; no canvas, output-folder creation, worker pool, PNG bytes, or file writes                     |
| default                                   | Main-thread ordered scheduler with window 3, allowing async encode/write work to overlap the next render          |
| `processPagesInParallel: true`            | Main-thread ordered scheduler with `concurrencyLimit` tasks in flight                                             |
| `renderInWorkerThreads: true`             | Dynamic worker pool of size `min(concurrencyLimit, selectedPages)`; takes precedence over main-thread parallelism |
| `processPagesInParallel: true`, limit `1` | Exactly one main-thread page task in flight                                                                       |

All modes preserve result-array order. The bounded main-thread scheduler stops dispatching after an error, drains work already in flight, and throws the failure with the lowest page index. Main-thread and worker schedulers share the same lowest-index error selector. Worker mode also drains main-thread finalizers and terminates every worker before settling; a worker-level fatal error takes precedence over page-level errors.

Each worker receives its own structured-clone copy of the PDF, loads that document lazily once, and renders dynamically assigned pages. PNG bytes are structured-clone copied back to the main thread, then wrapped as a `Buffer` without another copy. Output naming, duplicate detection, and disk security remain main-thread responsibilities.

## Output model

`PngPageOutput` in `src/types.ts` is a discriminated union:

| `kind`     | Meaning                          | `content`             | `path`             |
| ---------- | -------------------------------- | --------------------- | ------------------ |
| `metadata` | Renderability-checked dimensions | `undefined`           | `''`               |
| `content`  | In-memory conversion             | `Buffer \| undefined` | `''`               |
| `file`     | PNG written to disk              | `Buffer \| undefined` | absolute file path |

Metadata and rendering share pixel-dimension, rotation, zero-dimension, and maximum-canvas-area rules. File mode always materializes PNG bytes for the write, then drops them from the returned object when `returnPageContent` is false. In-memory mode may skip encoding when `returnPageContent` is false.

Custom names must be non-empty and contain no host path separator in every mode. The remaining host filename rules apply only to disk output; metadata and in-memory results may carry names, such as NUL-containing strings, that are not passed to filesystem APIs.

## Module map

| Module                    | Ownership                                                                                                    |
| ------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `src/index.ts`            | Four-item public library export surface                                                                      |
| `src/types.ts`            | Public options, output union, page rotation, and verbosity enum                                              |
| `src/const.ts`            | Defaults, input/concurrency/canvas limits, pipeline window, pdf.js asset paths                               |
| `src/pdfToPng.ts`         | Option normalization, page/name planning, ordered scheduling, mode selection, output finalization, lifecycle |
| `src/pdfInput.ts`         | Input-shape normalization, ownership, regular-file checks, bounded reads                                     |
| `src/pdfjsLoader.ts`      | Cached dynamic pdf.js import, init-parameter construction, document-load cleanup                             |
| `src/pageRenderer.ts`     | Metadata extraction, viewport guards, rotation normalization, canvas render/encode/cleanup                   |
| `src/outputWriter.ts`     | Flat disk-name validation, folder preparation, realpath checks, exclusive-create writes                      |
| `src/workerPool.ts`       | Worker protocol types, dynamic task dispatch, ordered error policy, finalization and teardown                |
| `src/pageRenderWorker.ts` | Compiled worker entry; lazy per-worker document load and page rendering                                      |
| `src/cli.ts`              | CLI parsing, CLI-only policy, output, version lookup, and process status                                     |

## Security and ownership boundaries

### Input

- A path is opened once with `O_RDONLY | O_NONBLOCK`; the same handle is checked with `stat()`, read positionally, and closed in `finally`.
- Only regular files are accepted. Reads are capped at `maxInputBytes`, including growth after the initial size check through a one-byte overflow probe. The implementation deliberately avoids `FileHandle.readFile()`, which would allocate through a changed EOF before a post-read cap check could reject growth.
- Path reads use a dedicated full-span allocation where possible, allowing a zero-copy handoff to pdf.js.
- Caller-owned `Buffer`, `Uint8Array`, `ArrayBuffer`, `SharedArrayBuffer`, cross-realm views, and supported array-likes are copied into unshared owned bytes before pdf.js can detach them.

### Output

- Relative output folders are resolved at conversion start, before `outputFileMaskFunc` can change the process CWD.
- Disk names are preflighted before folder creation and revalidated at the write boundary. They must be one flat path segment under the host's separator rules and contain no NUL; disk outputs also reject `"."` and `".."` aliases. Windows additionally rejects invalid filename characters, alternate-data-stream syntax, reserved device basenames, and trailing dots/spaces.
- Case-insensitive duplicate disk names fail before output I/O.
- `prepareOutputFolder()` creates the folder and captures its canonical `realpath`. Every write compares a fresh `realpath` with that baseline.
- `savePNGfile()` opens with `'wx'`, preventing overwrite of an existing target and rejecting a pre-planted final symlink under normal local-filesystem semantics.

The realpath comparison does not atomically bind the write to a directory inode. A hostile user who can replace directory components during the final check/open interval can still race it, so callers must use an output directory that is not writable by untrusted users.

### Resource lifecycle

- `getPageMetadata()` always calls `page.cleanup()`.
- `renderPdfPage()` always calls `page.cleanup()` and destroys a successfully created canvas, including render and encode failures.
- `getPdfDocument()` destroys a failed loading task; `pdfToPng()` destroys a successfully loaded task after all page work.
- `renderPagesInWorkerPool()` waits for output finalizers and any promise returned by worker termination before returning or throwing. A teardown-only termination failure does not invalidate pages that rendered and finalized successfully.

## CLI policy

`src/cli.ts` uses Node's `parseArgs()` and builds ordinary `PdfToPngOptions` for `pdfToPng()`.

- Image conversion requires `--output-folder`.
- `--return-metadata-only` prints the ordered result array as JSON and needs no output folder.
- `--return-page-content` is rejected because the CLI has no consumer for in-memory buffers; callers needing buffers use the library API.
- `--silent` suppresses progress, not errors.
- Semantic options receive a fail-fast validation pass through the conversion module before progress is printed; its normalized snapshot drives CLI-only policy and progress decisions. Valid file conversions print their processing banner before input/render work begins. `pdfToPng()` then validates defensively at its public boundary, so CLI calls intentionally perform two pure validation passes instead of coupling to a normalized internal core. Typed usage and conversion errors keep their output routes independent of message text or incidental `cause` values.
- `getVersion()` treats a missing or malformed `package.json` as a packaging failure.

## Build and validation

- Runtime requirement: Node.js 24 or newer.
- Package format: CommonJS, compiled from `.ts` to `out/` with `.js` relative import specifiers.
- `npm test` runs Vitest with coverage only.
- `npm run check` is the explicit CI/prepublish gate: clean, normal and strict type-checks, formatting, lint, production-license validation, and tests.
- `npm run build` performs the publishable production compile after cleaning `out/` and `test-results/`.
