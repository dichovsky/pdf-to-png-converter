import { promises as fsPromises } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import { afterEach, expect, test, vi } from 'vitest';
import * as pageRenderer from '../src/pageRenderer.js';
import { pdfToPng } from '../src/pdfToPng.js';
import * as pdfjsLoader from '../src/pdfjsLoader.js';

afterEach(() => {
    vi.restoreAllMocks();
});

test('rejects a file write when a renderer violates the content contract', async () => {
    const outputFolder = await fsPromises.mkdtemp(join(tmpdir(), 'pdf-to-png-undefined-content-'));
    const destroy = vi.fn().mockResolvedValue(undefined);
    const mockDocument = { numPages: 1, loadingTask: { destroy } } as unknown as PDFDocumentProxy;
    vi.spyOn(pdfjsLoader, 'getPdfDocument').mockResolvedValue(mockDocument);
    vi.spyOn(pageRenderer, 'renderPdfPage').mockResolvedValue({
        width: 10,
        height: 20,
        rotation: 0,
        content: undefined,
    });

    try {
        await expect(pdfToPng(new Uint8Array([1]), { outputFolder })).rejects.toThrow(
            'Cannot write PNG file "buffer_page_1.png" because content is undefined.',
        );
        expect(destroy).toHaveBeenCalledOnce();
    } finally {
        await fsPromises.rm(outputFolder, { recursive: true, force: true });
    }
});
