# Code Review Improvements

> Comprehensive repository audit performed on 2026-03-05.
> All tasks are atomic and reference specific files.

---

## Security

### [P1] Pin GitHub Actions to commit SHAs instead of mutable version tags

**Problem**
Both CI workflows use `actions/checkout@v6` and `actions/setup-node@v6`. These tags can be silently updated to point to new (potentially malicious) commits at any time, creating a supply-chain risk.

**Impact**
A compromised action could exfiltrate secrets (`NPM_TOKEN`), tamper with build output, or inject malicious code into published packages.

**Solution**
Replace every `@v6` reference with the corresponding full commit SHA (e.g. `actions/checkout@11bd71901bbe5b1630ceea73d27597364c9af683`). Add a comment with the tag name for human readability.

**Files**
- `.github/workflows/test.yml`
- `.github/workflows/publish.yml`

---

### [P1] Add explicit `permissions` declarations to GitHub Actions workflows

**Problem**
Both workflow files omit `permissions:`, so every job runs with the GitHub Actions default token permissions, which may include `write` access to repository contents, packages, pull requests, and other resources depending on the organisation setting.

**Impact**
Over-privileged tokens increase blast radius if a step is compromised (e.g., a compromised `npm ci` dependency could push commits or modify releases).

**Solution**
Add a minimal `permissions` block to each workflow. For the test workflow, `contents: read` is sufficient. For the publish workflow, `contents: read` plus `id-token: write` (if using OIDC) or simply `contents: read`.

```yaml
permissions:
  contents: read
```

**Files**
- `.github/workflows/test.yml`
- `.github/workflows/publish.yml`

---

### [P1] Run container as a non-root user in the Dockerfile

**Problem**
The `dockerfile` contains no `USER` instruction, so all container processes run as `root`. If a dependency vulnerability allows container escape or file write, root-level access is granted inside the container.

**Impact**
Violates the principle of least privilege. Poses a security risk in any deployment where containers share a kernel or are exposed to untrusted input.

**Solution**
Use the built-in `node` user that ships with the official Node.js images:
```dockerfile
RUN chown -R node:node /usr/pkg/
USER node
```
Add this before the `CMD` instruction.

**Files**
- `dockerfile`

---

### [P2] Add a `SECURITY.md` with a vulnerability disclosure process

**Problem**
There is no `SECURITY.md` file, so there is no documented process for security researchers to responsibly disclose vulnerabilities.

**Impact**
Vulnerabilities may be reported publicly before maintainers have a chance to fix them, increasing exposure time.

**Solution**
Create a `SECURITY.md` at the repository root following the GitHub recommended template. Include supported versions, a contact email or GitHub private advisory URL, and expected response times.

**Files**
- `SECURITY.md` (new file)

---

### [P2] Add `npm audit` step to CI

**Problem**
Neither `test.yml` nor `publish.yml` runs `npm audit` to check for known vulnerabilities in dependencies.

**Impact**
A dependency with a known CVE can be shipped to consumers without any automated gate.

**Solution**
Add `- run: npm audit --audit-level=high` as a CI step (after `npm ci`) in both workflows.

**Files**
- `.github/workflows/test.yml`
- `.github/workflows/publish.yml`

---

## Performance

### [P2] Cache the pdfjs dynamic import to avoid re-importing on every call

**Problem**
`getPdfDocument` uses `await import('pdfjs-dist/legacy/build/pdf.mjs')` on every invocation of `pdfToPng`. Repeated dynamic imports of large libraries incur module-resolution and initialisation overhead for each conversion call.

**Impact**
Applications that call `pdfToPng` in a loop (e.g., processing a queue of PDFs) pay the dynamic-import cost on every call instead of once.

**Solution**
Cache the imported module at module scope:
```typescript
let pdfjsLib: typeof import('pdfjs-dist/legacy/build/pdf.mjs') | undefined;
async function getPdfjsLib() {
    pdfjsLib ??= await import('pdfjs-dist/legacy/build/pdf.mjs');
    return pdfjsLib;
}
```
Use `getPdfjsLib()` inside `getPdfDocument`.

**Files**
- `src/pdfToPng.ts`

---

### [P3] Eliminate redundant intermediate array in `pdfToPng`

**Problem**
Inside `pdfToPng`, results are first collected in a local `pngPageOutputs` array and then spread into the outer `pngPagesOutput` array with `pngPagesOutput.push(...pngPageOutputs)`. The intermediate array serves no purpose.

**Impact**
Minor memory overhead and code noise; spreading a potentially large array with `...` can also cause stack-overflow in extreme cases.

**Solution**
Remove `pngPagesOutput` and return `pngPageOutputs` directly, or populate a single array throughout:
```typescript
const pngPageOutputs: PngPageOutput[] = [];
// ... fill pngPageOutputs ...
return pngPageOutputs;
```

**Files**
- `src/pdfToPng.ts`

---

## Code Quality

### [P2] Replace the async IIFE in `getPdfFileBuffer` with a simple `if/else`

**Problem**
`getPdfFileBuffer` uses an unnecessarily complex `await (async () => { ... })()` inline IIFE to handle the file-read branch. This pattern obscures intent and is an anti-pattern in modern TypeScript.

**Impact**
Reduces readability; makes the control-flow harder to follow during code review and maintenance.

**Solution**
Replace with a straightforward `if/else`:
```typescript
if (typeof pdfFile === 'string') {
    const buffer = await fsPromises.readFile(pdfFile);
    if (buffer instanceof ArrayBuffer) return buffer;
    if (Buffer.isBuffer(buffer)) {
        return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
    }
    throw new Error(`Unsupported buffer type: ${Object.prototype.toString.call(buffer)}`);
}
return pdfFile;
```

**Files**
- `src/pdfToPng.ts` (`getPdfFileBuffer`)

---

### [P2] Remove the redundant `build:docker` script

**Problem**
`package.json` contains `"build:docker": "tsc --pretty --project tsconfig.json"`, which is byte-for-byte identical to the `"build"` script. It is referenced only in the `predocker:test` hook, which could use `build` directly.

**Impact**
Dead code increases maintenance surface and causes confusion about whether there should be a separate build config for Docker.

**Solution**
Remove `build:docker` and update `predocker:test` to reference `build` instead:
```json
"predocker:test": "npm run build",
```

**Files**
- `package.json`

---

### [P2] Remove `/* istanbul ignore next */` by adding a test for the undefined-content guard

**Problem**
`savePNGfile` contains `/* istanbul ignore next */` before the `if (pngPageOutput.content === undefined)` guard. This suppresses coverage rather than testing the branch.

**Impact**
The ignore comment signals a coverage gap; if the guard is incorrectly removed in the future, no test will catch it.

**Solution**
Add a unit test that constructs a `PngPageOutput` with `content: undefined` and passes it directly to `savePNGfile` (via a spy or by calling the helper through `pdfToPng` in a way that produces undefined content before saving). Remove the `/* istanbul ignore next */` comment.

**Files**
- `src/pdfToPng.ts` (remove comment)
- `__tests__/` (add test)

---

### [P3] Remove redundant `isString` variable in `getPdfFileBuffer`

**Problem**
`const isString: boolean = typeof pdfFile === 'string'` is computed only to be used once in an immediately following ternary. The variable adds noise without improving readability.

**Impact**
Minor code verbosity.

**Solution**
Inline the expression directly into the condition (see P2 IIFE refactor above).

**Files**
- `src/pdfToPng.ts`

---

### [P3] Fix inconsistent import style in `canvas.and.context.ts`

**Problem**
`src/interfaces/canvas.and.context.ts` uses two separate `import type` statements from the same module (`@napi-rs/canvas`), and the first one has a missing space before the closing brace: `import type { Canvas}`.

**Impact**
Inconsistent style; would fail Prettier formatting checks if enforced on this file.

**Solution**
Merge into a single import:
```typescript
import type { Canvas, SKRSContext2D } from '@napi-rs/canvas';
```

**Files**
- `src/interfaces/canvas.and.context.ts`

---

### [P3] Rename `dockerfile` to `Dockerfile` (conventional capitalisation)

**Problem**
The Docker build file is named `dockerfile` (all lowercase). The Docker CLI default and ecosystem convention is `Dockerfile` with a capital `D`. Tools like Docker Buildkit, GitHub Actions Docker build actions, and many IDE plugins use the capitalised name by default.

**Impact**
`docker build .` without `-f` may not find the file on case-sensitive filesystems or inside tooling that expects the conventional name.

**Solution**
Rename `dockerfile` → `Dockerfile` and update `package.json` scripts if they reference the file by name (they currently don't, since they use `-t` not `-f`).

**Files**
- `dockerfile` → `Dockerfile`
- `package.json` (verify no explicit `-f dockerfile` reference)

---

## Architecture

### [P2] Extract parallel and sequential processing into named helpers

**Problem**
`pdfToPng` is a ~166-line function that mixes orchestration logic (page list computation, folder creation) with both the parallel and sequential processing paths, duplicating the per-page rendering-and-save logic in both branches.

**Impact**
Violates the Single Responsibility Principle. The duplication of the `savePNGfile` + `returnPageContent` logic in the parallel and sequential branches creates two places to update on each future change.

**Solution**
Extract a `processAndSavePage` helper (or similar) that handles a single page's render-and-save cycle, and call it from both `Promise.all` and the sequential `for` loop:
```typescript
async function processAndSavePage(pdf, pageName, pageNumber, ...) {
    const pageOutput = await processPdfPage(...);
    if (outputFolder && !returnMetadataOnly) {
        await savePNGfile(pageOutput, outputFolder);
        if (!returnPageContent) pageOutput.content = undefined;
    }
    return pageOutput;
}
```

**Files**
- `src/pdfToPng.ts`

---

### [P2] Resolve CMap and font paths at call time rather than at module load

**Problem**
`DOCUMENT_INIT_PARAMS_DEFAULTS` in `src/const.ts` calls `normalizePath('./node_modules/pdfjs-dist/cmaps/')` at module-load time, resolving against `process.cwd()` when the module is first `import`ed. If the consuming application changes `process.cwd()` after importing the library (a valid pattern in some frameworks), the resolved paths will be wrong.

**Impact**
Silent rendering failures for CJK PDFs or PDFs with embedded fonts when `process.cwd()` differs between library load and use.

**Solution**
Move the `normalizePath` calls inside `propsToPdfDocInitParams` (or into `getPdfDocument`) so paths are resolved against the current working directory at invocation time, not at import time.

**Files**
- `src/const.ts`
- `src/propsToPdfDocInitParams.ts`

---

### [P3] Split `processPdfPage` into two dedicated functions

**Problem**
`processPdfPage` handles two fundamentally different code paths controlled by the `returnMetadataOnly` flag: one that only reads metadata and one that creates a canvas and renders. This violates the Single Responsibility Principle.

**Impact**
Increases cognitive complexity; changes to the metadata path risk accidentally affecting the render path and vice versa.

**Solution**
Create two private functions:
- `getPageMetadata(pdf, pageName, pageNumber, scale)`: metadata-only path.
- `renderPdfPage(pdf, pageName, pageNumber, scale, returnContent)`: full render path.

Call the appropriate one from the caller based on `returnMetadataOnly`.

**Files**
- `src/pdfToPng.ts`

---

## Testing

### [P1] Remove or convert `__tests__/pdf.to.file.test.js` to TypeScript

**Problem**
`__tests__/pdf.to.file.test.js` is the only JavaScript test in an otherwise all-TypeScript test suite. It imports from `'../out'` (the compiled output) rather than the source, is not type-checked, and is not subject to the ESLint TypeScript rules.

**Impact**
The test can silently fall out of sync with source types; it bypasses linting; it requires a prior `npm run build` to pass, adding friction in watch mode.

**Solution**
Convert to `pdf.to.file.compiled.test.ts` (or simply remove it if it duplicates `pdf.to.file.test.ts`). Update imports to reference `'../src'` and add proper type annotations.

**Files**
- `__tests__/pdf.to.file.test.js` (convert or remove)

---

### [P2] Increase coverage thresholds

**Problem**
`vitest.config.mjs` sets `branches: 70`, `lines: 80`, `functions: 80`. These relatively low thresholds allow significant untested behaviour to accumulate.

**Impact**
30% of branch logic can be untested without failing CI, increasing the risk of regressions in edge cases.

**Solution**
Raise the thresholds incrementally:
```js
thresholds: {
    lines: 90,
    functions: 90,
    branches: 85,
}
```
Add missing tests to satisfy the higher thresholds (see other testing tasks).

**Files**
- `vitest.config.mjs`

---

### [P2] Fix incorrect import path in `props.to.pdf.doc.init.params.test.ts`

**Problem**
`__tests__/props.to.pdf.doc.init.params.test.ts` imports `PdfToPngOptions` from `'../src/types/pdf.to.png.options'`, but that path does not exist. The interface lives at `src/interfaces/pdf.to.png.options.ts`.

**Impact**
TypeScript type-checking of the test file would fail. Currently this is masked because `tsconfig.json` only includes `src/**/*` and Vitest erases the type import at runtime.

**Solution**
Change the import:
```typescript
import type { PdfToPngOptions } from '../src/interfaces/pdf.to.png.options';
```
or use the barrel:
```typescript
import type { PdfToPngOptions } from '../src/interfaces';
```

**Files**
- `__tests__/props.to.pdf.doc.init.params.test.ts`

---

### [P2] Add test for `concurrencyLimit: 1` and edge-case batch sizes

**Problem**
No tests cover `concurrencyLimit: 1` (effectively sequential parallel mode), `concurrencyLimit` larger than the number of pages, or a PDF with a single page in parallel mode.

**Impact**
Off-by-one errors in the batching logic (`slice(i, i + concurrencyLimit)`) could go undetected.

**Solution**
Add parameterised tests:
- `concurrencyLimit: 1` on a multi-page PDF.
- `concurrencyLimit: 100` on a 2-page PDF.
- `processPagesInParallel: true` with a single page.

**Files**
- `__tests__/pdf.to.png.parallel.no.content.test.ts` or a new file

---

### [P2] Add tests for `viewportScale` boundary validation

**Problem**
Validation of `viewportScale` (must be a finite positive number) is tested for `0` and `-1` but not for `NaN`, `Infinity`, or non-numeric types passed as `any`.

**Impact**
Type-unsafe callers or misconfigured JavaScript usage could bypass the existing checks.

**Solution**
Add test cases:
```typescript
await expect(pdfToPng('test.pdf', { viewportScale: NaN })).rejects.toThrow('viewportScale');
await expect(pdfToPng('test.pdf', { viewportScale: Infinity })).rejects.toThrow('viewportScale');
```

**Files**
- `__tests__/coverage.test.ts` or a new file

---

### [P3] Add tests for `normalizePath` with Windows-style paths and special characters

**Problem**
`normalizePath.test.ts` does not test inputs containing backslashes, spaces, or special characters that could behave differently across platforms.

**Impact**
Windows users or CI agents may encounter subtle path issues not caught by the existing tests.

**Solution**
Add additional test cases for paths containing spaces, and verify that the trailing-separator rule holds regardless of input separator style.

**Files**
- `__tests__/normalizePath.test.ts`

---

## Documentation

### [P2] Add `CHANGELOG.md`

**Problem**
There is no changelog documenting what changed in each release. Users upgrading must inspect Git history or GitHub releases to understand what was added, changed, or removed.

**Impact**
Poor upgrade experience for consumers; increases support burden.

**Solution**
Create `CHANGELOG.md` following [Keep a Changelog](https://keepachangelog.com/en/1.0.0/) format, starting from the current version and backfilling at least the last few releases.

**Files**
- `CHANGELOG.md` (new file)

---

### [P2] Add `CONTRIBUTING.md`

**Problem**
There is no contributor guide. New contributors have no documented process for setting up the development environment, running tests, or submitting PRs.

**Impact**
Higher barrier to entry for first-time contributors; increases maintainer review burden from poorly structured contributions.

**Solution**
Create `CONTRIBUTING.md` covering: prerequisites, local setup (`npm ci`, `npm test`), coding conventions (TypeScript, Prettier, ESLint), commit message format, and PR checklist.

**Files**
- `CONTRIBUTING.md` (new file)

---

### [P3] Clarify optional vs required properties in the README options table

**Problem**
The options table in `README.md` shows `viewportScale: number` without indicating that it is optional (it should be `viewportScale?: number`). Several options marked without `?` in the table are actually optional in the interface.

**Impact**
Users may incorrectly believe certain options are required and always supply them, reducing code clarity.

**Solution**
Audit all options in the table and add `?` to optional entries. Alternatively, add an "Optional" column.

**Files**
- `README.md`

---

### [P3] Add `CITATION` or acknowledge zero-native-binary claim accurately

**Problem**
The README states "Zero Native Binaries — Pure JavaScript, works everywhere" but the runtime dependency `@napi-rs/canvas` is a native addon (compiled Rust/C++ via N-API). This claim is inaccurate.

**Impact**
Users on unsupported architectures or with restrictive environments may be surprised by native binary requirements.

**Solution**
Update the README to accurately state that `@napi-rs/canvas` is a pre-built native addon distributed as a binary, and list supported platforms/architectures.

**Files**
- `README.md`

---

## Dependencies

### [P1] Add `license-checker` as a dev dependency instead of using `npx`

**Problem**
`package.json` runs `npx license-checker` in the `test:license` script. `npx` fetches the latest version of the package at runtime, meaning the license check may behave differently on different runs or fail if the registry is unavailable.

**Impact**
Non-deterministic CI results; potential for supply-chain risk from an unversioned `npx` invocation.

**Solution**
Add `license-checker` to `devDependencies` at a fixed version and update the script:
```json
"test:license": "license-checker --production --onlyAllow \"ISC; MIT; ...\""
```

**Files**
- `package.json`

---

### [P2] Add Dependabot or Renovate configuration for automated dependency updates

**Problem**
There is no Dependabot (`.github/dependabot.yml`) or Renovate (`renovate.json`) configuration. Dependencies will only be updated on manual intervention.

**Impact**
Security vulnerabilities in dependencies may go unpatched; outdated dependencies accumulate and create larger upgrade gaps.

**Solution**
Add `.github/dependabot.yml` to enable automated PRs for npm and GitHub Actions:
```yaml
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

### [P3] Pin `@types/node` to a minor version for stability

**Problem**
`devDependencies` uses `"@types/node": "^25.3.1"`. Minor version bumps to `@types/node` occasionally introduce type errors that break the build unexpectedly.

**Impact**
`npm ci` is reproducible (uses the lock file), but `npm install` or a Dependabot update that bumps the lock file could silently break the build.

**Solution**
This is largely mitigated by `package-lock.json` and `npm ci`, but keep this in mind when updating. Consider using `~` range (`~25.3.1`) to restrict updates to patch releases only.

**Files**
- `package.json`

---

## DevOps / CI

### [P1] Add test run to the publish workflow before publishing

**Problem**
`publish.yml` runs `npm ci` → `npm run build` → `npm publish` with no test step. A build can succeed while tests are failing, meaning broken code can be published to npm.

**Impact**
Broken releases can reach consumers before the failure is noticed.

**Solution**
Add a test step before `npm publish`:
```yaml
- run: npm test
```

**Files**
- `.github/workflows/publish.yml`

---

### [P1] Add `pull_request` trigger to the test workflow

**Problem**
`test.yml` only triggers on `push`. Pull requests (especially from forks) will not have CI run automatically on open/update.

**Impact**
PRs can be merged without automated tests passing, silently breaking the main branch.

**Solution**
Add `pull_request:` to the `on:` trigger:
```yaml
on:
  push:
  pull_request:
```

**Files**
- `.github/workflows/test.yml`

---

### [P2] Test against multiple Node.js versions in CI

**Problem**
The test matrix only includes Node 24, but `package.json` declares `"engines": { "node": ">=20" }`. Users on Node 20 or 22 may encounter bugs that CI would not catch.

**Impact**
Regressions for supported Node versions go undetected until a consumer reports them.

**Solution**
Expand the matrix:
```yaml
matrix:
  node: [20, 22, 24]
```

**Files**
- `.github/workflows/test.yml`

---

### [P2] Publish test coverage reports as workflow artifacts

**Problem**
Coverage results are generated during `npm test` but are deleted by `npm run clean` and are never uploaded as workflow artifacts.

**Impact**
Historical coverage data is unavailable; it is impossible to spot trends in coverage degradation over time.

**Solution**
Add an artifact upload step after the test step:
```yaml
- name: Upload coverage
  uses: actions/upload-artifact@v4
  with:
    name: coverage
    path: coverage/
```

**Files**
- `.github/workflows/test.yml`

---

### [P3] Add `test:license` to the CI pipeline

**Problem**
The `test:license` script exists but is not run in any CI workflow. Dependency license compliance is only verified manually.

**Impact**
A newly introduced dependency with an incompatible license could be merged and published without detection.

**Solution**
Add a license check step to `test.yml`:
```yaml
- name: Check licenses
  run: npm run test:license
```

**Files**
- `.github/workflows/test.yml`

---

## Docker & Deployment

### [P1] Use a multi-stage Dockerfile to keep the final image lean

**Problem**
The single-stage `dockerfile` installs all dependencies (including dev dependencies: TypeScript, Vitest, ESLint, etc.) in the final image, producing a large image with unnecessary tooling.

**Impact**
Larger image size increases pull time, attack surface, and storage costs.

**Solution**
Use a two-stage build:
```dockerfile
# Stage 1: build / test
FROM node:22.19.0-slim AS test
WORKDIR /usr/pkg/
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build:test && npm run lint
CMD ["npm", "run", "docker:test"]
```
For a production-use image a second stage would `npm ci --omit=dev`.

**Files**
- `dockerfile` (rename to `Dockerfile` first)

---

### [P1] Switch to a slim base image

**Problem**
`FROM node:22.19.0` uses the full Debian-based Node.js image. The `node:22.19.0-slim` variant removes many unnecessary packages and is significantly smaller (typically 200–300 MB vs 1+ GB).

**Impact**
Larger images slow CI builds, cost more in registry storage, and have a larger attack surface.

**Solution**
Change the base image:
```dockerfile
FROM node:22.19.0-slim
```
If native addon compilation requires build tools, add `RUN apt-get install -y --no-install-recommends python3 make g++ && rm -rf /var/lib/apt/lists/*` only in the build stage.

**Files**
- `dockerfile`

---

### [P2] Add missing entries to `.dockerignore`

**Problem**
`.dockerignore` only excludes `node_modules`, `test-results`, `coverage`, `out`, and `.vscode`. The following directories and files are unnecessarily copied into the Docker build context: `test-data/`, `__tests__/`, `.github/`, `*.md`, `*.mjs`, `.prettierrc`, `.prettierignore`, `eslint.config.mjs`.

**Impact**
Larger Docker build context increases build time and copies test data (potentially large PDFs) into the image.

**Solution**
Extend `.dockerignore`:
```
.git
.github
__tests__
test-data
test-results
coverage
out
.vscode
*.md
.prettierrc
.prettierignore
eslint.config.mjs
```

**Files**
- `.dockerignore`

---

### [P2] Set `ENV NODE_ENV` in the Dockerfile

**Problem**
The Dockerfile does not set the `NODE_ENV` environment variable. Node.js and many libraries behave differently based on this value (e.g., express disables caching in non-production mode, some logging libraries change verbosity).

**Impact**
Undefined runtime behaviour; potential performance issues if the consuming environment expects production defaults.

**Solution**
Add to the Dockerfile (stage that runs tests):
```dockerfile
ENV NODE_ENV=test
```
For a production image use `ENV NODE_ENV=production`.

**Files**
- `dockerfile`

---

### [P3] Add a `docker-compose.yml` for local development and testing

**Problem**
There is no `docker-compose.yml`. Running the Docker test environment requires memorising or referencing the npm script chain (`npm run test:docker`), and there is no way to compose services or mount volumes declaratively.

**Impact**
Higher friction for developers wanting to run tests in Docker locally; no standard entry point for future CI service dependencies.

**Solution**
Create a minimal `docker-compose.yml`:
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

### [P3] Add a `HEALTHCHECK` instruction to the Dockerfile

**Problem**
The Dockerfile has no `HEALTHCHECK` instruction. Container orchestrators (Kubernetes, Docker Compose with health checks, ECS) have no way to determine whether the container is healthy.

**Impact**
In orchestrated environments, the container is always assumed healthy, even if the process has crashed or stalled.

**Solution**
For a test-runner container this is less critical, but for completeness:
```dockerfile
HEALTHCHECK --interval=30s --timeout=10s --retries=3 \
    CMD node -e "process.exit(0)" || exit 1
```

**Files**
- `dockerfile`

---

## Developer Experience

### [P2] Add `.nvmrc` to standardise the Node.js version

**Problem**
`package.json` declares `"engines": { "node": ">=20" }` but there is no `.nvmrc` or `.node-version` file. Developers using `nvm` or `fnm` must manually select the correct version.

**Impact**
Inconsistent Node.js versions across developer machines can cause subtle build differences or missing native binary support.

**Solution**
Create `.nvmrc` with the recommended LTS version:
```
22
```

**Files**
- `.nvmrc` (new file)

---

### [P2] Add `.editorconfig` for consistent cross-editor formatting

**Problem**
There is no `.editorconfig` file. While Prettier handles JS/TS formatting, editors may use different indent sizes or line endings for other file types (YAML, Markdown, Dockerfile).

**Impact**
Inconsistent formatting in non-TypeScript files (CI YAML, README, Dockerfile) across different editors and contributors.

**Solution**
Create `.editorconfig`:
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

### [P3] Add pre-commit hooks with `husky` and `lint-staged`

**Problem**
There are no pre-commit hooks to run linting or formatting automatically before a commit is made. Developers can commit code that fails the CI lint check.

**Impact**
Developers discover lint failures only after pushing, slowing the feedback loop.

**Solution**
Add `husky` and `lint-staged` as dev dependencies and configure a pre-commit hook:
```json
// package.json
"lint-staged": {
    "src/**/*.ts": ["eslint --fix", "prettier --write"],
    "__tests__/**/*.ts": ["prettier --write"]
}
```
Run `npx husky init` to create `.husky/pre-commit`.

**Files**
- `package.json`
- `.husky/pre-commit` (new)

---

### [P3] Add a `prepublishOnly` script to prevent accidental unbuilt publishes

**Problem**
`package.json` has no `prepublishOnly` script. Running `npm publish` locally (outside CI) would publish without rebuilding, potentially shipping stale output from `out/`.

**Impact**
Stale or incorrect compiled output could be published to npm if `npm publish` is run locally without first running `npm run build`.

**Solution**
Add:
```json
"prepublishOnly": "npm run build"
```

**Files**
- `package.json`

---

### [P3] Include `__tests__` TypeScript files in type-checking scope

**Problem**
`tsconfig.json` only includes `src/**/*`. The `__tests__/**/*.ts` files are not type-checked during `npm run build:test`, meaning type errors in tests (e.g., the incorrect import path in `props.to.pdf.doc.init.params.test.ts`) are silently ignored.

**Impact**
Type errors in tests accumulate undetected; incorrect import paths and wrong types in test files are only caught at runtime.

**Solution**
Create a `tsconfig.test.json` that extends the base config and includes the test files, then add a `build:test:all` script that type-checks both source and tests. Alternatively, add a Vitest type-check step to CI.

**Files**
- `tsconfig.json` or new `tsconfig.test.json`
- `package.json`
- `.github/workflows/test.yml`
