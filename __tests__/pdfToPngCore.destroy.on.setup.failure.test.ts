import { promises as fsPromises } from 'node:fs';
import { afterEach, expect, test, vi } from 'vitest';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import { normalizePdfToPngOptions } from '../src/normalizePdfToPngOptions.js';
import * as pdfjsLoader from '../src/pdfjsLoader.js';
import { pdfToPngCore } from '../src/pdfToPngCore.js';

afterEach(() => {
    vi.restoreAllMocks();
});

/**
 * Regression guard for the PR-review fix.
 *
 * Before the fix, `pdfDocument.loadingTask.destroy()` lived in a `try/finally` that started AFTER
 * `mkdir(outputFolder)` and `realpath(outputFolder)`. If either of those threw — which
 * is realistic for EACCES, EROFS, ENOENT on bind-mounted volumes — the PDF.js document
 * and worker would leak. The fix moves the `try` opening to right after `getPdfDocument()`
 * succeeds so the worker is always destroyed.
 */
test('pdfDocument.loadingTask.destroy() runs even when mkdir(outputFolder) throws', async () => {
    const destroy = vi.fn().mockResolvedValue(undefined);
    const mockDocument = { numPages: 1, loadingTask: { destroy } } as unknown as PDFDocumentProxy;
    vi.spyOn(pdfjsLoader, 'getPdfDocument').mockResolvedValue(mockDocument);

    const mkdirError = new Error('EACCES: permission denied');
    vi.spyOn(fsPromises, 'mkdir').mockRejectedValue(mkdirError);

    const normalized = normalizePdfToPngOptions({ outputFolder: '/tmp/should-never-be-created-by-this-test' });

    await expect(pdfToPngCore(new Uint8Array([1]), normalized)).rejects.toThrow('EACCES: permission denied');

    expect(destroy).toHaveBeenCalledTimes(1);
});
