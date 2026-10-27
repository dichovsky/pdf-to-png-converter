# Contributing to pdf-to-png-converter

Thank you for taking the time to contribute!

## Prerequisites

- **Node.js 24+** for the contributor toolchain (`.nvmrc`: `nvm use`); the published runtime supports Node.js 22.13+
- **npm 11.11+** for development, because older releases drop the `libc` fields from `package-lock.json` when they rewrite it (the publish workflow pins npm 12.0.2)

## Getting Started

```sh
git clone https://github.com/dichovsky/pdf-to-png-converter.git
cd pdf-to-png-converter
npm ci
```

## Running Tests

```sh
npm run check         # full validation gate: types, format, lint, licenses, and tests
npm test              # run tests with coverage only
npm run test:fast     # fast Vitest loop without coverage
npm run lint          # ESLint on src/, __tests__/ and scripts/ using eslint.config.mjs; warnings fail (--max-warnings 0)
npm run build:test    # type-check src/, __tests__/ and scripts/ (all but scripts/benchmark.ts, which imports the built out/), no emit
npm run build:strict  # stricter dependency-boundary type-check of the same files
npm run test:license  # verify production dependency licenses
```

Run a single test file:

```sh
npx vitest run __tests__/<filename>.test.ts
```

The visual-comparison tests compare each render with a golden PNG under `test-data/`. A missing golden fails the test. It is not created automatically from the render under test, because that would compare the render with itself. To create a missing golden on your machine, run the test with `UPDATE_GOLDENS=1`, then review the new image and commit it:

```sh
UPDATE_GOLDENS=1 npx vitest run __tests__/<filename>.test.ts
```

Creation is refused when `CI` is set, and an existing golden is never overwritten. To refresh one deliberately, delete it, rerun the test with the variable, review the image, and commit it. The visual tests accept fewer than `RELAXED_COMPARE_DIFFERENCE_THRESHOLD` (6) mismatched pixels (`__tests__/test-data-constants.ts`), so a golden created on one platform can differ slightly from a render on another; the Ubuntu CI run shows whether it still matches. The Ubuntu CI jobs also fail any run that leaves a new or modified file under `test-data/`.

## Strict type-check

`npm run build:strict` runs `tsc` against `tsconfig.strict.json`, which disables `skipLibCheck` to surface type regressions in `pdfjs-dist` and `@napi-rs/canvas`. It also walks the declarations of `png-visual-compare`, which the tests import: `__tests__/pngjs.d.ts` is a minimal stub that makes the `pngjs` type import in them resolve, and strict mode fails without it, so read its header before changing or deleting it. This step blocks CI and is part of the explicit `npm run check` gate used by `prepublishOnly`. A plain `npm test` runs the test suite only.

If `build:strict` fails because of an upstream type, suppress on the line immediately above the failing call or assignment with `// @ts-expect-error <reason> — upstream <pkg>@<range>`. `@ts-expect-error` is self-cleaning: when the upstream typing is fixed, strict reports the unused suppression and you can remove the line.

**Exception — when to use `@ts-ignore` instead.** `@ts-expect-error` fails if no error exists. If the upstream type error is only visible under `build:strict`'s `skipLibCheck: false` (i.e. it disappears when `build:test` runs the same file with `skipLibCheck: true`), `@ts-expect-error` reports as an "unused directive" under `build:test` and breaks the validation gate. In that case, use `// eslint-disable-next-line @typescript-eslint/ban-ts-comment` + `// @ts-ignore <reason> — upstream <pkg>@<range>` instead. The canonical example is the `page.render(...)` call in `src/pageRenderer.ts`, where the `SKRSContext2D` vs `CanvasRenderingContext2D` mismatch is hidden by `skipLibCheck:true`.

Do not work around `build:strict` failures by adding `continue-on-error` to the workflow or `|| true` to the script.

## pdf.js dependency upgrades

`pdfjs-dist` is both a type boundary and the rendering engine, so an upgrade must pass more than the package-manager checks:

- `__tests__/pdfjs.assets.test.ts` exact-checks the installed `cmaps`, `standard_fonts`, and `wasm` directory contents, and the set of top-level `pdfjs-dist` directories, against `__tests__/test-data-constants.ts`. Update those lists only after reviewing the upstream package-layout diff; added files and added top-level directories are deliberately review-gated rather than accepted as a subset. Review every top-level folder, not only the known ones: the loader must pass pdf.js a location for each asset folder it reads in Node (`iccs` is deliberately not wired: pdf.js turns ICC wasm off in Node, so it never reads that folder), and a missed folder (`wasm`) left CCITT and JBIG2 images blank in issue #278. The loader reads these folders from the installed `pdfjs-dist` package, never from the working directory.
- Run the visual-comparison suites against the existing reference PNGs. A missing golden fails the test, and the Ubuntu CI jobs fail any run that leaves a new or modified file under `test-data/`. Do not create or refresh golden files merely to make an upgrade pass. If a rendering change is understood and intentional, refresh the golden as described under "Running Tests" and commit the reviewed image.
- Run the real worker-thread integration tests so the CommonJS-to-legacy-ESM import and per-worker pdf.js lifecycle stay covered. Worker and main-thread PNGs are byte-identical, so output alone cannot show which path rendered: these tests spy on `renderPagesInWorkerPool` and `renderPdfPage` to assert that the pool ran. For a new worker-mode case in `__tests__/pdf.to.png.worker.threads.test.ts`, convert through its `pdfToPngInWorkers()` helper.
- Finish from a clean install with `npm run check`, `npm run build`, `npm audit --audit-level=high`,
  `npm audit --omit=dev --audit-level=high`, and `npm pack --dry-run --ignore-scripts --json`.

## Coding Conventions

- **Language:** TypeScript (strict mode). All source lives under `src/`.
- **Formatting:** 4-space indent, single quotes, trailing commas, 140-char line width.
- **Imports:** use `.js` extensions in all relative imports (required by `"moduleResolution": "node16"`).
- **Type imports:** use `import type` for type-only imports.
- **Return types:** all functions in `src/` need explicit return type annotations.
- **Accessibility:** all class members need explicit `public` / `private` modifiers (constructors omit `public`).
- **Pre-commit hook:** `npm ci` installs a Husky hook that runs `lint-staged`: ESLint (`--max-warnings 0`) and Prettier on staged TypeScript in `src/`, `__tests__/` and `scripts/`, and Prettier on other staged formatted files (`js`, `mjs`, `cjs`, `json`, `md`, `yml`, `yaml`, and `.prettierrc`), matching the formatting and lint steps of `npm run check`.

## Commit Messages

Follow [Conventional Commits](https://www.conventionalcommits.org/):

```
<type>: <short description>

<optional body>
```

Types: `feat`, `fix`, `refactor`, `docs`, `test`, `chore`, `perf`, `ci`

## Pull Request Checklist

- [ ] `npm run check` passes locally
- [ ] New behaviour is covered by tests (coverage thresholds: statements, lines, functions, and branches 98%)
- [ ] `CHANGELOG.md` updated under `## [Unreleased]` (or moved into the release section when cutting a release)

## Releasing

Releases are published to npm by `.github/workflows/publish.yml` when a non-prerelease GitHub Release is **published**. The workflow pins npm 12.0.2 and uses npm **Trusted Publishing (OIDC)** — there is no long-lived `NPM_TOKEN`; the workflow mints a short-lived token and attaches build [provenance](https://docs.npmjs.com/generating-provenance-statements) automatically.

**One-time setup (maintainer):** on npmjs.com, configure the package's _Trusted Publisher_ to GitHub Actions for `dichovsky/pdf-to-png-converter`, workflow `publish.yml` (leave _Environment_ blank).

**Cutting a release:**

1. On a release branch, bump the version with `npm version <x.y.z> --no-git-tag-version` (updates `package.json` + `package-lock.json`).
2. Move the `## [Unreleased]` entries in `CHANGELOG.md` into a new `## [x.y.z] — <date>` section, then update the comparison links at the bottom of the file: `[Unreleased]` compares `vx.y.z...HEAD`, and a new `[x.y.z]` link compares the previous tag with `vx.y.z`.
3. Run `npm run check && npm run build`, then `RELEASE_TAG=vx.y.z npm run release:precheck`. The precheck confirms the tag/version match, version availability, versioned changelog entry, empty `[Unreleased]` section, that the tarball contains the required compiled artifacts and every `main`, `types`, `bin` and `exports` target from `package.json`, that each `bin` file starts with `#!/usr/bin/env node`, and that no source, tests, or build metadata ship.
4. Merge the branch, then create a non-prerelease GitHub Release tagged exactly `vx.y.z`.
5. The workflow runs `release:precheck` → `npm publish --provenance` → `release:postcheck` (verifies the published version, the `latest` dist-tag, the provenance attestation, a clean-install smoke test, and a real conversion in worker-thread mode against the installed package). The postcheck retries a registry read only while the package or version is not visible yet (E404 or no result). Any other npm error fails at once with npm's own message, a visible version without a provenance attestation fails without a retry, and running out of attempts reports the last npm response.

## Reporting Bugs / Security Issues

- **Bugs:** open a [GitHub issue](https://github.com/dichovsky/pdf-to-png-converter/issues)
- **Security vulnerabilities:** follow the process described in [SECURITY.md](SECURITY.md)
