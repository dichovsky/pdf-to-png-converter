import { beforeEach, expect, test, vi } from 'vitest';
import type { RenderPageRequest, WorkerResponse } from '../src/interfaces/worker.protocol';

/**
 * Unit tests for src/pageRenderWorker.ts's message classification (result / render-error /
 * fatal) with a mocked worker context — the file is excluded from V8 coverage because it
 * normally executes inside worker threads, so this exercises its logic in-process.
 */

const context = vi.hoisted(() => {
    type Handler = (message: unknown) => void;
    const state = {
        posted: [] as WorkerResponse[],
        handlers: [] as Handler[],
        parentPort: {
            on: (_event: string, handler: Handler): void => {
                state.handlers.push(handler);
            },
            postMessage: (message: WorkerResponse): void => {
                state.posted.push(message);
            },
        },
        workerData: {
            pdfBuffer: new Uint8Array([1, 2, 3]),
            documentOptions: { viewportScale: 1 },
            materializeContent: true,
        },
    };
    return state;
});

vi.mock('node:worker_threads', () => ({ parentPort: context.parentPort, workerData: context.workerData }));
vi.mock('../src/pdfjsLoader', () => ({ getPdfDocument: vi.fn() }));
vi.mock('../src/pageRenderer', () => ({ renderPdfPage: vi.fn() }));

import { getPdfDocument } from '../src/pdfjsLoader';
import { renderPdfPage } from '../src/pageRenderer';

const getPdfDocumentMock = vi.mocked(getPdfDocument);
const renderPdfPageMock = vi.mocked(renderPdfPage);

beforeEach(async () => {
    // Fresh module instance per test: pageRenderWorker caches its document promise at module
    // level, so each test re-imports it to start from a clean slate.
    vi.resetModules();
    context.handlers.length = 0;
    context.posted.length = 0;
    getPdfDocumentMock.mockReset();
    renderPdfPageMock.mockReset();
    await import('../src/pageRenderWorker.js');
});

function send(request: RenderPageRequest): void {
    for (const handler of context.handlers) {
        handler(request);
    }
}

function renderRequest(index: number): RenderPageRequest {
    return { type: 'render', index, pageNumber: index + 1, pageName: `page_${index + 1}.png` };
}

test('renders a page and posts a result, loading the document exactly once across pages', async () => {
    expect(context.handlers).toHaveLength(1);
    getPdfDocumentMock.mockResolvedValue({} as never);
    renderPdfPageMock.mockImplementation(async (_pdf, pageName, pageNumber) => ({
        kind: 'content',
        pageNumber,
        name: pageName,
        content: Buffer.from([pageNumber]),
        path: '',
        width: 10,
        height: 10,
        rotation: 0,
    }));

    send(renderRequest(0));
    send(renderRequest(1));
    await vi.waitFor(() => {
        expect(context.posted).toHaveLength(2);
    });

    const kinds = context.posted.map((response) => response.type);
    expect(kinds).toEqual(['result', 'result']);
    const first = context.posted.find((response) => response.type === 'result' && response.index === 0);
    if (first?.type === 'result') {
        expect(first.pageNumber).toBe(1);
        expect(Array.from(first.content ?? [])).toEqual([1]);
    }
    // Document reuse: one load serves both pages.
    expect(getPdfDocumentMock).toHaveBeenCalledTimes(1);
});

test('posts a render-error carrying the original error when one page fails, then keeps serving', async () => {
    getPdfDocumentMock.mockResolvedValue({} as never);
    const renderError = new Error('Canvas 20000×20000 px exceeds the pixel limit');
    renderPdfPageMock.mockRejectedValueOnce(renderError).mockResolvedValueOnce({
        kind: 'content',
        pageNumber: 5,
        name: 'page_5.png',
        content: undefined,
        path: '',
        width: 10,
        height: 10,
        rotation: 0,
    });

    send(renderRequest(3));
    await vi.waitFor(() => {
        expect(context.posted).toHaveLength(1);
    });
    expect(context.posted[0]).toEqual({ type: 'render-error', index: 3, error: renderError });

    // The worker stays usable for other pages after a per-page failure.
    send(renderRequest(4));
    await vi.waitFor(() => {
        expect(context.posted).toHaveLength(2);
    });
    expect(context.posted[1].type).toBe('result');
});

test('posts fatal when the document cannot be loaded, and keeps failing fatal (cached rejection)', async () => {
    const loadError = new Error('No password given');
    getPdfDocumentMock.mockRejectedValue(loadError);

    send(renderRequest(0));
    await vi.waitFor(() => {
        expect(context.posted).toHaveLength(1);
    });
    expect(context.posted[0]).toEqual({ type: 'fatal', error: loadError });

    // The failed load is cached (the pool terminates the worker after a fatal anyway) — a
    // straggler request posts fatal again rather than retrying the load.
    send(renderRequest(1));
    await vi.waitFor(() => {
        expect(context.posted).toHaveLength(2);
    });
    expect(context.posted[1]).toEqual({ type: 'fatal', error: loadError });
    expect(getPdfDocumentMock).toHaveBeenCalledTimes(1);
});
