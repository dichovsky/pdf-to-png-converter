# CLAUDE.md

Repository guidance for Claude Code.

## Commands

```bash
npm run build:test                         # Type-check src + tests, no emit
npm run build:strict                       # Strict dependency-boundary type-check
npm run test:fast                          # Fast Vitest loop, no coverage
npx vitest run __tests__/<file>.test.ts    # One test file
npm test                                   # Vitest with coverage only
npm run lint                               # ESLint
npm run format:check                       # Prettier check
npm run check                              # Full CI/prepublish gate
npm run build                              # Clean production compile to out/
```

`npm test` intentionally has no heavyweight `pretest` hook. Use `npm run check` when the complete validation graph is required.

## Architecture

This is a Node.js 22.13+ CommonJS library and CLI; `.nvmrc` uses Node.js 24 and CI tests Node.js 22.13 and 24. `src/index.ts` exports only `pdfToPng`, `PdfToPngOptions`, `PngPageOutput`, and `VerbosityLevel`. Rendering uses `pdfjs-dist` and its built-in Node canvas factory backed by `@napi-rs/canvas`.

The current source tree has 11 modules:

- `src/pdfToPng.ts` — the sole conversion entrypoint and orchestration boundary: option validation/defaulting, page and name planning, bounded scheduling, execution-mode selection, output finalization, and document teardown.
- `src/pdfInput.ts` — supported input shapes, owned `Uint8Array` normalization, bounded one-handle file reads, and input-size enforcement.
- `src/pdfjsLoader.ts` — cached dynamic pdf.js import, init parameters, and failed-load cleanup.
- `src/pageRenderer.ts` — page metadata, pixel/rotation guards, canvas rendering, PNG encoding, and page/canvas cleanup.
- `src/outputWriter.ts` — disk filename validation, output-folder preparation, realpath checks, and exclusive-create writes.
- `src/workerPool.ts` — worker protocol types, dynamic dispatch, error policy, main-thread finalizers, and worker teardown.
- `src/pageRenderWorker.ts` — compiled worker entry; lazy document load and page rendering inside each worker.
- `src/cli.ts` — CLI parsing and policy; delegates to the public `pdfToPng` function.
- `src/types.ts` — public option and output types plus `VerbosityLevel`.
- `src/const.ts` — defaults, resource/concurrency limits, pipeline window, and pdf.js asset paths.
- `src/index.ts` — public re-exports only.

Keep this consolidated ownership. Split out another seam only when a new independent implementation or lifecycle boundary actually needs it. See `docs/ARCHITECTURE.md` for the full runtime and ownership model.

## Conversion invariants

1. `pdfToPng()` validates and snapshots options before input I/O.
2. `getPdfFileBuffer()` returns owned `Uint8Array` bytes. Path input is opened, checked, and read through one handle; caller-owned byte containers are copied so pdf.js cannot detach them.
3. Worker mode retains one main-thread byte copy before the main pdf.js loading task may detach its input.
4. All page names are resolved before output-folder creation. Disk names and case-insensitive duplicates are preflighted before any output I/O.
5. Metadata-only mode creates no canvas, worker pool, output folder, PNG bytes, or files.
6. File writes always run on the main thread through `outputWriter`, including worker rendering mode.
7. Result arrays stay in requested page order in every mode.
8. `pdfDocument.loadingTask.destroy()` runs in `finally`; pages, canvases, loading failures, finalizers, and workers have matching cleanup paths.

`pagesToProcess` must contain positive integers. Entries above the document page count are silently filtered; duplicates remain separate tasks and are allowed unless disk output makes their resolved filenames collide.

## Scheduling and content

- Default paths, including metadata without explicit parallelism, use the ordered bounded scheduler with `SEQUENTIAL_PIPELINE_WINDOW` (`3`). Async PNG encode and disk finalization may overlap a later render.
- `processPagesInParallel: true` uses `concurrencyLimit` on the main thread. Set the limit to `1` for exactly one page task in flight.
- `renderInWorkerThreads: true` takes precedence over main-thread parallelism and is ignored for metadata-only requests. Each worker loads one private document copy; names and files stay main-side.
- In-flight work drains after a page error. Main-thread/page errors are deterministic by lowest page index; worker-level fatal errors take priority in worker mode.
- File mode always materializes content for the write, then omits it from the result when `returnPageContent` is false. In-memory mode may omit PNG encoding when content is not requested.

## Output and security

- Resolve relative output folders before invoking `outputFileMaskFunc`; callbacks must not be able to redirect the destination through `process.chdir()`.
- Keep disk names flat. Preflight with `assertValidOutputFilename()` before folder creation and repeat validation in `savePNGfile()` as defense in depth.
- Detect duplicate disk names case-insensitively before I/O.
- Preserve `OutputFolderHandle` as one value: the resolved folder and its baseline realpath must not drift apart.
- Preserve `'wx'` file opens. Never replace them with overwrite-capable `writeFile()` calls.
- Realpath checks cannot atomically bind a pathname to a directory inode. Documentation must continue to require an output directory that untrusted users cannot modify.

## Defaults

Runtime defaults live in `PDF_TO_PNG_OPTIONS_DEFAULTS` in `src/const.ts`; mode defaults are applied in `normalizeOptions()` in `src/pdfToPng.ts`. Use `??`, not `||`, when `false` or `0` are valid values. Keep public JSDoc defaults synchronized with runtime behavior.

Hard limits are also centralized in `src/const.ts`:

- `MAX_VIEWPORT_SCALE = 100`
- `MAX_CANVAS_PIXELS = 100_000_000`
- `MAX_INPUT_BYTES = 256 MiB`
- `MAX_CONCURRENCY_LIMIT = 16`

## TypeScript conventions

- The package is CommonJS but compiles with `module: nodenext` / `moduleResolution: node16`. Relative source imports must use `.js` specifiers.
- Use `import type` for type-only dependencies.
- Give functions in `src/` explicit return types.
- Prefix intentionally unused parameters with `_`.
- Use interfaces for object shapes and type aliases for unions.
- Do not add DOM globals to `tsconfig.json`. `tsconfig.strict.json` includes DOM only to check upstream canvas declarations.
- The native TypeScript 7 compiler runs `build*`; the TypeScript 6 compatibility package supplies the compiler API required by ts-node and typescript-eslint. Keep the explicit native compiler path in package scripts until `BACKLOG.md` item TOOL-001 is resolved.

## Testing

Vitest uses a 180-second timeout and enforces 98% V8 coverage for statements, lines, functions, and branches. `src/pageRenderWorker.ts` is exercised both through real-worker integration and in-process protocol tests so its branches remain part of the aggregate gate.

Fixtures live in `test-data/`; generated output and coverage live in `test-results/`. Worker integration tests compile `out/pageRenderWorker.js` directly before spawning real workers.

`__tests__/pdfjs.assets.test.ts` exact-checks the installed `cmaps` and `standard_fonts` layout against `__tests__/test-data-constants.ts`. For `pdfjs-dist` upgrades, review asset-list changes explicitly, keep existing golden PNGs unchanged unless a rendering change is understood and intentional, and run the real-worker parity suite.

Prefer focused tests while iterating, then run `npm run check`. Do not use `npm run build` inside a running test suite because its `prebuild` hook deletes `test-results/` and `out/`.

## Benchmarking

`npm run bench` rebuilds and exercises only the published `pdfToPng` interface. Useful controls include `BENCH_FIXTURE`, `BENCH_PAGES`, `BENCH_MODES`, `BENCH_ITERATIONS`, `BENCH_WARMUP`, `BENCH_CONCURRENCY`, and `BENCH_LABEL`. Large page counts cycle valid fixture page numbers; they are opt-in, not part of the routine default.
