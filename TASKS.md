# Backlog

> Last updated: 2026-03-30.
> Tasks are ordered by priority within each section. Prefix: P1 = critical, P2 = important, P3 = nice-to-have.

---

## Security

### [P1] Pin GitHub Actions to commit SHAs

**Problem**
Both CI workflows use `actions/checkout@v6` and `actions/setup-node@v6`. Mutable version tags can be silently moved to a new (potentially malicious) commit.

**Impact**
A compromised action could exfiltrate `NPM_TOKEN`, tamper with build output, or inject code into published packages.

**Solution**
Replace every `@v6` reference with the full commit SHA. Add a comment with the tag for human readability:
```yaml
uses: actions/checkout@<SHA>  # v6
```

**Files**
- `.github/workflows/test.yml`
- `.github/workflows/publish.yml`

---

### [P1] Add explicit `permissions` to GitHub Actions workflows

**Problem**
Both workflows omit `permissions:`, so jobs run with GitHub's default token which may include write access to contents, packages, and PRs depending on the organisation setting.

**Solution**
Add minimal permissions to each workflow:
```yaml
permissions:
  contents: read
```
The publish workflow additionally needs `id-token: write` if OIDC is adopted.

**Files**
- `.github/workflows/test.yml`
- `.github/workflows/publish.yml`

---

### [P2] Add `SECURITY.md` with a vulnerability disclosure process

**Problem**
No documented process exists for responsible disclosure. Researchers may report publicly before a fix is ready.

**Solution**
Create `SECURITY.md` at the repo root with: supported versions, a contact address (or GitHub private advisory URL), and expected response time.

**Files**
- `SECURITY.md` (new file)

---

### [P2] Add `npm audit` step to CI

**Problem**
Neither workflow runs `npm audit`, so a dependency with a known CVE can be shipped to consumers.

**Solution**
Add after `npm ci` in both workflows:
```yaml
- run: npm audit --audit-level=high
```

**Files**
- `.github/workflows/test.yml`
- `.github/workflows/publish.yml`

---

## CI / DevOps

### [P1] Add test step to the publish workflow

**Problem**
`publish.yml` runs `npm ci` → `npm run build` → `npm publish` with no test step. A build can succeed while tests are failing, shipping broken code to npm.

**Solution**
Add before `npm publish`:
```yaml
- run: npm test
```

**Files**
- `.github/workflows/publish.yml`

---

### [P1] Add `pull_request` trigger to the test workflow

**Problem**
`test.yml` only triggers on `push`. PRs (especially from forks) get no automated CI run, so they can be merged without tests passing.

**Solution**
```yaml
on:
  push:
  pull_request:
```

**Files**
- `.github/workflows/test.yml`

---

### [P2] Test against multiple Node.js versions

**Problem**
The matrix only includes Node 24, but `engines` declares `>=20`. Regressions on Node 20 and 22 go undetected.

**Solution**
```yaml
matrix:
  node: [20, 22, 24]
```

**Files**
- `.github/workflows/test.yml`

---

### [P2] Upload coverage reports as workflow artifacts

**Problem**
Coverage is generated then discarded. No historical trend data is available.

**Solution**
```yaml
- uses: actions/upload-artifact@v4
  with:
    name: coverage
    path: coverage/
```

**Files**
- `.github/workflows/test.yml`

---

### [P3] Add `test:license` to CI

**Problem**
The `test:license` script exists but is never run in CI. An incompatible-license dependency could be merged and published undetected.

**Solution**
Add a step to `test.yml`:
```yaml
- name: Check licenses
  run: npm run test:license
```

**Files**
- `.github/workflows/test.yml`

---

## Docker

### [P1] Switch to a slim base image

**Problem**
`FROM node:22.19.0` uses the full Debian image (~1 GB). The `-slim` variant is 200–300 MB and removes unnecessary packages.

**Solution**
```dockerfile
FROM node:22.19.0-slim
```

**Files**
- `dockerfile`

---

### [P1] Run container as a non-root user

**Problem**
No `USER` instruction means all container processes run as `root`, violating least-privilege.

**Solution**
Add before `CMD`:
```dockerfile
RUN chown -R node:node /usr/pkg/
USER node
```

**Files**
- `dockerfile`

---

### [P2] Use a multi-stage Dockerfile

**Problem**
The single-stage build installs all dev dependencies (TypeScript, Vitest, ESLint) in the final image, bloating size and attack surface.

**Solution**
```dockerfile
FROM node:22.19.0-slim AS test
WORKDIR /usr/pkg/
COPY package*.json ./
RUN npm ci
COPY . .
CMD ["npm", "run", "docker:test"]
```
A second production stage would `npm ci --omit=dev`.

**Files**
- `dockerfile`

---

### [P2] Extend `.dockerignore`

**Problem**
`.git`, `.github`, `__tests__`, `test-data`, `.prettierrc`, `.prettierignore`, and `eslint.config.mjs` are still copied into the Docker build context, inflating build time and image size. (`.env`, `.claude`, `output`, `tmp`, `TASKS.md`, `CLAUDE.md` were excluded on 2026-03-30.)

**Solution**
Add to `.dockerignore`:
```
.git
.github
__tests__
test-data
.prettierrc
.prettierignore
eslint.config.mjs
```

**Files**
- `.dockerignore`

---

### [P2] Set `NODE_ENV` in the Dockerfile

**Problem**
`NODE_ENV` is unset; some libraries change behaviour (logging, caching) based on this value.

**Solution**
```dockerfile
ENV NODE_ENV=test
```

**Files**
- `dockerfile`

---

### [P3] Rename `dockerfile` → `Dockerfile`

**Problem**
Lowercase `dockerfile` is non-standard. Some tools (Docker Buildkit, IDE plugins, GitHub Actions Docker actions) expect the capitalised name by default. On case-sensitive filesystems `docker build .` without `-f` may not find the file.

**Solution**
Rename the file. No `-f` flags are used in `package.json` scripts, so no script changes are needed.

**Files**
- `dockerfile` → `Dockerfile`

---

### [P3] Add `docker-compose.yml` for local development

**Problem**
Running Docker tests requires remembering the `npm run test:docker` chain. There is no standard entry point for future service dependencies.

**Solution**
```yaml
services:
  test:
    build: .
    volumes:
      - ./test-results:/usr/pkg/test-results
```

**Files**
- `docker-compose.yml` (new file)

---

## Testing

### [P1] Convert `pdf.to.file.test.js` to TypeScript

**Problem**
`__tests__/pdf.to.file.test.js` is the only JavaScript test file. It imports from `'../out'` (compiled output), is not type-checked, is not subject to ESLint TypeScript rules, and requires a prior `npm run build` to pass.

**Solution**
Convert to `pdf.to.file.test.ts` (or remove if it duplicates an existing `.ts` test), import from `'../src'`, and add type annotations.

**Files**
- `__tests__/pdf.to.file.test.js` (convert or remove)

---

### [P2] Fix wrong import path in `props.to.pdf.doc.init.params.test.ts`

**Problem**
The file imports `PdfToPngOptions` from `'../src/types/pdf.to.png.options'`, which does not exist (the interface lives at `src/interfaces/pdf.to.png.options.ts`). This is silently ignored at runtime because Vitest strips types, but it breaks type-checking.

**Solution**
```typescript
import type { PdfToPngOptions } from '../src/interfaces/pdf.to.png.options.js';
```

**Files**
- `__tests__/props.to.pdf.doc.init.params.test.ts`

---

### [P2] Increase coverage thresholds

**Problem**
`vitest.config.mjs` uses `branches: 70`, `lines: 80`, `functions: 80`. 30% of branch logic can be untested without CI failing.

**Solution**
```js
thresholds: { lines: 90, functions: 90, branches: 85 }
```
Add any missing tests required to satisfy the higher thresholds before raising them.

**Files**
- `vitest.config.mjs`

---

### [P2] Add `viewportScale` NaN / Infinity tests

**Problem**
Validation tests cover `0` and `-1` but not `NaN`, `Infinity`, or non-numeric values passed via `any`. Type-unsafe callers could hit unexpected behaviour.

**Solution**
```typescript
await expect(pdfToPng('test.pdf', { viewportScale: NaN })).rejects.toThrow('viewportScale');
await expect(pdfToPng('test.pdf', { viewportScale: Infinity })).rejects.toThrow('viewportScale');
```

**Files**
- `__tests__/coverage.test.ts`

---

### [P2] Add `concurrencyLimit` edge-case batch tests

**Problem**
No tests cover `concurrencyLimit: 1` (sequential parallel mode), a limit larger than the page count, or a single-page PDF in parallel mode. Off-by-one errors in `slice(i, i + concurrencyLimit)` would go undetected.

**Solution**
Add parameterised tests:
- `concurrencyLimit: 1` on a multi-page PDF
- `concurrencyLimit: 100` on a 2-page PDF
- `processPagesInParallel: true` with a single page

**Files**
- `__tests__/pdf.to.png.concurrency.limit.validation.test.ts` or new file

---

### [P3] Add `normalizePath` tests for paths with spaces and Windows separators

**Problem**
Existing tests do not cover inputs with spaces, backslashes, or special characters. Windows CI or contributors may hit subtle path issues.

**Solution**
Add test cases for paths containing spaces; verify the trailing-separator rule holds for all separator styles.

**Files**
- `__tests__/normalizePath.test.ts`

---

## Code Quality

### [P2] Fix split import in `canvas.and.context.ts`

**Problem**
Two separate `import type` statements from `@napi-rs/canvas`, and the first has a missing space: `import type { Canvas}`.

**Solution**
```typescript
import type { Canvas, SKRSContext2D } from '@napi-rs/canvas';
```

**Files**
- `src/interfaces/canvas.and.context.ts`

---

### [P3] Move inline security constants to `const.ts`

**Problem**
`MAX_VIEWPORT_SCALE` (1000) and `MAX_CANVAS_PIXELS` (100_000_000) are defined inline inside `pdfToPng.ts`. These are configuration values and belong alongside `PDF_TO_PNG_OPTIONS_DEFAULTS` in `const.ts` where they are visible, documented, and testable in isolation.

**Solution**
Move both constants to `src/const.ts` with JSDoc explaining the rationale, and import them in `pdfToPng.ts`.

**Files**
- `src/const.ts`
- `src/pdfToPng.ts`

---

### [P3] Eliminate redundant intermediate array in `pdfToPng`

**Problem**
Results are collected into `pngPageOutputs` and then spread into the outer `pngPagesOutput` with `push(...pngPageOutputs)`. The outer array is declared before `try` solely to return it from the `finally` block, but `pdfDocument.cleanup()` in `finally` doesn't need the array — only the `cleanup()` call matters.

**Solution**
Declare a single `pngPageOutputs` array, return it directly at the end, and let the `finally` block only call `cleanup()`:
```typescript
const pngPageOutputs: PngPageOutput[] = [];
try {
    // ... fill pngPageOutputs ...
} finally {
    await pdfDocument.cleanup();
}
return pngPageOutputs;
```

**Files**
- `src/pdfToPng.ts`

---

## Architecture

### [P2] Resolve CMap and font paths at call time, not module load time

**Problem**
`DOCUMENT_INIT_PARAMS_DEFAULTS` in `const.ts` calls `normalizePath('./node_modules/pdfjs-dist/cmaps/')` at module-load time, locking the path to `process.cwd()` at the moment the library is first imported. Applications that change `process.cwd()` after importing will silently produce wrong paths.

**Solution**
Move the `normalizePath` calls inside `propsToPdfDocInitParams` (or `getPdfDocument`) so the paths are resolved at invocation time.

**Files**
- `src/const.ts`
- `src/propsToPdfDocInitParams.ts`

---

### [P2] Extract a `processAndSavePage` helper to remove duplicated per-page logic

**Problem**
The render-and-save block (call `processPdfPage` → `savePNGfile` → optionally clear `content`) is duplicated verbatim in both the parallel `Promise.all` branch and the sequential `for` loop.

**Solution**
```typescript
async function processAndSavePage(pdf, pageName, pageNumber, scale, returnContent, metadataOnly, outputFolder, returnPageContent) {
    const out = await processPdfPage(...);
    if (outputFolder && !metadataOnly) {
        await savePNGfile(out, outputFolder);
        if (!returnPageContent) out.content = undefined;
    }
    return out;
}
```

**Files**
- `src/pdfToPng.ts`

---

### [P2] Cache the pdfjs dynamic import

**Problem**
`getPdfDocument` calls `await import('pdfjs-dist/legacy/build/pdf.mjs')` on every invocation. Applications processing queues of PDFs pay the module-resolution and initialisation cost on each call.

**Solution**
```typescript
let pdfjsLib: typeof import('pdfjs-dist/legacy/build/pdf.mjs') | undefined;
async function getPdfjsLib() {
    pdfjsLib ??= await import('pdfjs-dist/legacy/build/pdf.mjs');
    return pdfjsLib;
}
```

**Files**
- `src/pdfToPng.ts`

---

### [P3] Split `processPdfPage` into two dedicated functions

**Problem**
`processPdfPage` handles two fundamentally different paths via the `returnMetadataOnly` flag: metadata-only (no canvas) and full render. The `returnMetadataOnly` branch exits early but shares the function signature with the render path.

**Solution**
- `getPageMetadata(pdf, name, pageNumber, scale)` — metadata path
- `renderPdfPage(pdf, name, pageNumber, scale, returnContent)` — render path

Call the appropriate one from the caller based on `returnMetadataOnly`.

**Files**
- `src/pdfToPng.ts`

---

## Documentation

### [P2] Add `CHANGELOG.md`

**Problem**
No changelog exists. Users upgrading must inspect Git history or GitHub releases.

**Solution**
Create `CHANGELOG.md` following [Keep a Changelog](https://keepachangelog.com/en/1.0.0/) format, starting from v3.14.1 and backfilling key recent changes.

**Files**
- `CHANGELOG.md` (new file)

---

### [P2] Add `CONTRIBUTING.md`

**Problem**
No contributor guide documents how to set up the dev environment, run tests, or submit PRs.

**Solution**
Cover: prerequisites, `npm ci && npm test`, coding conventions (TypeScript, Prettier, ESLint), commit format, and PR checklist.

**Files**
- `CONTRIBUTING.md` (new file)

---

### [P3] Mark all optional properties in the README options table

**Problem**
The options block shows `viewportScale: number` (and others) without `?`, implying they are required.

**Solution**
Add `?` to all optional properties in the options code block in `README.md`.

**Files**
- `README.md`

---

## Dependencies

### [P1] Add `license-checker` as a dev dependency

**Problem**
`test:license` uses `npx license-checker`, fetching an unversioned package at runtime. This is non-deterministic and a minor supply-chain risk.

**Solution**
```sh
npm install --save-dev license-checker
```
Update the script to call `license-checker` directly.

**Files**
- `package.json`

---

### [P2] Add Dependabot for automated dependency updates

**Problem**
No Dependabot or Renovate config exists. Security patches in dependencies accumulate until someone manually updates.

**Solution**
```yaml
# .github/dependabot.yml
version: 2
updates:
  - package-ecosystem: npm
    directory: "/"
    schedule:
      interval: weekly
  - package-ecosystem: github-actions
    directory: "/"
    schedule:
      interval: weekly
```

**Files**
- `.github/dependabot.yml` (new file)

---

## Developer Experience

### [P2] Add `.nvmrc`

**Problem**
`engines` requires `>=20` but there is no `.nvmrc`. Developers using `nvm` or `fnm` must manually select a version.

**Solution**
```
22
```

**Files**
- `.nvmrc` (new file)

---

### [P2] Add `.editorconfig`

**Problem**
No `.editorconfig` means editors may use different indentation or line endings for YAML, Markdown, and Dockerfile.

**Solution**
```ini
root = true
[*]
indent_style = space
indent_size = 4
end_of_line = lf
charset = utf-8
trim_trailing_whitespace = true
insert_final_newline = true
[*.{yml,yaml}]
indent_size = 2
[*.md]
trim_trailing_whitespace = false
```

**Files**
- `.editorconfig` (new file)

---

### [P3] Add `prepublishOnly` script

**Problem**
`npm publish` run locally (outside CI) would ship whatever is currently in `out/` without rebuilding, risking stale output.

**Solution**
```json
"prepublishOnly": "npm test"
```

**Files**
- `package.json`

---

### [P3] Include `__tests__` in TypeScript type-checking

**Problem**
`tsconfig.json` only includes `src/**/*`. Type errors in test files (e.g., the wrong import path in `props.to.pdf.doc.init.params.test.ts`) are silently ignored during `npm run build:test`.

**Solution**
Create `tsconfig.test.json` extending the base config with `"include": ["src/**/*", "__tests__/**/*"]`. Add a `build:test:all` script and run it in CI.

**Files**
- `tsconfig.test.json` (new file)
- `package.json`
- `.github/workflows/test.yml`

---

### [P3] Add pre-commit hooks with `husky` and `lint-staged`

**Problem**
There are no pre-commit hooks. Developers discover lint failures only after pushing.

**Solution**
```json
"lint-staged": {
  "src/**/*.ts": ["eslint --fix", "prettier --write"],
  "__tests__/**/*.ts": ["prettier --write"]
}
```
Run `npx husky init` to create `.husky/pre-commit`.

**Files**
- `package.json`
- `.husky/pre-commit` (new)
