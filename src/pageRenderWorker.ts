import { types } from 'node:util';
import { parentPort, workerData } from 'node:worker_threads';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import { renderPdfPage } from './pageRenderer.js';
import { getPdfDocument } from './pdfjsLoader.js';
import type { RenderPageRequest, WorkerInitData, WorkerResponse } from './workerPool.js';

/**
 * Worker-thread entry point for `renderInWorkerThreads` mode.
 *
 * Each worker loads its OWN copy of the PDF document (pdf.js documents are not transferable
 * across threads) and renders the pages the pool assigns to it, end-to-end: getPage → render →
 * PNG encode. Disk writes stay on the main thread so the SEC-001/002/003 path guards run in
 * exactly one place. Workers never exit on their own — the pool terminates them.
 *
 * Runs only as a compiled artifact (`out/pageRenderWorker.js`); see `resolveWorkerEntryPath`
 * in `src/workerPool.ts` for how the pool locates it.
 */

if (parentPort === null) {
    throw new Error('pageRenderWorker must be started as a worker thread.');
}
const port = parentPort;
const init = workerData as WorkerInitData;

let documentPromise: Promise<PDFDocumentProxy> | undefined;

/**
 * Rebuilds an Error that is not a native error as a native one. pdf.js exceptions are `instanceof Error` (their prototype is an
 * Error instance) without being native errors, so structured clone, which `postMessage` applies, would flatten them into plain
 * objects and the pool would reject with a non-Error. Only the message and the cause carry over; the name travels separately.
 */
function toNativeError(error: Error): Error {
    return new Error(error.message, Object.hasOwn(error, 'cause') ? { cause: error.cause } : undefined);
}

/**
 * Posts a response that carries a thrown value. Native Errors retain their message, stack and cause through structured clone, and
 * non-native Errors (pdf.js exceptions) are rebuilt as native ones first. Structured clone resets any name that is not "Error" or
 * one of the standard subclasses to "Error", so the original name travels in `errorName` and the pool re-applies it. Values that
 * cannot be cloned (functions, exotic objects some libraries throw) are downgraded to a plain Error so the response always gets through.
 */
function postErrorResponse(build: (error: unknown, errorName: string | undefined) => WorkerResponse, error: unknown): void {
    const errorName = error instanceof Error && error.name !== 'Error' ? error.name : undefined;
    try {
        port.postMessage(build(error instanceof Error && !types.isNativeError(error) ? toNativeError(error) : error, errorName));
    } catch {
        port.postMessage(build(new Error(error instanceof Error ? error.message : String(error)), errorName));
    }
}

async function handleRender(request: RenderPageRequest): Promise<void> {
    let pdfDocument: PDFDocumentProxy;
    try {
        // Loaded lazily once per worker; getPdfDocument transfers (detaches) this worker's
        // private copy of the buffer, which is fine — it is loaded exactly once.
        // The main thread has already normalized and selected the exact fields consumed here;
        // workers do not repeat option defaulting or validation.
        documentPromise ??= getPdfDocument(init.pdfBuffer, init.renderOptions);
        pdfDocument = await documentPromise;
    } catch (error: unknown) {
        postErrorResponse((cause, errorName) => ({ type: 'fatal', error: cause, errorName }), error);
        return;
    }

    try {
        const page = await renderPdfPage(pdfDocument, request.pageNumber, init.renderOptions.viewportScale, init.materializeContent);
        const response: WorkerResponse = {
            type: 'result',
            index: request.index,
            width: page.width,
            height: page.height,
            rotation: page.rotation,
            content: page.content,
        };
        // The PNG bytes are structured-clone COPIED across the thread boundary, not
        // transferred: @napi-rs/canvas allocates encode() output as a napi-external
        // ArrayBuffer, which Node.js cannot transfer ("Cannot transfer object of
        // unsupported type"). One copy per page (typically well under 1 MB) is negligible
        // next to the render work this mode parallelizes.
        port.postMessage(response);
    } catch (error: unknown) {
        postErrorResponse((cause, errorName) => ({ type: 'render-error', index: request.index, error: cause, errorName }), error);
    }
}

port.on('message', (request: RenderPageRequest) => {
    void handleRender(request);
});
