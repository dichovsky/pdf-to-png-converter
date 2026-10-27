# CLAUDE.md

Repository guidance for Claude Code.

## Commands

```bash
npm run build:test                         # Type-check src + tests + scripts (except scripts/benchmark.ts), no emit
npm run build:strict                       # Strict dependency-boundary type-check
npm run test:fast                          # Fast Vitest loop, no coverage
npx vitest run __tests__/<file>.test.ts    # One test file
npm test                                   # Vitest with coverage only
npm run lint                               # ESLint, warnings fail (--max-warnings 0)
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
- `src/pdfjsLoader.ts` — cached dynamic pdf.js import, init parameters, installed-package asset-folder location (`cmaps`, `standard_fonts`, `wasm`), the once-per-thread wasm-decoder warning and warm-up, and failed-load cleanup.
- `src/pageRenderer.ts` — page metadata, pixel/rotation guards, canvas rendering, PNG encoding, and page/canvas cleanup.
- `src/outputWriter.ts` — disk filename validation, output-folder preparation, realpath checks, and exclusive-create writes.
- `src/workerPool.ts` — worker protocol types, dynamic dispatch, error policy, main-thread finalizers, and worker teardown.
- `src/pageRenderWorker.ts` — compiled worker entry; lazy document load and page rendering inside each worker.
- `src/cli.ts` — CLI parsing and policy; delegates to the public `pdfToPng` function. It takes exactly one `<pdf-file-path>`, reads the password from `--pdf-file-password`, else `PDF_TO_PNG_PASSWORD`, and sends pdf.js console output written on the main thread to stderr, so a metadata run's stdout is only the JSON. An empty `PDF_TO_PNG_PASSWORD` counts as unset. The entry check resolves `process.argv[1]` the way Node resolved the entry module, so extensionless, relative and symlinked launches run the CLI while `require()`-ing the module does not.
- `src/types.ts` — public option and output types plus `VerbosityLevel`.
- `src/const.ts` — defaults, resource/concurrency limits, pipeline window, wasm warm-up timeout, and pdf.js asset-directory and wasm-decoder file names.
- `src/index.ts` — public re-exports only.

Keep this consolidated ownership. Split out another seam only when a new independent implementation or lifecycle boundary actually needs it. See `docs/ARCHITECTURE.md` for the full runtime and ownership model.

## Conversion invariants

1. `pdfToPng()` validates and snapshots options before input I/O (`null` counts as unset) and, unless `returnMetadataOnly` is set, resolves a relative `outputFolder` against `process.cwd()` before its first `await`.
2. `getPdfFileBuffer()` returns owned `Uint8Array` bytes. Path input is opened, checked, and read through one handle; caller-owned byte containers are copied so pdf.js cannot detach them. Byte input is a `Buffer`, `Uint8Array`, `ArrayBuffer` or `SharedArrayBuffer` (cross-realm ones included) or a real `Array` of bytes; an object that only claims a numeric `length`, or only forges a buffer tag, is rejected.
3. Worker mode retains one main-thread byte copy before the main pdf.js loading task may detach its input.
4. All page names are resolved before output-folder creation. Disk names (flat, host-valid, at most `MAX_FILENAME_LENGTH` units) and duplicates under the `outputNameKey()` Unicode fold are preflighted before any output I/O.
5. Metadata-only mode creates no canvas, worker pool, output folder, PNG bytes, or files.
6. File writes always run on the main thread through `outputWriter`, including worker rendering mode.
7. Result arrays stay in requested page order in every mode.
8. `pdfDocument.loadingTask.destroy()` runs in `finally`; pages, canvases, loading failures, finalizers, and workers have matching cleanup paths.
9. pdf.js asset folders (`cmaps`, `standard_fonts`, `wasm`) come from the installed `pdfjs-dist` package location through `pdfjsAssetDirectory()`, never from the working directory, and there is no working-directory fallback. `getPdfDocument()` passes all three as `cMapUrl`, `standardFontDataUrl`, and `wasmUrl`. Without `wasmUrl`, CCITT, JBIG2, and JPEG 2000 images render blank with no error (issue #278).
10. `warnIfWasmDecodersMissing()` runs at most once per thread (the library runs the check on the main thread only, so normally once per process), after the metadata-only return and before the output folder is prepared. It emits process warning `PDF_TO_PNG_WASM_MISSING` when `jbig2.wasm` or `openjpeg.wasm` is missing; it cannot detect decode errors.
11. `pdfToPng()` awaits `warmUpWasmDecoders()` before every main-thread `getPdfDocument()` call, so no main-thread document opens until pdf.js has cached both wasm decoders, unless the warm-up fails or exceeds `WASM_WARM_UP_TIMEOUT_MS` (issue #288, mozilla/pdf.js#22131). Do not add a main-thread document open that skips it (`__tests__/loader.document.open.call.sites.test.ts` fails when a file other than `pdfToPng.ts`, `pageRenderWorker.ts`, or the warm-up in `pdfjsLoader.ts` opens one). Remove it under `BACKLOG.md` ARCH-018.

`pagesToProcess` must be a real `Array` of positive integers: typed arrays, Sets, strings, other array-likes, and arrays with holes are rejected before any I/O. Entries above the document page count are silently filtered; duplicates remain separate tasks and are allowed unless disk output makes their resolved filenames collide.

## Scheduling and content

- Default paths, including metadata without explicit parallelism, use the ordered bounded scheduler with `SEQUENTIAL_PIPELINE_WINDOW` (`3`). Async PNG encode and disk finalization may overlap a later render.
- `processPagesInParallel: true` uses `concurrencyLimit` on the main thread. Set the limit to `1` for exactly one page task in flight.
- `renderInWorkerThreads: true` takes precedence over main-thread parallelism and is ignored for metadata-only requests. Each worker loads one private document copy; names and files stay main-side.
- In-flight work drains after a page error. Main-thread/page errors are deterministic by lowest page index; worker-level fatal errors take priority in worker mode.
- Errors a worker reports reach the caller as native `Error`s with `message`, `name`, and `cause` preserved. Built-in subclasses such as `TypeError` keep their class; the class of a pdf.js exception or any custom `Error` subclass, and pdf.js-specific fields such as `details` and `code`, are not carried across. Worker mode needs the unbundled installed package: `resolveWorkerEntryPath()` needs `__dirname`, and an ESM bundle gets a descriptive error instead.
- File mode always materializes content for the write, then omits it from the result when `returnPageContent` is false. In-memory mode may omit PNG encoding when content is not requested.

## Output and security

- Resolve a relative `outputFolder` synchronously in `pdfToPng()`, before its first `await` and so before any `outputFileMaskFunc` call; a `process.chdir()` by the caller or by any conversion's callback must not redirect the destination.
- Keep disk names flat. Preflight with `assertValidOutputFilename()` (which also enforces `MAX_FILENAME_LENGTH`) before folder creation and repeat validation in `savePNGfile()` as defense in depth.
- Detect duplicate disk names before I/O under the `outputNameKey()` fold (NFD, full case folding, lone surrogates), not only ASCII case. The check is deliberately conservative: it also rejects names a case-sensitive filesystem would keep apart.
- Preserve `OutputFolderHandle` as one value: the resolved folder and its baseline realpath must not drift apart.
- Preserve `'wx'` file opens. Never replace them with overwrite-capable `writeFile()` calls. If the write or close fails after the open succeeded, `savePNGfile()` removes the file this call created (best effort, and only while the path still names that file: same device and inode, taken from the open handle) and rethrows the original error; keep that unlink out of the `open()` failure path so an existing target is never removed.
- Realpath checks cannot atomically bind a pathname to a directory inode. Documentation must continue to require an output directory that untrusted users cannot modify.

## Defaults

Runtime defaults live in `PDF_TO_PNG_OPTIONS_DEFAULTS` in `src/const.ts`; mode defaults are applied in `normalizeOptions()` in `src/pdfToPng.ts`. Use `??`, not `||`, when `false` or `0` are valid values. Keep public JSDoc defaults synchronized with runtime behavior.

`disableFontFace` is always `true` at runtime: pdf.js has no Font Loading API in Node.js, so `normalizeOptions()` ignores an explicit `false` and emits process warning `PDF_TO_PNG_DISABLE_FONT_FACE_IGNORED` at most once per thread (normally once per process). Do not forward the caller's value to pdf.js or the workers.

Hard limits are also centralized in `src/const.ts` (`MAX_INPUT_BYTES` is only the default of the overridable `maxInputBytes`, which bounds input bytes, not pdf.js memory):

- `MAX_VIEWPORT_SCALE = 100`
- `MAX_CANVAS_PIXELS = 100_000_000`
- `MAX_CANVAS_SIDE = 1_000_000` (libpng's per-side limit; a page over it is rejected on every path, including metadata-only and `returnPageContent: false`)
- `MAX_INPUT_BYTES = 256 MiB` (the CLI has no flag for `maxInputBytes`, so it always uses this default)
- `MAX_INPUT_PATH_LENGTH = 4096` (a longer string input is rejected before any filesystem access)
- `FILE_READ_MAX_CHUNK_BYTES = 2 ** 30` (largest single `FileHandle.read()` request, 1 GiB)
- `MAX_FILENAME_LENGTH = 255` (output file name units: UTF-16 code units on macOS and Windows, UTF-8 bytes elsewhere)
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

Fixtures live in `test-data/`; generated output and coverage live in `test-results/`. Worker integration tests compile `out/pageRenderWorker.js` directly before spawning real workers. Worker and main-thread PNGs are byte-identical, so worker-mode tests assert routing with spies on `renderPagesInWorkerPool` and `renderPdfPage` (helper `pdfToPngInWorkers()` in `__tests__/pdf.to.png.worker.threads.test.ts`); a silently ignored `renderInWorkerThreads` fails them.

`__tests__/cli.compiled.test.ts` compiles `src/` into `test-results/cli-compiled-out` (not `out/`, which the worker tests load while they run) and spawns the compiled CLI in fresh processes.

`__tests__/pdfjs.assets.test.ts` exact-checks the installed `cmaps`, `standard_fonts`, and `wasm` layouts and the set of top-level `pdfjs-dist` directories against `__tests__/test-data-constants.ts`. For `pdfjs-dist` upgrades, review asset-list changes explicitly, review every top-level asset folder in the package and not only the known ones (`cmaps`, `standard_fonts`, `wasm`) because a missed folder caused issue #278, keep existing golden PNGs unchanged unless a rendering change is understood and intentional, and run the real-worker parity suite.

`comparePNG` (`__tests__/comparePNG.ts`) fails on a missing golden PNG and never overwrites an existing one. To create a missing golden on a developer machine, run the test with `UPDATE_GOLDENS=1` (refused whenever `CI` is set), review the image, and commit it; to refresh one deliberately, delete it first. The CI step `Require unchanged test fixtures` fails the Ubuntu jobs when a run leaves any new or modified file under `test-data/`.

CCITT, JBIG2, and JPEG 2000 regression PDFs live in `test-data/wasm/` and are produced by `scripts/generate-wasm-fixtures.ts`.

Prefer focused tests while iterating, then run `npm run check`. Do not use `npm run build` inside a running test suite because its `prebuild` hook deletes `test-results/` and `out/`.

## Benchmarking

`npm run bench` rebuilds and exercises only the published `pdfToPng` interface. Useful controls include `BENCH_FIXTURE`, `BENCH_PAGES`, `BENCH_MODES`, `BENCH_ITERATIONS`, `BENCH_WARMUP`, `BENCH_CONCURRENCY`, and `BENCH_LABEL`. Large page counts cycle valid fixture page numbers; they are opt-in, not part of the routine default.
