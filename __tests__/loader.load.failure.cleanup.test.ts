import type { PDFDocumentLoadingTask, PDFDocumentProxy } from 'pdfjs-dist';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { VerbosityLevel } from '../src/types.js';

/**
 * A load failure has a matching cleanup path (CLAUDE.md invariant 8): when pdf.js rejects the load (a malformed PDF, a
 * wrong or missing password), getPdfDocument destroys the loading task once and rethrows the original error. Tests with
 * real pdf.js only see the rethrown error, so deleting the destroy call failed none of them.
 */

const getDocument = vi.fn();
const documentOptions = {
    disableFontFace: true,
    useSystemFonts: false,
    enableXfa: true,
    pdfFilePassword: undefined,
    verbosityLevel: VerbosityLevel.ERRORS,
};

beforeEach(() => {
    vi.resetModules();
    getDocument.mockReset();
    vi.doMock('pdfjs-dist/legacy/build/pdf.mjs', () => ({ getDocument }));
});

afterEach(() => {
    vi.doUnmock('pdfjs-dist/legacy/build/pdf.mjs');
    vi.resetModules();
});

test('a rejected load destroys the loading task once and rethrows the original error', async () => {
    const original = new Error('Invalid PDF structure.');
    const destroy = vi.fn().mockResolvedValue(undefined);
    // Created inside the mock so the rejection already has a handler when it exists (no unhandled-rejection report).
    getDocument.mockImplementationOnce(() => ({ promise: Promise.reject(original), destroy }) as unknown as PDFDocumentLoadingTask);
    const { getPdfDocument } = await import('../src/pdfjsLoader.js');

    await expect(getPdfDocument(new Uint8Array([1]), documentOptions)).rejects.toBe(original);
    expect(destroy).toHaveBeenCalledOnce();
});

test('a successful load hands the document to the caller without destroying it', async () => {
    const loaded = {} as PDFDocumentProxy;
    const destroy = vi.fn().mockResolvedValue(undefined);
    getDocument.mockReturnValueOnce({ promise: Promise.resolve(loaded), destroy } as unknown as PDFDocumentLoadingTask);
    const { getPdfDocument } = await import('../src/pdfjsLoader.js');

    await expect(getPdfDocument(new Uint8Array([1]), documentOptions)).resolves.toBe(loaded);
    expect(destroy).not.toHaveBeenCalled();
});
