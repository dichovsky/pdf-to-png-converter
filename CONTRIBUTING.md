# Contributing to pdf-to-png-converter

Thank you for your contribution.

## Prerequisites

- **Node.js 26+** for the contributor toolchain (`.nvmrc`: run `nvm use`). The published runtime supports Node.js 24+.
- **npm 11.11+** for development. Older npm versions remove the `libc` fields from `package-lock.json` when they rewrite the file. The publish workflow pins npm 12.2.3.

## Getting Started

```sh
git clone https://github.com/dichovsky/pdf-to-png-converter.git
cd pdf-to-png-converter
npm ci
```

On Windows, use `npm ci --force` for the development install. The visual test dependency declares support for macOS and Linux and requires Node.js 26. CI runs the full tests on Node.js 24 and 26, then checks a strict production install and a real render on Node.js 24 and Windows.

## Running Tests

```sh
npm run check         # Run the full validation gate: types, format, lint, licenses, and tests
npm test              # Run tests with coverage only
npm run test:fast     # Run Vitest without coverage
npm run lint          # Run Oxlint on src/, __tests__/, and scripts/ (--deny-warnings)
npm run build:test    # Type-check src/, __tests__/, and scripts/ and the Vitest configuration, no emit
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

The tests use `png-visual-compare` 8.0.0 to count mismatched pixels with pixelmatch 8. The per-pixel color threshold is `0.074` so the comparison detects a shift from mid-gray to teal. The helper also requires the two PNGs to have identical dimensions.

The visual tests require the number of different pixels to be below `RELAXED_COMPARE_DIFFERENCE_THRESHOLD` (6) (`__tests__/test-data-constants.ts`). This tolerance handles small platform rendering differences. The Ubuntu CI jobs verify that golden files match on Linux. The Ubuntu CI jobs also fail if a test run adds or modifies any file in `test-data/`.

## Strict type-check

`npm run build:strict` runs `tsc` with `tsconfig.strict.json`. This configuration sets `skipLibCheck: false` to check dependency declarations, including the PDF and canvas types.

`build:strict` blocks CI and runs as part of `npm run check` and `prepublishOnly`. `npm test` runs only the test suite.

If an upstream type causes a `build:strict` error, add a suppression comment on the line directly above the failing code:

```ts
// @ts-expect-error <reason> — upstream <pkg>@<range>
```

When an upstream update fixes the type, `tsc` reports the unused `@ts-expect-error` directive so you can remove it.

**When to use `@ts-ignore` instead of `@ts-expect-error`:** `@ts-expect-error` fails if no type error occurs. Some upstream type errors occur only when `skipLibCheck` is `false` (`build:strict`). They do not occur when `skipLibCheck` is `true` (`build:test`). In that condition, `@ts-expect-error` breaks `build:test`. Thus, do not use `@ts-expect-error`. Use these two lines:

```ts
// oxlint-disable-next-line typescript/ban-ts-comment
// @ts-ignore <reason> — upstream <pkg>@<range>
```

For example, `page.render(...)` in `src/pageRenderer.ts` uses `@ts-ignore` because `skipLibCheck: true` hides the mismatch between `SKRSContext2D` and `CanvasRenderingContext2D`.

Do not bypass `build:strict` failures with `continue-on-error` in CI workflows or `|| true` in scripts.

## pdf.js dependency upgrades

`pdfjs-dist` supplies the TypeScript declarations and the rendering engine. Follow these steps when you upgrade `pdfjs-dist`:

- Check `__tests__/pdfjs.assets.test.ts`. This test compares the installed `cmaps`, `standard_fonts`, and `wasm` directory contents, plus the top-level `pdfjs-dist` directories, against `__tests__/test-data-constants.ts`. Review the upstream package diff before you update those lists. Inspect all top-level folders in `pdfjs-dist`, not only `cmaps`, `standard_fonts`, and `wasm` (issue #278 occurred because `wasm` was missed). The `iccs` folder is intentionally omitted because pdf.js disables ICC WebAssembly in Node.js and never reads that folder. The loader always resolves asset folders from the installed `pdfjs-dist` package, never from the working directory.
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
- **Pre-commit hook:** Husky runs lint-staged. Oxlint checks staged TypeScript and fails on warnings. Oxfmt formats staged TypeScript, JavaScript, JSON, Markdown, and YAML.

## Writing documentation

Write repository prose with the writing rules of [ASD-STE100 Simplified Technical English, Issue 9 (January 2025)](https://asd-ste100.org/STE_downloads.html). Part 1 of the standard gives the writing rules. Part 2 gives the dictionary. The standard is copyrighted by ASD. Do not copy dictionary entries into this repository.

**Scope:** `README.md`, `CONTRIBUTING.md`, `SECURITY.md`, `docs/ARCHITECTURE.md`, `BACKLOG.md`, and the public JSDoc in `src/types.ts`.

**Not in scope:** `CHANGELOG.md`, `BACKLOG-ARCHIVE.md`, and `RELEASE_PLAN.md` (historical records), `LICENSE` (legal text), agent instruction files (`CLAUDE.md`, `.github/copilot-instructions.md`, and the Agent Rules note in `BACKLOG.md`), and runtime strings (error messages, CLI help and output, and process warnings). Tests and users depend on the exact runtime strings.

### Rules

- Write a maximum of 20 words in a procedural sentence and 25 words in a descriptive sentence.
- Write one topic in each paragraph, with a maximum of 6 sentences.
- Write instructions in the imperative. Write one instruction in each sentence, unless the actions occur at the same time.
- Use the active voice in procedures. Use the active voice as much as possible in descriptions.
- Keep the articles (`the`, `a`, `an`). Do not use a telegraphic style.
- Use vertical lists for sequences, conditions, and alternatives.
- Keep instructions separate from descriptive text.
- Start a warning with a short command. Then give the reason. Do not make the hazard weaker.
- Use one word for one meaning, and one word for one concept.
- Do not use idioms. Do not use a phrasal verb when a single verb has the same meaning.
- Do not use `it`, `this`, or `that` when the noun is not clear.
- Before you change a word, find its entry in Part 2 of the standard. Use the approved alternative that keeps the meaning.

### Terminology

STE Rules 1.5 and 1.12 let you use technical nouns and technical verbs that the dictionary does not contain. This project uses the terms in this table. Keep these terms. Do not use the "Do not use" terms for the same concept.

| Term                           | Category       | Meaning                                                                        | Do not use                                |
| ------------------------------ | -------------- | ------------------------------------------------------------------------------ | ----------------------------------------- |
| `pdf-to-png-converter`         | Product name   | This package and its CLI                                                       | the tool, the converter                   |
| pdf.js, `pdfjs-dist`           | Product name   | The PDF engine (pdf.js) and its npm package (`pdfjs-dist`)                     | PDF.js, pdfjs                             |
| `@napi-rs/canvas`              | Product name   | The native canvas package                                                      | napi canvas                               |
| render                         | Technical verb | Draw a PDF page into a canvas                                                  | paint, draw (for pages)                   |
| convert                        | Technical verb | Make PNG output or metadata from a PDF (one `pdfToPng()` call)                 | transform, export                         |
| conversion                     | Technical noun | One call to `pdfToPng()`                                                       | transformation, export                    |
| encode                         | Technical verb | Make PNG bytes from a canvas                                                   | compress, serialize                       |
| decode                         | Technical verb | Make pixels from an embedded image                                             | unpack                                    |
| run                            | Technical verb | Start and execute a command, test, script, or workflow                         | operate, launch                           |
| return, throw, reject, resolve | Technical verb | JavaScript function and promise results                                        | give back, raise                          |
| validate, check, verify        | Technical verb | Test a value or state against a rule                                           | ensure, confirm                           |
| load                           | Technical verb | Read a module, document, or worker entry into memory                           | import (except for the `import()` syntax) |
| emit                           | Technical verb | Send a Node.js process warning                                                 | raise, fire                               |
| pass                           | Technical verb | Give an argument, option, or flag to a function or command                     | supply (for arguments)                    |
| page                           | Technical noun | One page of the PDF document                                                   | sheet                                     |
| option                         | Technical noun | A property of `PdfToPngOptions`                                                | setting, parameter (for options)          |
| flag                           | Technical noun | A CLI argument that starts with `--`                                           | switch                                    |
| main thread, worker thread     | Technical noun | The Node.js thread that calls `pdfToPng()`, and a `node:worker_threads` thread | background thread                         |
| process                        | Technical noun | An operating-system process                                                    | program                                   |
| metadata                       | Technical noun | Page number, name, width, height, and rotation without image data              | info, details                             |
| golden PNG                     | Technical noun | A committed reference image for visual tests                                   | snapshot, baseline                        |
| should, may, never, must       | Exception      | Requirement strength. Keep these words as written                              | (no replacement)                          |

### Validate your changes

1. Run `npm run format:check`.
2. Run `npm run lint` and `npm run build:test` if you changed JSDoc.
3. Run the tests that pin documented values. Example: `npx vitest run __tests__/pdf.to.png.options.validation.test.ts` pins the `Default:` values in `src/types.ts`.
4. Read the full diff. Make sure that no limit, default, condition, warning, or requirement word changed.

Sentence-length and word-list checks help the review. They do not prove that the text obeys the standard.

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

The `.github/workflows/publish.yml` workflow publishes the package to npm when you publish a non-prerelease GitHub Release. The workflow pins npm 12.2.3 and uses npm **Trusted Publishing (OIDC)**. It does not use a long-lived `NPM_TOKEN`. GitHub Actions requests a short-lived OIDC token and attaches build [provenance](https://docs.npmjs.com/generating-provenance-statements) automatically.

**One-time setup (maintainer):** On npmjs.com, set the package _Trusted Publisher_ to GitHub Actions for `dichovsky/pdf-to-png-converter` and workflow `publish.yml`. Leave _Environment_ blank.

**Cutting a release:**

1. Create a release branch and update the version with `npm version <x.y.z> --no-git-tag-version`. This command updates `package.json` and `package-lock.json`.
2. In `CHANGELOG.md`, move the entries from `## [Unreleased]` into a new `## [x.y.z] — <date>` section. Update the comparison links at the bottom of `CHANGELOG.md`: set `[Unreleased]` to compare `vx.y.z...HEAD`, and add a `[x.y.z]` link that compares the previous tag with `vx.y.z`.
3. Run `npm run check && npm run build`, then run `RELEASE_TAG=vx.y.z npm run release:precheck`. The precheck verifies these conditions:
    - The tag matches `package.json`.
    - The version is not published at this time.
    - `CHANGELOG.md` has the version section and an empty `[Unreleased]` section.
    - The tarball contains all `main`, `types`, `bin`, and `exports` targets from `package.json`.
    - Each `bin` file starts with `#!/usr/bin/env node`.
    - The tarball contains no source or test files.
4. Merge the release branch into `main`. Create and publish a non-prerelease GitHub Release with the exact tag `vx.y.z`.
5. The publish workflow runs `release:precheck`, `npm publish --provenance`, and `release:postcheck`. The postcheck verifies the published version, the `latest` dist-tag, the provenance attestation, a clean install in a temporary directory, and a worker-thread conversion test. npm indexes new releases asynchronously. Thus, `release:postcheck` retries registry lookups for a maximum of 5 minutes when npm returns `E404` or empty output. All other npm errors fail immediately. A published version without provenance also fails immediately.

    **If `npm publish` succeeds but `release:postcheck` times out, do not re-run the workflow.** If you re-run it, `release:precheck` fails because the version exists in the registry. Run `npm run release:postcheck` locally from the release commit.

## Reporting Bugs / Security Issues

- **Bugs:** Open a [GitHub issue](https://github.com/dichovsky/pdf-to-png-converter/issues).
- **Security vulnerabilities:** Follow the instructions in [SECURITY.md](SECURITY.md).
