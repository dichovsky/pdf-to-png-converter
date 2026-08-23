import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import { MAX_CONCURRENCY_LIMIT, MAX_VIEWPORT_SCALE } from '../src/const.js';
import { pdfToPng } from '../src/pdfToPng.js';
import type { PdfToPngOptions } from '../src/types.js';

const unusedInput = new Uint8Array(0);

describe('public option validation', () => {
    test.each([Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, 0, -1, MAX_VIEWPORT_SCALE + 1])(
        'rejects unsafe viewportScale %s before input work',
        async (viewportScale) => {
            await expect(pdfToPng(unusedInput, { viewportScale })).rejects.toThrow(
                `viewportScale must be a finite number greater than 0 and at most ${MAX_VIEWPORT_SCALE}`,
            );
        },
    );

    test.each(['', '   '])('rejects blank outputFolder %j before input work', async (outputFolder) => {
        await expect(pdfToPng(unusedInput, { outputFolder })).rejects.toThrow('outputFolder must not be empty');
    });

    test('rejects unsupported verbosity levels', async () => {
        await expect(pdfToPng(unusedInput, { verbosityLevel: 3 } as unknown as PdfToPngOptions)).rejects.toThrow(
            'verbosityLevel must be 0, 1, or 5',
        );
    });

    test.each([0, -1, 1.5])('rejects invalid selected page %s', async (pageNumber) => {
        await expect(pdfToPng(unusedInput, { pagesToProcess: [pageNumber] })).rejects.toThrow(
            `pagesToProcess contains invalid page number: ${pageNumber}`,
        );
    });

    test.each([0, -1, 1.5, Number.NaN])('rejects invalid maxInputBytes %s', async (maxInputBytes) => {
        await expect(pdfToPng(unusedInput, { maxInputBytes })).rejects.toThrow('maxInputBytes must be a positive integer');
    });

    test.each([{ processPagesInParallel: true }, { renderInWorkerThreads: true }])(
        'validates concurrencyLimit when an explicit concurrency mode is enabled',
        async (mode) => {
            await expect(pdfToPng(unusedInput, { ...mode, concurrencyLimit: 0 })).rejects.toThrow(
                'concurrencyLimit must be a positive integer >= 1',
            );
            await expect(pdfToPng(unusedInput, { ...mode, concurrencyLimit: MAX_CONCURRENCY_LIMIT + 1 })).rejects.toThrow(
                `concurrencyLimit must be between 1 and ${MAX_CONCURRENCY_LIMIT}`,
            );
        },
    );

    test('leaves an unused concurrencyLimit inert for backward compatibility', async () => {
        const fixture = join(__dirname, '..', 'test-data', '10-page-sample.pdf');
        await expect(
            pdfToPng(fixture, {
                concurrencyLimit: Number.MAX_SAFE_INTEGER,
                pagesToProcess: [],
                returnMetadataOnly: true,
            }),
        ).resolves.toEqual([]);
    });
});
