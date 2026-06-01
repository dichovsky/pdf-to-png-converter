# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [Unreleased]

### Removed

- Removed the bespoke `NodeCanvasFactory` (`src/node.canvas.factory.ts`) and its tests. Rendering now uses pdf.js's built-in Node canvas factory (`PDFDocumentProxy.canvasFactory`, backed by `@napi-rs/canvas`) directly. The previous code selected this factory at runtime anyway — the `isNodeCanvasFactory()` duck-type guard always matched pdf.js's own factory, so the project's class and its `new NodeCanvasFactory()` fallback were never exercised on the render path. The `@napi-rs/canvas` dependency is unchanged (kept as a direct dependency so pdf.js's renderer is always able to load it). Rendered PNG output is unchanged — the visual-comparison suites pass. Resolves backlog item ARCH-015. pdf.js's `canvasFactory` is validated at runtime (it must expose callable `create`/`destroy`) rather than force-cast, the render path now asserts both the returned `canvas` and `context` are non-null before use, and `destroy()` receives the exact `CanvasAndContext` object pdf.js returned (preserving any internal fields it needs for cleanup).

### Fixed

- Parallel page processing now propagates a worker rejection whose reason is `undefined`. Previously `processPagesWithSlidingWindow()` used `undefined` as both the "no error" sentinel and a possible rejection payload, so that failure was swallowed and the conversion resolved with an `undefined` page result.
- `PngPageOutput.width` / `height` are now always integer pixel dimensions that match the rendered PNG. Previously they were reported straight from pdf.js's `PageViewport`, whose lengths are unrounded floats, while `@napi-rs/canvas` truncates fractional dimensions when it allocates the bitmap. Any PDF whose `viewportScale × pageDimension` was fractional therefore reported a non-integer size that disagreed with the actual image — e.g. a 595×842 pt (A4) page at `viewportScale: 1.5` reported `width: 892.5` for an 892 px-wide PNG. Both the render path (`renderPdfPage`) and the `returnMetadataOnly` path (`getPageMetadata`) now floor viewport lengths to pixels via the shared `toPixelDimension` helper, so the two paths agree and both match the bitmap. US-Letter assets (612×792) at integer scales are unaffected.
- A `viewportScale` small enough to floor a page to `0` px in either dimension now throws an actionable `"…cannot produce a valid image. Increase viewportScale."` error from both `renderPdfPage` and `getPageMetadata`, instead of returning a phantom `0×0` metadata result or surfacing an opaque canvas-factory `AssertionError`. The page is released before the render path throws.
- `returnMetadataOnly` (`getPageMetadata`) now enforces the `MAX_CANVAS_PIXELS` limit, matching `renderPdfPage`. Previously the oversized-page guard lived only on the render path, so a `viewportScale` whose viewport area exceeded the limit threw `"Canvas …×… px exceeds the … pixel limit. Reduce viewportScale."` on a real render but silently returned those (unrenderable) dimensions in metadata-only mode — a phantom result for a page that cannot be rendered, the same failure mode the floor-to-zero guard already prevents on both paths. The two paths now reject oversized pages with the identical message via the shared `canvasPixelLimitError` builder (mirroring `nonRenderableDimensionsError`).
- The `MAX_CANVAS_PIXELS` canvas-area guard now bounds the **rendered (floored) canvas** — `floor(viewportWidth) × floor(viewportHeight)` — instead of the unrounded fractional viewport area. Because the canvas is allocated with floored dimensions (via the shared `toPixelDimension` helper), a page whose un-floored viewport area slightly exceeded the limit while its actually-allocated bitmap fit within it was wrongly rejected with `"Canvas …×… px exceeds the … pixel limit. Reduce viewportScale."`. This affects a narrow `viewportScale` band — e.g. a 612×792 pt US-Letter page at `viewportScale ≈ 14.3636` produces an un-floored area of `100,000,739` px (over the `100,000,000` cap) but a real `8790×11375 = 99,986,250` px bitmap (under it), so the page is renderable yet was refused. Both `renderPdfPage` and the `returnMetadataOnly` path (`getPageMetadata`) now floor viewport lengths _before_ the area check, so the guard matches the bitmap actually allocated and the two paths stay symmetric. Pages that genuinely exceed the limit still throw the identical message on both paths, and peak canvas memory remains bounded at `MAX_CANVAS_PIXELS × 4 bytes ≈ 400 MB`.

## [4.1.0] — 2026-05-31

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

[Unreleased]: https://github.com/dichovsky/pdf-to-png-converter/compare/v4.0.0...HEAD
[4.0.0]: https://github.com/dichovsky/pdf-to-png-converter/compare/v3.15.0...v4.0.0
[3.15.0]: https://github.com/dichovsky/pdf-to-png-converter/compare/release/v3.14.0...v3.15.0
[3.14.0]: https://github.com/dichovsky/pdf-to-png-converter/compare/release/v3.7.0...release/v3.14.0
[3.7.0]: https://github.com/dichovsky/pdf-to-png-converter/compare/release/v3.3.0...release/v3.7.0
[3.3.0]: https://github.com/dichovsky/pdf-to-png-converter/compare/release/v3.0.0...release/v3.3.0
[3.0.0]: https://github.com/dichovsky/pdf-to-png-converter/compare/release/v1.0.0...release/v3.0.0
[1.0.0]: https://github.com/dichovsky/pdf-to-png-converter/releases/tag/release/v1.0.0
