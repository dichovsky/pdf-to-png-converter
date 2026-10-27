# Architecture

## Overview

`pdf-to-png-converter` is a Node.js 22.13+ CommonJS library and CLI. It accepts a PDF path or byte container and returns ordered page metadata, PNG buffers, or PNG files. Rendering uses `pdfjs-dist` with its built-in Node canvas factory backed by `@napi-rs/canvas`.

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

1. `pdfToPng()` validates the options and binds the output folder before any input I/O, synchronously and before its first `await`:
    - `normalizeOptions()` validates and defaults the public options once. `null` is treated as unset for every option. A `viewportScale` above `MAX_VIEWPORT_SCALE` (100) is rejected, and in parallel or worker mode so is a `concurrencyLimit` above `MAX_CONCURRENCY_LIMIT` (16).
    - `pagesToProcess` must be a real `Array` of positive integers: typed arrays, Sets, strings, array-likes, and holes are rejected. It is copied, so later caller mutation cannot change an in-flight conversion.
    - An explicit `disableFontFace: false` is coerced to `true`, because pdf.js has no Font Loading API in Node.js, and process warning `PDF_TO_PNG_DISABLE_FONT_FACE_IGNORED` is emitted at most once per thread (normally once per process).
    - A relative `outputFolder` is resolved against `process.cwd()`, so a later `process.chdir()` cannot redirect it. Metadata-only requests resolve nothing.
2. `getPdfFileBuffer()` in `src/pdfInput.ts` normalizes the input to an owned `Uint8Array` within `maxInputBytes`.
3. Worker mode retains one copy of those bytes because the main pdf.js loading task may detach its input. `pdfToPng()` then awaits `warmUpWasmDecoders()`, which runs once per thread. After that, `getPdfDocument()` in `src/pdfjsLoader.ts` creates the main `PDFDocumentProxy`. It resolves the installed `pdfjs-dist` package root once and passes pdf.js `cMapUrl`, `standardFontDataUrl`, and `wasmUrl` built from that location (see [pdf.js assets](#pdfjs-assets) for the warm-up and the asset folders).
4. `pdfToPng()` filters page numbers above `numPages`, resolves all observable page names, and, for disk output, preflights the names before creating a directory: each must be a valid flat filename of at most 255 units, and no two may be duplicates under a Unicode fold (see [Output](#output)). Metadata-only requests skip the disk-name preflight and return from this point. Every other request then calls `warnIfWasmDecodersMissing()`, which checks the wasm decoder files at most once per thread (the library runs the check on the main thread only, so normally once per process), before `prepareOutputFolder()` creates the directory.
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

An error a worker reports reaches the caller as a native `Error`. Structured clone keeps the message, stack, and `cause` of native errors, so only pdf.js exceptions, which are not native errors, are rebuilt first, with the same message and `cause`. Structured clone resets a name outside the standard error classes to `Error`, so the original name travels in a separate `errorName` field and the pool restores it. pdf.js-specific fields such as `details` and `code`, and the error class, are not carried. The pool loads the compiled `pageRenderWorker.js` from beside `workerPool.js`, so worker mode needs the unbundled `out/` layout of the installed package: where `__dirname` is undefined, as in an ESM bundle, the pool rejects with an error that says so.

`verbosityLevel` is process-wide on the main thread. pdf.js keeps one module-level verbosity, set by every `getDocument()` call, so overlapping main-thread conversions can see the level of the document opened last. It changes pdf.js log lines only, not output or errors. Each worker thread has its own pdf.js module and so its own setting.

## Output model

`PngPageOutput` in `src/types.ts` is a discriminated union:

| `kind`     | Meaning                          | `content`             | `path`             |
| ---------- | -------------------------------- | --------------------- | ------------------ |
| `metadata` | Renderability-checked dimensions | `undefined`           | `''`               |
| `content`  | In-memory conversion             | `Buffer \| undefined` | `''`               |
| `file`     | PNG written to disk              | `Buffer \| undefined` | absolute file path |

Metadata and rendering share the pixel-dimension, rotation, and canvas-size rules. Viewport lengths are floored to integer pixels, and a length up to 1e-6 px below an integer counts as that integer, so float noise such as `2974.9999999999995` for 612 pt at `350 / 72` does not lose a pixel. A page is rejected before any canvas is allocated if its area exceeds `MAX_CANVAS_PIXELS` (100,000,000), if its width or height exceeds `MAX_CANVAS_SIDE` (1,000,000, libpng's per-side limit, which the area limit does not bound for a thin page), or if a side floors to zero, checked in that order. This holds in every mode, including in-memory conversion with `returnPageContent: false`, so a page that can never become a PNG fails the same way everywhere. File mode always materializes PNG bytes for the write, then drops them from the returned object when `returnPageContent` is false. In-memory mode may skip encoding when `returnPageContent` is false.

Custom names must be non-empty and contain no host path separator in every mode. The remaining host filename rules, including the 255-unit length limit, apply only to disk output; metadata and in-memory results may carry names, such as NUL-containing strings or names over 255 units, that are not passed to filesystem APIs.

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

- A path is opened once with `O_RDONLY | O_NONBLOCK`; the same handle is checked with `stat()`, read positionally, and closed in `finally`. A string over `MAX_INPUT_PATH_LENGTH` (4096 characters) is rejected before any filesystem call, and the message does not echo it: a string is always read as a path, so a longer one is document content passed by mistake, and the filesystem error would copy it. Windows extended-length paths over that length therefore cannot be passed as a string. A relative path is passed to `open()` as given, so it binds to the working directory when the open runs, unlike the output folder (`BACKLOG.md` ARCH-021).
- Only regular files are accepted. Reads are capped at `maxInputBytes`, including growth after the initial size check through a one-byte overflow probe. The implementation deliberately avoids `FileHandle.readFile()`, which would allocate through a changed EOF before a post-read cap check could reject growth.
- Path reads are issued in `FileHandle.read()` requests of at most `FILE_READ_MAX_CHUNK_BYTES` (1 GiB). The Node read length is an int32: one request of 2 GiB or more aborts the process or throws, depending on the Node version, except a multiple of 4 GiB, which wraps to a zero-length read and returns a silently short buffer. The read loop assembles larger files from short reads.
- Path reads use a dedicated full-span allocation where possible, allowing a zero-copy handoff to pdf.js.
- `maxInputBytes` (default `MAX_INPUT_BYTES`, 256 MiB) bounds input bytes only, not the memory pdf.js needs to parse them: a non-PDF payload that is one long run of a single byte value needs about 32 to 64 heap bytes per input byte in the pdf.js recovery scan and can abort the process (`BACKLOG.md` SEC-006).
- Caller-owned `Buffer`, `Uint8Array`, `ArrayBuffer`, `SharedArrayBuffer`, cross-realm views, cross-realm `ArrayBuffer` and `SharedArrayBuffer`, and Arrays of byte values are copied into unshared owned bytes before pdf.js can detach them. Only a real `Array` counts as a byte array, because the cap bounds the length an object claims, not the work of copying it: `{ length: 268435456 }` is rejected, not copied. `null`, `undefined`, other primitives, and objects that match none of these shapes are rejected with `Unsupported buffer type`. A cross-realm buffer is recognised through the `ArrayBuffer` or `SharedArrayBuffer` prototype `byteLength` getter, which throws for any other receiver, so an object that only forges the tag with `Symbol.toStringTag` is rejected and the cap applies to the real size. A Proxy around a real `Array` that lies about its `length` is not covered; like the other in-process-only shapes it costs no more than passing a large real `Array` (`BACKLOG-ARCHIVE.md` SEC-005).

### Output

- Relative output folders are resolved against the process working directory when `pdfToPng()` is called, before its first `await` and so before the call's own `outputFileMaskFunc` runs. A later `process.chdir()`, including one made by a mask callback of this or another conversion, cannot redirect them.
- Disk names are preflighted before folder creation and revalidated at the write boundary. They must be one flat path segment under the host's separator rules, contain no NUL, and be at most `MAX_FILENAME_LENGTH` (255) units: UTF-16 code units on macOS and Windows, UTF-8 bytes on other hosts, so the host family stands in for the filesystem. A longer name fails at the preflight with a message that gives counts, not a raw `ENAMETOOLONG` from `open()` after the folder exists. A lower per-segment limit on the target filesystem and the total path length are not preflighted (`BACKLOG.md` ARCH-021). Disk outputs also reject `"."` and `".."` aliases. Windows additionally rejects invalid filename characters, alternate-data-stream syntax, reserved device basenames, and trailing dots/spaces.
- Duplicate disk names fail before output I/O. `outputNameKey()` compares names under a Unicode fold (`toWellFormed()`, NFD, then lowercase, uppercase, and lowercase again), so names a filesystem treats as one file collide: NFC and NFD spellings, sharp s and `SS`, sigma and final sigma, and lone surrogates. The fold is conservative: pairs that a case-sensitive, normalization-sensitive filesystem would keep apart, such as `straße.png` and `STRASSE.png`, are rejected on every platform, as `Page.png` and `page.png` already were.
- `prepareOutputFolder()` creates the folder and captures its canonical `realpath`. Every write compares a fresh `realpath` with that baseline.
- `savePNGfile()` opens with `'wx'`, preventing overwrite of an existing target and rejecting a pre-planted final symlink under normal local-filesystem semantics. If the write or close fails after the open succeeded, it removes the file this call created and rethrows the original error, so the same names can be retried. The removal is best effort and runs only while the path still names the file this call created (same device and inode, taken from the open handle). That narrows, but does not close, the window in which a directory swapped in after the open could make it delete another file: `lstat()` and `unlink()` resolve the pathname separately, so the private-directory requirement below covers this removal too. If the handle's identity could not be read, the file is left in place. A failed open never unlinks, so an existing target is untouched. Only the failing page's file is removed; pages completed earlier remain.

The realpath comparison does not atomically bind the write to a directory inode. A hostile user who can replace directory components during the final check/open interval can still race it, so callers must use an output directory that is not writable by untrusted users.

### pdf.js assets

- `pdfjsAssetDirectory()` locates the installed `pdfjs-dist` package once (`require.resolve('pdfjs-dist/package.json')`, memoised; not `createRequire(__filename)`, because ESM bundlers shim `require` but leave `__filename` undefined) and joins the directory names from `PDFJS_ASSET_DIRECTORIES` (`cmaps`, `standard_fonts`, `wasm`). The working directory is never consulted and there is no fallback: a `node_modules` folder under `process.cwd()` is not necessarily the copy pdf.js was imported from. If resolution fails, conversion throws an error that names `pdfjs-dist` and the path searched from, with the original error as `cause`.
- `getPdfDocument()` passes `cMapUrl`, `standardFontDataUrl`, and `wasmUrl` as absolute directory URLs with forward slashes and a trailing `/`. Worker threads load the same module, so main-thread and worker documents use the same asset folders.
- The `wasm` folder holds the CCITT/JBIG2 (`jbig2.wasm`) and JPEG 2000 (`openjpeg.wasm`) decoders. Without `wasmUrl`, pdf.js swallows the decode failure and renders those images blank, logging only at verbosity `WARNINGS` or higher (issue #278). `warnIfWasmDecodersMissing()` checks that both files in `PDFJS_WASM_DECODER_FILES` exist; when one is missing, those images may render blank, or decode more slowly through the pdf.js JavaScript fallback where it is available. It emits process warning `PDF_TO_PNG_WASM_MISSING` at most once per thread (the library runs the check on the main thread only, so normally once per process). It cannot detect decode errors.
- pdf.js up to 6.4.299 fetches each wasm decoder through the message handler of the document opened most recently (mozilla/pdf.js#22131). Once that document is destroyed, the first wasm decode in any other open document never settles (issue #288). `pdfToPng()` therefore awaits `warmUpWasmDecoders()` before every main-thread `getPdfDocument()` call. Once per thread, it opens a built-in one-page PDF with two 8x8 inline images (CCITT G4 and JPEG 2000) and builds its operator list, which decodes both images, then destroys it. pdf.js keeps the fetched wasm bytes for the rest of the thread, so later decodes never use a stale handler. A failed warm-up is ignored, and one still pending after `WASM_WARM_UP_TIMEOUT_MS` (10 s) stops blocking conversions, so other pdf.js use in the same thread cannot stall every conversion through it. Worker threads skip it because each opens only one document. Remove it once pdfjs-dist includes mozilla/pdf.js#22145 (`BACKLOG.md` ARCH-018).
- Decoding any image costs memory, whatever its filter (Flate and DCT included): pdf.js uses a temporary canvas of about 8 bytes per declared image pixel on each thread that renders a page (the main thread, or each worker). A declared image of about 537 million pixels or more, whose canvas (4 bytes per pixel) would need more than 2,147,483,647 bytes, is silently left out of the page: since `@napi-rs/canvas` 1.0.12, `createCanvas()` no longer throws for such a surface and drawing into it does nothing, so `pdfToPng()` resolves without an error, even at verbosity `WARNINGS`. JPEG 2000 is the exception: above a size limit of its own, pdf.js decodes it at a reduced resolution and logs a warning at verbosity `WARNINGS`. Up to `@napi-rs/canvas` 1.0.11, pdf.js failed with `Create skia surface failed` and `pdfToPng()` rejected the whole conversion. Page canvases are unaffected, because `MAX_CANVAS_PIXELS` bounds them before allocation. Decoding a large valid image is also slower with `@napi-rs/canvas` 1.0.13 than it was with 1.0.9, and the cause is in `@napi-rs/canvas`, not in pdf.js: images up to about 36 million pixels (a 600 dpi A4 scan) showed no slowdown, the gap grows with the declared size, and on one Apple Silicon Mac a 1-bit Flate image of about 529 million pixels took about 54 s instead of about 3.5 s. The memory cost predates the wasm fix; since then CCITT, JBIG2, and JPEG 2000 images, which can declare sizes like these from even smaller files, reach this path instead of rendering blank. Each wasm decoder instance (JBIG2/CCITT and JPEG 2000) is also capped at 2 GiB of wasm heap, and every worker has its own. Neither `maxInputBytes` nor `MAX_CANVAS_PIXELS` bounds a declared image size (`BACKLOG.md` SEC-004), so untrusted-PDF deployments need container memory limits and per-job time limits. On the main thread pdf.js decodes images one at a time, so the peak stays near one image whatever the concurrency; with worker threads the peak multiplies by the number of workers, so keep `concurrencyLimit` low in worker mode.

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
- Semantic options receive a fail-fast validation pass through the conversion module before progress is printed; its normalized snapshot drives CLI-only policy and progress decisions. Valid file conversions print their processing banner before input/render work begins. `pdfToPng()` then validates defensively at its public boundary, so CLI calls intentionally perform two validation passes instead of coupling to a normalized internal core; the `disableFontFace` process warning still fires once per process, not once per pass. Typed usage and conversion errors keep their output routes independent of message text or incidental `cause` values.
- Exactly one `<pdf-file-path>` is accepted. A missing path, or more than one argument, is a usage error that prints the usage text and exits 1; the error for extra arguments lists every argument it received.
- The password comes from `--pdf-file-password`, else from the `PDF_TO_PNG_PASSWORD` environment variable; an empty variable counts as unset. The flag is visible to other local users in process listings and stays in shell history and audit logs, so the variable is the safer channel.
- `withConsoleOnStderr()` points `console.log` and `console.info` at stderr while `pdfToPng()` runs, in every mode. pdf.js reports Info lines (verbosity 5) through `console.info`, which would otherwise land on stdout. The CLI prints its banner, success line, and metadata JSON outside that window, so a `--return-metadata-only` run writes only the JSON to stdout, even at `--verbosity-level 5`. Worker threads keep their own console.
- The entry guard starts the CLI only when `realpath(require.resolve(process.argv[1]))` equals `realpath(__filename)`. That covers a launch without the `.js` extension (`node out/cli`), a relative path, and a symbolic link such as the npm `.bin` link, while `require()`-ing the module does not start it.
- The CLI has no `maxInputBytes` option, so it always applies the 256 MiB default; only the library option raises it.
- `getVersion()` treats a missing or malformed `package.json` as a packaging failure.

## Build and validation

- Runtime requirement: Node.js 22.13 or newer; `.nvmrc` uses Node.js 24 and CI tests Node.js 22.13 and 24.
- Package format: CommonJS, compiled from `.ts` to `out/` with `.js` relative import specifiers.
- `npm test` runs Vitest with coverage only and enforces 98% thresholds for statements, lines, functions, and branches across all production modules.
- `npm run build:test` and `npm run build:strict` type-check `src/`, `__tests__/`, and `scripts/`, except `scripts/benchmark.ts`, which imports the built `out/`. `build:strict` checks the upstream `pdfjs-dist` / `@napi-rs/canvas` declaration boundary with `skipLibCheck: false`, and its program also walks the declaration graph of `png-visual-compare`, which the tests import. `__tests__/pngjs.d.ts` is a minimal stub that makes the `pngjs` type import in that graph resolve; strict mode fails without it, and its header says when it can be removed.
- `__tests__/pdfjs.assets.test.ts` exact-checks the installed pdf.js `cmaps`, `standard_fonts`, and `wasm` layouts and the set of top-level `pdfjs-dist` directories, so an upgrade must review every asset folder in the package; CCITT, JBIG2, and JPEG 2000 regression PDFs in `test-data/wasm/` (produced by `scripts/generate-wasm-fixtures.ts`) cover the wasm decoders; golden-image and real-worker tests cover rendered output and main/worker parity.
- Golden PNGs are compared through `comparePNG()` in `__tests__/comparePNG.ts`. A missing golden fails the test: creating it from the render under test would compare the render with itself. `UPDATE_GOLDENS=1` creates a missing golden on a developer machine, never when `CI` is set, and an existing golden is never overwritten; to refresh one deliberately, delete it, rerun with the variable, review the image, and commit it. CI also runs a `Require unchanged test fixtures` step that fails the Ubuntu jobs when a run leaves any new or modified file under `test-data/`.
- `__tests__/cli.compiled.test.ts` compiles `src/` into `test-results/cli-compiled-out` (not `out/`, which the worker tests compile and load) and spawns the compiled CLI in fresh processes, so entry-point launches and real pdf.js console output are covered, which the in-process tests in `__tests__/cli.test.ts` cannot see.
- Worker and main-thread PNGs are byte-identical, so output alone cannot show which path rendered. The real-worker tests spy on `renderPagesInWorkerPool` and `renderPdfPage` and assert that the pool ran once and the main thread rendered no page; `pdfToPngInWorkers()` in `__tests__/pdf.to.png.worker.threads.test.ts` asserts this for each worker-mode conversion that must render in the pool. The rejection and metadata-only cases check the spies directly, and the compiled-CLI cases cannot spy across the process boundary (`BACKLOG.md` ARCH-020).
- `__tests__/loader.document.open.call.sites.test.ts` fails if a file other than `pdfToPng.ts`, `pageRenderWorker.ts` (one document per worker thread), or the warm-up in `pdfjsLoader.ts` calls `getPdfDocument()`, or if `getDocument()` is called outside `getPdfDocument()`, so a new document open cannot skip the warm-up unnoticed.
- `npm run check` is the explicit CI/prepublish gate: clean, normal and strict type-checks, formatting, lint, production-license validation, and tests. Lint also covers `scripts/` (`scripts/benchmark.ts` without type information) and fails on warnings (`eslint . --max-warnings 0`).
- The Husky pre-commit hook runs `lint-staged`: ESLint (`--max-warnings 0`) and Prettier on staged TypeScript in `src/`, `__tests__/`, and `scripts/`, and Prettier on other staged formatted files (`js`, `mjs`, `cjs`, `json`, `md`, `yml`, `yaml`, and `.prettierrc`), matching the formatting and lint steps of `npm run check`.
- `npm run build` performs the publishable production compile after cleaning `out/` and `test-results/`.
