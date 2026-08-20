import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { Worker } from 'node:worker_threads';
import type { PageRenderResult } from './pageRenderer.js';
import type { PdfDocumentOptions } from './pdfjsLoader.js';

/** The exact validated, structured-clone-safe configuration a render worker consumes. */
export interface WorkerRenderOptions extends PdfDocumentOptions {
    viewportScale: number;
}

/** One page-render assignment; `index` is the position in the conversion's ordered task list. */
export interface WorkerPageTask {
    index: number;
    pageNumber: number;
}

/** Passed once per worker via `workerData`; the PDF bytes are cloned once per worker. */
export interface WorkerInitData {
    pdfBuffer: Uint8Array;
    renderOptions: WorkerRenderOptions;
    materializeContent: boolean;
}

/** Main → worker: render one page. Workers are stopped with `terminate()`. */
export interface RenderPageRequest {
    type: 'render';
    index: number;
    pageNumber: number;
}

/** Worker → main: one successfully rendered page. */
interface RenderedPageMessage {
    type: 'result';
    index: number;
    width: number;
    height: number;
    rotation: PageRenderResult['rotation'];
    content: Uint8Array | undefined;
}

/** Worker → main: one page failed, but the worker can continue serving other pages. */
interface RenderErrorMessage {
    type: 'render-error';
    index: number;
    error: unknown;
}

/** Worker → main: this worker cannot serve any page. */
interface FatalErrorMessage {
    type: 'fatal';
    error: unknown;
}

export type WorkerResponse = RenderedPageMessage | RenderErrorMessage | FatalErrorMessage;

/** Throws the lowest-index recorded error, preserving `undefined` as a valid rejection reason. */
export function throwLowestIndexedError(errorsByIndex: ReadonlyMap<number, unknown>): void {
    if (errorsByIndex.size === 0) {
        return;
    }
    throw errorsByIndex.get(Math.min(...errorsByIndex.keys()));
}

/**
 * Locates the compiled worker entry. In the published package (and any `out/` build) it sits
 * next to this file. When this module runs from `src/` (vitest transforms TypeScript in-place,
 * so `__dirname` is `src/`), fall back to the repo's `out/` build — the integration tests
 * compile it first. Workers can only execute plain JavaScript, never `.ts` sources.
 */
function resolveWorkerEntryPath(): string {
    const compiled = join(__dirname, 'pageRenderWorker.js');
    if (existsSync(compiled)) {
        return compiled;
    }
    return join(__dirname, '..', 'out', 'pageRenderWorker.js');
}

/**
 * Renders pages across a pool of worker threads.
 *
 * Each worker receives its own structured-clone copy of `pdfBuffer` (pdf.js documents cannot be
 * shared across threads) and loads the document once. Tasks are dispatched dynamically — a worker
 * gets its next page as soon as it finishes one — so heavy pages don't stall the queue behind
 * them. `onPageRendered` runs on the main thread per completed page (this is where file-mode
 * output is written, keeping every path-security guard main-side);
 * an error it throws is attributed to that page's index. The pool never settles while an
 * `onPageRendered` call is still pending — no write escapes the function's lifetime.
 *
 * Failure semantics: after the first error no new pages are dispatched and in-flight pages
 * settle. Per-page failures (a page that fails to render, or whose output write fails) are
 * collected by index and the LOWEST-index one is thrown through the same helper used by
 * `mapLimitOrdered`. Worker-level failures (document load failure, worker crash, startup failure,
 * unexpected exit) are FATAL: the first one is thrown with priority over any per-page error,
 * regardless of what the crashed worker was doing at the time. Worker termination is attempted,
 * and its returned promise is awaited, before this function settles. A failure of that teardown
 * alone does not turn otherwise successful page processing into a conversion error.
 */
export async function renderPagesInWorkerPool(
    pdfBuffer: Uint8Array,
    renderOptions: WorkerRenderOptions,
    materializeContent: boolean,
    tasks: WorkerPageTask[],
    poolSize: number,
    onPageRendered: (index: number, page: PageRenderResult) => Promise<void>,
): Promise<void> {
    if (tasks.length === 0) {
        return;
    }

    const workerEntryPath = resolveWorkerEntryPath();
    const workerCount = Math.min(poolSize, tasks.length);
    const initData: WorkerInitData = { pdfBuffer, renderOptions, materializeContent };

    let nextTaskIndex = 0;
    let fatalError: unknown;
    let hasFatalError = false;
    const errorsByIndex = new Map<number, unknown>();

    const recordFatal = (error: unknown): void => {
        if (!hasFatalError) {
            hasFatalError = true;
            fatalError = error;
        }
    };

    const shouldStop = (): boolean => hasFatalError || errorsByIndex.size > 0;

    const runWorker = (): Promise<void> =>
        new Promise<void>((resolveWorker) => {
            let worker: Worker;
            try {
                worker = new Worker(workerEntryPath, { workerData: initData });
            } catch (error: unknown) {
                // A synchronous spawn failure is fatal; recording it flips shouldStop() so the
                // sibling workers stop dispatching and wind down through their normal path.
                recordFatal(error);
                resolveWorker();
                return;
            }
            let settled = false;
            // Serializes this worker's response handling; finish() awaits it so a pending
            // onPageRendered (e.g. a file write) can never outlive the pool.
            let pendingWork: Promise<void> = Promise.resolve();

            const finish = (): void => {
                if (settled) {
                    return;
                }
                settled = true;

                // Capture both resources at settlement time. A pending output finalizer and the
                // worker's asynchronous native teardown must BOTH finish before this pool worker
                // resolves; otherwise writes or worker resources can escape the conversion.
                const finalization = pendingWork;
                let termination: Promise<number>;
                try {
                    termination = worker.terminate();
                } catch {
                    // A teardown-only failure cannot invalidate pages that rendered and finalized
                    // successfully. There is no asynchronous termination left to await when the
                    // call itself throws.
                    termination = Promise.resolve(0);
                }
                void Promise.allSettled([finalization, termination]).then((outcomes) => {
                    const [finalizationOutcome] = outcomes;
                    if (finalizationOutcome.status === 'rejected') {
                        recordFatal(finalizationOutcome.reason);
                    }
                    resolveWorker();
                });
            };

            const dispatchNext = (): void => {
                if (shouldStop() || nextTaskIndex >= tasks.length) {
                    finish();
                    return;
                }
                const task = tasks[nextTaskIndex];
                nextTaskIndex += 1;
                const request: RenderPageRequest = {
                    type: 'render',
                    index: task.index,
                    pageNumber: task.pageNumber,
                };
                try {
                    worker.postMessage(request);
                } catch (error: unknown) {
                    // A synchronous dispatch failure (for example, a worker that died between
                    // scheduling and postMessage) is worker-level, so stop globally and teardown.
                    recordFatal(error);
                    finish();
                }
            };

            const handleResponse = async (response: WorkerResponse): Promise<void> => {
                if (settled) {
                    return;
                }
                if (response.type === 'fatal') {
                    recordFatal(response.error);
                    finish();
                    return;
                }
                if (response.type === 'render-error') {
                    errorsByIndex.set(response.index, response.error);
                    dispatchNext();
                    return;
                }
                // Re-wrap the structured-cloned bytes as a Buffer without copying.
                const content =
                    response.content !== undefined
                        ? Buffer.from(response.content.buffer, response.content.byteOffset, response.content.byteLength)
                        : undefined;
                try {
                    await onPageRendered(response.index, {
                        width: response.width,
                        height: response.height,
                        rotation: response.rotation,
                        content,
                    });
                } catch (error: unknown) {
                    errorsByIndex.set(response.index, error);
                }
                dispatchNext();
            };

            worker.on('message', (response: WorkerResponse) => {
                if (settled) {
                    return;
                }
                pendingWork = pendingWork
                    .then(() => handleResponse(response))
                    .catch((error: unknown) => {
                        recordFatal(error);
                        finish();
                    });
            });
            worker.on('error', (error: unknown) => {
                // Any worker 'error' is a worker-level failure (crash, startup failure such as a
                // missing entry file) — always fatal, never attributed to the page it happened
                // to be rendering.
                recordFatal(error);
                finish();
            });
            worker.on('exit', () => {
                // terminate() sets `settled` before this fires; an exit seen while unsettled is
                // a crash. Record it as fatal so the pool neither hangs nor blames a page.
                if (!settled) {
                    recordFatal(new Error('Render worker exited unexpectedly.'));
                }
                finish();
            });

            dispatchNext();
        });

    await Promise.all(Array.from({ length: workerCount }, () => runWorker()));

    if (hasFatalError) {
        throw fatalError;
    }
    throwLowestIndexedError(errorsByIndex);
}
