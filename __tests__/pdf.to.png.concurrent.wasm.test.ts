import { execSync, spawnSync } from 'node:child_process';
import { join, resolve } from 'node:path';
import { beforeAll, expect, test } from 'vitest';
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
