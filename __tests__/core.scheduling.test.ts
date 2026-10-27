import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import { afterEach, beforeAll, describe, expect, test, vi, type MockInstance } from 'vitest';
import * as pageRenderer from '../src/pageRenderer.js';
import type { PageRenderResult } from '../src/pageRenderer.js';
import * as pdfjsLoader from '../src/pdfjsLoader.js';
import { pdfToPng } from '../src/pdfToPng.js';
import type { PdfToPngOptions } from '../src/types.js';
import * as workerPool from '../src/workerPool.js';

/**
 * Pins the planning and scheduling contract of pdfToPng() against a mocked document, so it needs no real pdf.js render and
 * no worker thread: requested page order, the option snapshot, flag precedence and which modes never reach the worker pool.
 */

// Run the real one-time wasm warm-up (issue #288) first; the mocks below replace getPdfDocument for the conversions only.
beforeAll(() => pdfjsLoader.warmUpWasmDecoders());

afterEach(() => {
    vi.restoreAllMocks();
});

const input = new Uint8Array([1]);
// Unsorted, with a duplicate, and with page numbers above the 5th page of the shorter mock documents.
const requestedPages = [9, 2, 5, 2, 12, 1];

function rendered(pageNumber: number): PageRenderResult {
    return { content: Buffer.from(String(pageNumber)), width: 100 + pageNumber, height: 100, rotation: 0 };
}

function mockDocument(numPages: number): { destroy: ReturnType<typeof vi.fn> } {
    const destroy = vi.fn().mockResolvedValue(undefined);
    vi.spyOn(pdfjsLoader, 'getPdfDocument').mockResolvedValue({ numPages, loadingTask: { destroy } } as unknown as PDFDocumentProxy);
    return { destroy };
}

function mockPageRenderers(): void {
    vi.spyOn(pageRenderer, 'renderPdfPage').mockImplementation(async (_pdf, pageNumber) => rendered(pageNumber));
    vi.spyOn(pageRenderer, 'getPageMetadata').mockImplementation(async (_pdf, pageNumber) => ({
        ...rendered(pageNumber),
        content: undefined,
    }));
}

/** A worker pool whose workers finish in the reverse of the dispatch order. */
function mockReversedWorkerPool(): MockInstance<typeof workerPool.renderPagesInWorkerPool> {
    return vi
        .spyOn(workerPool, 'renderPagesInWorkerPool')
        .mockImplementation(async (_pdfBuffer, _renderOptions, _materializeContent, tasks, _poolSize, onPageRendered) => {
            for (const task of [...tasks].reverse()) {
                await onPageRendered(task.index, rendered(task.pageNumber));
            }
        });
}

describe('requested page order', () => {
    test.each<[string, PdfToPngOptions]>([
        ['default (sequential pipeline)', {}],
        ['processPagesInParallel', { processPagesInParallel: true, concurrencyLimit: 4 }],
        ['processPagesInParallel with concurrencyLimit 1', { processPagesInParallel: true, concurrencyLimit: 1 }],
        ['returnMetadataOnly', { returnMetadataOnly: true }],
        ['returnMetadataOnly with processPagesInParallel', { returnMetadataOnly: true, processPagesInParallel: true, concurrencyLimit: 2 }],
    ])('%s keeps unsorted and duplicate pagesToProcess in request order', async (_label, options) => {
        const { destroy } = mockDocument(12);
        mockPageRenderers();

        const pages = await pdfToPng(input, { ...options, pagesToProcess: requestedPages });

        expect(pages.map((page) => page.pageNumber)).toEqual(requestedPages);
        expect(pages.map((page) => page.name)).toEqual(requestedPages.map((pageNumber) => `buffer_page_${pageNumber}.png`));
        expect(pages.map((page) => page.width)).toEqual(requestedPages.map((pageNumber) => 100 + pageNumber));
        expect(destroy).toHaveBeenCalledOnce();
    });

    test('renderInWorkerThreads keeps the request order when workers finish in reverse', async () => {
        const { destroy } = mockDocument(12);
        const pool = mockReversedWorkerPool();

        const pages = await pdfToPng(input, { renderInWorkerThreads: true, concurrencyLimit: 3, pagesToProcess: requestedPages });

        expect(pool).toHaveBeenCalledOnce();
        expect(pool.mock.calls[0][3]).toEqual(requestedPages.map((pageNumber, index) => ({ index, pageNumber })));
        expect(pages.map((page) => page.pageNumber)).toEqual(requestedPages);
        expect(pages.map((page) => page.width)).toEqual(requestedPages.map((pageNumber) => 100 + pageNumber));
        expect(destroy).toHaveBeenCalledOnce();
    });

    test('pages above the document page count are dropped without disturbing the order of the rest', async () => {
        mockDocument(5);
        mockPageRenderers();

        const pages = await pdfToPng(input, { pagesToProcess: requestedPages });

        expect(pages.map((page) => page.pageNumber)).toEqual([2, 5, 2, 1]);
    });
});

describe('worker pool selection', () => {
    test('renderInWorkerThreads takes precedence over processPagesInParallel', async () => {
        mockDocument(3);
        const pool = mockReversedWorkerPool();
        const render = vi.spyOn(pageRenderer, 'renderPdfPage');

        const pages = await pdfToPng(input, { renderInWorkerThreads: true, processPagesInParallel: true, concurrencyLimit: 2 });

        expect(pages.map((page) => page.pageNumber)).toEqual([1, 2, 3]);
        expect(pool).toHaveBeenCalledOnce();
        // The pool size is the concurrencyLimit.
        expect(pool.mock.calls[0][4]).toBe(2);
        expect(render).not.toHaveBeenCalled();
    });

    test('renderInWorkerThreads is ignored for metadata-only requests: no pool, no PDF copy for workers', async () => {
        mockDocument(3);
        mockPageRenderers();
        const pool = mockReversedWorkerPool();

        const pages = await pdfToPng(input, { renderInWorkerThreads: true, returnMetadataOnly: true, concurrencyLimit: 2 });

        expect(pages.map((page) => page.kind)).toEqual(['metadata', 'metadata', 'metadata']);
        expect(pool).not.toHaveBeenCalled();
        expect(pageRenderer.getPageMetadata).toHaveBeenCalledTimes(3);
        expect(pageRenderer.renderPdfPage).not.toHaveBeenCalled();
    });
});

describe('option snapshot', () => {
    test('options changed after the call do not change the conversion', async () => {
        mockDocument(5);
        mockPageRenderers();
        const names = (pageNumber: number): string => `kept_${pageNumber}.png`;
        const options: PdfToPngOptions = {
            pagesToProcess: [4, 1],
            viewportScale: 2,
            returnMetadataOnly: true,
            outputFileMaskFunc: names,
        };

        const conversion = pdfToPng(input, options);
        // Everything below happens before the first await of the call resumes.
        options.pagesToProcess?.splice(0, 2, 5);
        options.viewportScale = 1;
        options.returnMetadataOnly = false;
        options.outputFileMaskFunc = (pageNumber) => `changed_${pageNumber}.png`;
        const pages = await conversion;

        expect(pages.map((page) => [page.kind, page.pageNumber, page.name])).toEqual([
            ['metadata', 4, 'kept_4.png'],
            ['metadata', 1, 'kept_1.png'],
        ]);
        expect(pageRenderer.getPageMetadata).toHaveBeenCalledWith(expect.anything(), 4, 2);
        expect(pageRenderer.renderPdfPage).not.toHaveBeenCalled();
    });
});

describe('output names are planned before the output folder is created', () => {
    test.each<[string, (pageNumber: number) => unknown, string]>([
        ['an empty name', () => '', 'returned an empty filename for page 1'],
        ['a non-string name', () => 42, 'returned a non-string filename for page 1'],
        ['a name with a path separator', () => 'nested/page.png', 'containing a path separator for page 1'],
    ])('%s leaves no output folder behind', async (_label, mask, message) => {
        mockDocument(2);
        mockPageRenderers();
        const outputFolder = join(tmpdir(), `pdf-to-png-core-names-${process.pid}-${Date.now()}`);

        await expect(
            pdfToPng(input, { outputFolder, pagesToProcess: [1], outputFileMaskFunc: mask as (pageNumber: number) => string }),
        ).rejects.toThrow(message);

        expect(existsSync(outputFolder)).toBe(false);
    });
});
