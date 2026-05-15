# Contributing to pdf-to-png-converter

Thank you for taking the time to contribute!

## Prerequisites

- **Node.js 22.13+** (use `.nvmrc`: `nvm use`)
- **npm 10+**

## Getting Started

```sh
git clone https://github.com/dichovsky/pdf-to-png-converter.git
cd pdf-to-png-converter
npm ci
```

## Running Tests

```sh
npm test              # build + run all tests with coverage
npm run lint          # ESLint across the repository using eslint.config.mjs
npm run build:test    # type-check src/ + __tests__/ (no emit)
npm run build:strict  # stricter dependency-boundary type-check
npm run test:license  # verify production dependency licenses
```

Run a single test file:

```sh
npx vitest run __tests__/<filename>.test.ts
```

## Strict type-check

`npm run build:strict` runs `tsc` against `tsconfig.strict.json`, which disables `skipLibCheck` to surface type regressions in `pdfjs-dist` and `@napi-rs/canvas`. This step blocks CI and is part of `pretest`, so it also runs on every local `npm test` and on `prepublishOnly`.

If `build:strict` fails because of an upstream type, suppress at the import site with `// @ts-expect-error <reason> — upstream <pkg>@<range>` (see `src/pageRenderer.ts` for the canonical example). `@ts-expect-error` is self-cleaning: when the upstream typing is fixed, strict reports the unused suppression and you can remove the line.

Do not work around `build:strict` failures by adding `continue-on-error` to the workflow or `|| true` to the script.

## Coding Conventions

- **Language:** TypeScript (strict mode). All source lives under `src/`.
- **Formatting:** 4-space indent, single quotes, trailing commas, 140-char line width.
- **Imports:** use `.js` extensions in all relative imports (required by `"moduleResolution": "node16"`).
- **Type imports:** use `import type` for type-only imports.
- **Return types:** all functions in `src/` need explicit return type annotations.
- **Accessibility:** all class members need explicit `public` / `private` modifiers.

## Commit Messages

Follow [Conventional Commits](https://www.conventionalcommits.org/):

```
<type>: <short description>

<optional body>
```

Types: `feat`, `fix`, `refactor`, `docs`, `test`, `chore`, `perf`, `ci`

## Pull Request Checklist

- [ ] `npm test` passes locally
- [ ] `npm run lint` reports no errors
- [ ] New behaviour is covered by tests (coverage thresholds: lines 90%, functions 90%, branches 85%)
- [ ] `CHANGELOG.md` updated under `## [Unreleased]` (or moved into the release section when cutting a release)

## Reporting Bugs / Security Issues

- **Bugs:** open a [GitHub issue](https://github.com/dichovsky/pdf-to-png-converter/issues)
- **Security vulnerabilities:** follow the process described in [SECURITY.md](SECURITY.md)
