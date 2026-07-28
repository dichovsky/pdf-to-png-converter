import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { Worker } from 'node:worker_threads';
import type { PageRotation } from './interfaces/index.js';
import type { RenderPageRequest, WorkerInitData, WorkerDocumentOptions, WorkerResponse } from './interfaces/worker.protocol.js';

/** One page-render assignment; `index` is the position in the conversion's ordered task list. */
export interface WorkerPageTask {
    index: number;
    pageNumber: number;
    pageName: string;
}

/** A page as rendered inside a worker, re-materialized on the main thread. */
export interface WorkerRenderedPage {
    pageNumber: number;
    name: string;
    width: number;
    height: number;
    rotation: PageRotation;
    content: Buffer | undefined;
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
 * output is written through the existing sink, keeping every path-security guard main-side);
 * an error it throws is attributed to that page's index. The pool never settles while an
 * `onPageRendered` call is still pending — no write escapes the function's lifetime.
 *
 * Failure semantics: after the first error no new pages are dispatched and in-flight pages
 * settle. Per-page failures (a page that fails to render, or whose output write fails) are
 * collected by index and the LOWEST-index one is thrown — mirroring
 * `processPagesWithSlidingWindow`. Worker-level failures (document load failure, worker crash,
 * startup failure, unexpected exit) are FATAL: the first one is thrown with priority over any
 * per-page error, regardless of what the crashed worker was doing at the time. Workers are
 * always terminated before this function settles.
 */
export async function renderPagesInWorkerPool(
    pdfBuffer: Uint8Array,
    documentOptions: WorkerDocumentOptions,
    materializeContent: boolean,
    tasks: WorkerPageTask[],
    poolSize: number,
    onPageRendered: (index: number, page: WorkerRenderedPage) => Promise<void>,
): Promise<void> {
    if (tasks.length === 0) {
        return;
    }

    const workerEntryPath = resolveWorkerEntryPath();
    const workerCount = Math.min(poolSize, tasks.length);
    const initData: WorkerInitData = { pdfBuffer, documentOptions, materializeContent };

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
                if (!settled) {
                    settled = true;
                    void worker.terminate();
                    void pendingWork.then(() => resolveWorker());
                }
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
                    pageName: task.pageName,
                };
                worker.postMessage(request);
            };

            const handleResponse = async (response: WorkerResponse): Promise<void> => {
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
                        pageNumber: response.pageNumber,
                        name: response.name,
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
                pendingWork = pendingWork.then(() => handleResponse(response)).catch(recordFatal);
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
    if (errorsByIndex.size > 0) {
        throw errorsByIndex.get(Math.min(...errorsByIndex.keys()));
    }
}
