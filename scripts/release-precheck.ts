import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join, posix } from 'node:path';
import { parseSingleNpmJsonResult } from './npm-json';

// Preventive release gate. Run by `publish.yml` immediately before `npm publish`
// (and locally as a pre-flight) to block a release whose version, changelog, or
// packaged contents are wrong. All checks accumulate; the process exits non-zero
// listing every failure rather than stopping at the first.

// The fields of package.json the checks read. The entry-point fields stay `unknown`: they are parsed JSON and
// are narrowed where they are used.
export interface PackageManifest {
    name: string;
    version: string;
    main?: unknown;
    types?: unknown;
    bin?: unknown;
    exports?: unknown;
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
    return { ...parsed, name: parsed.name, version: parsed.version };
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
        const parsed = parseSingleNpmJsonResult(out);
        if (parsed !== null && typeof parsed !== 'string') {
            throw new Error(`npm returned a non-string version: ${JSON.stringify(parsed)}`);
        }
        published = parsed;
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

// P4 — the published tarball must ship the build output and every file package.json points consumers at,
// and nothing else (no source, tests, or tsbuildinfo). A manifest-only typo in main, types, bin or exports,
// or a lost bin shebang, still packs and publishes cleanly and is only caught by the post-publish smoke test.

// Every string in an entry-point value: a plain path, the values of a `bin` map, and the conditions,
// subpaths and fallback arrays of `exports`.
function stringLeaves(value: unknown): string[] {
    if (typeof value === 'string') {
        return [value];
    }
    if (Array.isArray(value)) {
        return value.flatMap(stringLeaves);
    }
    if (value !== null && typeof value === 'object') {
        return Object.values(value).flatMap(stringLeaves);
    }
    return [];
}

// `./out/x.js` in package.json is `out/x.js` in the `npm pack` file list.
function toPackedPath(target: string): string {
    return posix.normalize(target.replace(/\\/g, '/'));
}

function binFiles(manifest: PackageManifest): string[] {
    return stringLeaves(manifest.bin).map(toPackedPath);
}

export function requiredTarballFiles(manifest: PackageManifest): string[] {
    const declared = [manifest.main, manifest.types, manifest.bin, manifest.exports]
        .flatMap(stringLeaves)
        // A subpath pattern such as "./*" names a set of files, not one file that must be listed.
        .filter((target) => !target.includes('*'))
        .map(toPackedPath);
    return [...new Set([...REQUIRED_TARBALL_FILES, ...declared])];
}

// npm links a bin file as it is, so without the shebang the installed command fails to start (ENOEXEC) instead of running under node.
export function hasNodeShebang(source: string): boolean {
    return /^#!\/usr\/bin\/env node(\r?\n|$)/.test(source);
}

// The pure part of P4: what is wrong with a packed file list. `readSource` returns the text of a packed file.
export function tarballProblems(files: readonly string[], manifest: PackageManifest, readSource: (file: string) => string): string[] {
    const problems: string[] = [];
    const missing = requiredTarballFiles(manifest).filter((required) => !files.includes(required));
    if (missing.length > 0) {
        problems.push(`P4 tarball is missing required files: ${missing.join(', ')}`);
    }
    const forbidden = files.filter(
        (file) =>
            file.startsWith('src/') ||
            file.includes('__tests__/') ||
            file.endsWith('.tsbuildinfo') ||
            (file.endsWith('.ts') && !file.endsWith('.d.ts')),
    );
    if (forbidden.length > 0) {
        problems.push(`P4 tarball contains files that should not ship: ${forbidden.join(', ')}`);
    }
    // A bin file that is not in the tarball is already reported as missing above.
    for (const file of binFiles(manifest).filter((bin) => files.includes(bin))) {
        try {
            if (!hasNodeShebang(readSource(file))) {
                problems.push(`P4 bin file ${file} does not start with "#!/usr/bin/env node"`);
            }
        } catch (err) {
            problems.push(`P4 could not read bin file ${file} to check its shebang: ${err instanceof Error ? err.message : String(err)}`);
        }
    }
    return problems;
}

function checkTarballContents(manifest: PackageManifest, failures: string[]): void {
    let files: string[];
    try {
        const out = runNpm(['pack', '--dry-run', '--ignore-scripts', '--json']);
        // npm <= 11 prints a JSON ARRAY of pack results; npm >= 12 prints an OBJECT keyed by
        // package name. Anchoring on the first "[" parsed the nested "files" array and then
        // choked on the trailing keys, so P4 reported "could not inspect the tarball" and blocked
        // the release. Accept both shapes so the check works with older local npm releases and
        // with the npm 12 release pinned by publish.yml.
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
    const problems = tarballProblems(files, manifest, (file) => readFileSync(join(REPO_ROOT, file), 'utf-8'));
    failures.push(...problems);
    if (problems.length === 0) {
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
    const manifest = readManifest();
    const { name, version } = manifest;
    console.log(`release:precheck for ${name}@${version}`);
    const failures: string[] = [];
    checkTagMatchesVersion(version, failures);
    checkNotAlreadyPublished(name, version, failures);
    checkChangelogEntry(version, failures);
    checkTarballContents(manifest, failures);
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

// Only when run as the script: the pure checks above are imported by tests, which must not shell out to npm.
if (require.main === module) {
    main();
}
