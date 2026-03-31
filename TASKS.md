# Backlog

> Last updated: 2026-03-31.
> Tasks are ordered by priority within each section. Prefix: P1 = critical, P2 = important, P3 = nice-to-have.
> Completed tasks are listed at the bottom of each section.

---

## Security

### ✅ [P1] Pin GitHub Actions to commit SHAs

Replaced `actions/checkout@v6` and `actions/setup-node@v6` with full commit SHAs plus inline tag comments.

**Files**
- `.github/workflows/test.yml`
- `.github/workflows/publish.yml`

---

### ✅ [P1] Add explicit `permissions` to GitHub Actions workflows

Added `permissions: contents: read` to both workflows.

**Files**
- `.github/workflows/test.yml`
- `.github/workflows/publish.yml`

---

### ✅ [P2] Add `SECURITY.md` with a vulnerability disclosure process

**Files**
- `SECURITY.md`

---

### ✅ [P2] Add `npm audit` step to CI

Added `npm audit --audit-level=high` after `npm ci` in both workflows.

**Files**
- `.github/workflows/test.yml`
- `.github/workflows/publish.yml`

---

## CI / DevOps

### ✅ [P1] Add test step to the publish workflow

Added `npm test` before `npm publish` in `publish.yml`.

**Files**
- `.github/workflows/publish.yml`

---

### ✅ [P1] Add `pull_request` trigger to the test workflow

**Files**
- `.github/workflows/test.yml`

---

### ✅ [P2] Test against multiple Node.js versions

Matrix now includes Node 20, 22, and 24.

**Files**
- `.github/workflows/test.yml`

---

### ✅ [P2] Upload coverage reports as workflow artifacts

**Files**
- `.github/workflows/test.yml`

---

### ✅ [P3] Add `test:license` to CI

**Files**
- `.github/workflows/test.yml`

---

## Docker

### ✅ [P1] Switch to a slim base image

Changed `FROM node:22.19.0` to `FROM node:22.19.0-slim AS test`.

**Files**
- `Dockerfile`

---

### ✅ [P1] Run container as a non-root user

Added `RUN chown -R node:node /usr/pkg/` and `USER node`.

**Files**
- `Dockerfile`

---

### ✅ [P2] Use a multi-stage Dockerfile

Single test stage uses the slim image; dev dependencies are only installed for that stage.

**Files**
- `Dockerfile`

---

### ✅ [P2] Extend `.dockerignore`

Added `.git`, `.github`, `.prettierrc`, `.prettierignore`, `eslint.config.mjs` to `.dockerignore`.

**Files**
- `.dockerignore`

---

### ✅ [P2] Set `NODE_ENV` in the Dockerfile

Added `ENV NODE_ENV=test`.

**Files**
- `Dockerfile`

---

### ✅ [P3] Rename `dockerfile` → `Dockerfile`

**Files**
- `Dockerfile`

---

### ✅ [P3] Add `docker-compose.yml` for local development

**Files**
- `docker-compose.yml`

---

## Testing

### ✅ [P1] Convert `pdf.to.file.test.js` to TypeScript

Converted to `.ts` and updated import to use `../src` directly.

**Files**
- `__tests__/pdf.to.file.test.ts`

---

### ✅ [P2] Fix wrong import path in `props.to.pdf.doc.init.params.test.ts`

Changed import to `'../src/interfaces/pdf.to.png.options.js'`.

**Files**
- `__tests__/props.to.pdf.doc.init.params.test.ts`

---

### ✅ [P2] Increase coverage thresholds

Raised to `lines: 90`, `functions: 90`, `branches: 85`.

**Files**
- `vitest.config.mjs`

---

### ✅ [P2] Add `viewportScale` NaN / Infinity tests

Added tests for `NaN`, `Infinity`, and non-numeric values.

**Files**
- `__tests__/coverage.test.ts`

---

### ✅ [P2] Add `concurrencyLimit` edge-case batch tests

Added tests for `concurrencyLimit: 1`, `concurrencyLimit: 100`, and single-page parallel mode.

**Files**
- `__tests__/pdf.to.png.concurrency.limit.validation.test.ts`

---

### ✅ [P3] Add `normalizePath` tests for paths with spaces and special characters

Added tests for spaces, parentheses, and special characters.

**Files**
- `__tests__/normalizePath.test.ts`

---

### ✅ [P3] Standardize all test assertions to Vitest-native style

Replaced Chai-style `.to.equal()`, `.to.deep.equal()`, `.to.throw()` etc. with
Vitest-native `.toBe()`, `.toEqual()`, `.toThrow()` across all test files.

**Files**
- `__tests__/*.test.ts` (12 files updated)

---

## Code Quality

### ✅ [P2] Fix split import in `canvas.and.context.ts`

Merged two separate `import type` statements into one.

**Files**
- `src/interfaces/canvas.and.context.ts`

---

### ✅ [P3] Move inline security constants to `const.ts`

Moved `MAX_VIEWPORT_SCALE` and `MAX_CANVAS_PIXELS` from `pdfToPng.ts` to `const.ts`.

**Files**
- `src/const.ts`
- `src/pdfToPng.ts`

---

### ✅ [P3] Eliminate redundant intermediate array in `pdfToPng`

Removed the intermediate `pngPagesOutput` array; results collected directly into `pngPageOutputs`.

**Files**
- `src/pdfToPng.ts`

---

### ✅ [P3] Strengthen ESLint rules for `src/`

Enabled `@typescript-eslint/no-var-requires: error` and `@typescript-eslint/no-explicit-any: warn`.

**Files**
- `eslint.config.mjs`

---

### ✅ [P3] Add `.js` extensions to barrel re-exports

Added required `.js` extensions to all relative imports in barrel files under `nodemodule: nodenext`.

**Files**
- `src/index.ts`
- `src/interfaces/index.ts`
- `src/types/index.ts`

---

### ✅ [P3] Validate `outputFileMaskFunc` return value

Added `resolvePageName()` helper that throws immediately if `outputFileMaskFunc` returns an empty string.

**Files**
- `src/pdfToPng.ts`

---

## Architecture

### ✅ [P2] Resolve CMap and font paths at call time, not module load time

Moved `normalizePath` calls from `const.ts` module-load time into `propsToPdfDocInitParams`.

**Files**
- `src/const.ts`
- `src/propsToPdfDocInitParams.ts`

---

### ✅ [P2] Extract a `processAndSavePage` helper to remove duplicated per-page logic

**Files**
- `src/pdfToPng.ts`

---

### ✅ [P2] Cache the pdfjs dynamic import

Added module-level `let pdfjsLib` cache with `??=` assignment.

**Files**
- `src/pdfToPng.ts`

---

### ✅ [P2] Cache `realpath` of `outputFolder` before the page loop

Hoisted `realpath(resolvedOutputFolder)` into `pdfToPng` after `mkdir`, passing the cached
value into `savePNGfile` to avoid N redundant syscalls for an N-page PDF. Per-page TOCTOU
re-check inside `savePNGfile` is preserved.

**Files**
- `src/pdfToPng.ts`

---

### ✅ [P3] Split `processPdfPage` into two dedicated functions

Split into `getPageMetadata` (no canvas) and `renderPdfPage` (full render).

**Files**
- `src/pdfToPng.ts`

---

## Documentation

### ✅ [P2] Add `CHANGELOG.md`

**Files**
- `CHANGELOG.md`

---

### ✅ [P2] Fill in actual release dates in `CHANGELOG.md`

Replaced placeholder `YYYY-MM-DD` dates with actual git tag dates for all six releases.

**Files**
- `CHANGELOG.md`

---

### ✅ [P2] Add `CONTRIBUTING.md`

**Files**
- `CONTRIBUTING.md`

---

### ✅ [P3] Mark all optional properties in the README options table

Added `?` to all optional properties in the options block.

**Files**
- `README.md`

---

### ✅ [P3] Improve README with VerbosityLevel, canvas limit, output format, and native binaries

Added `VerbosityLevel` import example, canvas pixel-limit note for `viewportScale`,
`@napi-rs/canvas` native binaries note, and `content`/`path` clarification for `returnMetadataOnly`.

**Files**
- `README.md`

---

### ✅ [P3] Add `@since` tags to newer `PdfToPngOptions` properties

Added `@since 3.3.0`, `@since 3.7.0`, and `@since 3.14.0` to `pagesToProcess`,
`processPagesInParallel`, `outputFileMaskFunc`, `returnMetadataOnly`, and `concurrencyLimit`.

**Files**
- `src/interfaces/pdf.to.png.options.ts`

---

## Dependencies

### ✅ [P1] Add `license-checker` as a dev dependency

Added `license-checker` to `devDependencies`; removed the `npx` prefix from the `test:license` script.

**Files**
- `package.json`

---

### ✅ [P2] Add Dependabot for automated dependency updates

**Files**
- `.github/dependabot.yml`

---

### ✅ [P3] Add `prettier` as a pinned dev dependency

Pinned `"prettier": "3.8.1"` in `devDependencies` for deterministic formatting.

**Files**
- `package.json`

---

## Developer Experience

### ✅ [P2] Add `.nvmrc`

Pinned to Node 22.

**Files**
- `.nvmrc`

---

### ✅ [P2] Add `.editorconfig`

**Files**
- `.editorconfig`

---

### ✅ [P2] Add `tsconfig.test.json` and `build:test:all` script

Type-checks both `src/` and `__tests__/` together.

**Files**
- `tsconfig.test.json`
- `package.json`

---

### ✅ [P3] Add `prepublishOnly` script

`"prepublishOnly": "npm test"` prevents publishing stale builds locally.

**Files**
- `package.json`

---

### ✅ [P3] Add pre-commit hooks with `husky` and `lint-staged`

**Files**
- `package.json`
- `.husky/pre-commit`

---

### ✅ [P3] Add `packageManager` field to `package.json`

Declares `npm@11.12.1` for deterministic tooling.

**Files**
- `package.json`

---

### ✅ [P3] Fix `normalizePath` trailing separator on Windows

Used `path.sep` instead of a hardcoded `/` for the trailing separator check and append,
ensuring correctness on both POSIX (`/`) and Windows (`\`).

**Files**
- `src/normalizePath.ts`

---
