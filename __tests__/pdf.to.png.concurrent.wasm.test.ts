import { execSync, spawn, spawnSync } from 'node:child_process';
import { join, resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import { beforeAll, expect, test } from 'vitest';
import { WASM_WARM_UP_TIMEOUT_MS } from '../src/const.js';
import { codecPdf, JPX_FLAT_GRAY_PDF } from './wasmFixtures';

/**
 * Issue #288 (upstream mozilla/pdf.js#22131): in pdfjs-dist 6.3 and 6.4 (up to 6.4.299) two main-thread conversions running at once could
 * leave a CCITT, JBIG2 or JPEG 2000 conversion pending forever when the other one settled before its first wasm
 * decode. Each case runs in a fresh Node process because the bug depends on process-wide pdf.js state.
 *
 * The child loads compiled JavaScript from its own folder, not `out/`: the worker-thread tests compile `out/` and load
 * `out/pageRenderWorker.js` while they run, so a second compile there could overwrite it mid-test.
 */
const compiledDirectory = resolve(__dirname, '..', 'test-results', 'concurrent-wasm-out');

beforeAll(() => {
    try {
        execSync(`npx tsc --project tsconfig.prod.json --outDir ${JSON.stringify(compiledDirectory)}`, {
            cwd: resolve(__dirname, '..'),
            stdio: 'pipe',
        });
    } catch (error) {
        const output = error as { stdout?: Buffer; stderr?: Buffer };
        throw new Error(`concurrent wasm build (tsc) failed:\n${output.stdout?.toString() ?? ''}\n${output.stderr?.toString() ?? ''}`, {
            cause: error,
        });
    }
}, 120_000);

test.each([
    ['CCITT', 'invalid', codecPdf('ccitt-g4'), ['fulfilled', 'rejected']],
    ['JBIG2', 'invalid', codecPdf('jbig2-arith'), ['fulfilled', 'rejected']],
    ['JPEG 2000', 'invalid', JPX_FLAT_GRAY_PDF, ['fulfilled', 'rejected']],
    ['CCITT', 'metadata', codecPdf('ccitt-g4'), ['fulfilled', 'fulfilled']],
])('a %s conversion settles when a concurrent %s conversion settles first', (_codec, concurrent, pdf, expected) => {
    const result = spawnSync(process.execPath, [join(__dirname, 'concurrentWasmChild.cjs'), compiledDirectory, pdf, concurrent], {
        encoding: 'utf8',
        timeout: 60_000,
    });

    expect(result.error).toBeUndefined();
    expect(result.status, result.stderr).toBe(0);
    // A hung conversion leaves nothing to keep the child alive, so it exits 0 without printing anything.
    expect(result.stdout, 'the scanned conversion never settled').not.toBe('');
    expect(JSON.parse(result.stdout)).toEqual(expected);
});

// The warm-up bounds its wait with a WASM_WARM_UP_TIMEOUT_MS timer. If a finished warm-up left that timer running, the
// process would stay alive until it fired (10 s after the first conversion) although all work is done.
const MAX_EXIT_DELAY_MS = 5_000;
const SETTLE_SCRIPT =
    "require(require('node:path').join(process.argv[1], 'index.js')).pdfToPng(process.argv[2]).then(() => process.stdout.write('settled\\n'))";

/** Runs one conversion in a fresh process and returns how long that process lived after the conversion settled. */
function msFromSettledToExit(pdf: string): Promise<number> {
    return new Promise((resolveDelay, reject) => {
        const child = spawn(process.execPath, ['-e', SETTLE_SCRIPT, compiledDirectory, pdf], { stdio: ['ignore', 'pipe', 'inherit'] });
        let settledAt: number | undefined;
        let exitedAt: number | undefined;
        child.stdout.on('data', (chunk: Buffer) => {
            if (settledAt === undefined && chunk.toString().includes('settled')) settledAt = performance.now();
        });
        child.once('error', reject);
        child.once('exit', () => {
            exitedAt = performance.now();
        });
        // 'close' follows 'exit' once stdout is drained, so the settled line is always seen before this runs.
        child.once('close', () => {
            if (settledAt === undefined || exitedAt === undefined) {
                reject(new Error('the conversion never settled'));
            } else {
                resolveDelay(exitedAt - settledAt);
            }
        });
    });
}

test('the process exits right after a conversion settles: the warm-up timeout timer is cleared', async () => {
    // The check only means something while the timer outlasts the bound by a wide margin.
    expect(WASM_WARM_UP_TIMEOUT_MS).toBeGreaterThanOrEqual(2 * MAX_EXIT_DELAY_MS);

    await expect(msFromSettledToExit(codecPdf('ccitt-g4'))).resolves.toBeLessThan(MAX_EXIT_DELAY_MS);
}, 60_000);
