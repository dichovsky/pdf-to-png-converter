# Architecture

## Overview

`pdf-to-png-converter` is a Node.js 24+ CommonJS library and CLI. It accepts a PDF file path or byte container and returns ordered page metadata, PNG buffers, or PNG files. Rendering uses `pdfjs-dist` and its built-in Node canvas factory backed by `@napi-rs/canvas`.

The source tree has 11 TypeScript modules. `src/pdfToPng.ts` owns conversion policy and orchestration. The other modules own I/O, pdf.js loading, page rendering, worker threads, or CLI execution.

## Public surfaces

| Surface     | File           | Contract                                                                                 |
| ----------- | -------------- | ---------------------------------------------------------------------------------------- |
| Library     | `src/index.ts` | Exports `pdfToPng`, `PdfToPngOptions`, `PngPageOutput`, and `VerbosityLevel`             |
| CLI         | `src/cli.ts`   | Parses arguments, delegates to `pdfToPng`, writes progress or metadata JSON, sets status |
| npm package | `package.json` | Publishes CommonJS from `out/` and exposes `out/cli.js` as `pdf-to-png-converter`        |

Internal module paths are not exported.

## Runtime pipeline

All library conversions start in `pdfToPng()` (`src/pdfToPng.ts`):

1. `pdfToPng()` validates options and resolves the output folder synchronously before its first `await`:
    - `normalizeOptions()` validates options and applies defaults one time. It treats `null` as unset for all options. It rejects `viewportScale` values above `MAX_VIEWPORT_SCALE` (100). In parallel or worker mode, it rejects `concurrencyLimit` values above `MAX_CONCURRENCY_LIMIT` (16).
    - `pagesToProcess` must be a real `Array` of positive integers. Typed arrays, `Set`s, strings, array-likes, and sparse arrays are rejected. `normalizeOptions()` copies the array. Thus, later mutations by the caller do not change the conversion.
    - If the caller passes `disableFontFace: false`, the library uses `true`, because pdf.js has no Font Loading API in Node.js. This coercion emits process warning `PDF_TO_PNG_DISABLE_FONT_FACE_IGNORED` a maximum of one time for each thread.
    - Unless `returnMetadataOnly` is `true`, `pdfToPng()` immediately resolves a relative `outputFolder` against `process.cwd()`. Thus, later `process.chdir()` calls cannot redirect output.
2. `getPdfFileBuffer()` in `src/pdfInput.ts` normalizes the input into an owned `Uint8Array` of `maxInputBytes` or less.
3. Worker mode saves one copy of the PDF bytes on the main thread because the main-thread pdf.js loading task can detach its input buffer. `pdfToPng()` then awaits `warmUpWasmDecoders()`, which runs one time for each thread. Next, `getPdfDocument()` in `src/pdfjsLoader.ts` opens the main `PDFDocumentProxy` and passes `cMapUrl`, `standardFontDataUrl`, and `wasmUrl` resolved from the installed `pdfjs-dist` package (see [pdf.js assets](#pdfjs-assets)).
4. `pdfToPng()` removes page numbers above `numPages` and resolves all page filenames. Then it validates disk filenames before it creates the output folder:
    - Each disk filename must be a flat host name of 255 units or less.
    - No two names can collide under `outputNameKey()` Unicode folding (see [Output](#output)).

    Metadata-only requests skip disk-filename checks, the decoder-file check, and folder creation. Each conversion that reaches the rendering step calls `warnIfWasmDecodersMissing()` on the calling thread. The helper checks the files once per thread. Only disk output calls `prepareOutputFolder()`.

5. The selected execution path generates `PageRenderResult` objects:
    - Metadata-only mode calls `getPageMetadata()` without creating canvases or files.
    - Main-thread mode calls `renderPdfPage()` through the ordered bounded scheduler.
    - Worker-thread mode calls `renderPagesInWorkerPool()`, where each worker runs `getPdfDocument()` and `renderPdfPage()`.
6. `finalizePage()` in `src/pdfToPng.ts` attaches `kind`, `pageNumber`, `name`, and `path`. In file mode, `savePNGfile()` in `src/outputWriter.ts` writes the file on the main thread.
7. `pdfDocument.loadingTask.destroy()` runs in `finally`. If `getPdfDocument()` fails during document load, it destroys the loading task before rethrowing the error.

The CLI calls this same public `pdfToPng()` function.

## Execution modes

| Options                                   | Rendering and finalization                                                                                    |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `returnMetadataOnly: true`                | Metadata scheduler; creates no canvas, output folder, worker pool, PNG buffer, or file                        |
| default                                   | Main-thread ordered scheduler with window 3; overlaps async PNG encoding and file writes with the next render |
| `processPagesInParallel: true`            | Main-thread ordered scheduler with up to `concurrencyLimit` tasks in flight                                   |
| `renderInWorkerThreads: true`             | Dynamic worker pool of size `min(concurrencyLimit, selectedPages)`; overrides main-thread parallel mode       |
| `processPagesInParallel: true`, limit `1` | Keeps at most one main-thread page task in flight                                                             |

All modes return pages in the requested order. When a page error occurs, the scheduler does these steps:

1. It stops scheduling new tasks.
2. It waits for in-flight tasks to finish.
3. It throws the error with the lowest page index.

Worker mode also drains main-thread finalizers and terminates all workers before it settles. Worker-level fatal errors take precedence over page errors.

Each worker receives a structured-clone copy of the PDF bytes, loads its document one time on demand, and renders pages dynamically. Workers send PNG bytes back to the main thread through structured clone. The main thread wraps those bytes in a `Buffer` and does not copy them again. Filename validation, duplicate checks, and file writes always run on the main thread.

Worker errors return to the caller as native `Error` instances. Structured clone preserves `message`, `stack`, and `cause` for native errors. Before cloning, the worker converts non-native pdf.js exceptions to native `Error` instances with `message` and `cause`. The main thread then restores the original `name` from `errorName`. Custom error classes and pdf.js properties such as `details` and `code` are not preserved. The worker pool loads `pageRenderWorker.js` next to `workerPool.js` through `__dirname`. If `__dirname` is undefined (such as in an ESM bundle), the pool rejects with a descriptive error.

On the main thread, pdf.js stores `verbosityLevel` at the module level and updates it on each `getDocument()` call. Concurrent main-thread conversions with different verbosity levels share the most recently applied level. This shared level changes log output only. Each worker thread has its own pdf.js module instance and verbosity state.

## Output model

`PngPageOutput` (`src/types.ts`) is a discriminated union:

| `kind`     | Meaning                          | `content`             | `path`             |
| ---------- | -------------------------------- | --------------------- | ------------------ |
| `metadata` | Renderability-checked dimensions | `undefined`           | `''`               |
| `content`  | In-memory conversion             | `Buffer \| undefined` | `''`               |
| `file`     | PNG written to disk              | `Buffer \| undefined` | absolute file path |

Metadata and rendering use the same pixel-dimension, rotation, and canvas-limit rules. Viewport dimensions are floored to integer pixels. Exception: a value that is `1e-6` px or less below an integer rounds up to that integer. This rule prevents a loss of 1 pixel from floating-point inaccuracy, such as `2974.9999999999995` for 612 pt at `350 / 72`.

Before it allocates a canvas, the renderer rejects a page if one of these conditions is true:

- The page area is more than `MAX_CANVAS_PIXELS` (100,000,000).
- The page width or height is more than `MAX_CANVAS_SIDE` (1,000,000, the libpng per-side limit).
- The page width or height floors to `0`.

All modes enforce these checks, including `returnMetadataOnly` and `returnPageContent: false`. File mode always encodes PNG bytes to write the file, then omits `content` when `returnPageContent` is `false`. In-memory mode skips PNG encoding when `returnPageContent` is `false`.

Custom filenames must be non-empty and must not contain host path separators in any mode. Additional host filename rules (such as the 255-unit length limit) apply only when writing to disk.

## Module map

| Module                    | Ownership                                                                                                    |
| ------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `src/index.ts`            | Four-item public library export surface                                                                      |
| `src/types.ts`            | Public options, output union, page rotation, and verbosity enum                                              |
| `src/const.ts`            | Defaults, input/path/filename/canvas/concurrency limits, pipeline window, wasm warm-up timeout, pdf.js names |
| `src/pdfToPng.ts`         | Option normalization, page/name planning, ordered scheduling, mode selection, output finalization, lifecycle |
| `src/pdfInput.ts`         | Input-shape normalization, ownership, regular-file checks, bounded reads                                     |
| `src/pdfjsLoader.ts`      | Cached dynamic pdf.js import, package asset folders, init parameters, wasm warning and warm-up, load cleanup |
| `src/pageRenderer.ts`     | Metadata extraction, viewport guards, rotation normalization, canvas render/encode/cleanup                   |
| `src/outputWriter.ts`     | Flat disk-name validation, folder preparation, realpath checks, exclusive-create writes                      |
| `src/workerPool.ts`       | Worker protocol types, dynamic task dispatch, ordered error policy, finalization and teardown                |
| `src/pageRenderWorker.ts` | Compiled worker entry; lazy per-worker document load and page rendering                                      |
| `src/cli.ts`              | CLI parsing, CLI-only policy, output, version lookup, and process status                                     |

## Security and ownership boundaries

### Input

- Path inputs are opened once with `O_RDONLY | O_NONBLOCK`, inspected with `stat()`, read positionally through that same handle, and closed in `finally`. Path strings longer than `MAX_INPUT_PATH_LENGTH` (4096 characters) are rejected before a filesystem call. The error message does not include the string. For relative paths, the kernel opens the input synchronously at call time. This preserves symbolic links, parent components, and relative paths in filesystem errors. The open can block on a slow filesystem. Stat, reads, and close are asynchronous. Fully qualified inputs also open asynchronously.
- Only regular files are accepted. Reads enforce `maxInputBytes` and probe 1 byte past the initial size to detect files that grow during reading. The code does not use `FileHandle.readFile()`. Thus, a growing file cannot allocate unbounded memory before the size check.
- File reads use chunks of at most `FILE_READ_MAX_CHUNK_BYTES` (1 GiB) because Node's `FileHandle.read()` takes a signed 32-bit integer length.
- When possible, file reads allocate a dedicated buffer that matches the file size. This buffer lets the code give the bytes to pdf.js without a copy.
- `maxInputBytes` (default `MAX_INPUT_BYTES`, 256 MiB) caps input bytes only, not the heap memory pdf.js allocates during parsing (`BACKLOG.md` SEC-006).
- Caller-owned `Buffer`, `Uint8Array`, `ArrayBuffer`, `SharedArrayBuffer`, cross-realm views/buffers, and real `Array`s of byte values are copied into unshared memory before pdf.js can detach them. Arbitrary objects with a numeric `length` or a forged `Symbol.toStringTag` are rejected. The code reads `ArrayBuffer` and `SharedArrayBuffer` sizes through their prototype `byteLength` getters.

### Output

- Relative output folders resolve against `process.cwd()` synchronously when `pdfToPng()` starts, before any `outputFileMaskFunc` callback runs.
- Disk filenames are validated before folder creation and again before each file write. Each filename must be a single path segment with no NUL characters. Its length must be `MAX_FILENAME_LENGTH` (255) units or less. A unit is a UTF-16 code unit on macOS and Windows, and a UTF-8 byte on other platforms. The destination filesystem can enforce a lower limit on a filename or the full path. An exclusive open that fails with `ENAMETOOLONG` preserves the OS error code and path. Disk mode also rejects `"."` and `".."`. On Windows, disk mode also rejects invalid characters, alternate data streams, reserved device names, and trailing dots or spaces.
- Duplicate disk filenames are rejected before output I/O through `outputNameKey()` (`toWellFormed()`, NFD, lowercase, uppercase, lowercase). This check folds case and Unicode normalization forms across all platforms.
- `prepareOutputFolder()` creates the directory and records its canonical `realpath`. Each file write verifies that the directory's current `realpath` continues to match.
- `savePNGfile()` opens files with `'wx'`. Thus, existing files and symlinks are never overwritten. If writing or closing fails after `open()` succeeds, `savePNGfile()` does these steps:
    1. It unlinks the newly created file. This unlink is best effort. It occurs only if `lstat()` matches the device and inode of the open handle.
    2. It rethrows the original error.
- Failed `open()` calls never unlink existing files.

**Callers must use an output directory that untrusted users cannot modify.** Pathname checks cannot prevent directory-swap races between `realpath`/`lstat` and `open`/`unlink`.

### pdf.js assets

- `pdfjsAssetDirectory()` resolves the installed `pdfjs-dist` package one time through `require.resolve('pdfjs-dist/package.json')` and appends the folder names from `PDFJS_ASSET_DIRECTORIES` (`cmaps`, `standard_fonts`, `wasm`). It never uses `process.cwd()`.
- `getPdfDocument()` passes `cMapUrl`, `standardFontDataUrl`, and `wasmUrl` as forward-slash directory paths ending in `/`.
- The `wasm` directory contains `jbig2.wasm` (CCITT/JBIG2) and `openjpeg.wasm` (JPEG 2000). Without `wasmUrl`, pdf.js renders those images blank without throwing an error (issue #278). `warnIfWasmDecodersMissing()` checks that the two `.wasm` files are present. If a file is missing, it emits process warning `PDF_TO_PNG_WASM_MISSING` a maximum of one time for each thread.
- Each conversion awaits the same per-thread warm-up promise from `warmUpWasmDecoders()` before it opens the input document (issue #288, mozilla/pdf.js#22131; remove under `BACKLOG.md` ARCH-018). The warm-up decodes a tiny built-in PDF that contains 8×8 CCITT G4 and JPEG 2000 images. A successful warm-up lets pdf.js cache both WebAssembly decoders. Conversion can proceed if the warm-up fails or the `WASM_WARM_UP_TIMEOUT_MS` (10 s) wait expires.
- When pdf.js decodes an image, it allocates a temporary canvas on the rendering thread. This canvas uses approximately 8 bytes for each declared pixel.
- In `@napi-rs/canvas` 1.0.12+, a canvas of approximately 537 million pixels or more (> 2 GiB) is created, but it silently ignores drawing calls. Thus, Flate, JPEG, CCITT, or JBIG2 images are blank, and no error occurs. JPEG 2000 images above pdf.js's internal limit decode at reduced resolution, with a warning.
- Each WebAssembly decoder instance also caps its heap at 2 GiB for each thread.
- When you process untrusted PDFs, use container memory limits, per-job timeouts, and a low `concurrencyLimit` (`BACKLOG.md` SEC-004).

### Resource lifecycle

- `getPageMetadata()` always calls `page.cleanup()`.
- `renderPdfPage()` always calls `page.cleanup()` and destroys any allocated canvas, even when rendering or encoding fails.
- `getPdfDocument()` destroys failed loading tasks, and `pdfToPng()` destroys loaded documents in `finally`.
- `renderPagesInWorkerPool()` awaits all output finalizers and worker terminations before settling.

## CLI policy

`src/cli.ts` parses arguments with `node:util` `parseArgs()` and calls `pdfToPng()`:

- Image conversion requires `--output-folder`.
- `--return-metadata-only` prints the result array as JSON to `stdout` and does not require `--output-folder`.
- `--return-page-content` is rejected because in-memory buffers apply only to the library API.
- `--silent` suppresses progress messages, not metadata JSON or errors.
- The CLI validates options before printing the start banner, then calls `pdfToPng()`.
- The CLI requires one `<pdf-file-path>` and no other positional arguments. Zero or multiple positional arguments print usage and exit with code 1.
- The password comes from `--pdf-file-password` or `PDF_TO_PNG_PASSWORD` (an empty variable counts as unset).
- `withConsoleOnStderr()` routes `console.log` and `console.info` to `stderr` while `pdfToPng()` runs on the main thread. Thus, `--return-metadata-only` prints only JSON to `stdout`.
- The entrypoint check compares `realpath(require.resolve(process.argv[1]))` with `realpath(__filename)`.
- The CLI always uses the default 256 MiB `maxInputBytes` limit.
- `getVersion()` throws a packaging error if `package.json` is missing or invalid.

## Build and validation

- Runtime requirement: Node.js 24 or newer; `.nvmrc` specifies Node.js 26 and CI tests Node.js 24 and 26.
- Package format: CommonJS compiled from `src/` to `out/` with `.js` relative import specifiers.
- `npm test` runs Vitest with V8 coverage and enforces 98% thresholds for statements, lines, functions, and branches.
- TypeScript 7 checks the source, tests, scripts, and Vitest configuration. The strict check also verifies dependency declarations.
- `__tests__/pdfjs.assets.test.ts` verifies the installed `cmaps`, `standard_fonts`, `wasm`, and top-level `pdfjs-dist` directories.
- `comparePNG()` in `__tests__/comparePNG.ts` fails when a golden PNG is missing. It creates missing goldens only when `UPDATE_GOLDENS=1` and `CI` is unset or empty. It never overwrites existing golden files.
- `__tests__/cli.compiled.test.ts` compiles `src/` to `test-results/cli-compiled-out` and tests the CLI in child processes.
- Worker tests in `__tests__/pdf.to.png.worker.threads.test.ts` use `pdfToPngInWorkers()` to spy on `renderPagesInWorkerPool` and `renderPdfPage`.
- `__tests__/loader.document.open.call.sites.test.ts` verifies that all main-thread document opens go through `getPdfDocument()` after `warmUpWasmDecoders()`.
- `npm run check` runs clean, both type-checks, Oxfmt check, Oxlint (`--deny-warnings`), license check, and coverage tests.
- The Husky pre-commit hook runs `lint-staged` with Oxlint (`--deny-warnings`) and Oxfmt.
- `npm run build` cleans `out/` and `test-results/` and compiles production output to `out/`.
