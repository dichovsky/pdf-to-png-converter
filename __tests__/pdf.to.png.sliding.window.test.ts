import { expect, test, vi } from 'vitest';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import * as pageRenderer from '../src/pageRenderer.js';
import * as pdfjsLoader from '../src/pdfjsLoader.js';
import { pdfToPng } from '../src/pdfToPng.js';

function createDeferred(): { promise: Promise<void>; resolve: () => void } {
    let resolve!: () => void;
    const promise = new Promise<void>((res) => {
        resolve = res;
    });

    return { promise, resolve };
}

test('should start the next page as soon as a parallel slot frees up', async () => {
    const destroy = vi.fn().mockResolvedValue(undefined);
    const mockDocument = { numPages: 5, destroy } as unknown as PDFDocumentProxy;
    vi.spyOn(pdfjsLoader, 'getPdfDocument').mockResolvedValue(mockDocument);

    const startedPages: number[] = [];
    const deferredRenders = new Map<number, { promise: Promise<void>; resolve: () => void }>();
    for (const pageNumber of [1, 2, 3, 4, 5]) {
        deferredRenders.set(pageNumber, createDeferred());
    }

    vi.spyOn(pageRenderer, 'renderPdfPage').mockImplementation(async (_pdf, pageName, pageNumber) => {
        startedPages.push(pageNumber);
        await deferredRenders.get(pageNumber)?.promise;
        return {
            kind: 'content',
            pageNumber,
            name: pageName,
            content: Buffer.from(String(pageNumber)),
            path: '',
            width: 100,
            height: 100,
            rotation: 0,
        };
    });

    const conversionPromise = pdfToPng(new Uint8Array([1]), {
        processPagesInParallel: true,
        concurrencyLimit: 2,
        pagesToProcess: [1, 2, 3, 4, 5],
    });

    await vi.waitFor(() => {
        expect(startedPages).toEqual([1, 2]);
    });

    deferredRenders.get(1)?.resolve();
    await vi.waitFor(() => {
        expect(startedPages).toEqual([1, 2, 3]);
    });

    deferredRenders.get(2)?.resolve();
    await vi.waitFor(() => {
        expect(startedPages).toEqual([1, 2, 3, 4]);
    });

    deferredRenders.get(3)?.resolve();
    deferredRenders.get(4)?.resolve();
    await vi.waitFor(() => {
        expect(startedPages).toEqual([1, 2, 3, 4, 5]);
    });

    deferredRenders.get(5)?.resolve();
    const results = await conversionPromise;

    expect(results.map((page) => page.pageNumber)).toEqual([1, 2, 3, 4, 5]);
    expect(destroy).toHaveBeenCalled();
});
