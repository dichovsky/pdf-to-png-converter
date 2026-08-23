# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [Unreleased]

### Changed

- Consolidated conversion into one canonical `pdfToPng()` path. Option normalization, page planning, bounded main-thread scheduling, mode selection, output finalization, and document teardown now live together; the CLI delegates to that public API instead of a normalized internal core. The public package exports and option/result behavior are unchanged.
- Colocated one-consumer implementation details with their owners: pdf.js parameter mapping and portable asset URLs with the loader, page identity with main-thread finalization, worker protocol types with the pool, and public declarations in `src/types.ts`. The source tree is reduced from 27 to 11 TypeScript modules without removing execution modes.
- Reworked `npm run bench` around fresh child processes, structured Node IPC, and the published interface. It now records wall time, CPU time, and process peak RSS for configurable page counts and default, parallel, worker, file, and metadata modes without presenting lifetime high-water deltas as conversion memory growth.
- Added an explicit `npm run check` CI/publish gate for both type-checks, formatting, lint, production licenses, and coverage tests. A plain `npm test` now runs the coverage suite without an implicit build/tooling chain.
- Raised the enforced V8 coverage floor to 98% for statements, lines, functions, and branches, including the production worker entry through in-process protocol coverage.
- Expanded regression coverage for worker startup, dispatch, fatal ordering, queued and malformed responses, growing file inputs, non-`Error` CLI validation failures, portable pdf.js factory URLs, and missing renderer content in file mode. The clean suite reaches 99.36% statements, 98.12% branches, 100% functions, and 99.55% lines.
- Refreshed dependency ranges, including `@napi-rs/canvas` from `~1.0.3` to `~1.0.7`, Vitest and `@vitest/coverage-v8` from `^4.1.10` to `^4.1.11`, and ESLint from `^10.8.0` to `^10.9.0`, plus compatible Node.js types, typescript-eslint, lint-staged, and visual-comparison tooling updates. The publish workflow now pins npm 12.0.2.
- Removed the obsolete `brace-expansion` override after refreshing the audited lockfile, moved the publisher's npm pin from package metadata to the workflow, and recorded the permitted `fsevents@2.3.3` lifecycle script in `allowScripts`.
- CI now validates the supported Node.js floor (22.13) as well as the Node.js 24 development and publishing line.

### Fixed

- Page cleanup now covers viewport and canvas-allocation failures, a created canvas is destroyed even when page cleanup throws, and worker-pool settlement waits for both main-thread page finalization and the promise returned by `Worker.terminate()`. A teardown-only termination failure no longer discards otherwise successful page results.
- Duplicate output-name detection is now linear rather than repeatedly copying the accumulated page list for every collision.
- The CLI again validates semantic options before printing progress, then emits its processing and output-folder banners before conversion work starts. Its fail-fast pass returns the normalized snapshot used for CLI-only policy, and typed usage/conversion errors replace message and `cause` sniffing. `pdfToPng()` still revalidates at the public boundary; the small duplicate pass replaces the former normalized internal-core coupling.
- Main-thread and worker schedulers now call one shared lowest-index error selector, keeping their deterministic page-error policy aligned. Main-thread limit selection and worker-mode selection each have one source of truth.
- Release prechecks now require the worker-thread entry and root type declarations in the dry-run tarball, catching incomplete packages before publication.
- Release prechecks and postchecks now accept both npm 11's direct `npm view --json` values and npm 12's one-element array envelope. This prevents the precheck from misclassifying an already-published version as new and keeps post-publish version, dist-tag, and provenance verification working under the pinned npm 12 toolchain.

### Security

- Path inputs are opened once with nonblocking read-only flags, then checked and bounded-read through that same file handle. This closes the previous path-swap gap between `stat()` and `readFile()`, rejects special files without blocking on FIFOs, and prevents a growing file from allocating beyond `maxInputBytes` before rejection.
- Disk filenames are validated before folder creation as well as at the write boundary, including NUL, empty names, and `"."` / `".."` aliases. Windows preflight also rejects invalid characters and control bytes, alternate data streams, reserved device basenames (including the documented `COM¹`–`COM³` and `LPT¹`–`LPT³` aliases), and trailing dots/spaces before output I/O. The host-separator predicate again has one owner shared by naming and writing. Output documentation now states the residual directory-inode replacement race accurately instead of claiming canonical-path equality is atomic.

### Removed

- Removed the one-implementation `OutputSink` / `FilesystemSink`, `PageMode`, page orchestrator, normalized-core wrapper, mapper/path helper files, internal type barrels, and standalone worker/canvas protocol files.
- Removed generated `CODEMAP.md` and its 732-line generator/checking path; the maintained architecture guide now documents the compact live module tree directly.

## [4.2.0] — 2026-07-29

### Added

- **`renderInWorkerThreads`** (default `false`, CLI flag `--render-in-worker-threads`): pages are rasterized and PNG-encoded in a pool of Node.js worker threads, giving true multi-core parallelism. `processPagesInParallel` only interleaves pages on a single JS thread — rasterization itself never runs concurrently there — so on CPU-bound documents (large embedded images, complex vector art) it cannot use more than one core; worker mode can. Measured ~3× end-to-end on a 12-page image-heavy document with the default pool of 4. The pool size is `concurrencyLimit` (same `1..16` bound, same validation, which now also applies when only `renderInWorkerThreads` is set). Each worker loads its own copy of the document, so the cost is roughly one PDF copy plus one pdf.js instance of memory per worker, one additional copy of the input retained on the main thread for the duration of the conversion, and a few hundred milliseconds of pool startup per conversion — it pays off on multi-page, render-heavy work and can be slower than the default for small documents. Rendered pixels are identical to single-threaded mode and results are still returned in page order. Page filtering, output-name resolution, duplicate-name detection, and all file writes stay on the main thread, so disk output goes through the same `OutputSink` and the same SEC-001/002/003 path-security guards as every other mode. `outputFileMaskFunc` is fully supported (names are resolved before dispatch). Takes precedence over `processPagesInParallel`; ignored when `returnMetadataOnly` is `true`, since metadata extraction does not render.
- A "Performance Notes" section in the README covering pipelined processing, libuv threadpool sizing (`UV_THREADPOOL_SIZE`), strict serial processing, and when multi-core rendering pays off.
- `npm run bench`, an on-demand benchmark harness (`scripts/benchmark.ts`) used to size the sequential pipeline window and to measure worker-thread mode. Dev-only — the published tarball still ships `out/` alone.

### Changed

- **Sequential (default) processing is now pipelined.** Pages previously ran in a strict one-at-a-time loop; they now run through the same sliding-window scheduler as parallel mode with a fixed window of `SEQUENTIAL_PIPELINE_WINDOW` (`3`), so the off-thread PNG encode (`canvas.encode('png')`, on the libuv threadpool) and the disk write of a finished page overlap the next page's render on the JS thread. The returned `PngPageOutput[]` is still strictly page-ordered and rendered pixels are unchanged, but three side effects are observable: files may **finish writing out of page order** (consume the resolved, ordered array rather than directory-watch order); when a page fails, pages already in flight run to completion before the returned promise rejects; and peak canvas memory is up to three live canvases instead of one. For strictly one page in flight — minimal memory, strict on-disk ordering — use `processPagesInParallel: true` with `concurrencyLimit: 1`, a sliding window of exactly one page. The window size of 3 was chosen by paired A/B measurement: PNG encode costs roughly 2× render on text-heavy documents, and a second in-flight encode recovered a consistent ~2–5% median end-to-end margin over a window of 2, while a window of 4 measured within noise of 3.
- The file-path input branch now hands its buffer to pdf.js **zero-copy**. `fsPromises.readFile` returns a freshly allocated `Buffer` that is never exposed to the caller, so pdf.js may safely transfer (detach) its underlying `ArrayBuffer` — one full copy of the PDF is no longer made on every conversion. The handoff is guarded on the view spanning its entire `ArrayBuffer` (`byteOffset === 0` and `byteLength === buffer.buffer.byteLength`), so a future pooled allocation sharing backing memory with unrelated data would fall back to the copy path; empty and detached buffers also take the copy path, so pdf.js still raises its clear "empty PDF" error instead of an opaque constructor `TypeError`. Caller-owned `Buffer` / `Uint8Array` / `ArrayBufferLike` inputs are unaffected and still copied defensively.
- `savePNGfile()` now performs a **single** `realpath` syscall per write instead of two. Because output filenames are guaranteed flat, the file's directory _is_ the output folder, so one fresh `realpath` of the output folder immediately before `open()`, compared for exact equality against the value captured at conversion start, detects any symlink swap or rename of the folder or its ancestors — equality is strictly stronger than the previous containment check. The SEC-001/002/003 threat model and all rejection messages are unchanged.
- Migrated `pdfjs-dist` from `~6.0.227` to `~6.2.108` and `@napi-rs/canvas` from `~1.0.0` to `~1.0.3`. No public API, default, asset-path, or import-path change; rendered PNG output is unchanged — the visual-comparison suites pass against the existing reference images.
- The development toolchain now type-checks and builds with the TypeScript 7 native compiler (`@typescript/native`, alias for `typescript@~7.0.2`), while the `typescript` package name is the official TypeScript 6 compatibility alias (`@typescript/typescript6`) that keeps the JS compiler API available to the codemap generator, ts-node scripts, and typescript-eslint. Dev-only change — no runtime, type, or API change to the published package.
- Replaced the unmaintained `license-checker` devDependency with `license-checker-rseidelsohn` and added a `brace-expansion@^5.0.8` override, clearing the high-severity advisories that made `npm audit --audit-level=high` — a gate in both the CI and publish workflows — fail. Dev-only; the override does not affect consumers, whose own root overrides govern their tree.
- An input value that is not a byte container at all — no numeric `length`, not an `ArrayBuffer.isView`, not an `ArrayBuffer`/`SharedArrayBuffer` (e.g. `{}` or a number) — is now rejected at the input seam with `Unsupported buffer type: <shape>` instead of being passed through to pdf.js, which reported it as `The PDF file is empty, i.e. its size is zero bytes.` — misleading, since the value is the wrong type rather than an empty document. The set of inputs that successfully convert is unchanged: cross-realm typed arrays and `ArrayBuffer`s (from `node:vm` / `isolated-vm`, where `instanceof` is realm-bound), `Uint8ClampedArray`, and byte array-likes such as the `data` field of a `Buffer` that round-tripped through JSON as `{ type: 'Buffer', data: number[] }` are all still accepted and normalized to `Uint8Array`. `DataView` input, which previously reached pdf.js and failed as an "empty" PDF, now converts. `maxInputBytes` is applied to array-like inputs, which carry no `byteLength` and previously escaped the cap.
- `release:postcheck` now runs a real conversion against the freshly published package, in worker-thread mode, and compares the result with single-threaded output (Q5). `renderInWorkerThreads` spawns `out/pageRenderWorker.js` by a path resolved inside the installed `out/` directory, and every in-repo test runs against the source tree where that file always exists — so a packaging change that dropped or relocated it would have broken worker mode for consumers with the whole suite still green. Q5 also asserts that worker entry exists in the installed package directly, so the check cannot silently degrade into comparing single-threaded output against itself. Release tooling only; no runtime or API change.

### Fixed

- The sliding-window scheduler now reports a **deterministic** error when several pages fail. It previously kept whichever rejection settled first, so with more than one page in flight the surfaced error depended on scheduling; it now collects failures by page index and throws the one with the lowest index, matching what a strict page-order loop would report. This applies to `processPagesInParallel` and, now that the default path is pipelined, to sequential conversions too.
- Conversions of very large page counts no longer risk a crash while assembling the result. Page outputs were appended with `push(...results)`, whose spread exceeds V8's maximum argument count once the array is large enough; the window result is now returned directly.

### Security

- `savePNGfile()` now rejects the output filename `"."` with the explicit `Output file name must be a plain filename, received: .` error. Under `join()`, `"."` collapses to the output folder itself and produced an empty relative path, so it slipped past the escaping-path checks and surfaced as a raw `EEXIST`/`EISDIR` from `open()` that **leaked the absolute output folder path** in the error message — the same path-disclosure failure mode SEC-001 and VAL-001 were introduced to prevent. Reachable through an `outputFileMaskFunc` returning `"."`. `".."` needs no twin guard: it resolves to the parent folder, which the existing escaping-relative-path check already rejects cleanly.

### Refactored

- Output-folder preparation moved from `pdfToPngCore` into `outputWriter`, which now exposes `resolveOutputFolder()` and `prepareOutputFolder()` returning an `OutputFolderHandle` (the resolved path plus the `realpath` baseline every write is checked against). `savePNGfile()` and `FilesystemSink` take that handle instead of two positional strings that callers had to keep in sync, and the whole SEC-001/002/003 threat model — folder creation, the baseline, and the per-write re-check that consumes it — now lives in one module. Call order is unchanged in both directions that matter: the path is still resolved against the CWD at conversion start, before any user-supplied `outputFileMaskFunc` can call `process.chdir()` and redirect a relative `outputFolder`; and the duplicate-output-filename check still runs before any output I/O, so a conversion that fails validation still creates no directory. Both invariants now have explicit regression tests. Internal only; `savePNGfile` is not part of the public API (resolves ARCH-012).
- The flat-filename predicate is now owned by a single module, `src/flatFilename.ts` (`containsPathSeparator` + `SEPARATOR_DESCRIPTION`), instead of being duplicated verbatim in `pageOrchestrator` and `outputWriter`. Both call sites keep their existing, distinct error messages. This predicate is load-bearing for SEC-001 — rejecting path separators is what closes the TOCTOU window on intermediate directory components — so a future fix landing in only one copy was a real risk (resolves ARCH-016).
- `getPdfFileBuffer()` now returns `Uint8Array` rather than `Uint8Array | ArrayBufferLike`, making `src/pdfInput.ts` the single owner of the shape handed to pdf.js. The `pdfFileBuffer instanceof Uint8Array ? … : new Uint8Array(…)` re-derivation is gone from both `getPdfDocument()` (whose parameter is now `Uint8Array`) and the worker-mode buffer copy in `pdfToPngCore`. Rendered output and the defensive-copy guarantees for caller-owned buffers are unchanged (resolves ARCH-014).

## [4.1.1] — 2026-06-19

### Fixed

- pdf.js CMap and standard-font factory URLs (`cMapUrl` / `standardFontDataUrl`) are now always emitted with forward slashes and a guaranteed trailing `/`, fixing every conversion on Windows. `normalizePath()` previously appended the OS path separator, so on Windows it produced a `\`-terminated, backslash-separated value; pdf.js validates these factory URLs with `getFactoryUrlProp`, which throws `Invalid factory url … must include trailing slash.` for any non-`/` terminator, breaking all rendering on Windows. POSIX output is byte-identical to before (the separator was already `/`). Resolves issue #173.
- The duplicate-output-filename pre-flight check (VAL-001) now detects collisions **case-insensitively**. Previously it compared resolved page filenames with exact string equality, so two names differing only in case (e.g. an `outputFileMaskFunc` returning `Page.png` for one page and `page.png` for another) passed the check. On case-insensitive, case-preserving filesystems — the default on macOS (APFS) and Windows (NTFS) — those names are the **same file**, so the second exclusive-create (`'wx'`) write failed with a raw `EEXIST` that left the first file on disk and **leaked the absolute output path** in the error message — exactly the partial-output + path-leak failure mode VAL-001 was introduced to prevent. The pre-flight now lower-cases names when keying, so the clean `Duplicate output filename "…" for pages …` error is thrown before any I/O on every platform; the reported name preserves the first-seen original casing. In-memory / metadata-only conversions (no `outputFolder`) still allow repeated names. This makes the "each processed page must resolve to a unique filename" guarantee hold portably regardless of the host filesystem.

### Changed

- The published npm tarball no longer ships `out/.tsbuildinfo`. `incremental` is disabled in `tsconfig.prod.json` (and the unused `tsBuildInfoFile` setting removed) — the `prebuild` step runs `clean`, which wipes `out/` before every build, so incremental compilation never had any effect here. Removing the file drops the tarball from 48 to 47 files (~45 kB → ~30 kB packed). No runtime, type, or API change.

## [4.1.0] — 2026-06-02

### Removed

- Removed the bespoke `NodeCanvasFactory` (`src/node.canvas.factory.ts`) and its tests. Rendering now uses pdf.js's built-in Node canvas factory (`PDFDocumentProxy.canvasFactory`, backed by `@napi-rs/canvas`) directly. The previous code selected this factory at runtime anyway — the `isNodeCanvasFactory()` duck-type guard always matched pdf.js's own factory, so the project's class and its `new NodeCanvasFactory()` fallback were never exercised on the render path. The `@napi-rs/canvas` dependency is unchanged (kept as a direct dependency so pdf.js's renderer is always able to load it). Rendered PNG output is unchanged — the visual-comparison suites pass. Resolves backlog item ARCH-015. pdf.js's `canvasFactory` is validated at runtime (it must expose callable `create`/`destroy`) rather than force-cast, the render path now asserts both the returned `canvas` and `context` are non-null before use, and `destroy()` receives the exact `CanvasAndContext` object pdf.js returned (preserving any internal fields it needs for cleanup).

### Fixed

- `outputFileMaskFunc` now rejects non-string return values before page processing. Previously truthy non-string values passed the separator check through implicit coercion and could escape into metadata results as a non-string `name`, violating the `PngPageOutput` contract.
- Parallel page processing now propagates a worker rejection whose reason is `undefined`. Previously `processPagesWithSlidingWindow()` used `undefined` as both the "no error" sentinel and a possible rejection payload, so that failure was swallowed and the conversion resolved with an `undefined` page result.
- `PngPageOutput.width` / `height` are now always integer pixel dimensions that match the rendered PNG. Previously they were reported straight from pdf.js's `PageViewport`, whose lengths are unrounded floats, while `@napi-rs/canvas` truncates fractional dimensions when it allocates the bitmap. Any PDF whose `viewportScale × pageDimension` was fractional therefore reported a non-integer size that disagreed with the actual image — e.g. a 595×842 pt (A4) page at `viewportScale: 1.5` reported `width: 892.5` for an 892 px-wide PNG. Both the render path (`renderPdfPage`) and the `returnMetadataOnly` path (`getPageMetadata`) now floor viewport lengths to pixels via the shared `toPixelDimension` helper, so the two paths agree and both match the bitmap. US-Letter assets (612×792) at integer scales are unaffected.
- A `viewportScale` small enough to floor a page to `0` px in either dimension now throws an actionable `"…cannot produce a valid image. Increase viewportScale."` error from both `renderPdfPage` and `getPageMetadata`, instead of returning a phantom `0×0` metadata result or surfacing an opaque canvas-factory `AssertionError`. The page is released before the render path throws.
- `returnMetadataOnly` (`getPageMetadata`) now enforces the `MAX_CANVAS_PIXELS` limit, matching `renderPdfPage`. Previously the oversized-page guard lived only on the render path, so a `viewportScale` whose viewport area exceeded the limit threw `"Canvas …×… px exceeds the … pixel limit. Reduce viewportScale."` on a real render but silently returned those (unrenderable) dimensions in metadata-only mode — a phantom result for a page that cannot be rendered, the same failure mode the floor-to-zero guard already prevents on both paths. The two paths now reject oversized pages with the identical message via the shared `canvasPixelLimitError` builder (mirroring `nonRenderableDimensionsError`).
- The `MAX_CANVAS_PIXELS` canvas-area guard now bounds the **rendered (floored) canvas** — `floor(viewportWidth) × floor(viewportHeight)` — instead of the unrounded fractional viewport area. Because the canvas is allocated with floored dimensions (via the shared `toPixelDimension` helper), a page whose un-floored viewport area slightly exceeded the limit while its actually-allocated bitmap fit within it was wrongly rejected with `"Canvas …×… px exceeds the … pixel limit. Reduce viewportScale."`. This affects a narrow `viewportScale` band — e.g. a 612×792 pt US-Letter page at `viewportScale ≈ 14.3636` produces an un-floored area of `100,000,739` px (over the `100,000,000` cap) but a real `8790×11375 = 99,986,250` px bitmap (under it), so the page is renderable yet was refused. Both `renderPdfPage` and the `returnMetadataOnly` path (`getPageMetadata`) now floor viewport lengths _before_ the area check, so the guard matches the bitmap actually allocated and the two paths stay symmetric. Pages that genuinely exceed the limit still throw the identical message on both paths, and peak canvas memory remains bounded at `MAX_CANVAS_PIXELS × 4 bytes ≈ 400 MB`.

### Security

- **SEC-001**: `outputFileMaskFunc` filenames are now rejected synchronously when they contain a `/` or `\` path separator, closing a residual TOCTOU window where a co-tenant with write access to `outputFolder` could swap an intermediate directory for a symlink between the `realpath(dirname(...))` check and the `open(..., 'wx')` call in `savePNGfile()`. The guard fires both in `resolvePageName` (early) and in `savePNGfile` (defense in depth). The existing flat-filename contract is unchanged.
- **SEC-002**: Added `PdfToPngOptions.maxInputBytes` (default `256 MiB` via `MAX_INPUT_BYTES`) bounding input PDF size. The path branch of `getPdfFileBuffer()` now runs `fs.stat()` before `fs.readFile()` and rejects (a) non-regular files (`/dev/zero`, FIFOs, sockets, character devices) and (b) inputs whose size exceeds `maxInputBytes`. The buffer / `Uint8Array` branch validates `byteLength` against the same cap. Together these block unbounded memory consumption from untrusted input paths and oversized buffers.
- **SEC-003**: `concurrencyLimit` now enforces an upper bound of `MAX_CONCURRENCY_LIMIT` (`16`) when `processPagesInParallel` is `true`. At the cap, peak in-flight canvas memory ≈ `16 × MAX_CANVAS_PIXELS × 4 bytes ≈ 6.4 GiB` — a defensible ceiling for typical service containers. Values above `16` (e.g. `Number.MAX_SAFE_INTEGER`) throw synchronously before any rendering starts. The default `4` and lower values are unaffected.

### Changed

- Migrated `pdfjs-dist` from `~5.7.284` to `~6.0.227`. pdf.js v6 removed `PDFDocumentProxy.destroy()`, so document/worker teardown now uses `pdfDocument.loadingTask.destroy()` (the `loadingTask` getter exists in both v5 and v6, and the removed `destroy()` previously delegated to it). The public API, default options, asset paths (`cmaps` / `standard_fonts`), the `legacy/build/pdf.mjs` import path, and rendered PNG output are all unchanged — the visual-comparison suites pass against the existing v5-generated reference images.
- CI now blocks on `npm run build:strict`; the strict type-check is no longer advisory. `continue-on-error: true` is removed from `.github/workflows/test.yml` and the dedicated CI "Strict type check" step is replaced by `pretest` gating (avoiding a double run on CI). `pretest` now runs `build:strict` alongside `build:test` — the two type-checks enforce different contracts: `build:test` (using `tsconfig.json`, no DOM lib) gates `src/` against accidental DOM globals (`document`, `window`) that production builds would reject; `build:strict` (using `tsconfig.strict.json`, `skipLibCheck: false` + DOM lib for `@napi-rs/canvas` type resolution) gates against upstream type regressions in `pdfjs-dist` / `@napi-rs/canvas`. Local `npm test` and `prepublishOnly` now gate on both.
- Improved README accuracy and usability for npm consumers, and simplified the package funding metadata so `npm fund` exposes the Buy Me a Coffee URL.

### Refactored

- Updated the stale version pin in the existing `@ts-ignore` suppression in `src/pageRenderer.ts` from `pdfjs-dist@~5.6.205` to `pdfjs-dist@~6.0.x` and clarified why `@ts-ignore` (not `@ts-expect-error`) is required for this site — the underlying type error is hidden by `build:test`'s `skipLibCheck:true`, which would cause `@ts-expect-error` to report as unused. Added a comment in `tsconfig.strict.json` explaining the intentional DOM-lib divergence from `tsconfig.json`. Added a "Strict type-check" section to `CONTRIBUTING.md` documenting the failure-handling playbook (default `@ts-expect-error` for self-cleaning; `@ts-ignore` exception for `skipLibCheck`-hidden errors).

---

## [4.0.0] — 2026-04-28

### Security

- Pinned GitHub Actions to full commit SHAs to prevent supply-chain attacks via mutable tags
- Added explicit `permissions: contents: read` to all workflows
- Added `npm audit --audit-level=high` step to CI and publish workflows

### Added

- `SECURITY.md` with vulnerability disclosure policy
- `CHANGELOG.md` (this file)
- `CONTRIBUTING.md` with contributor guide
- `.nvmrc` pinned to Node 22
- `.editorconfig` for consistent editor settings across contributors
- `.github/dependabot.yml` for automated weekly npm and GitHub Actions updates
- `docker-compose.yml` for local Docker test runs
- `prepublishOnly` script to prevent stale local publishes
- Pre-commit hooks via husky + lint-staged (ESLint + Prettier on staged files)
- `license-checker` as a pinned devDependency (replaces `npx license-checker`)
- `npm run test:license` step added to CI
- Coverage reports uploaded as workflow artifacts per Node version
- `pull_request` trigger added to test workflow

### Changed

- **Breaking (major):** `PngPageOutput` is now a discriminated union with `kind: 'metadata' | 'content' | 'file'`; consumers should branch on `kind` before using mode-specific fields like `path` or `content`
- Docker base image switched from `node:22.19.0` to `node:22.19.0-slim`
- Dockerfile now runs as non-root `node` user
- Dockerfile converted to multi-stage build with dependency layer caching
- `NODE_ENV=test` set in Dockerfile
- `dockerfile` renamed to `Dockerfile` (standard casing)
- CI matrix expanded to Node 20, 22, and 24
- Coverage thresholds raised: `lines: 90`, `functions: 90`, `branches: 85`
- `MAX_VIEWPORT_SCALE` and `MAX_CANVAS_PIXELS` moved from inline in `pdfToPng.ts` to `const.ts`
- CMap and font paths now resolved at call time in `propsToPdfDocInitParams` instead of at module-load time
- `pdfjs-dist` dynamic import cached at module level for repeated-call performance
- All optional properties in README options table now marked with `?`

### Fixed

- Wrong import path in `props.to.pdf.doc.init.params.test.ts` (`../src/types/...` → `../src/interfaces/...`)
- Split `import type { Canvas}` with missing space in `canvas.and.context.ts` merged into single import

### Refactored

- Extracted `processAndSavePage` helper to eliminate duplicated render+save logic in parallel and sequential paths
- Eliminated redundant `pngPagesOutput` outer array in `pdfToPng`
- Split `processPdfPage` into `getPageMetadata` (metadata-only path) and `renderPdfPage` (render path)
- Converted `pdf.to.file.test.js` (JavaScript, importing from `../out`) to TypeScript importing from `../src`

---

## [3.15.0] — 2026-03-31

### Fixed

- `viewportScale` maximum limit updated to 100; error messages updated accordingly
- Canvas pixel-area cap added to prevent OOM on extreme viewport scales
- `pageViewportScale` captured before first `await` to prevent mutation between validation and rendering
- `concurrencyLimit` fail-fast validation added; documents integer constraint
- Path-traversal prevention via segment-aware `..` check and symlink-escape guard in `savePNGfile`
- TOCTOU window narrowed: final `realpath` check added immediately before `writeFile`
- `pdfFile` parameter type widened to include `Uint8Array`; Buffer-to-Uint8Array conversion avoids redundant allocation

---

## [3.14.0] — 2026-02-26

### Added

- `returnMetadataOnly` option: returns page dimensions and rotation without rendering
- `concurrencyLimit` option for parallel page processing
- `outputFileMaskFunc` for custom page filename generation

### Changed

- Migrated canvas dependency to `@napi-rs/canvas` (pre-built binaries, no node-gyp)
- Updated `pdfjs-dist` to v5

---

## [3.7.0] — 2025-03-06

### Added

- `processPagesInParallel` option using `Promise.all` with configurable concurrency

---

## [3.3.0] — 2024-08-30

### Added

- `pagesToProcess` option to convert specific pages

---

## [3.0.0] — 2023-04-09

### Changed

- Module type changed to CommonJS (`"type": "commonjs"`)
- `"moduleResolution": "node16"` — `.js` extensions required in relative imports

---

## [1.0.0] — 2022-05-07

### Added

- Initial stable release
- `pdfToPng(pdfFile, options?)` public API
- File path and `ArrayBuffer` input support
- `outputFolder`, `viewportScale`, `pdfFilePassword`, `disableFontFace`, `useSystemFonts`, `enableXfa` options

[Unreleased]: https://github.com/dichovsky/pdf-to-png-converter/compare/v4.2.0...HEAD
[4.2.0]: https://github.com/dichovsky/pdf-to-png-converter/compare/v4.1.1...v4.2.0
[4.1.1]: https://github.com/dichovsky/pdf-to-png-converter/compare/v4.1.0...v4.1.1
[4.1.0]: https://github.com/dichovsky/pdf-to-png-converter/compare/8368a905c5c7c8ab71c8d04be8745da51cd4db05...v4.1.0
[4.0.0]: https://github.com/dichovsky/pdf-to-png-converter/compare/v3.16.0...8368a905c5c7c8ab71c8d04be8745da51cd4db05
[3.15.0]: https://github.com/dichovsky/pdf-to-png-converter/compare/release/v3.14.0...v3.15.0
[3.14.0]: https://github.com/dichovsky/pdf-to-png-converter/compare/release/v3.7.0...release/v3.14.0
[3.7.0]: https://github.com/dichovsky/pdf-to-png-converter/compare/release/v3.3.0...release/v3.7.0
[3.3.0]: https://github.com/dichovsky/pdf-to-png-converter/compare/release/v3.0.0...release/v3.3.0
[3.0.0]: https://github.com/dichovsky/pdf-to-png-converter/compare/release/v1.0.0...release/v3.0.0
[1.0.0]: https://github.com/dichovsky/pdf-to-png-converter/releases/tag/release/v1.0.0
