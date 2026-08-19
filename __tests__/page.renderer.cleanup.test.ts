import type { PDFDocumentProxy } from 'pdfjs-dist';
import { expect, test, vi } from 'vitest';
import { getPageMetadata, renderPdfPage } from '../src/pageRenderer.js';

test('metadata cleanup runs when getViewport throws', async () => {
    const cleanup = vi.fn();
    const viewportError = new Error('invalid page box');
    const pdf = {
        getPage: vi.fn().mockResolvedValue({
            getViewport: vi.fn(() => {
                throw viewportError;
            }),
            cleanup,
        }),
    } as unknown as PDFDocumentProxy;

    await expect(getPageMetadata(pdf, 1, 1)).rejects.toBe(viewportError);
    expect(cleanup).toHaveBeenCalledOnce();
});

test('render cleanup runs when getViewport throws', async () => {
    const cleanup = vi.fn();
    const viewportError = new Error('invalid page box');
    const pdf = {
        getPage: vi.fn().mockResolvedValue({
            getViewport: vi.fn(() => {
                throw viewportError;
            }),
            cleanup,
        }),
    } as unknown as PDFDocumentProxy;

    await expect(renderPdfPage(pdf, 1, 1, true)).rejects.toBe(viewportError);
    expect(cleanup).toHaveBeenCalledOnce();
});

test('render cleanup runs without destroy when canvas creation throws', async () => {
    const cleanup = vi.fn();
    const createError = new Error('canvas allocation failed');
    const destroy = vi.fn();
    const pdf = {
        getPage: vi.fn().mockResolvedValue({
            getViewport: vi.fn().mockReturnValue({ width: 10, height: 10 }),
            cleanup,
        }),
        canvasFactory: {
            create: vi.fn(() => {
                throw createError;
            }),
            destroy,
        },
    } as unknown as PDFDocumentProxy;

    await expect(renderPdfPage(pdf, 1, 1, true)).rejects.toBe(createError);
    expect(cleanup).toHaveBeenCalledOnce();
    expect(destroy).not.toHaveBeenCalled();
});

test('a malformed canvas factory fails clearly and still cleans up the page', async () => {
    const cleanup = vi.fn();
    const pdf = {
        getPage: vi.fn().mockResolvedValue({
            getViewport: vi.fn().mockReturnValue({ width: 10, height: 10 }),
            cleanup,
        }),
        canvasFactory: { create: 'not a function' },
    } as unknown as PDFDocumentProxy;

    await expect(renderPdfPage(pdf, 1, 1, true)).rejects.toThrow('did not provide a usable canvas factory');
    expect(cleanup).toHaveBeenCalledOnce();
});

test('a null canvas result fails clearly without passing it to destroy', async () => {
    const cleanup = vi.fn();
    const destroy = vi.fn();
    const pdf = {
        getPage: vi.fn().mockResolvedValue({
            getViewport: vi.fn().mockReturnValue({ width: 10, height: 10 }),
            cleanup,
        }),
        canvasFactory: {
            create: vi.fn().mockReturnValue({ canvas: null, context: null }),
            destroy,
        },
    } as unknown as PDFDocumentProxy;

    await expect(renderPdfPage(pdf, 1, 1, true)).rejects.toThrow('returned a null canvas or context');
    expect(cleanup).toHaveBeenCalledOnce();
    expect(destroy).not.toHaveBeenCalled();
});

test('a created canvas is destroyed even when page cleanup throws', async () => {
    const cleanupError = new Error('page cleanup failed');
    const created = {
        canvas: { encode: vi.fn().mockResolvedValue(Buffer.from([1])) },
        context: {},
    };
    const destroy = vi.fn();
    const pdf = {
        getPage: vi.fn().mockResolvedValue({
            getViewport: vi.fn().mockReturnValue({ width: 10, height: 10 }),
            render: vi.fn().mockReturnValue({ promise: Promise.resolve() }),
            rotate: 0,
            cleanup: vi.fn(() => {
                throw cleanupError;
            }),
        }),
        canvasFactory: {
            create: vi.fn().mockReturnValue(created),
            destroy,
        },
    } as unknown as PDFDocumentProxy;

    await expect(renderPdfPage(pdf, 1, 1, true)).rejects.toBe(cleanupError);
    expect(destroy).toHaveBeenCalledOnce();
    expect(destroy).toHaveBeenCalledWith(created);
});
