import type { PDFDocumentLoadingTask, PDFDocumentProxy } from 'pdfjs-dist';
import type { DocumentInitParameters } from 'pdfjs-dist/types/src/display/api';
import { expect, test, vi } from 'vitest';
import { VerbosityLevel } from '../src/types.js';

const getDocument = vi.fn<(parameters: DocumentInitParameters) => PDFDocumentLoadingTask>();
const pathHarness = vi.hoisted(() => ({ returnRoot: false }));

vi.mock('node:path', async (importOriginal) => {
    const actual = await importOriginal<typeof import('node:path')>();
    return {
        ...actual.win32,
        default: actual.win32,
        resolve: (...paths: string[]): string => (pathHarness.returnRoot ? 'C:\\' : actual.win32.resolve(...paths)),
    };
});

vi.mock('pdfjs-dist/legacy/build/pdf.mjs', () => ({ getDocument }));

test('pdf.js factory URLs retain forward slashes under Windows path semantics', async () => {
    const document = {} as PDFDocumentProxy;
    getDocument.mockReturnValueOnce({ promise: Promise.resolve(document) } as PDFDocumentLoadingTask);
    const { getPdfDocument } = await import('../src/pdfjsLoader.js');

    await expect(
        getPdfDocument(new Uint8Array([1]), {
            disableFontFace: true,
            useSystemFonts: false,
            enableXfa: true,
            pdfFilePassword: undefined,
            verbosityLevel: VerbosityLevel.ERRORS,
        }),
    ).resolves.toBe(document);

    const parameters = getDocument.mock.calls[0][0];
    for (const url of [parameters.cMapUrl, parameters.standardFontDataUrl]) {
        expect(url).toMatch(/\/$/);
        expect(url).not.toContain('\\');
    }
});

test('pdf.js factory URLs preserve an existing portable trailing slash', async () => {
    pathHarness.returnRoot = true;
    const document = {} as PDFDocumentProxy;
    getDocument.mockReturnValueOnce({ promise: Promise.resolve(document) } as PDFDocumentLoadingTask);
    const { getPdfDocument } = await import('../src/pdfjsLoader.js');

    await expect(
        getPdfDocument(new Uint8Array([1]), {
            disableFontFace: true,
            useSystemFonts: false,
            enableXfa: true,
            pdfFilePassword: undefined,
            verbosityLevel: VerbosityLevel.ERRORS,
        }),
    ).resolves.toBe(document);

    const parameters = getDocument.mock.calls.at(-1)?.[0];
    expect(parameters?.cMapUrl).toBe('C:/');
    expect(parameters?.standardFontDataUrl).toBe('C:/');
});
