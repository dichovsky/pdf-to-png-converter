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
const REQUIRED_TARBALL_FILES: readonly string[] = ['out/index.js', 'out/index.d.ts', 'out/cli.js'];

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
        const start = out.indexOf('[');
        if (start === -1) {
            throw new Error('no JSON array in "npm pack" output');
        }
        const result = JSON.parse(out.slice(start)) as PackResult[];
        files = result[0].files.map((file) => file.path.replace(/\\/g, '/'));
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

function main(): void {
    const { name, version } = readManifest();
    console.log(`release:precheck for ${name}@${version}`);
    const failures: string[] = [];
    checkTagMatchesVersion(version, failures);
    checkNotAlreadyPublished(name, version, failures);
    checkChangelogEntry(version, failures);
    checkTarballContents(failures);
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
