import { promises as fsPromises } from 'node:fs';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import { afterEach, expect, test, vi } from 'vitest';
import { pdfToPng } from '../src/pdfToPng.js';
import * as pdfjsLoader from '../src/pdfjsLoader.js';

afterEach(() => {
    vi.restoreAllMocks();
});

test('pdfDocument.loadingTask.destroy() runs when output-folder preparation fails', async () => {
    const destroy = vi.fn().mockResolvedValue(undefined);
    const mockDocument = { numPages: 1, loadingTask: { destroy } } as unknown as PDFDocumentProxy;
    vi.spyOn(pdfjsLoader, 'getPdfDocument').mockResolvedValue(mockDocument);

    vi.spyOn(fsPromises, 'mkdir').mockRejectedValue(new Error('EACCES: permission denied'));

    await expect(pdfToPng(new Uint8Array([1]), { outputFolder: '/tmp/should-never-be-created-by-this-test' })).rejects.toThrow(
        'EACCES: permission denied',
    );
    expect(destroy).toHaveBeenCalledOnce();
});

test('a failing loadingTask.destroy() is not swallowed: the main-thread teardown error is the conversion error', async () => {
    // Pins the main-thread policy: a pdf.js teardown failure surfaces, exactly as a page.cleanup() failure does
    // (page.renderer.cleanup.test.ts). Only Worker.terminate() is tolerated, because that is a Node resource whose
    // failure says nothing about the pages (worker.pool.test.ts). pdfjs-dist cannot reject destroy() in Node today.
    const teardownError = new Error('loadingTask.destroy failed');
    const destroy = vi.fn().mockRejectedValue(teardownError);
    vi.spyOn(pdfjsLoader, 'getPdfDocument').mockResolvedValue({ numPages: 1, loadingTask: { destroy } } as unknown as PDFDocumentProxy);

    await expect(pdfToPng(new Uint8Array([1]), { pagesToProcess: [] })).rejects.toBe(teardownError);
    expect(destroy).toHaveBeenCalledOnce();
});
