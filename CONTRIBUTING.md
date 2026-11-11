# Contributing to pdf-to-png-converter

Thank you for your contribution.

## Prerequisites

- **Node.js 26+** for the contributor toolchain (`.nvmrc`: run `nvm use`). The published runtime supports Node.js 24+.
- **npm 11.11+** for development. Older npm versions remove the `libc` fields from `package-lock.json` when they rewrite the file. The publish workflow pins npm 12.2.2.

## Getting Started

```sh
git clone https://github.com/dichovsky/pdf-to-png-converter.git
cd pdf-to-png-converter
npm ci
```

## Running Tests

```sh
npm run check         # Run the full validation gate: types, format, lint, licenses, and tests
npm test              # Run tests with coverage only
npm run test:fast     # Run Vitest without coverage
npm run lint          # Run ESLint on src/, __tests__/, and scripts/ (--max-warnings 0)
npm run build:test    # Type-check src/, __tests__/, and scripts/ (except scripts/benchmark.ts), no emit
npm run build:strict  # Run the strict dependency-boundary type-check on the same files
npm run test:license  # Check production dependency licenses
```

Run one test file:

```sh
npx vitest run __tests__/<filename>.test.ts
```

The visual-comparison tests compare each rendered image with a golden PNG in `test-data/`. If a golden PNG is missing, the test fails. The test helper does not create missing golden files automatically, because that would compare the output with itself.

To create a missing golden PNG on your machine, run the test with `UPDATE_GOLDENS=1`:

```sh
UPDATE_GOLDENS=1 npx vitest run __tests__/<filename>.test.ts
```

Review the new image and commit it. The helper refuses `UPDATE_GOLDENS=1` when `CI` is set, and it never overwrites an existing golden file. To replace an existing golden PNG, delete the file first, run the test with `UPDATE_GOLDENS=1`, review the image, and commit it.

The visual tests allow fewer than `RELAXED_COMPARE_DIFFERENCE_THRESHOLD` (6) different pixels (`__tests__/test-data-constants.ts`). This tolerance handles small platform rendering differences. The Ubuntu CI jobs verify that golden files match on Linux. The Ubuntu CI jobs also fail if a test run adds or modifies any file in `test-data/`.

## Strict type-check

`npm run build:strict` runs `tsc` with `tsconfig.strict.json`. This configuration sets `skipLibCheck: false` to find type errors in `pdfjs-dist`, `@napi-rs/canvas`, and `png-visual-compare`. The stub file `__tests__/pngjs.d.ts` resolves the `pngjs` type import in `png-visual-compare`. Strict mode fails without this stub. Read the header in `__tests__/pngjs.d.ts` before you change or delete it.

`build:strict` blocks CI and runs as part of `npm run check` and `prepublishOnly`. `npm test` runs only the test suite.

If an upstream type causes a `build:strict` error, add a suppression comment on the line directly above the failing code:

```ts
// @ts-expect-error <reason> — upstream <pkg>@<range>
```

When an upstream update fixes the type, `tsc` reports the unused `@ts-expect-error` directive so you can remove it.

**When to use `@ts-ignore` instead:** `@ts-expect-error` fails if no type error occurs. Some upstream type errors appear only when `skipLibCheck` is `false` (`build:strict`) and disappear when `skipLibCheck` is `true` (`build:test`). In that case, `@ts-expect-error` breaks `build:test`. Use these two lines instead:

```ts
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore <reason> — upstream <pkg>@<range>
```

For example, `page.render(...)` in `src/pageRenderer.ts` uses `@ts-ignore` because `skipLibCheck: true` hides the mismatch between `SKRSContext2D` and `CanvasRenderingContext2D`.

Do not bypass `build:strict` failures with `continue-on-error` in CI workflows or `|| true` in scripts.

## pdf.js dependency upgrades

`pdfjs-dist` provides both TypeScript declarations and the rendering engine. Follow these steps when you upgrade `pdfjs-dist`:

- Check `__tests__/pdfjs.assets.test.ts`. This test compares the installed `cmaps`, `standard_fonts`, and `wasm` directory contents, plus the top-level `pdfjs-dist` directories, against `__tests__/test-data-constants.ts`. Review the upstream package diff before you update those lists. Inspect every top-level folder in `pdfjs-dist`, not only `cmaps`, `standard_fonts`, and `wasm` (issue #278 occurred because `wasm` was missed). The `iccs` folder is intentionally omitted because pdf.js disables ICC WebAssembly in Node.js and never reads that folder. The loader always resolves asset folders from the installed `pdfjs-dist` package, never from the working directory.
- Run the visual-comparison tests against the existing golden PNGs in `test-data/`. Do not create or replace golden files only to make an upgrade pass. If an upstream rendering change is intentional, delete the affected golden file, regenerate it with `UPDATE_GOLDENS=1`, review the image, and commit it.
- Run the worker-thread integration tests in `__tests__/pdf.to.png.worker.threads.test.ts`. Worker threads and the main thread produce identical PNG bytes. These tests use spies on `renderPagesInWorkerPool` and `renderPdfPage` (through the `pdfToPngInWorkers()` helper) to verify that the worker pool ran.
- Run a clean install and execute these verification commands:
    - `npm ci`
    - `npm run check`
    - `npm run build`
    - `npm audit --audit-level=high`
    - `npm audit --omit=dev --audit-level=high`
    - `npm pack --dry-run --ignore-scripts --json`

## Coding Conventions

- **Language:** TypeScript in strict mode. Place all production source files in `src/`.
- **Formatting:** Use 4-space indentation, single quotes, trailing commas, and a 140-character line limit.
- **Imports:** Use `.js` extensions in all relative imports (`"moduleResolution": "node16"` requires this).
- **Type imports:** Use `import type` for type-only imports.
- **Return types:** Add explicit return type annotations to all functions in `src/`.
- **Accessibility:** Add explicit `public` or `private` modifiers to class members (omit `public` on constructors).
- **Pre-commit hook:** `npm ci` installs a Husky pre-commit hook that runs `lint-staged`. It runs ESLint (`--max-warnings 0`) and Prettier on staged TypeScript files in `src/`, `__tests__/`, and `scripts/`. It also runs Prettier on staged `js`, `mjs`, `cjs`, `json`, `md`, `yml`, `yaml`, and `.prettierrc` files.

## Commit Messages

Use [Conventional Commits](https://www.conventionalcommits.org/):

```
<type>: <short description>

<optional body>
```

Allowed types: `feat`, `fix`, `refactor`, `docs`, `test`, `chore`, `perf`, `ci`.

## Pull Request Checklist

- [ ] `npm run check` passes locally
- [ ] Tests cover all new behavior (minimum 98% coverage for statements, lines, functions, and branches)
- [ ] `CHANGELOG.md` includes the changes under `## [Unreleased]` (or under the new version heading for a release PR)

## Releasing

The `.github/workflows/publish.yml` workflow publishes the package to npm when you publish a non-prerelease GitHub Release. The workflow pins npm 12.2.2 and uses npm **Trusted Publishing (OIDC)**. It does not use a long-lived `NPM_TOKEN`. GitHub Actions requests a short-lived OIDC token and attaches build [provenance](https://docs.npmjs.com/generating-provenance-statements) automatically.

**One-time setup (maintainer):** On npmjs.com, set the package _Trusted Publisher_ to GitHub Actions for `dichovsky/pdf-to-png-converter` and workflow `publish.yml`. Leave _Environment_ blank.

**Cutting a release:**

1. Create a release branch and update the version with `npm version <x.y.z> --no-git-tag-version`. This command updates `package.json` and `package-lock.json`.
2. In `CHANGELOG.md`, move the entries from `## [Unreleased]` into a new `## [x.y.z] — <date>` section. Update the comparison links at the bottom of `CHANGELOG.md`: set `[Unreleased]` to compare `vx.y.z...HEAD`, and add a `[x.y.z]` link that compares the previous tag with `vx.y.z`.
3. Run `npm run check && npm run build`, then run `RELEASE_TAG=vx.y.z npm run release:precheck`. The precheck verifies that the tag matches `package.json`, the version is not published yet, `CHANGELOG.md` has the version section and an empty `[Unreleased]` section, the tarball contains all `main`, `types`, `bin`, and `exports` targets from `package.json`, each `bin` file starts with `#!/usr/bin/env node`, and no source or test files are packed.
4. Merge the release branch into `main`. Create and publish a non-prerelease GitHub Release with the exact tag `vx.y.z`.
5. The publish workflow runs `release:precheck`, `npm publish --provenance`, and `release:postcheck`. The postcheck verifies the published version, the `latest` dist-tag, the provenance attestation, a clean install in a temporary directory, and a worker-thread conversion test. Because npm indexes new releases asynchronously, `release:postcheck` retries registry lookups for up to 5 minutes when npm returns `E404` or empty output. Any other npm error fails immediately. A published version without provenance also fails immediately. If `npm publish` succeeds but `release:postcheck` times out, do not re-run the workflow (`release:precheck` will fail because the version already exists). Instead, run `npm run release:postcheck` locally from the release commit.

## Reporting Bugs / Security Issues

- **Bugs:** Open a [GitHub issue](https://github.com/dichovsky/pdf-to-png-converter/issues).
- **Security vulnerabilities:** Follow the instructions in [SECURITY.md](SECURITY.md).
