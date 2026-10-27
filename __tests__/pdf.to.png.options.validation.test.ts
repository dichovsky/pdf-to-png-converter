import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import { MAX_CONCURRENCY_LIMIT, MAX_VIEWPORT_SCALE } from '../src/const.js';
import { assertValidPdfToPngOptions, pdfToPng } from '../src/pdfToPng.js';
import type { PdfToPngOptions } from '../src/types.js';
import { VerbosityLevel } from '../src/types.js';

const unusedInput = new Uint8Array(0);
const samplePdf = join(__dirname, '..', 'test-data', 'sample.pdf');
// A path that does not exist: reading it would reject with ENOENT, so an option error proves validation came first.
const missingInput = join(tmpdir(), 'pdf-to-png-core-validation', 'does-not-exist.pdf');

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

describe('pagesToProcess shape', () => {
    // A hole is built by assignment: an array literal `[1, , 2]` is a lint error.
    const sparse: number[] = [];
    sparse[0] = 1;
    sparse[2] = 2;

    test.each([
        ['a Uint16Array', new Uint16Array([1, 2])],
        ['a Float64Array', new Float64Array([1, 2])],
        ['a Buffer', Buffer.from([1, 2])],
        ['a Set', new Set([1, 2])],
        ['a string', '12'],
        ['a number', 2],
        ['an array-like object', { length: 1, 0: 1 }],
        ['an object that has its own map', { map: () => [] }],
    ])('rejects %s before input work', async (_label, pagesToProcess) => {
        await expect(pdfToPng(missingInput, { pagesToProcess } as unknown as PdfToPngOptions)).rejects.toThrow(
            'pagesToProcess must be an array of positive integers',
        );
    });

    test('rejects a sparse array like an explicit undefined entry', async () => {
        await expect(pdfToPng(missingInput, { pagesToProcess: sparse })).rejects.toThrow(
            'pagesToProcess contains invalid page number: undefined',
        );
    });

    test('snapshots a plain array', () => {
        const pages = [3, 1, 3];
        const { pagesToProcess } = assertValidPdfToPngOptions({ pagesToProcess: pages });

        expect(Array.isArray(pagesToProcess)).toBe(true);
        expect(pagesToProcess).toStrictEqual([3, 1, 3]);
        expect(pagesToProcess).not.toBe(pages);
    });

    test('treats null as unset', () => {
        expect(assertValidPdfToPngOptions({ pagesToProcess: null } as unknown as PdfToPngOptions).pagesToProcess).toBeUndefined();
    });
});

describe('outputFolder and outputFileMaskFunc shape', () => {
    // Every other option treats null as unset, so these two must as well instead of crashing after the document has loaded.
    test('treats a null outputFolder as unset and keeps the pages in memory', async () => {
        const pages = await pdfToPng(samplePdf, { outputFolder: null, pagesToProcess: [1] } as unknown as PdfToPngOptions);

        expect(pages).toHaveLength(1);
        expect(pages[0]).toMatchObject({ kind: 'content', name: 'sample_page_1.png', path: '' });
    });

    test('treats a null outputFileMaskFunc as unset and keeps the default names', async () => {
        const pages = await pdfToPng(samplePdf, { outputFileMaskFunc: null, returnMetadataOnly: true } as unknown as PdfToPngOptions);

        expect(pages.map((page) => page.name)).toEqual(['sample_page_1.png', 'sample_page_2.png']);
    });

    test.each([
        ['outputFolder', 42, 'outputFolder must be a string'],
        ['outputFolder', {}, 'outputFolder must be a string'],
        ['outputFileMaskFunc', 'page.png', 'outputFileMaskFunc must be a function'],
        ['outputFileMaskFunc', {}, 'outputFileMaskFunc must be a function'],
    ])('rejects a non-%s value %j before input work', async (option, value, message) => {
        await expect(pdfToPng(missingInput, { [option]: value } as unknown as PdfToPngOptions)).rejects.toThrow(message);
    });
});

describe('validation precedes input work', () => {
    test.each<[string, PdfToPngOptions, string]>([
        ['viewportScale', { viewportScale: 0 }, 'viewportScale must be a finite number'],
        ['blank outputFolder', { outputFolder: ' ' }, 'outputFolder must not be empty'],
        ['pagesToProcess entry', { pagesToProcess: [0] }, 'pagesToProcess contains invalid page number: 0'],
        ['concurrencyLimit', { processPagesInParallel: true, concurrencyLimit: 0 }, 'concurrencyLimit must be a positive integer'],
        ['maxInputBytes', { maxInputBytes: -1 }, 'maxInputBytes must be a positive integer'],
    ])('reports an invalid %s instead of the missing input file', async (_label, options, message) => {
        await expect(pdfToPng(missingInput, options)).rejects.toThrow(message);
    });
});

describe('runtime defaults', () => {
    // Literals, not PDF_TO_PNG_OPTIONS_DEFAULTS: this pins the values documented in src/types.ts ("Default:") to what runs.
    const documentedDefaults = {
        viewportScale: 1,
        disableFontFace: true,
        useSystemFonts: false,
        enableXfa: true,
        pdfFilePassword: undefined,
        outputFolder: undefined,
        outputFileMaskFunc: undefined,
        pagesToProcess: undefined,
        verbosityLevel: VerbosityLevel.ERRORS,
        returnPageContent: true,
        returnMetadataOnly: false,
        processPagesInParallel: false,
        renderInWorkerThreads: false,
        concurrencyLimit: 4,
        maxInputBytes: 256 * 1024 * 1024,
    };

    test.each([
        ['no options', undefined],
        ['an empty options object', {}],
    ])('normalizes %s to the documented defaults', (_label, options) => {
        expect(assertValidPdfToPngOptions(options)).toStrictEqual(documentedDefaults);
    });
});
