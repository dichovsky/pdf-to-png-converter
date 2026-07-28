import { parentPort, workerData } from 'node:worker_threads';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import type { RenderPageRequest, WorkerInitData, WorkerResponse } from './interfaces/worker.protocol.js';
import { normalizePdfToPngOptions } from './normalizePdfToPngOptions.js';
import { renderPdfPage } from './pageRenderer.js';
import { getPdfDocument } from './pdfjsLoader.js';

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
// Re-normalize inside the worker: pure, keeps NormalizedPdfToPngOptions the single validation
// boundary on both sides of the thread hop, and reconstructs defaulted fields dropped from the
// serializable subset.
const normalizedOptions = normalizePdfToPngOptions(init.documentOptions);

let documentPromise: Promise<PDFDocumentProxy> | undefined;

/**
 * Posts a response that carries a thrown value. Error instances structured-clone with
 * name/message/stack preserved; values that cannot be cloned (functions, exotic objects some
 * libraries throw) are downgraded to a plain Error so the response always gets through.
 */
function postErrorResponse(build: (error: unknown) => WorkerResponse, error: unknown): void {
    try {
        port.postMessage(build(error));
    } catch {
        port.postMessage(build(new Error(error instanceof Error ? error.message : String(error))));
    }
}

async function handleRender(request: RenderPageRequest): Promise<void> {
    let pdfDocument: PDFDocumentProxy;
    try {
        // Loaded lazily once per worker; getPdfDocument transfers (detaches) this worker's
        // private copy of the buffer, which is fine — it is loaded exactly once.
        documentPromise ??= getPdfDocument(init.pdfBuffer, normalizedOptions);
        pdfDocument = await documentPromise;
    } catch (error: unknown) {
        postErrorResponse((cause) => ({ type: 'fatal', error: cause }), error);
        return;
    }

    try {
        const page = await renderPdfPage(
            pdfDocument,
            request.pageName,
            request.pageNumber,
            normalizedOptions.viewportScale,
            init.materializeContent,
        );
        const response: WorkerResponse = {
            type: 'result',
            index: request.index,
            pageNumber: page.pageNumber,
            name: page.name,
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
        postErrorResponse((cause) => ({ type: 'render-error', index: request.index, error: cause }), error);
    }
}

port.on('message', (request: RenderPageRequest) => {
    void handleRender(request);
});
