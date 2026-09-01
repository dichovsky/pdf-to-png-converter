# Copilot Instructions

## Commands

```bash
npm run build:test                         # Type-check src + tests, no emit
npm run build:strict                       # Strict upstream/dependency type-check
npm run test:fast                          # Fast Vitest loop, no coverage
npx vitest run __tests__/<file>.test.ts    # One test file
npm test                                   # Vitest with V8 coverage only
npm run lint                               # ESLint
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
| `src/const.ts`            | Defaults, input/concurrency/canvas limits, pipeline window, pdf.js asset paths            |
| `src/pdfToPng.ts`         | Validation, planning, scheduling, mode selection, output finalization, document lifecycle |
| `src/pdfInput.ts`         | Input normalization, ownership, one-handle bounded file reads                             |
| `src/pdfjsLoader.ts`      | Cached dynamic pdf.js import, init parameters, load cleanup                               |
| `src/pageRenderer.ts`     | Metadata, pixel/rotation guards, canvas render/encode/cleanup                             |
| `src/outputWriter.ts`     | Disk filename validation, folder preparation, realpath defense, exclusive-create writes   |
| `src/workerPool.ts`       | Worker protocol, dynamic scheduling, main-thread finalization, error/teardown policy      |
| `src/pageRenderWorker.ts` | Compiled worker entry, lazy per-worker document load, render responses                    |
| `src/cli.ts`              | CLI parsing/policy/output; delegates to public `pdfToPng`                                 |

Keep this consolidated ownership. Add another seam only when a new independent implementation or lifecycle boundary justifies it. `docs/ARCHITECTURE.md` is the detailed source of truth.

## Conversion flow

1. `pdfToPng()` calls its private `normalizeOptions()` once and snapshots `pagesToProcess`.
2. `getPdfFileBuffer()` returns owned, unshared `Uint8Array` bytes under `maxInputBytes`.
3. Worker mode retains one byte copy; `getPdfDocument()` loads the main document and maps the already validated pdf.js fields.
4. Page selection, output-folder resolution, page naming, disk-name validation, and case-insensitive duplicate checks happen before output-folder creation.
5. Metadata calls `getPageMetadata()`. Main-thread rendering calls `renderPdfPage()` through `mapLimitOrdered()`. Worker rendering calls `renderPagesInWorkerPool()` and uses the same loader/renderer in each worker.
6. `finalizePage()` attaches the public identity fields. Disk output goes through `savePNGfile()` on the main thread in every rendering mode.
7. The main loading task is destroyed in `finally`; pages, canvases, failed loads, worker finalizers, and workers have paired cleanup paths.

The CLI builds ordinary `PdfToPngOptions` and calls `pdfToPng()`. Image conversion requires `--output-folder`; metadata-only mode prints JSON; `--return-page-content` is rejected because in-memory buffers are a library-only result.

## Modes and ordering

- `returnMetadataOnly: true`: no canvas, PNG encode, worker pool, folder creation, or file write.
- Default: ordered window of `SEQUENTIAL_PIPELINE_WINDOW` (`3`) so asynchronous encode/write work can overlap later rendering.
- `processPagesInParallel: true`: ordered main-thread window of `concurrencyLimit`; use `1` for one page task in flight.
- `renderInWorkerThreads: true`: dynamic pool with at most `concurrencyLimit` workers, takes precedence over main-thread parallelism, and is ignored for metadata.

Every mode returns results in requested page order. Once an error occurs, no new work is dispatched and in-flight work drains. Page errors are reported deterministically by lowest page index; worker-level fatal errors take priority in worker mode. Workers and pending main-thread output finalizers must finish teardown before the call settles.

## Output contract

`PngPageOutput` is a discriminated union:

- `kind: 'metadata'`: `content` is `undefined`, `path` is `''`.
- `kind: 'content'`: `path` is `''`; `content` may be omitted when `returnPageContent` is false.
- `kind: 'file'`: `path` is absolute; content is materialized for the write and retained only when requested.

All variants include `pageNumber`, `name`, floored integer `width`/`height`, and normalized `rotation`. Metadata and render paths must share zero-size and `MAX_CANVAS_PIXELS` rejection behavior.

`pagesToProcess` accepts positive integers. Page numbers above `numPages` are silently filtered. Duplicate page requests remain duplicate tasks; they fail only when disk output resolves them to colliding names.

## Security invariants

### Input

- Open a path once with `O_RDONLY | O_NONBLOCK`; inspect and positionally read through that same handle, then close in `finally`.
- Reject non-regular files and enforce `maxInputBytes` across initial size, later growth, buffers, cross-realm views, and supported array-likes.
- Preserve caller byte containers by copying before pdf.js can transfer/detach them. Preserve the path-input dedicated-allocation zero-copy handoff where safe.

### Output

- Resolve relative output folders before user filename callbacks run.
- Preflight disk filenames and duplicates before `prepareOutputFolder()` so validation failures create no directory.
- Revalidate with `assertValidOutputFilename()` in `savePNGfile()` as defense in depth.
- Keep filenames to one flat path segment under the host's separator rules and reject `"."` / `".."` disk aliases.
- Preserve `OutputFolderHandle`, the per-write realpath equality check, and `'wx'` opens.
- Do not claim the path checks eliminate directory-swap races. Callers must use an output folder that untrusted users cannot modify.

## Defaults and limits

`src/const.ts` is authoritative for shared defaults and limits. Mode defaults are applied in `normalizeOptions()`.

- viewport scale: `1`, maximum `100`
- canvas area: `100_000_000` pixels
- input size: `256 MiB`
- concurrency: default `4`, maximum `16`
- default in-memory content: enabled
- metadata, main-thread parallelism, and worker threads: disabled

Use `??`, not `||`, for optional values where `false` or `0` are meaningful. Keep `src/types.ts` JSDoc synchronized with behavior.

## TypeScript and style

- Relative TypeScript imports use `.js` specifiers because the project compiles with NodeNext semantics to CommonJS.
- Use `import type` for type-only imports.
- Give functions in `src/` explicit return types and prefix intentionally unused parameters with `_`.
- Use interfaces for object shapes and type aliases for unions.
- Do not add DOM globals to the normal build. `tsconfig.strict.json` includes DOM only for upstream canvas declaration checking.
- Build scripts invoke `@typescript/native` by explicit path. The `typescript` package is the TypeScript 6 compatibility compiler API used by ts-node and typescript-eslint; toolchain reunification remains in `BACKLOG.md`.

## Tests

Vitest has a 180-second timeout. V8 coverage thresholds are 98% for statements, lines, functions, and branches. Worker integration compiles `out/pageRenderWorker.js` before starting real workers; do not call `npm run build` from a running test because its clean hook removes shared output directories.

Fixtures live in `test-data/`; generated output and coverage live in `test-results/`. Prefer focused tests while iterating, then run `npm run check`.

`__tests__/pdfjs.assets.test.ts` exact-checks the installed `cmaps` and `standard_fonts` layout against `__tests__/test-data-constants.ts`. For `pdfjs-dist` upgrades, review asset-list changes explicitly, do not auto-refresh golden PNGs, and run the real-worker parity suite.

High-value regression areas:

- caller-buffer ownership and cross-realm input shapes
- same-handle file checks, shrinking/growing reads, caps, and special-file rejection
- output callback CWD changes, flat names, duplicate names, symlink changes, and `'wx'` collisions
- metadata/render dimension parity and cleanup on every failure hop
- result order and deterministic failures in default, parallel, and worker modes
- worker document reuse, crashes, output-finalizer failures, and complete termination
- pdf.js import/type compatibility, installed asset layout, golden rendering, and main/worker byte parity
- CLI metadata JSON, required output-folder policy, silent behavior, and packaging/version errors

## Benchmark

`scripts/benchmark.ts` imports only the compiled public API. `BENCH_FIXTURE`, `BENCH_PAGES`, `BENCH_MODES` (or legacy `BENCH_MODE`), `BENCH_ITERATIONS`, `BENCH_WARMUP`, `BENCH_CONCURRENCY`, and `BENCH_LABEL` configure a run. Requested counts cycle valid fixture page numbers, so expensive counts such as 20 or 100 are explicit opt-ins rather than defaults.
