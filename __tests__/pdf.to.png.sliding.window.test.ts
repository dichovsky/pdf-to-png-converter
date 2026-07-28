import { afterEach, expect, test, vi } from 'vitest';
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

afterEach(() => {
    vi.restoreAllMocks();
});

test('should start the next page as soon as a parallel slot frees up', async () => {
    const destroy = vi.fn().mockResolvedValue(undefined);
    const mockDocument = { numPages: 5, loadingTask: { destroy } } as unknown as PDFDocumentProxy;
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

    // concurrencyLimit 2 deliberately differs from SEQUENTIAL_PIPELINE_WINDOW (3) so this test
    // proves the parallel window width really comes from the option, not the sequential constant
    // — including narrowing below it.
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

test('sequential mode pipelines with a window of 3 while preserving output order', async () => {
    const destroy = vi.fn().mockResolvedValue(undefined);
    const mockDocument = { numPages: 5, loadingTask: { destroy } } as unknown as PDFDocumentProxy;
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

    // Default options: processPagesInParallel is false → SEQUENTIAL_PIPELINE_WINDOW (3) applies.
    const conversionPromise = pdfToPng(new Uint8Array([1]), {
        pagesToProcess: [1, 2, 3, 4, 5],
    });

    // Window of 3: pages 2 and 3 start while page 1 is still in flight, page 4 must wait.
    await vi.waitFor(() => {
        expect(startedPages).toEqual([1, 2, 3]);
    });

    deferredRenders.get(1)?.resolve();
    await vi.waitFor(() => {
        expect(startedPages).toEqual([1, 2, 3, 4]);
    });

    deferredRenders.get(2)?.resolve();
    await vi.waitFor(() => {
        expect(startedPages).toEqual([1, 2, 3, 4, 5]);
    });

    deferredRenders.get(3)?.resolve();
    deferredRenders.get(4)?.resolve();
    deferredRenders.get(5)?.resolve();
    const results = await conversionPromise;

    expect(results.map((page) => page.pageNumber)).toEqual([1, 2, 3, 4, 5]);
    expect(destroy).toHaveBeenCalled();
});

test('sequential mode: a failure stops new pages after the in-flight ones and throws the first error', async () => {
    const destroy = vi.fn().mockResolvedValue(undefined);
    const mockDocument = { numPages: 5, loadingTask: { destroy } } as unknown as PDFDocumentProxy;
    vi.spyOn(pdfjsLoader, 'getPdfDocument').mockResolvedValue(mockDocument);

    const startedPages: number[] = [];
    const deferredRenders = new Map<number, { promise: Promise<void>; resolve: () => void }>();
    for (const pageNumber of [2, 3]) {
        deferredRenders.set(pageNumber, createDeferred());
    }
    vi.spyOn(pageRenderer, 'renderPdfPage').mockImplementation(async (_pdf, pageName, pageNumber) => {
        startedPages.push(pageNumber);
        if (pageNumber === 1) {
            throw new Error('page 1 render failed');
        }
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

    const conversionPromise = pdfToPng(new Uint8Array([1]), { pagesToProcess: [1, 2, 3, 4, 5] });

    // Window of 3: pages 1-3 start; page 1's failure must prevent pages 4 and 5 from ever
    // starting, while the already-in-flight pages 2 and 3 finish before the promise rejects.
    await vi.waitFor(() => {
        expect(startedPages).toEqual([1, 2, 3]);
    });
    deferredRenders.get(2)?.resolve();
    deferredRenders.get(3)?.resolve();

    await expect(conversionPromise).rejects.toThrow('page 1 render failed');
    expect(startedPages).toEqual([1, 2, 3]);
    expect(destroy).toHaveBeenCalled();
});

test('should reject when a parallel page rejects with undefined', async () => {
    const destroy = vi.fn().mockResolvedValue(undefined);
    const mockDocument = { numPages: 1, loadingTask: { destroy } } as unknown as PDFDocumentProxy;
    vi.spyOn(pdfjsLoader, 'getPdfDocument').mockResolvedValue(mockDocument);
    vi.spyOn(pageRenderer, 'renderPdfPage').mockRejectedValue(undefined);

    const outcome = await pdfToPng(new Uint8Array([1]), {
        processPagesInParallel: true,
        concurrencyLimit: 1,
        pagesToProcess: [1],
    }).then(
        (value) => ({ status: 'fulfilled' as const, value }),
        (reason: unknown) => ({ status: 'rejected' as const, reason }),
    );

    expect(outcome).toEqual({ status: 'rejected', reason: undefined });
    expect(destroy).toHaveBeenCalled();
});
