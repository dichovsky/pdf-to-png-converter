import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import * as normalizeModule from '../src/normalizePdfToPngOptions.js';
import { run } from '../src/cli.js';

// Mock pdfToPngCore so the actual PDF pipeline does not execute during this test;
// we are exclusively asserting on normalization-call counts.
vi.mock('../src/pdfToPngCore.js', () => ({
    pdfToPngCore: vi.fn().mockResolvedValue([]),
}));

/**
 * Regression guard for ARCH-011.
 *
 * Before ARCH-011 the CLI normalized once inside `buildPdfToPngOptions`, then handed
 * a flat `PdfToPngOptions` object to the public `pdfToPng()` wrapper which normalized
 * it AGAIN. That second pass was wasteful and — more importantly — created a divergence
 * risk: any field added to the normalizer had to be mirrored in the CLI's manual
 * field-by-field rebuild, or it would be silently dropped before re-normalization.
 *
 * After ARCH-011 the CLI calls `pdfToPngCore` directly with its already-normalized
 * options, so `normalizePdfToPngOptions` must be invoked **exactly once** per CLI run.
 */
describe('CLI single-normalize regression guard', () => {
    let exitSpy: MockInstance;
    let logSpy: MockInstance;
    let errorSpy: MockInstance;
    let originalArgv: string[];
    let normalizeSpy: MockInstance;

    beforeEach(() => {
        exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);
        logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
        errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
        normalizeSpy = vi.spyOn(normalizeModule, 'normalizePdfToPngOptions');
        originalArgv = process.argv;
    });

    afterEach(() => {
        process.argv = originalArgv;
        vi.restoreAllMocks();
    });

    it('invokes normalizePdfToPngOptions exactly once for a successful CLI run', async () => {
        process.argv = ['node', 'cli.js', 'test.pdf', '--output-folder', '/out', '--viewport-scale', '2', '--silent'];

        await run();

        expect(exitSpy).not.toHaveBeenCalled();
        expect(errorSpy).not.toHaveBeenCalled();
        expect(logSpy).not.toHaveBeenCalled(); // --silent
        expect(normalizeSpy).toHaveBeenCalledTimes(1);
    });

    it('invokes normalizePdfToPngOptions exactly once for --return-metadata-only mode', async () => {
        process.argv = ['node', 'cli.js', 'test.pdf', '--return-metadata-only', '--silent'];

        await run();

        expect(exitSpy).not.toHaveBeenCalled();
        expect(normalizeSpy).toHaveBeenCalledTimes(1);
    });
});
