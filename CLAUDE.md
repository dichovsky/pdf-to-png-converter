# CLAUDE.md

Repository guidance for Claude Code.

## Commands

```bash
npm run build:test                         # Type-check src, tests, and scripts (except scripts/benchmark.ts), no emit
npm run build:strict                       # Run strict dependency-boundary type-check
npm run test:fast                          # Run Vitest without coverage
npx vitest run __tests__/<file>.test.ts    # Run one test file
npm test                                   # Run Vitest with V8 coverage only
npm run lint                               # Run ESLint (--max-warnings 0)
npm run format:check                       # Run Prettier check
npm run check                              # Run the full CI and prepublish gate
npm run build                              # Clean and compile production code to out/
```

`npm test` has no `pretest` hook. Run `npm run check` to execute the full validation gate.

## Architecture

This package is a Node.js 24+ CommonJS library and CLI. `.nvmrc` specifies Node.js 26, and CI tests Node.js 24 and 26. `src/index.ts` exports only `pdfToPng`, `PdfToPngOptions`, `PngPageOutput`, and `VerbosityLevel`. Rendering uses `pdfjs-dist` and its built-in Node canvas factory backed by `@napi-rs/canvas`.

The source tree has 11 modules:

- `src/pdfToPng.ts` — Single conversion entrypoint and orchestrator. Handles option validation, defaults, page and filename planning, bounded scheduling, execution-mode selection, output finalization, and document teardown.
- `src/pdfInput.ts` — Input validation, owned `Uint8Array` normalization, bounded single-handle file reads, and input-size enforcement.
- `src/pdfjsLoader.ts` — Cached dynamic `pdfjs-dist` import, initialization parameters, installed package asset resolution (`cmaps`, `standard_fonts`, `wasm`), once-per-thread WebAssembly decoder warning and warm-up, and failed-load cleanup.
- `src/pageRenderer.ts` — Page metadata extraction, pixel and rotation validation, canvas rendering, PNG encoding, and page/canvas cleanup.
- `src/outputWriter.ts` — Disk filename validation, output-folder preparation, `realpath` checks, and exclusive-create file writes.
- `src/workerPool.ts` — Worker protocol types, dynamic task dispatch, error selection, main-thread finalizers, and worker termination.
- `src/pageRenderWorker.ts` — Compiled worker entrypoint. Loads one document lazily per worker and renders assigned pages.
- `src/cli.ts` — CLI argument parser and runner. Calls the public `pdfToPng` function. Accepts one `<pdf-file-path>`, reads the password from `--pdf-file-password` or `PDF_TO_PNG_PASSWORD` (an empty variable counts as unset), and redirects main-thread pdf.js console output to `stderr` so metadata mode writes only JSON to `stdout`. The entrypoint check resolves `process.argv[1]` so extensionless, relative, and symlinked invocations run the CLI, while `require()` does not.
- `src/types.ts` — Public option and output types, plus `VerbosityLevel`.
- `src/const.ts` — Runtime defaults, resource and concurrency limits, pipeline window size, WebAssembly warm-up timeout, and pdf.js asset directory and decoder filenames.
- `src/index.ts` — Public re-exports only.

Keep these 11 modules consolidated. Add a new module only when an independent implementation or lifecycle boundary requires it. See `docs/ARCHITECTURE.md` for details.

## Conversion invariants

1. `pdfToPng()` validates and snapshots options before any input I/O (`null` counts as unset). Unless `returnMetadataOnly` is `true`, `pdfToPng()` resolves a relative `outputFolder` against `process.cwd()` synchronously before its first `await`.
2. `getPdfFileBuffer()` returns an owned `Uint8Array`. It opens, checks, and reads path inputs through one file handle. It copies caller-provided byte containers (`Buffer`, `Uint8Array`, `ArrayBuffer`, `SharedArrayBuffer`, cross-realm views/buffers, or real `Array`s of bytes) so pdf.js cannot detach them. It rejects objects that only have a numeric `length` or a forged `Symbol.toStringTag`.
3. Worker mode retains one main-thread copy of the PDF bytes before the main-thread pdf.js loading task can detach its input.
4. `pdfToPng()` resolves all page filenames before it creates the output folder. For disk output, it validates flat host filenames (up to `MAX_FILENAME_LENGTH` units) and checks for duplicates under `outputNameKey()` Unicode folding before any output I/O.
5. Metadata-only mode creates no canvas, worker pool, output folder, PNG buffer, or file.
6. File writes always run on the main thread through `outputWriter`, including in worker-thread mode.
7. Result arrays preserve the requested page order in every mode.
8. `pdfDocument.loadingTask.destroy()` runs in `finally`. Pages, canvases, failed document loads, finalizers, and workers all have paired cleanup paths.
9. `pdfjsAssetDirectory()` resolves `cmaps`, `standard_fonts`, and `wasm` from the installed `pdfjs-dist` package, never from `process.cwd()`. `getPdfDocument()` passes `cMapUrl`, `standardFontDataUrl`, and `wasmUrl`. Without `wasmUrl`, CCITT, JBIG2, and JPEG 2000 images render blank without an error (issue #278).
10. `warnIfWasmDecodersMissing()` runs at most once per thread on the main thread, after the metadata-only return and before output-folder creation. It emits process warning `PDF_TO_PNG_WASM_MISSING` if `jbig2.wasm` or `openjpeg.wasm` is missing. It does not detect runtime decode errors.
11. `pdfToPng()` awaits `warmUpWasmDecoders()` before every main-thread `getPdfDocument()` call so pdf.js caches both WebAssembly decoders before opening caller documents (unless warm-up fails or exceeds `WASM_WARM_UP_TIMEOUT_MS`; issue #288, mozilla/pdf.js#22131). Do not open a main-thread document without awaiting warm-up (`__tests__/loader.document.open.call.sites.test.ts` enforces this). Remove warm-up under `BACKLOG.md` ARCH-018.

`pagesToProcess` must be a real `Array` of positive integers. Typed arrays, `Set`s, strings, array-like objects, and sparse arrays fail validation before any I/O. Page numbers above the document page count are ignored. Duplicate page numbers run as separate tasks and succeed unless disk output filenames collide.

## Scheduling and content

- Default mode and non-parallel metadata mode use the ordered bounded scheduler with `SEQUENTIAL_PIPELINE_WINDOW` (`3`). Asynchronous PNG encoding and file writes overlap subsequent page renders.
- `processPagesInParallel: true` uses `concurrencyLimit` on the main thread. Set `concurrencyLimit: 1` to keep at most one page task in flight.
- `renderInWorkerThreads: true` overrides `processPagesInParallel` and is ignored when `returnMetadataOnly` is `true`. Each worker loads its own document copy; filename planning and file writes stay on the main thread.
- After a page error, the scheduler stops dispatching new pages and drains in-flight tasks. Main-thread and page errors report the failure with the lowest page index. Worker-level fatal errors take precedence over page errors.
- Worker errors return to the caller as native `Error` instances with `message`, `name`, and `cause` preserved. Standard subclasses such as `TypeError` preserve their class. Custom `Error` subclasses, pdf.js exception classes, and extra properties such as `details` or `code` do not cross the worker boundary. Worker mode requires the unbundled `out/` directory because `resolveWorkerEntryPath()` uses `__dirname`.
- File mode always encodes PNG buffers to write the files, then omits `content` from the returned objects when `returnPageContent` is `false`. In-memory mode skips PNG encoding when `returnPageContent` is `false`.

## Output and security

- Resolve a relative `outputFolder` synchronously in `pdfToPng()` before the first `await` and before any `outputFileMaskFunc` call. Subsequent `process.chdir()` calls must not change the output path.
- Keep disk filenames flat. Validate names with `assertValidOutputFilename()` (including `MAX_FILENAME_LENGTH`) before creating the output folder, and validate again in `savePNGfile()`.
- Check for duplicate disk filenames before I/O with `outputNameKey()` (NFD normalization, full case folding, and lone-surrogate replacement). This check rejects colliding names on all platforms, including case-sensitive filesystems.
- Keep `OutputFolderHandle` as a single object that pairs the resolved folder path with its initial `realpath`.
- Always open output files with `'wx'`. Never use overwrite-capable `writeFile()` calls. If `writeFile()` or `close()` fails after `open()` succeeds, `savePNGfile()` unlinks the newly created file (best effort, only if `lstat` matches the open handle's device and inode) and rethrows the original error. Never unlink when `open()` fails.
- `realpath` checks cannot prevent directory-swap races between the check and the file operation. Documentation must instruct users to use an output directory that untrusted users cannot modify.

## Defaults

`PDF_TO_PNG_OPTIONS_DEFAULTS` in `src/const.ts` defines shared defaults, and `normalizeOptions()` in `src/pdfToPng.ts` applies mode defaults. Use `??` instead of `||` when `false` or `0` are valid inputs. Keep JSDoc defaults in `src/types.ts` synchronized with runtime behavior.

`disableFontFace` is always coerced to `true` at runtime because pdf.js has no Font Loading API in Node.js. When a caller passes `false`, `normalizeOptions()` forces `true` and emits process warning `PDF_TO_PNG_DISABLE_FONT_FACE_IGNORED` at most once per thread.

`src/const.ts` also defines hard limits (`MAX_INPUT_BYTES` is the default for `maxInputBytes`, which caps input file bytes, not pdf.js heap memory):

- `MAX_VIEWPORT_SCALE = 100`
- `MAX_CANVAS_PIXELS = 100_000_000`
- `MAX_CANVAS_SIDE = 1_000_000` (libpng per-side limit; enforced in all modes, including `returnMetadataOnly` and `returnPageContent: false`)
- `MAX_INPUT_BYTES = 256 MiB` (CLI always uses this limit)
- `MAX_INPUT_PATH_LENGTH = 4096` (longer path strings fail before filesystem access)
- `FILE_READ_MAX_CHUNK_BYTES = 2 ** 30` (maximum single `FileHandle.read()` call, 1 GiB)
- `MAX_FILENAME_LENGTH = 255` (UTF-16 code units on macOS/Windows; UTF-8 bytes elsewhere)
- `MAX_CONCURRENCY_LIMIT = 16`

## TypeScript conventions

- The package emits CommonJS using `module: nodenext` and `moduleResolution: node16`. Use `.js` extensions in all relative imports.
- Use `import type` for type-only imports.
- Add explicit return types to all functions in `src/`.
- Prefix unused parameters with `_`.
- Use `interface` for object shapes and `type` for unions.
- Do not add DOM globals to `tsconfig.json`. `tsconfig.strict.json` includes `DOM` only to check upstream `@napi-rs/canvas` declarations.
- Build scripts invoke `@typescript/native` directly, while `typescript` points to TypeScript 6 for `ts-node` and `typescript-eslint` compatibility (see `BACKLOG.md` TOOL-001).

## Testing

Vitest uses a 180-second timeout and requires 98% V8 coverage across statements, lines, functions, and branches. Both real-worker integration tests and in-process unit tests cover `src/pageRenderWorker.ts`.

Test inputs live in `test-data/`; test outputs and coverage reports go to `test-results/`. Worker integration tests compile `out/pageRenderWorker.js` before spawning workers. Because worker and main-thread PNG outputs are byte-identical, worker tests spy on `renderPagesInWorkerPool` and `renderPdfPage` (`pdfToPngInWorkers()` in `__tests__/pdf.to.png.worker.threads.test.ts`) to verify worker routing.

`__tests__/cli.compiled.test.ts` compiles `src/` into `test-results/cli-compiled-out` (avoiding `out/`) and spawns the compiled CLI in child processes.

`__tests__/pdfjs.assets.test.ts` verifies the installed `cmaps`, `standard_fonts`, and `wasm` contents and top-level `pdfjs-dist` directories against `__tests__/test-data-constants.ts`. When upgrading `pdfjs-dist`, review all top-level directories, keep golden PNGs unchanged unless a rendering change is expected, and run the worker parity suite.

`comparePNG` (`__tests__/comparePNG.ts`) fails if a golden PNG is missing and never overwrites existing golden files. To create a missing golden locally, run with `UPDATE_GOLDENS=1` (blocked when `CI` is set), inspect the image, and commit it. To update an existing golden, delete it first.

CCITT, JBIG2, and JPEG 2000 test fixtures live in `test-data/wasm/` and are generated by `scripts/generate-wasm-fixtures.ts`.

Run targeted tests during development, then run `npm run check`. Do not run `npm run build` while tests are running, because `prebuild` deletes `out/` and `test-results/`.

## Benchmarking

`npm run bench` builds the package and benchmarks the public `pdfToPng` API. Configure runs with `BENCH_FIXTURE`, `BENCH_PAGES`, `BENCH_MODES`, `BENCH_ITERATIONS`, `BENCH_WARMUP`, `BENCH_CONCURRENCY`, and `BENCH_LABEL`.
