import { afterEach, expect, test, vi } from 'vitest';
import type { PageRenderResult } from '../src/pageRenderer';
import { VerbosityLevel } from '../src/types';
import { renderPagesInWorkerPool } from '../src/workerPool';
import type { RenderPageRequest, WorkerPageTask, WorkerRenderOptions, WorkerResponse } from '../src/workerPool';

/**
 * Unit tests for the pool's scheduling and error-routing logic with FAKE workers — no threads.
 * The real worker round-trip is covered by pdf.to.png.worker.threads.test.ts.
 */

const harness = vi.hoisted(() => {
    type Handler = (...args: unknown[]) => void;

    class FakeWorker {
        public posted: unknown[] = [];
        public terminated = false;
        public terminationPromise: Promise<number> = Promise.resolve(0);
        public terminationError: unknown;
        private readonly handlers = new Map<string, Handler[]>();

        constructor(
            public entryPath: string,
            public options: unknown,
        ) {
            harness.instances.push(this);
        }

        public on(event: string, handler: Handler): this {
            const list = this.handlers.get(event) ?? [];
            list.push(handler);
            this.handlers.set(event, list);
            return this;
        }

        public postMessage(message: unknown): void {
            this.posted.push(message);
        }

        public terminate(): Promise<number> {
            this.terminated = true;
            if (this.terminationError !== undefined) {
                throw this.terminationError;
            }
            return this.terminationPromise;
        }

        public emit(event: string, ...args: unknown[]): void {
            for (const handler of this.handlers.get(event) ?? []) {
                handler(...args);
            }
        }
    }

    const harness = { FakeWorker, instances: [] as InstanceType<typeof FakeWorker>[] };
    return harness;
});

vi.mock('node:worker_threads', () => ({ Worker: harness.FakeWorker }));

afterEach(() => {
    harness.instances.length = 0;
});

function makeTasks(count: number): WorkerPageTask[] {
    return Array.from({ length: count }, (_, index) => ({
        index,
        pageNumber: index + 1,
    }));
}

const RENDER_OPTIONS = {
    viewportScale: 1,
    disableFontFace: true,
    useSystemFonts: false,
    enableXfa: true,
    pdfFilePassword: undefined,
    verbosityLevel: VerbosityLevel.ERRORS,
} satisfies WorkerRenderOptions;

function resultMessage(index: number, content?: Uint8Array): WorkerResponse {
    return {
        type: 'result',
        index,
        width: 10,
        height: 10,
        rotation: 0,
        content,
    };
}

test('returns without creating workers when no pages are selected', async () => {
    const onPageRendered = vi.fn();

    await renderPagesInWorkerPool(new Uint8Array([1]), RENDER_OPTIONS, true, [], 4, onPageRendered);

    expect(harness.instances).toHaveLength(0);
    expect(onPageRendered).not.toHaveBeenCalled();
});

test('dispatches one task per worker, then the next task as each result arrives', async () => {
    const rendered: Array<{ index: number; page: PageRenderResult }> = [];
    const poolPromise = renderPagesInWorkerPool(new Uint8Array([1]), RENDER_OPTIONS, true, makeTasks(3), 2, async (index, page) => {
        rendered.push({ index, page });
    });
    await vi.waitFor(() => {
        expect(harness.instances).toHaveLength(2);
        expect(harness.instances.every((worker) => worker.posted.length === 1)).toBe(true);
    });

    // Pool size 2 for 3 tasks: two workers spawned, tasks 0 and 1 dispatched.
    expect(harness.instances).toHaveLength(2);
    const [workerA, workerB] = harness.instances;
    expect(workerA.posted[0]).toEqual({ type: 'render', index: 0, pageNumber: 1 } satisfies RenderPageRequest);
    expect(workerB.posted[0]).toEqual({ type: 'render', index: 1, pageNumber: 2 } satisfies RenderPageRequest);
    expect(workerA.options).toEqual({
        workerData: {
            pdfBuffer: new Uint8Array([1]),
            renderOptions: RENDER_OPTIONS,
            materializeContent: true,
        },
    });

    workerB.emit('message', resultMessage(1, new Uint8Array([7, 8])));
    await vi.waitFor(() => {
        expect(workerB.posted).toHaveLength(2);
    });
    // Worker B finished first and immediately received task 2.
    expect((workerB.posted[1] as RenderPageRequest).index).toBe(2);

    workerA.emit('message', resultMessage(0));
    workerB.emit('message', resultMessage(2));
    await poolPromise;

    expect(rendered.map((entry) => entry.index).sort()).toEqual([0, 1, 2]);
    const withContent = rendered.find((entry) => entry.index === 1);
    expect(withContent?.page.content).toBeInstanceOf(Buffer);
    expect(Array.from(withContent?.page.content ?? [])).toEqual([7, 8]);
    expect(harness.instances.every((worker) => worker.terminated)).toBe(true);
});

test('throws the LOWEST-index error when multiple in-flight pages fail, and stops dispatching', async () => {
    const poolPromise = renderPagesInWorkerPool(new Uint8Array([1]), RENDER_OPTIONS, true, makeTasks(4), 2, async () => undefined);
    await vi.waitFor(() => {
        expect(harness.instances).toHaveLength(2);
    });
    const [workerA, workerB] = harness.instances;

    // Higher index fails FIRST, lower index fails second — the lower index must win.
    workerB.emit('message', { type: 'render-error', index: 1, error: new Error('page 2 exploded') } satisfies WorkerResponse);
    workerA.emit('message', { type: 'render-error', index: 0, error: new Error('page 1 exploded') } satisfies WorkerResponse);

    await expect(poolPromise).rejects.toThrow('page 1 exploded');
    // No further tasks were dispatched after the first error (tasks 2 and 3 never started).
    const dispatched = harness.instances.flatMap((worker) => worker.posted as RenderPageRequest[]).map((request) => request.index);
    expect(dispatched.sort()).toEqual([0, 1]);
});

test('an onPageRendered failure (e.g. disk write) is attributed to that page index', async () => {
    const poolPromise = renderPagesInWorkerPool(new Uint8Array([1]), RENDER_OPTIONS, true, makeTasks(2), 2, async (index) => {
        if (index === 0) {
            throw new Error('write failed for page 1');
        }
    });
    await vi.waitFor(() => {
        expect(harness.instances).toHaveLength(2);
    });
    const [workerA, workerB] = harness.instances;

    workerA.emit('message', resultMessage(0, new Uint8Array([1])));
    workerB.emit('message', resultMessage(1, new Uint8Array([2])));

    await expect(poolPromise).rejects.toThrow('write failed for page 1');
});

test('a fatal worker error (document load failure) wins over page errors and stops the pool', async () => {
    const poolPromise = renderPagesInWorkerPool(new Uint8Array([1]), RENDER_OPTIONS, true, makeTasks(3), 2, async () => undefined);
    await vi.waitFor(() => {
        expect(harness.instances).toHaveLength(2);
    });
    const [workerA, workerB] = harness.instances;

    workerB.emit('message', { type: 'render-error', index: 1, error: new Error('page render failed') } satisfies WorkerResponse);
    workerA.emit('message', { type: 'fatal', error: new Error('No password given') } satisfies WorkerResponse);

    await expect(poolPromise).rejects.toThrow('No password given');
    expect(harness.instances.every((worker) => worker.terminated)).toBe(true);
});

test('a worker crash is fatal and wins over a LOWER-index page error (no page attribution)', async () => {
    const poolPromise = renderPagesInWorkerPool(new Uint8Array([1]), RENDER_OPTIONS, true, makeTasks(3), 2, async () => undefined);
    await vi.waitFor(() => {
        expect(harness.instances).toHaveLength(2);
    });
    const [workerA, workerB] = harness.instances;

    // Ordinary page error on the LOWEST index first, then a crash on another worker: the crash
    // must surface (worker-level failures beat per-page errors), not the page-1 error.
    workerA.emit('message', { type: 'render-error', index: 0, error: new Error('page 1 render failed') } satisfies WorkerResponse);
    workerB.emit('error', new Error('segfault-ish'));

    await expect(poolPromise).rejects.toThrow('segfault-ish');
});

test('an unexpected worker exit (no error event) rejects instead of hanging the pool', async () => {
    const poolPromise = renderPagesInWorkerPool(new Uint8Array([1]), RENDER_OPTIONS, true, makeTasks(2), 2, async () => undefined);
    await vi.waitFor(() => {
        expect(harness.instances).toHaveLength(2);
    });
    const [workerA, workerB] = harness.instances;

    workerA.emit('exit', 1);
    workerB.emit('message', resultMessage(1));

    await expect(poolPromise).rejects.toThrow('Render worker exited unexpectedly.');
});

test('a message arriving after the worker settled is ignored', async () => {
    const rendered: number[] = [];
    const poolPromise = renderPagesInWorkerPool(new Uint8Array([1]), RENDER_OPTIONS, true, makeTasks(1), 1, async (index) => {
        rendered.push(index);
    });
    await vi.waitFor(() => {
        expect(harness.instances).toHaveLength(1);
    });
    const [workerA] = harness.instances;

    workerA.emit('message', resultMessage(0));
    await poolPromise;

    // Late duplicate after finish() — must not re-run finalization.
    workerA.emit('message', resultMessage(0));
    expect(rendered).toEqual([0]);
});

test('does not settle until pending output finalization and worker termination both resolve', async () => {
    let resolveFinalization: (() => void) | undefined;
    const finalizationPromise = new Promise<void>((resolve) => {
        resolveFinalization = resolve;
    });
    let resolveTermination: ((exitCode: number) => void) | undefined;
    const terminationPromise = new Promise<number>((resolve) => {
        resolveTermination = resolve;
    });
    let poolSettled = false;
    const onPageRendered = vi.fn(async () => {
        await finalizationPromise;
    });
    const poolPromise = renderPagesInWorkerPool(new Uint8Array([1]), RENDER_OPTIONS, true, makeTasks(1), 1, onPageRendered);
    void poolPromise.then(
        () => {
            poolSettled = true;
        },
        () => {
            poolSettled = true;
        },
    );
    await vi.waitFor(() => {
        expect(harness.instances).toHaveLength(1);
    });
    const [worker] = harness.instances;
    worker.terminationPromise = terminationPromise;

    worker.emit('message', resultMessage(0));
    await vi.waitFor(() => {
        expect(onPageRendered).toHaveBeenCalledOnce();
    });

    expect(worker.terminated).toBe(false);
    expect(poolSettled).toBe(false);

    resolveFinalization?.();
    await vi.waitFor(() => {
        expect(worker.terminated).toBe(true);
    });
    expect(poolSettled).toBe(false);

    resolveTermination?.(0);
    await poolPromise;
    expect(poolSettled).toBe(true);
});

test('does not fail successful pages when asynchronous worker termination rejects', async () => {
    let rejectTermination: ((reason: unknown) => void) | undefined;
    const terminationPromise = new Promise<number>((_resolve, reject) => {
        rejectTermination = reject;
    });
    let poolSettled = false;
    const onPageRendered = vi.fn(async () => undefined);
    const poolPromise = renderPagesInWorkerPool(new Uint8Array([1]), RENDER_OPTIONS, true, makeTasks(1), 1, onPageRendered);
    void poolPromise.finally(() => {
        poolSettled = true;
    });

    await vi.waitFor(() => {
        expect(harness.instances).toHaveLength(1);
    });
    const [worker] = harness.instances;
    worker.terminationPromise = terminationPromise;

    worker.emit('message', resultMessage(0));
    await vi.waitFor(() => {
        expect(worker.terminated).toBe(true);
    });
    expect(onPageRendered).toHaveBeenCalledOnce();
    expect(poolSettled).toBe(false);

    rejectTermination?.(new Error('native teardown failed'));
    await expect(poolPromise).resolves.toBeUndefined();
    expect(poolSettled).toBe(true);
});

test('does not fail successful pages when worker termination throws synchronously', async () => {
    const onPageRendered = vi.fn(async () => undefined);
    const poolPromise = renderPagesInWorkerPool(new Uint8Array([1]), RENDER_OPTIONS, true, makeTasks(1), 1, onPageRendered);

    await vi.waitFor(() => {
        expect(harness.instances).toHaveLength(1);
    });
    const [worker] = harness.instances;
    worker.terminationError = new Error('terminate threw');

    worker.emit('message', resultMessage(0));

    await expect(poolPromise).resolves.toBeUndefined();
    expect(onPageRendered).toHaveBeenCalledOnce();
    expect(worker.terminated).toBe(true);
});

test('spawns no more workers than there are tasks', async () => {
    const poolPromise = renderPagesInWorkerPool(new Uint8Array([1]), RENDER_OPTIONS, true, makeTasks(2), 4, async () => undefined);
    await vi.waitFor(() => {
        expect(harness.instances).toHaveLength(2);
    });

    harness.instances[0].emit('message', resultMessage(0));
    harness.instances[1].emit('message', resultMessage(1));
    await poolPromise;
});

test('resolves immediately for an empty task list without spawning workers', async () => {
    await renderPagesInWorkerPool(new Uint8Array([1]), RENDER_OPTIONS, true, [], 4, async () => undefined);
    expect(harness.instances).toHaveLength(0);
});
