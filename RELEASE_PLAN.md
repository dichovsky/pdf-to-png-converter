# Release plan: v4.2.1

## Decision

Release `4.2.1` as a patch after the checks below are green. The changes since `4.2.0` preserve the public exports, options, defaults, output variants, CLI contract, and Node.js 22.13 minimum. They consist of backward-compatible fixes, security hardening, internal consolidation, dependency maintenance, documentation corrections, and stronger tests, so a minor or major version is not warranted.

This plan does not bump the package version, create a tag, publish a GitHub Release, or publish to npm. Those state-changing steps belong to the release cut after review.

## Release scope

- Ship the conversion/lifecycle consolidation and worker-pool cleanup fixes already recorded under `CHANGELOG.md`'s `[Unreleased]` section.
- Ship the input and output-path security hardening already recorded under `[Unreleased]`.
- Update every direct npm dependency range that is behind its latest compatible stable release and refresh compatible transitive dependencies.
- Enforce at least 98% V8 statement, branch, function, and line coverage without excluding production modules.
- Keep the README, contributor guide, architecture guide, repository guidance, changelog, and release workflow descriptions synchronized with the shipped code.

## Go/no-go criteria

All items are release blockers:

- `npx npm-check-updates@latest --target latest` and `npm outdated --depth=0 --json` report no direct dependency update. Any entries from `npm outdated --all` are reviewed and limited to upstream-constrained transitive packages or uninstalled optional peers.
- `npm audit` and `npm audit --omit=dev` report zero vulnerabilities.
- `npm run check` passes from a clean install and the coverage report is at least 98% for statements, branches, functions, and lines.
- `npm run build` passes and produces the required CommonJS library, declarations, CLI, and worker entry in `out/`.
- `npm run release:precheck` passes after the version/changelog cut, including the registry-version and tarball-content checks.
- A normal render, metadata-only conversion, file output, CLI invocation, and worker-thread render remain covered by the automated suite.
- The Node.js 22.13 and 24 CI matrix passes on the release commit, confirming the patch preserves the published runtime floor. Retain the local macOS render result because `@napi-rs/canvas` is native and the publish job runs on Linux.
- Review confirms that `[Unreleased]` contains no breaking public API change. If one is found, stop and choose the appropriate SemVer version before tagging.

The Node.js 24 Windows smoke is informational. Windows support is best-effort, so its result does not block merge or publication.

## Cut sequence

1. Freeze the release scope and branch from an up-to-date `main`.
2. Run `npm ci`, check direct ranges with `npx npm-check-updates@latest --target latest` and `npm outdated --depth=0`, review `npm outdated --all`, then run `npm audit`, `npm audit --omit=dev`, and `npm run check`.
3. Bump manifests only: `npm version 4.2.1 --no-git-tag-version`.
4. Move all `[Unreleased]` entries to `## [4.2.1] — YYYY-MM-DD`, restore an empty `[Unreleased]` section, and update the comparison links at the bottom of `CHANGELOG.md`.
5. Run `npm run check && npm run build`.
6. Run `RELEASE_TAG=v4.2.1 npm run release:precheck`; inspect `npm pack --dry-run --json` if it fails.
7. Commit the version, lockfile, and changelog together; open the release PR and require the repository CI check.
8. Merge, then publish a non-prerelease GitHub Release tagged `v4.2.1`. The publish workflow will build, run the precheck again, publish with npm provenance, and run the registry/install/render postchecks.

## Post-release verification

- Confirm `npm view pdf-to-png-converter@4.2.1 version` returns `4.2.1` and the `latest` dist-tag points to it.
- Confirm the npm package shows a provenance attestation.
- Confirm the workflow's clean-install checks load the API, report `v4.2.1` from the CLI, include `out/pageRenderWorker.js`, and render equivalent single-threaded and worker-thread PNGs.
- Install `pdf-to-png-converter@4.2.1` in a throwaway consumer and run one documented README example.
- Watch the release workflow and issue tracker for native-install, worker-startup, rendering, or path-handling regressions.

## Recovery plan

Prefer a fix-forward `4.2.2`. If `4.2.1` is materially broken, deprecate that exact npm version and move the `latest` dist-tag back to `4.2.0` while preparing the fix. Do not delete tags, rewrite release commits, or unpublish the package unless npm policy and a security incident specifically require it.
