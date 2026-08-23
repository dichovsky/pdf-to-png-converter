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
