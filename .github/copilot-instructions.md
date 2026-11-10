# Copilot Instructions

## Commands

```bash
npm run build:test                         # Type-check src, tests, and scripts (except scripts/benchmark.ts), no emit
npm run build:strict                       # Run strict dependency-boundary type-check
npm run test:fast                          # Run Vitest without coverage
npx vitest run __tests__/<file>.test.ts    # Run one test file
npm test                                   # Run Vitest with V8 coverage only
npm run lint                               # Run ESLint (--max-warnings 0)
npm run format:check                       # Run Prettier check
npm run check                              # Run the full CI and prepublish validation gate
npm run build                              # Clean and compile production code to out/
npm run bench                              # Run the public-interface benchmark
```

`npm test` has no `pretest` hook. Run `npm run check` to execute the complete gate: clean, normal and strict type-checks, formatting, lint, production-license check, and tests.

## Product boundary

This repository publishes a Node.js 24+ CommonJS library and CLI. `.nvmrc` specifies Node.js 26, and CI tests Node.js 24 and 26. The package converts PDF file paths or byte containers into ordered page metadata, PNG buffers, or PNG files. `pdfjs-dist` renders pages through its built-in Node canvas factory backed by `@napi-rs/canvas`.

The package root exports only these symbols:

```typescript
export { pdfToPng } from './pdfToPng.js';
export type { PdfToPngOptions, PngPageOutput } from './types.js';
export { VerbosityLevel } from './types.js';
```

Do not export internal module paths or add a second conversion entrypoint.

## Current module design

The source tree has 11 TypeScript modules:

| Module                    | Responsibility                                                                            |
| ------------------------- | ----------------------------------------------------------------------------------------- |
| `src/index.ts`            | Public re-exports only                                                                    |
| `src/types.ts`            | Public options, output union, rotation, and verbosity                                     |
| `src/const.ts`            | Defaults, limits, pipeline window, wasm warm-up timeout, pdf.js asset and decoder names   |
| `src/pdfToPng.ts`         | Validation, planning, scheduling, mode selection, output finalization, document lifecycle |
| `src/pdfInput.ts`         | Input normalization, ownership, single-handle bounded file reads                          |
| `src/pdfjsLoader.ts`      | Cached pdf.js import, init parameters, package assets, wasm warning/warm-up, load cleanup |
| `src/pageRenderer.ts`     | Metadata, pixel/rotation guards, canvas render/encode/cleanup                             |
| `src/outputWriter.ts`     | Disk filename validation, folder preparation, realpath defense, exclusive-create writes   |
| `src/workerPool.ts`       | Worker protocol, dynamic scheduling, main-thread finalization, error/teardown policy      |
| `src/pageRenderWorker.ts` | Compiled worker entry, lazy per-worker document load, render responses                    |
| `src/cli.ts`              | CLI parsing, policy, and output; delegates to public `pdfToPng`                           |

Keep these 11 modules consolidated. Add a new module only when an independent implementation or lifecycle boundary requires it. See `docs/ARCHITECTURE.md` for full details.

## Conversion flow

1. `pdfToPng()` calls `normalizeOptions()` once (`null` counts as unset; `pagesToProcess` must be a real `Array` and is copied). Unless `returnMetadataOnly` is `true`, `pdfToPng()` resolves a relative `outputFolder` against `process.cwd()` synchronously before its first `await`.
2. `getPdfFileBuffer()` returns an owned, unshared `Uint8Array` within `maxInputBytes`.
3. Worker mode saves one copy of the PDF bytes on the main thread. `pdfToPng()` awaits `warmUpWasmDecoders()` before every main-thread `getPdfDocument()` call (issue #288, mozilla/pdf.js#22131; enforced by `__tests__/loader.document.open.call.sites.test.ts`; remove under `BACKLOG.md` ARCH-018). Warm-up runs once per thread on the main thread, ignores errors, and stops blocking after `WASM_WARM_UP_TIMEOUT_MS`. `getPdfDocument()` loads the main document and passes `cMapUrl`, `standardFontDataUrl`, and `wasmUrl` resolved from the installed `pdfjs-dist` package (never from `process.cwd()`).
4. `pdfToPng()` filters page numbers, resolves all page filenames, validates disk filenames (including `MAX_FILENAME_LENGTH`), and checks for duplicate names under `outputNameKey()` Unicode folding before creating the output folder. After the metadata-only return and before output-folder creation, `warnIfWasmDecodersMissing()` runs at most once per thread on the main thread.
5. Metadata mode calls `getPageMetadata()`. Main-thread rendering calls `renderPdfPage()` through `mapLimitOrdered()`. Worker mode calls `renderPagesInWorkerPool()`, where each worker uses the same loader and renderer.
6. `finalizePage()` adds the public output fields. In file mode, `savePNGfile()` writes files on the main thread in both main-thread and worker rendering modes.
7. `pdfDocument.loadingTask.destroy()` runs in `finally`. Pages, canvases, failed loads, worker finalizers, and workers all have paired cleanup paths.

The CLI builds `PdfToPngOptions` and calls `pdfToPng()`. Image conversion requires `--output-folder`. Metadata mode prints JSON to `stdout`. The CLI rejects `--return-page-content` because in-memory buffers apply only to the library API. It accepts one `<pdf-file-path>` (extra positional arguments fail with exit code 1), reads the password from `--pdf-file-password` or `PDF_TO_PNG_PASSWORD`, and redirects main-thread pdf.js console output to `stderr` so metadata mode prints only JSON to `stdout`.

## Modes and ordering

- `returnMetadataOnly: true`: Creates no canvas, PNG buffer, worker pool, output folder, or file.
- Default mode: Uses an ordered window of `SEQUENTIAL_PIPELINE_WINDOW` (`3`) so asynchronous PNG encoding and file writes overlap later page renders.
- `processPagesInParallel: true`: Uses an ordered main-thread window of `concurrencyLimit`. Set `concurrencyLimit: 1` for strict single-page execution.
- `renderInWorkerThreads: true`: Uses a dynamic worker pool of up to `concurrencyLimit` workers. Overrides `processPagesInParallel` and is ignored in metadata mode.

Every mode returns results in requested page order. When an error occurs, the scheduler stops dispatching new tasks and drains in-flight work. Page errors report deterministically by lowest page index; worker-level fatal errors take priority in worker mode. Workers and main-thread finalizers complete teardown before `pdfToPng()` settles. Worker errors return as native `Error` instances with `message`, `name`, and `cause` preserved (standard subclasses like `TypeError` keep their class; pdf.js exception classes and extra properties like `details` or `code` are not preserved). Worker mode requires the unbundled package because `resolveWorkerEntryPath()` uses `__dirname`.

## Output contract

`PngPageOutput` is a discriminated union:

- `kind: 'metadata'`: `content` is `undefined`, `path` is `''`.
- `kind: 'content'`: `path` is `''`; `content` is `undefined` when `returnPageContent` is `false`.
- `kind: 'file'`: `path` is an absolute path; `content` is generated for the file write and kept only when `returnPageContent` is `true`.

All variants include `pageNumber`, `name`, floored integer `width` and `height`, and normalized `rotation`. Metadata and render modes enforce the same zero-dimension, `MAX_CANVAS_PIXELS`, and `MAX_CANVAS_SIDE` checks.

`pagesToProcess` must be a real `Array` of positive integers; other containers and sparse arrays throw before I/O. Page numbers above `numPages` are ignored. Duplicate page numbers run as separate tasks and fail only if disk filenames collide.

## Security invariants

### Input

- Open path inputs once with `O_RDONLY | O_NONBLOCK`, inspect and read positionally through that handle, and close the handle in `finally`.
- Reject non-regular files. Enforce `maxInputBytes` across initial file size, file growth during reads, buffers, cross-realm views/buffers, and byte `Array`s. Reject arbitrary objects with a numeric `length` or a forged `ArrayBuffer`/`SharedArrayBuffer` `Symbol.toStringTag` (size is read from prototype `byteLength` getters).
- Copy caller byte containers before pdf.js can transfer or detach them. Keep the zero-copy buffer handoff for dedicated file-read allocations.

### Output

- Resolve a relative `outputFolder` synchronously in `pdfToPng()` before the first `await` and before any `outputFileMaskFunc` call.
- Validate disk filenames and check for duplicates under `outputNameKey()` Unicode folding before `prepareOutputFolder()` creates any directory.
- Validate filenames again in `savePNGfile()` with `assertValidOutputFilename()`.
- Keep disk filenames flat (one path segment, up to `MAX_FILENAME_LENGTH` units, no `"."` or `".."` aliases).
- Preserve `OutputFolderHandle`, the per-write `realpath` comparison, and `'wx'` exclusive file creation.
- If a write or close fails after `'wx'` open succeeds, unlink the newly created file (best effort, only while `lstat` matches the open handle's device and inode) and rethrow the original error. Never unlink when `open()` fails.
- Require callers to use an output folder that untrusted users cannot modify.

## Defaults and limits

`src/const.ts` defines shared defaults and limits, and `normalizeOptions()` applies mode defaults:

- Viewport scale: default `1`, maximum `100`
- Canvas area: maximum `100_000_000` pixels; canvas side: maximum `1_000_000` pixels (libpng limit, enforced in all modes)
- Input size: default `256 MiB` (`maxInputBytes`, bounds input bytes only); input path length: maximum `4096` characters; single `FileHandle.read()` call: maximum `2 ** 30` bytes
- Output filename length: maximum `255` units (UTF-16 code units on macOS/Windows, UTF-8 bytes elsewhere)
- Concurrency: default `4`, maximum `16`
- Default in-memory content: `true`
- Metadata, parallel mode, and worker threads: default `false`

Use `??` instead of `||` when `false` or `0` are valid values. Keep JSDoc in `src/types.ts` synchronized with runtime behavior.

`disableFontFace` is always `true` at runtime because pdf.js has no Font Loading API in Node.js. Passing `false` logs process warning `PDF_TO_PNG_DISABLE_FONT_FACE_IGNORED` at most once per thread and uses `true`.

## TypeScript and style

- Use `.js` extensions in relative imports (`module: nodenext` / `moduleResolution: node16` compiling to CommonJS).
- Use `import type` for type-only imports.
- Add explicit return types to functions in `src/` and prefix unused parameters with `_`.
- Use `interface` for object shapes and `type` for unions.
- Do not add DOM globals to `tsconfig.json`. `tsconfig.strict.json` adds `DOM` only to check upstream canvas types.
- Build scripts invoke `@typescript/native` directly while `typescript` points to TypeScript 6 for `ts-node` and `typescript-eslint` (`BACKLOG.md` TOOL-001).

## Tests

Vitest uses a 180-second timeout and enforces 98% V8 coverage for statements, lines, functions, and branches. Worker integration tests compile `out/pageRenderWorker.js` before spawning workers; do not run `npm run build` inside tests because `prebuild` deletes `out/` and `test-results/`. Worker tests use spies on `renderPagesInWorkerPool` and `renderPdfPage` (`pdfToPngInWorkers()` in `__tests__/pdf.to.png.worker.threads.test.ts`). `__tests__/cli.compiled.test.ts` compiles `src/` into `test-results/cli-compiled-out` and runs the CLI in child processes.

`__tests__/pdfjs.assets.test.ts` checks installed `cmaps`, `standard_fonts`, `wasm`, and top-level `pdfjs-dist` directories against `__tests__/test-data-constants.ts`. `comparePNG` fails on missing golden PNGs and never overwrites existing ones (`UPDATE_GOLDENS=1` creates missing goldens locally when `CI` is unset).

Key regression areas:

- Caller buffer ownership and cross-realm input shapes
- Single-handle file checks, shrinking/growing files, size caps, and special-file rejection
- Output callback CWD changes, flat filenames, filename length, Unicode-folded duplicate detection, symlink checks, `'wx'` collisions, and partial-file cleanup on failed writes
- Metadata and render dimension parity and resource cleanup on errors
- Result ordering and deterministic error selection across default, parallel, and worker modes
- Worker routing spies, document reuse, worker crashes, error serialization (`message`, `name`, `cause`), finalizer failures, and worker termination
- pdf.js asset layout, WebAssembly decoders and warm-up, golden image comparison, and main/worker byte parity
- CLI metadata JSON on `stdout`, required `--output-folder`, single `<pdf-file-path>`, `PDF_TO_PNG_PASSWORD`, `stderr` routing of pdf.js logs, `--silent` mode, compiled CLI invocation forms, and package version checks

## Benchmark

`scripts/benchmark.ts` imports the compiled public API. Configure runs with `BENCH_FIXTURE`, `BENCH_PAGES`, `BENCH_MODES` (or `BENCH_MODE`), `BENCH_ITERATIONS`, `BENCH_WARMUP`, `BENCH_CONCURRENCY`, and `BENCH_LABEL`.
