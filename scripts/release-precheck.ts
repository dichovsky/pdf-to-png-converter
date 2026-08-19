import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// Preventive release gate. Run by `publish.yml` immediately before `npm publish`
// (and locally as a pre-flight) to block a release whose version, changelog, or
// packaged contents are wrong. All checks accumulate; the process exits non-zero
// listing every failure rather than stopping at the first.

interface PackageManifest {
    name: string;
    version: string;
}

interface PackedFile {
    path: string;
}

interface PackResult {
    files: PackedFile[];
}

const NPM: string = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const REPO_ROOT: string = join(__dirname, '..');
const REQUIRED_TARBALL_FILES: readonly string[] = [
    'out/index.js',
    'out/index.d.ts',
    'out/types.d.ts',
    'out/cli.js',
    // Loaded by runtime path rather than the main import graph, so TypeScript can build and the
    // package can load successfully even when this independently executable artifact is absent.
    'out/pageRenderWorker.js',
];

function readManifest(): PackageManifest {
    const raw: string = readFileSync(join(REPO_ROOT, 'package.json'), 'utf-8');
    const parsed = JSON.parse(raw) as Partial<PackageManifest>;
    if (typeof parsed.name !== 'string' || typeof parsed.version !== 'string') {
        throw new Error('package.json is missing a string "name" or "version"');
    }
    return { name: parsed.name, version: parsed.version };
}

function runNpm(args: string[]): string {
    return execFileSync(NPM, args, { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'pipe'] });
}

// P1 — the GitHub Release tag must match the package version being published.
function checkTagMatchesVersion(version: string, failures: string[]): void {
    const tag: string | undefined = process.env.RELEASE_TAG;
    if (tag === undefined || tag === '') {
        console.log('  P1 tag matches version:   SKIPPED (no RELEASE_TAG; local run)');
        return;
    }
    const expected = `v${version}`;
    if (tag !== expected) {
        failures.push(`P1 release tag "${tag}" does not match package version "${expected}"`);
        return;
    }
    console.log(`  P1 tag matches version:   OK (${tag})`);
}

// P2 — the version must not already exist on the registry (fail fast on a double publish).
function checkNotAlreadyPublished(name: string, version: string, failures: string[]): void {
    let published: string | null = null;
    try {
        const out = runNpm(['view', `${name}@${version}`, 'version', '--json']).trim();
        published = out.length > 0 ? (JSON.parse(out) as string) : null;
    } catch (err) {
        const text = err instanceof Error ? err.message : String(err);
        if (!text.includes('E404')) {
            failures.push(`P2 could not query npm for ${name}@${version}: ${text}`);
            return;
        }
    }
    if (published === version) {
        failures.push(`P2 ${name}@${version} is already published to npm — bump the version`);
        return;
    }
    console.log(`  P2 version is unpublished: OK (${name}@${version} is new)`);
}

// P3 — CHANGELOG.md must carry a section for this version (no release without notes).
function checkChangelogEntry(version: string, failures: string[]): void {
    const changelog = readFileSync(join(REPO_ROOT, 'CHANGELOG.md'), 'utf-8');
    const escaped = version.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const heading = new RegExp(`^##\\s*\\[${escaped}\\]`, 'm');
    if (!heading.test(changelog)) {
        failures.push(`P3 CHANGELOG.md has no "## [${version}]" section`);
        return;
    }
    console.log(`  P3 CHANGELOG entry exists: OK ([${version}])`);
}

// P4 — the published tarball must ship the build output and nothing else (no source, tests, or tsbuildinfo).
function checkTarballContents(failures: string[]): void {
    let files: string[];
    try {
        const out = runNpm(['pack', '--dry-run', '--ignore-scripts', '--json']);
        // npm <= 11 prints a JSON ARRAY of pack results; npm >= 12 prints an OBJECT keyed by
        // package name. Anchoring on the first "[" parsed the nested "files" array and then
        // choked on the trailing keys, so P4 reported "could not inspect the tarball" and blocked
        // the release. Accept both shapes — publish.yml currently pins npm@11.13.0, so this is
        // latent there but active for anyone running the precheck locally on npm 12.
        const start = out.search(/[[{]/);
        if (start === -1) {
            throw new Error('no JSON in "npm pack" output');
        }
        const parsed: unknown = JSON.parse(out.slice(start));
        const result = (Array.isArray(parsed) ? parsed[0] : Object.values(parsed as Record<string, unknown>)[0]) as PackResult | undefined;
        if (result?.files === undefined) {
            throw new Error('"npm pack" output has no file list');
        }
        files = result.files.map((file) => file.path.replace(/\\/g, '/'));
    } catch (err) {
        failures.push(`P4 could not inspect the tarball: ${err instanceof Error ? err.message : String(err)}`);
        return;
    }
    const missing = REQUIRED_TARBALL_FILES.filter((required) => !files.includes(required));
    if (missing.length > 0) {
        failures.push(`P4 tarball is missing required files: ${missing.join(', ')}`);
    }
    const forbidden = files.filter(
        (file) =>
            file.startsWith('src/') ||
            file.includes('__tests__/') ||
            file.endsWith('.tsbuildinfo') ||
            (file.endsWith('.ts') && !file.endsWith('.d.ts')),
    );
    if (forbidden.length > 0) {
        failures.push(`P4 tarball contains files that should not ship: ${forbidden.join(', ')}`);
    }
    if (missing.length === 0 && forbidden.length === 0) {
        console.log(`  P4 tarball contents:       OK (${files.length} files)`);
    }
}

// P5 — `[Unreleased]` must be empty at publish time.
//
// P3 only asks whether a section for THIS version exists; it says nothing about entries still
// sitting under `[Unreleased]`. Those entries are in the working tree, so they are in the tarball
// — the release would ship code its own changelog calls unreleased. This is not hypothetical: it
// happened while 4.2.0 sat version-bumped but unpublished and later work landed on top of it, and
// P1-P4 all passed. The documented flow (CONTRIBUTING "Cutting a release", step 2) is to move
// `[Unreleased]` into the new version section, so a non-empty one at this point means that step
// was skipped.
function checkUnreleasedIsEmpty(failures: string[]): void {
    const changelog = readFileSync(join(REPO_ROOT, 'CHANGELOG.md'), 'utf-8');
    const start = changelog.search(/^##\s*\[Unreleased\]/m);
    if (start === -1) {
        // No `[Unreleased]` heading at all is fine — nothing can be stranded under it.
        console.log('  P5 [Unreleased] is empty:  OK (no [Unreleased] section)');
        return;
    }
    const rest = changelog.slice(start);
    const nextHeading = rest.slice(1).search(/^##\s/m);
    const body = nextHeading === -1 ? rest.replace(/^##.*$/m, '') : rest.slice(0, nextHeading + 1).replace(/^##.*$/m, '');
    const stranded = body
        .split('\n')
        .map((line) => line.trim())
        // Sub-headings are scaffolding, not content: an `[Unreleased]` left holding an empty
        // "### Changed" ships nothing and must not block the release. Everything else counts —
        // narrowing this to bullet lines would let stranded prose through, and prose under
        // `[Unreleased]` describes shipped behaviour just as much as a bullet does.
        .filter((line) => line.length > 0 && !line.startsWith('#'));
    if (stranded.length > 0) {
        failures.push(
            `P5 CHANGELOG.md still has ${stranded.length} entry line(s) under "## [Unreleased]" — move them into the version section being released, or they ship undocumented`,
        );
        return;
    }
    console.log('  P5 [Unreleased] is empty:  OK');
}

function main(): void {
    const { name, version } = readManifest();
    console.log(`release:precheck for ${name}@${version}`);
    const failures: string[] = [];
    checkTagMatchesVersion(version, failures);
    checkNotAlreadyPublished(name, version, failures);
    checkChangelogEntry(version, failures);
    checkTarballContents(failures);
    checkUnreleasedIsEmpty(failures);
    if (failures.length > 0) {
        console.error('\nrelease:precheck FAILED:');
        for (const failure of failures) {
            console.error(`  x ${failure}`);
        }
        process.exit(1);
    }
    console.log('\nrelease:precheck PASSED');
}

main();
