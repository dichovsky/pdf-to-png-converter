import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Detective release verification. Run by `publish.yml` immediately after `npm publish`
// to confirm the publish actually landed with provenance and is consumable. The publish
// has already happened by this point, so a failure here is an alarm, not a gate — it
// surfaces a broken OIDC/provenance/propagation pipeline loudly. Registry reads are
// retried to absorb propagation lag.

interface PackageManifest {
    name: string;
    version: string;
}

interface Attestations {
    url?: string;
    provenance?: unknown;
}

interface DistInfo {
    attestations?: Attestations;
}

interface PackumentVersion {
    dist?: DistInfo;
}

const NPM: string = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const REPO_ROOT: string = join(__dirname, '..');
const RETRY_ATTEMPTS = 10;
const RETRY_DELAY_MS = 3000;

function readManifest(): PackageManifest {
    const raw: string = readFileSync(join(REPO_ROOT, 'package.json'), 'utf-8');
    const parsed = JSON.parse(raw) as Partial<PackageManifest>;
    if (typeof parsed.name !== 'string' || typeof parsed.version !== 'string') {
        throw new Error('package.json is missing a string "name" or "version"');
    }
    return { name: parsed.name, version: parsed.version };
}

function runNpm(args: string[], cwd?: string): string {
    return execFileSync(NPM, args, { encoding: 'utf-8', cwd, stdio: ['ignore', 'pipe', 'pipe'] });
}

function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

// Retry a registry read until it returns a non-null value, absorbing propagation lag.
async function retry<T>(label: string, fn: () => T | null): Promise<T> {
    for (let attempt = 1; attempt <= RETRY_ATTEMPTS; attempt += 1) {
        const value = fn();
        if (value !== null) {
            return value;
        }
        if (attempt < RETRY_ATTEMPTS) {
            await sleep(RETRY_DELAY_MS);
        }
    }
    throw new Error(`${label}: still unavailable after ${RETRY_ATTEMPTS} attempts`);
}

// Q1 — the exact version is resolvable on the registry.
function fetchPublishedVersion(name: string, version: string): string | null {
    try {
        const out = runNpm(['view', `${name}@${version}`, 'version', '--json']).trim();
        return out.length > 0 ? (JSON.parse(out) as string) : null;
    } catch {
        return null;
    }
}

// Q2 — the `latest` dist-tag points at the new version.
function fetchLatestDistTag(name: string): string | null {
    try {
        const out = runNpm(['view', name, 'dist-tags.latest', '--json']).trim();
        return out.length > 0 ? (JSON.parse(out) as string) : null;
    } catch {
        return null;
    }
}

// Q3 — the published version carries a provenance attestation.
function fetchAttestations(name: string, version: string): Attestations | null {
    try {
        const out = runNpm(['view', `${name}@${version}`, '--json']).trim();
        if (out.length === 0) {
            return null;
        }
        const packument = JSON.parse(out) as PackumentVersion;
        return packument.dist?.attestations ?? null;
    } catch {
        return null;
    }
}

// Q4 — a clean install of the published version loads and exposes a working CLI.
function smokeTestInstall(name: string, version: string): void {
    const dir = mkdtempSync(join(tmpdir(), 'p2p-smoke-'));
    try {
        runNpm(['init', '-y'], dir);
        runNpm(['install', `${name}@${version}`, '--no-audit', '--no-fund'], dir);
        execFileSync(
            process.execPath,
            ['-e', `if (typeof require(${JSON.stringify(name)}).pdfToPng !== 'function') { process.exit(3); }`],
            { cwd: dir, stdio: ['ignore', 'pipe', 'pipe'] },
        );
        const binPath = join(dir, 'node_modules', '.bin', name);
        const cliOutput = execFileSync(binPath, ['--version'], { encoding: 'utf-8' }).trim();
        if (cliOutput !== `v${version}`) {
            throw new Error(`CLI --version printed "${cliOutput}", expected "v${version}"`);
        }
    } finally {
        rmSync(dir, { recursive: true, force: true });
    }
}

async function main(): Promise<void> {
    const { name, version } = readManifest();
    console.log(`release:postcheck for ${name}@${version}`);

    const publishedVersion = await retry('Q1 published version', () => fetchPublishedVersion(name, version));
    if (publishedVersion !== version) {
        throw new Error(`Q1 npm reports version "${publishedVersion}", expected "${version}"`);
    }
    console.log(`  Q1 published version:      OK (${publishedVersion})`);

    const latest = await retry('Q2 dist-tag latest', () => fetchLatestDistTag(name));
    if (latest !== version) {
        throw new Error(`Q2 dist-tag "latest" is "${latest}", expected "${version}"`);
    }
    console.log(`  Q2 dist-tag latest:        OK (${latest})`);

    const attestations = await retry('Q3 provenance attestation', () => fetchAttestations(name, version));
    if (attestations.url === undefined && attestations.provenance === undefined) {
        throw new Error('Q3 published version has no provenance attestation');
    }
    console.log('  Q3 provenance attestation: OK');

    smokeTestInstall(name, version);
    console.log('  Q4 clean-install smoke:    OK');

    console.log('\nrelease:postcheck PASSED');
}

main().catch((err: unknown) => {
    console.error('\nrelease:postcheck FAILED:');
    console.error(`  x ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
});
