# Release plan: v4.3.0

> **Status:** This plan was executed and `4.3.0` was published to npm on 2026-10-27. The publish workflow's post-release step failed because npm needed about 75 seconds to make the new version visible, longer than the step's 27-second retry window. Run locally from the release commit, `release:postcheck` passed, and the retry window has since been widened. The file records this release's go/no-go criteria and cut sequence; the maintained release procedure is the "Releasing" section of [CONTRIBUTING.md](CONTRIBUTING.md#releasing). The previous plan (`4.2.1`) is in the git history of this file.

## Decision

Release `4.3.0` as a minor. The exported names, the `pdfToPng(pdfFile: string | ArrayBufferLike | Uint8Array, props?)` signature, the `PdfToPngOptions` keys and types, the `PngPageOutput` shape, `VerbosityLevel`, and the Node.js `>=22.13.0` engine range are unchanged from `4.2.1` (the `src/types.ts` diff is JSDoc only). New features rule out a patch: the `PDF_TO_PNG_PASSWORD` environment variable, the `PDF_TO_PNG_WASM_MISSING` and `PDF_TO_PNG_DISABLE_FONT_FACE_IGNORED` process warnings, and cross-realm `SharedArrayBuffer` input. Both runtime dependencies move within their majors (`pdfjs-dist` `~6.2.108` to `~6.4.299`, `@napi-rs/canvas` `~1.0.8` to `~1.0.13`).

A major version is not warranted. Most behaviour changes fix output that was already wrong (blank CCITT, JBIG2 and JPEG 2000 images, missing-glyph boxes with `disableFontFace: false`, wrong fonts or missing CJK text outside the project root, one-pixel-short dimensions, `Info:` lines corrupting metadata JSON) or tighten validation of input outside the typed contract. Three independent reviews agreed on `4.3.0`. The following changes can still fail a call that produced correct results on `4.2.1`, and the release notes must name them:

- The CLI rejects more than one positional argument, including a stray value after a flag that takes none (`file.pdf --silent true`).
- A string input longer than 4096 characters is rejected before any filesystem access.
- The duplicate output-name check folds Unicode, so pairs such as `straße.png` and `STRASSE.png` are rejected even on a case-sensitive filesystem.
- `returnMetadataOnly` and in-memory `returnPageContent: false` reject a page with a floored side above 1,000,000 px.
- Width and height can grow by one pixel at some scales (for example 2974 × 3849 becomes 2975 × 3850).

## Release scope

- Ship every entry recorded under `CHANGELOG.md`'s `[Unreleased]` section at the cut, which becomes `## [4.3.0]`.
- No code change is part of the cut: only the version in `package.json` and `package-lock.json`, the changelog section and links, and this file.

## Go/no-go criteria

All items are release blockers:

- `npx npm-check-updates@latest --target latest` and `npm outdated --depth=0` report no direct dependency update.
- `npm audit` and `npm audit --omit=dev` report zero vulnerabilities.
- `npm run check` passes from a clean install (`npm ci`), with coverage of at least 98% for statements, branches, functions, and lines.
- `npm run build` produces the CommonJS library, declarations, CLI, and worker entry in `out/`.
- `RELEASE_TAG=v4.3.0 npm run release:precheck` passes, and `npm pack --dry-run` lists only `out/`, `README.md`, `LICENSE`, and `package.json`.
- The `ubuntu` aggregate check (Node.js 22.13 and 24) passes on the release PR. The Node.js 24 Windows smoke is informational, because Windows support is best-effort.
- A read-only review confirms that every user-observable change since `v4.2.1` has a changelog entry and that the entries match the code.

## Cut sequence

1. Branch `chore/release-v4.3.0` from an up-to-date `main` whose CI is green.
2. Run `npm ci`, the dependency and audit checks above, and the changelog review.
3. `npm version 4.3.0 --no-git-tag-version`.
4. Move the `[Unreleased]` entries to `## [4.3.0] — 2026-10-27`, leave an empty `[Unreleased]` section, and update the comparison links.
5. `npm run check && npm run build`, then `RELEASE_TAG=v4.3.0 npm run release:precheck` and `npm pack --dry-run`.
6. Commit, open the release PR, and wait for the `ubuntu` check.
7. Merge, then run `gh release create v4.3.0 --target <full merge SHA>` (not a prerelease). Publishing the GitHub Release starts `publish.yml` straight away. The workflow has no `environment:` approval gate, so this step publishes to npm. The workflow runs `release:precheck`, then `npm publish --provenance`, then `release:postcheck`.

## Post-release verification

- `git rev-parse v4.3.0` equals the merge SHA.
- The `publish.yml` run for `v4.3.0` succeeds, including its post-release checks: version, `latest` dist-tag, provenance, clean install, and worker-thread render parity.
- `npm view pdf-to-png-converter dist-tags` shows `latest: 4.3.0`, and `npm view pdf-to-png-converter@4.3.0 dist.attestations` shows a provenance attestation.
- In a throwaway directory outside the repository, `npm i pdf-to-png-converter@4.3.0`, then check `npx pdf-to-png-converter --version`, a metadata-only CLI run, and the README's library example. The asset-folder fix in this release concerns runs whose working directory is not the project root.
- Watch the issue tracker for native-install, worker-startup, rendering, memory, or path-handling regressions.

## Recovery plan

Prefer a fix-forward `4.3.1`. If `4.3.0` is badly broken, deprecate that exact npm version and point the `latest` dist-tag back to `4.2.1` while the fix is prepared. Do not delete tags, rewrite release commits, or unpublish unless npm policy and a security incident require it.
