import { performance } from 'node:perf_hooks';
import { setImmediate } from 'node:timers';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { WASM_WARM_UP_TIMEOUT_MS } from '../src/const.js';
import { pdfToPng } from '../src/pdfToPng.js';
import * as pdfjsLoader from '../src/pdfjsLoader.js';

/**
 * Unit checks for the issue #288 wasm warm-up. The real hang and its fix are proven in fresh processes by
 * pdf.to.png.concurrent.wasm.test.ts; these cover ordering, failure handling, run-once behaviour and the timeout timer.
 */

/** Far below the real 10 s bound and far above the 50 ms override, so only an override that really applies passes. */
const MUCH_SHORTER_THAN_THE_REAL_BOUND_MS = 5_000;

beforeEach(() => {
    // The static imports above already evaluated the loader against the real constants and timers. Start every test with
    // an empty module registry so a test that mocks const.js, node:timers or pdf.js imports a loader bound to its mocks.
    vi.resetModules();
});

afterEach(() => {
    vi.doUnmock('pdfjs-dist/legacy/build/pdf.mjs');
    vi.doUnmock('../src/const.js');
    vi.doUnmock('node:timers');
    vi.resetModules();
    vi.restoreAllMocks();
});

/**
 * Replaces the loader's timers (it imports them from node:timers, which vi.useFakeTimers() does not patch) with spies
 * that schedule nothing, so a test fires the timeout by hand and sees exactly which timer was set and cleared.
 */
function mockLoaderTimers() {
    const handle = { name: 'warm-up timeout' };
    const setTimeoutSpy = vi.fn<(onTimeout: () => void, delayMs: number) => object>(() => handle);
    const clearTimeoutSpy = vi.fn();
    vi.doMock('node:timers', async (importOriginal) => ({
        ...(await importOriginal<object>()),
        setTimeout: setTimeoutSpy,
        clearTimeout: clearTimeoutSpy,
    }));
    return { handle, setTimeoutSpy, clearTimeoutSpy };
}

/** Mocks pdf.js with a one-page document whose first page builds its operator list through `getOperatorList`. */
function mockPdfjsDocument(getOperatorList: () => Promise<unknown>) {
    const destroy = vi.fn().mockResolvedValue(undefined);
    const getOperatorListSpy = vi.fn(getOperatorList);
    const getPage = vi.fn().mockResolvedValue({ getOperatorList: getOperatorListSpy });
    const getDocument = vi.fn(() => ({ promise: Promise.resolve({ getPage, loadingTask: { destroy } }), destroy }));
    vi.doMock('pdfjs-dist/legacy/build/pdf.mjs', () => ({ getDocument }));
    return { destroy, getOperatorList: getOperatorListSpy };
}

test('a warm-up that never settles stops blocking conversions after the timeout', async () => {
    // The loader imports its timers from node:timers, which vi.useFakeTimers() does not patch, so shorten the bound.
    const timeoutMs = 50;
    vi.doMock('../src/const.js', async (importOriginal) => ({ ...(await importOriginal<object>()), WASM_WARM_UP_TIMEOUT_MS: timeoutMs }));
    const getDocument = vi.fn(() => ({ promise: new Promise(() => undefined), destroy: vi.fn() }));
    vi.doMock('pdfjs-dist/legacy/build/pdf.mjs', () => ({ getDocument }));
    const { warmUpWasmDecoders } = await import('../src/pdfjsLoader.js');

    const startedAt = performance.now();
    let settled = false;
    const warmUp = warmUpWasmDecoders().then(() => {
        settled = true;
    });
    await new Promise((resolveTick) => setImmediate(resolveTick));
    expect(getDocument).toHaveBeenCalledOnce();
    expect(settled).toBe(false);

    // The mocked document never loads, so only the timeout can settle the warm-up.
    await warmUp;
    expect(settled).toBe(true);
    // The 50 ms override must really apply: against the real 10 s bound this test used to sleep 10 s on every run.
    expect(performance.now() - startedAt).toBeLessThan(MUCH_SHORTER_THAN_THE_REAL_BOUND_MS);
});

test('a stalled warm-up is abandoned at the timeout without waiting on or destroying its document', async () => {
    const timers = mockLoaderTimers();
    const pdfjs = mockPdfjsDocument(() => new Promise(() => undefined));
    const { warmUpWasmDecoders } = await import('../src/pdfjsLoader.js');
    let settled = false;
    const warmUp = warmUpWasmDecoders().then(() => {
        settled = true;
    });
    await new Promise((resolveTick) => setImmediate(resolveTick));
    expect(pdfjs.getOperatorList).toHaveBeenCalledOnce();
    expect(settled).toBe(false);

    const [fireTimeout] = timers.setTimeoutSpy.mock.calls[0];
    fireTimeout();
    await warmUp;

    expect(settled).toBe(true);
    // Left alone on purpose: pdf.js's destroy() on such a stalled document did not settle (observed with pdfjs-dist
    // 6.4.299), so waiting on it would defeat the timeout.
    expect(pdfjs.destroy).not.toHaveBeenCalled();
});

test('the timeout timer is cleared once the warm-up completes, so it cannot keep the process alive', async () => {
    const timers = mockLoaderTimers();
    const pdfjs = mockPdfjsDocument(() => Promise.resolve([]));
    const { warmUpWasmDecoders } = await import('../src/pdfjsLoader.js');

    await warmUpWasmDecoders();

    expect(timers.setTimeoutSpy).toHaveBeenCalledTimes(1);
    expect(timers.setTimeoutSpy).toHaveBeenCalledWith(expect.any(Function), WASM_WARM_UP_TIMEOUT_MS);
    expect(timers.clearTimeoutSpy).toHaveBeenCalledTimes(1);
    expect(timers.clearTimeoutSpy).toHaveBeenCalledWith(timers.handle);
    expect(pdfjs.destroy).toHaveBeenCalledOnce();
});

test('the timeout timer is also cleared when the warm-up fails', async () => {
    const timers = mockLoaderTimers();
    mockPdfjsDocument(() => Promise.reject(new Error('operator list failed')));
    const { warmUpWasmDecoders } = await import('../src/pdfjsLoader.js');

    await expect(warmUpWasmDecoders()).resolves.toBeUndefined();

    expect(timers.clearTimeoutSpy).toHaveBeenCalledTimes(1);
    expect(timers.clearTimeoutSpy).toHaveBeenCalledWith(timers.handle);
});

test('pdfToPng opens its document only after the warm-up settles', async () => {
    const warmUp = Promise.withResolvers<void>();
    vi.spyOn(pdfjsLoader, 'warmUpWasmDecoders').mockReturnValue(warmUp.promise);
    const destroy = vi.fn().mockResolvedValue(undefined);
    const getPdfDocument = vi
        .spyOn(pdfjsLoader, 'getPdfDocument')
        .mockResolvedValue({ numPages: 0, loadingTask: { destroy } } as unknown as PDFDocumentProxy);

    const conversion = pdfToPng(new Uint8Array([1]), { returnMetadataOnly: true });
    await new Promise((resolveTick) => setImmediate(resolveTick));
    expect(getPdfDocument).not.toHaveBeenCalled();

    warmUp.resolve();
    await expect(conversion).resolves.toEqual([]);
    expect(getPdfDocument).toHaveBeenCalledOnce();
});

test('a failed warm-up resolves, destroys its document, and is not retried', async () => {
    const destroy = vi.fn().mockResolvedValue(undefined);
    const getPage = vi.fn().mockRejectedValue(new Error('page load failed'));
    const getDocument = vi.fn(() => ({ promise: Promise.resolve({ getPage, loadingTask: { destroy } }), destroy }));
    vi.doMock('pdfjs-dist/legacy/build/pdf.mjs', () => ({ getDocument }));
    const { warmUpWasmDecoders } = await import('../src/pdfjsLoader.js');

    await expect(warmUpWasmDecoders()).resolves.toBeUndefined();
    await expect(warmUpWasmDecoders()).resolves.toBeUndefined();

    expect(getDocument).toHaveBeenCalledOnce();
    expect(getPage).toHaveBeenCalledWith(1);
    expect(destroy).toHaveBeenCalledOnce();
});
