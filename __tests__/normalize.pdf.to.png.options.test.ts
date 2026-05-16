import { expect, test } from 'vitest';
import { MAX_CONCURRENCY_LIMIT, MAX_INPUT_BYTES } from '../src/const';
import type { PdfToPngOptions } from '../src/interfaces/pdf.to.png.options.js';
import { normalizePdfToPngOptions } from '../src/normalizePdfToPngOptions';

test('should apply defaults when options are undefined', () => {
    expect(normalizePdfToPngOptions(undefined)).toEqual({
        viewportScale: 1,
        disableFontFace: true,
        useSystemFonts: false,
        enableXfa: true,
        pdfFilePassword: undefined,
        outputFolder: undefined,
        outputFileMaskFunc: undefined,
        pagesToProcess: undefined,
        verbosityLevel: 0,
        returnPageContent: true,
        returnMetadataOnly: false,
        processPagesInParallel: false,
        concurrencyLimit: 4,
        maxInputBytes: MAX_INPUT_BYTES,
    });
});

test('should preserve explicitly provided happy-path values', () => {
    const outputFileMaskFunc = (pageNumber: number): string => `page-${pageNumber}.png`;

    expect(
        normalizePdfToPngOptions({
            viewportScale: 2,
            disableFontFace: false,
            useSystemFonts: true,
            enableXfa: false,
            pdfFilePassword: 'secret',
            outputFolder: 'out',
            outputFileMaskFunc,
            pagesToProcess: [1, 2, 3],
            verbosityLevel: 5,
            returnPageContent: false,
            returnMetadataOnly: true,
            processPagesInParallel: true,
            concurrencyLimit: 2,
            maxInputBytes: 1024,
        }),
    ).toEqual({
        viewportScale: 2,
        disableFontFace: false,
        useSystemFonts: true,
        enableXfa: false,
        pdfFilePassword: 'secret',
        outputFolder: 'out',
        outputFileMaskFunc,
        pagesToProcess: [1, 2, 3],
        verbosityLevel: 5,
        returnPageContent: false,
        returnMetadataOnly: true,
        processPagesInParallel: true,
        concurrencyLimit: 2,
        maxInputBytes: 1024,
    });
});

test('should reject concurrencyLimit values above MAX_CONCURRENCY_LIMIT when parallel is enabled', () => {
    expect(() => normalizePdfToPngOptions({ processPagesInParallel: true, concurrencyLimit: MAX_CONCURRENCY_LIMIT + 1 })).toThrow(
        `concurrencyLimit must be between 1 and ${MAX_CONCURRENCY_LIMIT}`,
    );
    expect(() => normalizePdfToPngOptions({ processPagesInParallel: true, concurrencyLimit: Number.MAX_SAFE_INTEGER })).toThrow(
        `concurrencyLimit must be between 1 and ${MAX_CONCURRENCY_LIMIT}`,
    );
});

test('should allow concurrencyLimit equal to MAX_CONCURRENCY_LIMIT', () => {
    expect(() => normalizePdfToPngOptions({ processPagesInParallel: true, concurrencyLimit: MAX_CONCURRENCY_LIMIT })).not.toThrow();
});

test('should ignore concurrencyLimit upper bound when parallel mode is disabled', () => {
    expect(() => normalizePdfToPngOptions({ concurrencyLimit: Number.MAX_SAFE_INTEGER })).not.toThrow();
});

test('should reject non-positive or non-integer maxInputBytes', () => {
    expect(() => normalizePdfToPngOptions({ maxInputBytes: 0 })).toThrow('maxInputBytes must be a positive integer');
    expect(() => normalizePdfToPngOptions({ maxInputBytes: -1 })).toThrow('maxInputBytes must be a positive integer');
    expect(() => normalizePdfToPngOptions({ maxInputBytes: 1.5 })).toThrow('maxInputBytes must be a positive integer');
    expect(() => normalizePdfToPngOptions({ maxInputBytes: Number.NaN })).toThrow('maxInputBytes must be a positive integer');
});

test('should reject an empty outputFolder before any I/O', () => {
    expect(() => normalizePdfToPngOptions({ outputFolder: '' })).toThrow('outputFolder must not be empty');
    expect(() => normalizePdfToPngOptions({ outputFolder: '   ' })).toThrow('outputFolder must not be empty');
});

test('should reject invalid verbosity levels', () => {
    const invalidOptions = { verbosityLevel: 3 } as unknown as PdfToPngOptions;

    expect(() => normalizePdfToPngOptions(invalidOptions)).toThrow('verbosityLevel must be 0, 1, or 5');
});

test('should allow supported verbosity levels', () => {
    expect(() => normalizePdfToPngOptions({ verbosityLevel: 0 })).not.toThrow();
    expect(() => normalizePdfToPngOptions({ verbosityLevel: 1 })).not.toThrow();
    expect(() => normalizePdfToPngOptions({ verbosityLevel: 5 })).not.toThrow();
});

test('should reject non-positive pagesToProcess values', () => {
    expect(() => normalizePdfToPngOptions({ pagesToProcess: [0] })).toThrow('pagesToProcess contains invalid page number: 0');
    expect(() => normalizePdfToPngOptions({ pagesToProcess: [-1] })).toThrow('pagesToProcess contains invalid page number: -1');
});

test('should reject non-integer pagesToProcess values', () => {
    expect(() => normalizePdfToPngOptions({ pagesToProcess: [1.5] })).toThrow('pagesToProcess contains invalid page number: 1.5');
});
