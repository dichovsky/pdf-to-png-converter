import { expect, test } from 'vitest';
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
    });
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
