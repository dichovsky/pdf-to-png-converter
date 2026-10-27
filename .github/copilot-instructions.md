# Copilot Instructions

## Commands

```bash
npm run build:test                         # Type-check src + tests + scripts (except scripts/benchmark.ts), no emit
npm run build:strict                       # Strict upstream/dependency type-check
npm run test:fast                          # Fast Vitest loop, no coverage
npx vitest run __tests__/<file>.test.ts    # One test file
npm test                                   # Vitest with V8 coverage only
npm run lint                               # ESLint, warnings fail (--max-warnings 0)
npm run format:check                       # Prettier check
npm run check                              # Full CI/prepublish validation graph
npm run build                              # Clean production compile to out/
npm run bench                              # Public-interface benchmark
```

`npm test` has no `pretest` validation hook. Run `npm run check` for the complete gate: clean, both type-checks, formatting, lint, production-license validation, and tests.

## Product boundary

This repository publishes a Node.js 22.13+ CommonJS library and CLI; `.nvmrc` uses Node.js 24 and CI tests Node.js 22.13 and 24. It converts PDF paths or byte containers into ordered page metadata, PNG buffers, or PNG files. `pdfjs-dist` renders through its built-in Node canvas factory backed by `@napi-rs/canvas`.

The package root exports only:

```typescript
export { pdfToPng } from './pdfToPng.js';
export type { PdfToPngOptions, PngPageOutput } from './types.js';
export { VerbosityLevel } from './types.js';
```

Do not expose internal source paths or add a second conversion entrypoint.

## Current module design

The source tree contains 11 TypeScript modules:

| Module                    | Responsibility                                                                            |
| ------------------------- | ----------------------------------------------------------------------------------------- |
| `src/index.ts`            | Public re-exports only                                                                    |
| `src/types.ts`            | Public options, output union, rotation, and verbosity                                     |
| `src/const.ts`            | Defaults, limits, pipeline window, wasm warm-up timeout, pdf.js asset and decoder names   |
| `src/pdfToPng.ts`         | Validation, planning, scheduling, mode selection, output finalization, document lifecycle |
| `src/pdfInput.ts`         | Input normalization, ownership, one-handle bounded file reads                             |
| `src/pdfjsLoader.ts`      | Cached pdf.js import, init parameters, package assets, wasm warning/warm-up, load cleanup |
| `src/pageRenderer.ts`     | Metadata, pixel/rotation guards, canvas render/encode/cleanup                             |
| `src/outputWriter.ts`     | Disk filename validation, folder preparation, realpath defense, exclusive-create writes   |
| `src/workerPool.ts`       | Worker protocol, dynamic scheduling, main-thread finalization, error/teardown policy      |
| `src/pageRenderWorker.ts` | Compiled worker entry, lazy per-worker document load, render responses                    |
| `src/cli.ts`              | CLI parsing/policy/output; delegates to public `pdfToPng`                                 |

Keep this consolidated ownership. Add another seam only when a new independent implementation or lifecycle boundary justifies it. `docs/ARCHITECTURE.md` is the detailed source of truth.

## Conversion flow

1. `pdfToPng()` calls its private `normalizeOptions()` once (`null` counts as unset; `pagesToProcess` must be a real `Array` and is snapshotted) and, unless `returnMetadataOnly` is set, resolves a relative `outputFolder` against `process.cwd()` before its first `await`.
2. `getPdfFileBuffer()` returns owned, unshared `Uint8Array` bytes under `maxInputBytes`.
3. Worker mode retains one byte copy. `warmUpWasmDecoders()` is awaited before every main-thread `getPdfDocument()` call (issue #288, mozilla/pdf.js#22131; do not add a main-thread document open that skips it, and `__tests__/loader.document.open.call.sites.test.ts` fails when a file other than `pdfToPng.ts`, `pageRenderWorker.ts`, or the warm-up in `pdfjsLoader.ts` opens one; remove under `BACKLOG.md` ARCH-018). It runs once per thread, workers skip it, a failed warm-up is ignored, and one still pending after `WASM_WARM_UP_TIMEOUT_MS` stops blocking. `getPdfDocument()` loads the main document, maps the already validated pdf.js fields, and passes `cMapUrl`, `standardFontDataUrl`, and `wasmUrl` built from the installed `pdfjs-dist` package location (never the working directory).
4. Page selection, page naming, disk-name validation (including `MAX_FILENAME_LENGTH`), and duplicate checks under the `outputNameKey()` Unicode fold happen before output-folder creation. After the metadata-only return and before the folder is prepared, `warnIfWasmDecodersMissing()` runs at most once per thread (the library runs the check on the main thread only, so normally once per process).
5. Metadata calls `getPageMetadata()`. Main-thread rendering calls `renderPdfPage()` through `mapLimitOrdered()`. Worker rendering calls `renderPagesInWorkerPool()` and uses the same loader/renderer in each worker.
6. `finalizePage()` attaches the public identity fields. Disk output goes through `savePNGfile()` on the main thread in every rendering mode.
7. The main loading task is destroyed in `finally`; pages, canvases, failed loads, worker finalizers, and workers have paired cleanup paths.

The CLI builds ordinary `PdfToPngOptions` and calls `pdfToPng()`. Image conversion requires `--output-folder`; metadata-only mode prints JSON; `--return-page-content` is rejected because in-memory buffers are a library-only result. The CLI takes exactly one `<pdf-file-path>` (more is a usage error with exit code 1), reads the password from `--pdf-file-password`, else `PDF_TO_PNG_PASSWORD`, and sends pdf.js console output written on the main thread to stderr, so a metadata run's stdout is only the JSON.

## Modes and ordering

- `returnMetadataOnly: true`: no canvas, PNG encode, worker pool, folder creation, or file write.
- Default: ordered window of `SEQUENTIAL_PIPELINE_WINDOW` (`3`) so asynchronous encode/write work can overlap later rendering.
- `processPagesInParallel: true`: ordered main-thread window of `concurrencyLimit`; use `1` for one page task in flight.
- `renderInWorkerThreads: true`: dynamic pool with at most `concurrencyLimit` workers, takes precedence over main-thread parallelism, and is ignored for metadata.

Every mode returns results in requested page order. Once an error occurs, no new work is dispatched and in-flight work drains. Page errors are reported deterministically by lowest page index; worker-level fatal errors take priority in worker mode. Workers and pending main-thread output finalizers must finish teardown before the call settles. Errors a worker reports reach the caller as native `Error`s with `message`, `name`, and `cause` preserved. Built-in subclasses such as `TypeError` keep their class; the class of a pdf.js exception or any custom `Error` subclass, and pdf.js-specific fields such as `details` and `code`, are not carried across. Worker mode needs the unbundled installed package (`resolveWorkerEntryPath()` needs `__dirname`).

## Output contract

`PngPageOutput` is a discriminated union:

- `kind: 'metadata'`: `content` is `undefined`, `path` is `''`.
- `kind: 'content'`: `path` is `''`; `content` may be omitted when `returnPageContent` is false.
- `kind: 'file'`: `path` is absolute; content is materialized for the write and retained only when requested.

All variants include `pageNumber`, `name`, floored integer `width`/`height`, and normalized `rotation`. Metadata and render paths must share zero-size, `MAX_CANVAS_PIXELS`, and `MAX_CANVAS_SIDE` rejection behavior.

`pagesToProcess` must be a real `Array` of positive integers; any other container and arrays with holes throw before I/O. Page numbers above `numPages` are silently filtered. Duplicate page requests remain duplicate tasks; they fail only when disk output resolves them to colliding names.

## Security invariants

### Input

- Open a path once with `O_RDONLY | O_NONBLOCK`; inspect and positionally read through that same handle, then close in `finally`.
- Reject non-regular files and enforce `maxInputBytes` across initial size, later growth, buffers, cross-realm views and buffers, and byte `Array`s counted by `length`. Accept no other array-like: an object that merely claims a `length` is rejected, and so is an object that only forges the `ArrayBuffer` or `SharedArrayBuffer` tag (the size comes from the prototype `byteLength` getters).
- Preserve caller byte containers by copying before pdf.js can transfer/detach them. Preserve the path-input dedicated-allocation zero-copy handoff where safe.

### Output

- Resolve a relative `outputFolder` synchronously in `pdfToPng()`, before its first `await` and so before any user filename callback runs; a later `process.chdir()` (the caller's or another conversion's callback) must not redirect it.
- Preflight disk filenames and duplicates before `prepareOutputFolder()` so validation failures create no directory. Detect duplicates under the `outputNameKey()` Unicode fold (NFD, full case folding, lone surrogates), not only ASCII case.
- Revalidate with `assertValidOutputFilename()` in `savePNGfile()` as defense in depth.
- Keep filenames to one flat path segment under the host's separator rules, at most `MAX_FILENAME_LENGTH` units, and reject `"."` / `".."` disk aliases.
- Preserve `OutputFolderHandle`, the per-write realpath equality check, and `'wx'` opens.
- If a write or close fails after the `'wx'` open succeeded, remove the file this call created (best effort, and only while the path still names that file: same device and inode, taken from the open handle) and rethrow the original error. Never unlink on an `open()` failure, so an existing target stays untouched.
- Do not claim the path checks eliminate directory-swap races. Callers must use an output folder that untrusted users cannot modify.

## Defaults and limits

`src/const.ts` is authoritative for shared defaults and limits. Mode defaults are applied in `normalizeOptions()`.

- viewport scale: `1`, maximum `100`
- canvas area: `100_000_000` pixels; canvas side: `1_000_000` pixels (libpng's per-side limit, enforced on every path including metadata-only and `returnPageContent: false`)
- input size: `256 MiB`, the default of `maxInputBytes` (the CLI has no flag for it), which bounds input bytes and not pdf.js memory; string path input: at most `4096` characters; one `FileHandle.read()` request: at most `2 ** 30` bytes
- output file name: at most `255` units (UTF-16 code units on macOS and Windows, UTF-8 bytes elsewhere)
- concurrency: default `4`, maximum `16`
- default in-memory content: enabled
- metadata, main-thread parallelism, and worker threads: disabled

Use `??`, not `||`, for optional values where `false` or `0` are meaningful. Keep `src/types.ts` JSDoc synchronized with behavior.

`disableFontFace` is always `true` at runtime: pdf.js has no Font Loading API in Node.js, so `normalizeOptions()` ignores an explicit `false` and emits process warning `PDF_TO_PNG_DISABLE_FONT_FACE_IGNORED` at most once per thread (normally once per process). Do not forward the caller's value to pdf.js or the workers.

## TypeScript and style

- Relative TypeScript imports use `.js` specifiers because the project compiles with NodeNext semantics to CommonJS.
- Use `import type` for type-only imports.
- Give functions in `src/` explicit return types and prefix intentionally unused parameters with `_`.
- Use interfaces for object shapes and type aliases for unions.
- Do not add DOM globals to the normal build. `tsconfig.strict.json` includes DOM only for upstream canvas declaration checking.
- Build scripts invoke `@typescript/native` by explicit path. The `typescript` package is the TypeScript 6 compatibility compiler API used by ts-node and typescript-eslint; toolchain reunification remains in `BACKLOG.md`.

## Tests

Vitest has a 180-second timeout. V8 coverage thresholds are 98% for statements, lines, functions, and branches. Worker integration compiles `out/pageRenderWorker.js` before starting real workers; do not call `npm run build` from a running test because its clean hook removes shared output directories. Worker and main-thread PNGs are byte-identical, so worker-mode tests assert routing with spies on `renderPagesInWorkerPool` and `renderPdfPage` (helper `pdfToPngInWorkers()` in `__tests__/pdf.to.png.worker.threads.test.ts`). `__tests__/cli.compiled.test.ts` compiles `src/` into `test-results/cli-compiled-out` (not `out/`), like the concurrent-wasm test, and spawns the compiled CLI in fresh processes.

Fixtures live in `test-data/`; generated output and coverage live in `test-results/`. Prefer focused tests while iterating, then run `npm run check`.

`__tests__/pdfjs.assets.test.ts` exact-checks the installed `cmaps`, `standard_fonts`, and `wasm` layouts and the set of top-level `pdfjs-dist` directories against `__tests__/test-data-constants.ts`. For `pdfjs-dist` upgrades, review asset-list changes explicitly, review every top-level asset folder in the package and not only the known ones (`cmaps`, `standard_fonts`, `wasm`) because a missed folder caused issue #278, do not auto-refresh golden PNGs, and run the real-worker parity suite. CCITT, JBIG2, and JPEG 2000 regression PDFs live in `test-data/wasm/` and are produced by `scripts/generate-wasm-fixtures.ts`. `comparePNG` fails on a missing golden PNG and never overwrites an existing one; create a missing golden only with `UPDATE_GOLDENS=1` while `CI` is unset, then review and commit it. The CI step `Require unchanged test fixtures` fails the Ubuntu jobs on any new or modified file under `test-data/`.

High-value regression areas:

- caller-buffer ownership and cross-realm input shapes
- same-handle file checks, shrinking/growing reads, caps, and special-file rejection
- output callback CWD changes, flat names, name length, Unicode-fold duplicate names, symlink changes, `'wx'` collisions, and removal of a file left by a failed write
- metadata/render dimension parity and cleanup on every failure hop
- result order and deterministic failures in default, parallel, and worker modes
- worker routing (asserted with spies, not inferred from byte parity), document reuse, crashes, error `message`, `name`, and `cause` across the thread boundary, output-finalizer failures, and complete termination
- pdf.js import/type compatibility, installed asset layout, wasm decoders and warm-up, golden rendering, and main/worker byte parity
- CLI metadata JSON (stdout only), required output-folder policy, the single `<pdf-file-path>` rule, `PDF_TO_PNG_PASSWORD`, stderr routing of pdf.js output, silent behavior, compiled-CLI launch forms (with or without `.js`, relative, symlinked), and packaging/version errors

## Benchmark

`scripts/benchmark.ts` imports only the compiled public API. `BENCH_FIXTURE`, `BENCH_PAGES`, `BENCH_MODES` (or legacy `BENCH_MODE`), `BENCH_ITERATIONS`, `BENCH_WARMUP`, `BENCH_CONCURRENCY`, and `BENCH_LABEL` configure a run. Requested counts cycle valid fixture page numbers, so expensive counts such as 20 or 100 are explicit opt-ins rather than defaults.
