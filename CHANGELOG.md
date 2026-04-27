# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [Unreleased]

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
- `tsconfig.test.json` to type-check `__tests__/` in CI alongside `src/`
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

[Unreleased]: https://github.com/dichovsky/pdf-to-png-converter/compare/v3.15.0...HEAD
[3.15.0]: https://github.com/dichovsky/pdf-to-png-converter/compare/release/v3.14.0...v3.15.0
[3.14.0]: https://github.com/dichovsky/pdf-to-png-converter/compare/release/v3.7.0...release/v3.14.0
[3.7.0]: https://github.com/dichovsky/pdf-to-png-converter/compare/release/v3.3.0...release/v3.7.0
[3.3.0]: https://github.com/dichovsky/pdf-to-png-converter/compare/release/v3.0.0...release/v3.3.0
[3.0.0]: https://github.com/dichovsky/pdf-to-png-converter/compare/release/v1.0.0...release/v3.0.0
[1.0.0]: https://github.com/dichovsky/pdf-to-png-converter/releases/tag/release/v1.0.0
