import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
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

// Installs the published version into a throwaway project and runs `fn` against it. Q4 and Q5
// share one install: the package carries a large native dependency, so installing twice doubled
// the slowest part of the postcheck for no extra coverage.
function withInstalledPackage<T>(name: string, version: string, fn: (dir: string) => T): T {
    const dir = mkdtempSync(join(tmpdir(), 'p2p-smoke-'));
    try {
        runNpm(['init', '-y'], dir);
        runNpm(['install', `${name}@${version}`, '--no-audit', '--no-fund'], dir);
        return fn(dir);
    } finally {
        rmSync(dir, { recursive: true, force: true });
    }
}

// Q4 — a clean install of the published version loads and exposes a working CLI.
function smokeTestInstall(name: string, version: string, dir: string): void {
    execFileSync(process.execPath, ['-e', `if (typeof require(${JSON.stringify(name)}).pdfToPng !== 'function') { process.exit(3); }`], {
        cwd: dir,
        stdio: ['ignore', 'pipe', 'pipe'],
    });
    const binPath = join(dir, 'node_modules', '.bin', name);
    const cliOutput = execFileSync(binPath, ['--version'], { encoding: 'utf-8' }).trim();
    if (cliOutput !== `v${version}`) {
        throw new Error(`CLI --version printed "${cliOutput}", expected "v${version}"`);
    }
}

// Q5 — the published package can actually render, including in worker-thread mode.
//
// `renderInWorkerThreads` spawns `out/pageRenderWorker.js` by a path resolved relative to the
// installed `out/` directory. Every in-repo test runs against the source tree, where that file is
// always present, so a packaging change that drops or relocates it would break worker mode for
// consumers with the whole suite still green. This is the only check that exercises the worker
// entry as an npm consumer sees it.
//
// Comparing worker output against single-threaded output also catches a worker that starts but
// renders differently — a silent-corruption failure a "did it throw?" check would pass.
//
// The render comparison alone is NOT sufficient, because it only infers that worker mode ran.
// `renderInWorkerThreads` is a plain optional field and the library ignores unknown option keys,
// so if the option ever stops being honoured — renamed, dropped from the normalizer, or typoed in
// this template, none of which `tsc`/ESLint/the test suite can see inside a generated JS string —
// both calls would take the main-thread path and produce byte-identical output. Q5 would then pass
// with `out/pageRenderWorker.js` absent from the tarball, the exact break it exists to catch. The
// explicit `existsSync` assertion below tests that packaging property directly, so the guard
// cannot decay into a tautology.
function buildRenderSmokeScript(name: string, samplePdf: string): string {
    return `
const assert = require('node:assert/strict');
const { existsSync } = require('node:fs');
const { dirname, join } = require('node:path');
const { pdfToPng } = require(${JSON.stringify(name)});

const PDF = ${JSON.stringify(samplePdf)};
const PNG_MAGIC = Buffer.from('89504e470d0a1a0a', 'hex');

async function main() {
    // Mirrors resolveWorkerEntryPath() in src/workerPool.ts: the worker entry sits next to the
    // compiled main entry. \`exports\` declares no subpaths, so resolve it via the main entry.
    const workerEntry = join(dirname(require.resolve(${JSON.stringify(name)})), 'pageRenderWorker.js');
    assert.ok(existsSync(workerEntry), 'worker entry missing from the installed package: ' + workerEntry);

    const outputFolder = join(__dirname, 'worker-out');
    const workers = await pdfToPng(PDF, { renderInWorkerThreads: true, concurrencyLimit: 2, outputFolder });
    const single = await pdfToPng(PDF);

    assert.ok(workers.length > 0, 'worker mode rendered no pages');
    assert.equal(workers.length, single.length, 'worker mode returned a different page count');
    assert.deepEqual(
        workers.map((page) => page.pageNumber),
        single.map((page) => page.pageNumber),
        'worker mode did not preserve page order',
    );

    for (let index = 0; index < workers.length; index += 1) {
        const pageNumber = workers[index].pageNumber;
        const content = workers[index].content;
        // Two empty buffers compare equal, so assert real PNG bytes before comparing renders —
        // otherwise a renderer producing nothing at all would satisfy the equality check.
        assert.ok(content.length > PNG_MAGIC.length, 'page ' + pageNumber + ' produced no PNG bytes');
        assert.ok(content.subarray(0, PNG_MAGIC.length).equals(PNG_MAGIC), 'page ' + pageNumber + ' is not a PNG');
        assert.ok(content.equals(single[index].content), 'page ' + pageNumber + ' differs from single-threaded output');
        assert.ok(existsSync(workers[index].path), 'page ' + pageNumber + ' was not written: ' + workers[index].path);
    }
}

main().catch((error) => {
    console.error(error);
    // Not process.exit(): on POSIX an inherited stderr that is a pipe (which is what an Actions
    // step provides) is written asynchronously, and exiting discards whatever is still queued —
    // truncating the one diagnostic this check exists to produce. Nothing keeps the loop alive
    // once the pool has terminated its workers.
    process.exitCode = 4;
});
`;
}

// A hung worker pool would otherwise block execFileSync until the job-level timeout kills the
// whole publish run, producing "exceeded the maximum execution time" and no Q5 diagnostic at all.
const RENDER_SMOKE_TIMEOUT_MS = 300_000;

function smokeTestRender(name: string, dir: string): void {
    // The repo checkout is available in the publish workflow, so a real multi-page asset is used
    // rather than a synthetic one — this must fail on a genuinely broken renderer, not on a
    // hand-rolled PDF that pdf.js merely tolerates.
    const samplePdf = join(REPO_ROOT, 'test-data', 'sample.pdf');
    const scriptPath = join(dir, 'render-smoke.js');
    writeFileSync(scriptPath, buildRenderSmokeScript(name, samplePdf), 'utf-8');
    try {
        // Inherited stdio streams the child's diagnostics straight into the Actions log as they
        // happen. (Piping would also surface them — Node appends captured stderr to the thrown
        // error's message — but only after the fact, and subject to the maxBuffer cap.)
        execFileSync(process.execPath, [scriptPath], {
            cwd: dir,
            stdio: ['ignore', 'inherit', 'inherit'],
            timeout: RENDER_SMOKE_TIMEOUT_MS,
            killSignal: 'SIGKILL',
        });
    } catch (error: unknown) {
        if (error !== null && typeof error === 'object' && (error as { signal?: string }).signal === 'SIGKILL') {
            throw new Error(
                `Q5 render smoke timed out after ${RENDER_SMOKE_TIMEOUT_MS / 1000}s — the worker pool never settled (a present but unusable ${'`pageRenderWorker.js`'} can hang instead of failing)`,
            );
        }
        throw error;
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

    withInstalledPackage(name, version, (dir) => {
        smokeTestInstall(name, version, dir);
        console.log('  Q4 clean-install smoke:    OK');

        smokeTestRender(name, dir);
        console.log('  Q5 worker-thread render:   OK');
    });

    console.log('\nrelease:postcheck PASSED');
}

main().catch((err: unknown) => {
    console.error('\nrelease:postcheck FAILED:');
    console.error(`  x ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
});
