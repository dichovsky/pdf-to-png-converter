import { setImmediate } from 'node:timers';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import { afterEach, expect, test, vi } from 'vitest';
import { pdfToPng } from '../src/pdfToPng.js';
import * as pdfjsLoader from '../src/pdfjsLoader.js';

/**
 * Unit checks for the issue #288 wasm warm-up. The real hang and its fix are proven in fresh processes by
 * pdf.to.png.concurrent.wasm.test.ts; these cover ordering, failure handling and run-once behaviour.
 */

afterEach(() => {
    vi.doUnmock('pdfjs-dist/legacy/build/pdf.mjs');
    vi.doUnmock('../src/const.js');
    vi.resetModules();
    vi.restoreAllMocks();
});

test('a warm-up that never settles stops blocking conversions after the timeout', async () => {
    // The loader imports its timers from node:timers, which vi.useFakeTimers() does not patch, so shorten the bound.
    const timeoutMs = 50;
    vi.doMock('../src/const.js', async (importOriginal) => ({ ...(await importOriginal<object>()), WASM_WARM_UP_TIMEOUT_MS: timeoutMs }));
    const getDocument = vi.fn(() => ({ promise: new Promise(() => undefined), destroy: vi.fn() }));
    vi.doMock('pdfjs-dist/legacy/build/pdf.mjs', () => ({ getDocument }));
    const { warmUpWasmDecoders } = await import('../src/pdfjsLoader.js');

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
