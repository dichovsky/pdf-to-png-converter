# Release plan: v4.3.0

> **Status:** Executed on 2026-10-27 (`4.3.0` published to npm). During the publish workflow, `release:postcheck` timed out because npm took about 75 seconds to index the new version, exceeding the initial 27-second retry window. Running `release:postcheck` locally from the release commit succeeded, and the retry window was later extended to 5 minutes. See [CONTRIBUTING.md](CONTRIBUTING.md#releasing) for the standard release procedure.

## Decision

Publish `4.3.0` as a minor release. Public exports, `pdfToPng(pdfFile, props?)`, `PdfToPngOptions`, `PngPageOutput`, `VerbosityLevel`, and the `4.3.0` Node.js engine range (`>=22.13.0`) matched `4.2.1`. New features required a minor bump: the `PDF_TO_PNG_PASSWORD` environment variable, the `PDF_TO_PNG_WASM_MISSING` and `PDF_TO_PNG_DISABLE_FONT_FACE_IGNORED` process warnings, and cross-realm `SharedArrayBuffer` input support. Runtime dependencies remained within their major versions (`pdfjs-dist` `~6.2.108` to `~6.4.299`, `@napi-rs/canvas` `~1.0.8` to `~1.0.13`).

Behavior changes that can reject inputs previously accepted in `4.2.1`:

- The CLI rejects more than one positional argument, including extra values after boolean flags (`file.pdf --silent true`).
- String inputs longer than 4096 characters fail before any filesystem access.
- Duplicate output filename checks use Unicode folding, rejecting pairs such as `straße.png` and `STRASSE.png` on all platforms.
- `returnMetadataOnly` and in-memory `returnPageContent: false` reject pages with a floored side above 1,000,000 px.
- Page dimensions within `1e-6` px below an integer now round up to that integer (for example, `2974 × 3849` becomes `2975 × 3850`).

## Release scope

- Include all entries under `CHANGELOG.md` `[Unreleased]` in `## [4.3.0]`.
- Change only the version in `package.json` and `package-lock.json`, the changelog sections and links, and this file.

## Go/no-go criteria

Every item below must pass before release:

- `npx npm-check-updates@latest --target latest` and `npm outdated --depth=0` report no outdated direct dependencies.
- `npm audit` and `npm audit --omit=dev` report zero vulnerabilities.
- `npm run check` passes after `npm ci`, with at least 98% coverage across statements, branches, functions, and lines.
- `npm run build` outputs the CommonJS library, type declarations, CLI, and worker entrypoint in `out/`.
- `RELEASE_TAG=v4.3.0 npm run release:precheck` passes, and `npm pack --dry-run` lists only `out/`, `README.md`, `LICENSE`, and `package.json`.
- The `ubuntu` CI check passes on the release pull request.
- Every user-visible change after `v4.2.1` has an accurate entry in `CHANGELOG.md`.

## Cut sequence

1. Create branch `chore/release-v4.3.0` from `main`.
2. Run `npm ci`, check dependencies and audit status, and review `CHANGELOG.md`.
3. Run `npm version 4.3.0 --no-git-tag-version`.
4. Move `[Unreleased]` entries to `## [4.3.0] — 2026-10-27`, leave `[Unreleased]` empty, and update comparison links at the bottom of `CHANGELOG.md`.
5. Run `npm run check && npm run build`, `RELEASE_TAG=v4.3.0 npm run release:precheck`, and `npm pack --dry-run`.
6. Commit the changes, open the release pull request, and wait for CI checks to pass.
7. Merge the pull request and run `gh release create v4.3.0 --target <full merge SHA>`. Publishing the GitHub Release triggers `publish.yml` (`release:precheck` → `npm publish --provenance` → `release:postcheck`).

## Post-release verification

- Confirm `git rev-parse v4.3.0` matches the merge commit SHA.
- Confirm the `publish.yml` workflow succeeds.
- Verify `npm view pdf-to-png-converter dist-tags` shows `latest: 4.3.0` and `npm view pdf-to-png-converter@4.3.0 dist.attestations` includes the provenance attestation.
- Install `pdf-to-png-converter@4.3.0` in a temporary directory outside the repository and test `npx pdf-to-png-converter --version`, `--return-metadata-only`, and a library conversion.

## Recovery plan

If a regression is found, publish a `4.3.1` patch release. If `4.3.0` is critically broken, deprecate `4.3.0` on npm and point the `latest` dist-tag back to `4.2.1` while preparing `4.3.1`. Do not delete git tags, rewrite release commits, or unpublish versions.
