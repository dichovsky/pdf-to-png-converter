import type { PageRotation } from './index.js';

/**
 * Message protocol between the worker-thread page pool (`src/workerPool.ts`, main thread) and
 * the render worker entry (`src/pageRenderWorker.ts`, worker thread).
 *
 * Internal to the library — not exported from `src/index.ts`. All shapes must remain
 * structured-cloneable: they cross the thread boundary via `postMessage`.
 */

/**
 * The serializable subset of `PdfToPngOptions` a render worker needs to load the document and
 * render pages. Deliberately excludes non-cloneable (`outputFileMaskFunc`) and main-thread-only
 * (`outputFolder`, `pagesToProcess`, concurrency) fields; the worker re-runs
 * `normalizePdfToPngOptions` on this subset so the single-validation-boundary contract holds
 * inside the worker too.
 */
export interface WorkerDocumentOptions {
    viewportScale?: number;
    disableFontFace?: boolean;
    useSystemFonts?: boolean;
    enableXfa?: boolean;
    pdfFilePassword?: string;
    verbosityLevel?: number;
}

/** Passed once per worker via `workerData`. `pdfBuffer` is structured-cloned per worker. */
export interface WorkerInitData {
    pdfBuffer: Uint8Array;
    documentOptions: WorkerDocumentOptions;
    /** Whether rendered pages must materialize their PNG Buffer (file mode or returnPageContent). */
    materializeContent: boolean;
}

/** Main → worker: render one page. The only request type; workers are stopped via terminate(). */
export interface RenderPageRequest {
    type: 'render';
    /** Position in the conversion's task list — results are re-assembled by this index. */
    index: number;
    pageNumber: number;
    pageName: string;
}

/** Worker → main: one page rendered successfully. `content.buffer` is transferred when safe. */
export interface RenderedPageMessage {
    type: 'result';
    index: number;
    pageNumber: number;
    name: string;
    width: number;
    height: number;
    rotation: PageRotation;
    content: Uint8Array | undefined;
}

/**
 * Worker → main: rendering this one page failed; the worker remains usable for other pages.
 * `error` is the thrown value itself — `Error` instances survive structured cloning with
 * `name`/`message`/`stack` intact, so main-thread callers see the same error surface as the
 * single-threaded modes (non-cloneable values are downgraded to a plain `Error` worker-side).
 */
export interface RenderErrorMessage {
    type: 'render-error';
    index: number;
    error: unknown;
}

/** Worker → main: the worker cannot serve any page (e.g. document load failed). */
export interface FatalErrorMessage {
    type: 'fatal';
    error: unknown;
}

export type WorkerResponse = RenderedPageMessage | RenderErrorMessage | FatalErrorMessage;
