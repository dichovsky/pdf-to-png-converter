import { resolve } from 'node:path';
import { expect, test } from 'vitest';
import { normalizePdfToPngOptions } from '../src/normalizePdfToPngOptions.js';
import { pdfToPngCore } from '../src/pdfToPngCore.js';

/**
 * Smoke test for the internal `pdfToPngCore` entry point introduced by ARCH-011.
 *
 * Verifies that callers (currently the CLI) can supply already-normalized options and
 * receive identical results to the public `pdfToPng()` wrapper, without re-normalizing.
 */
test('pdfToPngCore converts the sample PDF when given pre-normalized options', async () => {
    const pdfFilePath = resolve('./test-data/sample.pdf');
    const normalized = normalizePdfToPngOptions({ viewportScale: 2.0 });

    const pngPages = await pdfToPngCore(pdfFilePath, normalized);

    expect(pngPages.length).toBe(2);
    for (const pngPage of pngPages) {
        expect(pngPage.kind).toBe('content');
        expect(pngPage.name).toBe(`sample_page_${pngPage.pageNumber}.png`);
        expect(pngPage.content).toBeInstanceOf(Buffer);
        expect(pngPage.path).toBe('');
        expect(pngPage.width).toBeGreaterThan(0);
        expect(pngPage.height).toBeGreaterThan(0);
    }
});
