import type { PDFDocumentProxy } from 'pdfjs-dist';
import { expect, test, vi } from 'vitest';
import { MAX_CANVAS_PIXELS, MAX_CANVAS_SIDE } from '../src/const.js';
import { getPageMetadata, renderPdfPage } from '../src/pageRenderer.js';
import { pdfToPng } from '../src/pdfToPng.js';
import { blankPdf } from './wasmFixtures';

/**
 * MAX_CANVAS_PIXELS bounds only the area, but the PNG encoder (libpng) also refuses any side above 1,000,000 px. A thin
 * enough page passed the area guard, was rendered, and then failed in the encoder with an opaque "Get png data from
 * surface failed" plus raw libpng lines on stderr. Metadata and render now reject it up front with an actionable
 * message, before a canvas is allocated.
 */

function sideLimitMessage(width: number, height: number): string {
    return `Canvas ${width}×${height} px exceeds the 1,000,000 pixel per-side limit. Reduce viewportScale.`;
}

/** A mocked one-page document whose page has this viewport; the canvas factory and the PNG encoder are stubs. */
function mockedDocument(width: number, height: number) {
    const cleanup = vi.fn();
    const create = vi.fn().mockReturnValue({ canvas: { encode: vi.fn().mockResolvedValue(Buffer.from([1])) }, context: {} });
    const pdf = {
        getPage: vi.fn().mockResolvedValue({
            getViewport: vi.fn().mockReturnValue({ width, height }),
            render: vi.fn().mockReturnValue({ promise: Promise.resolve() }),
            rotate: 0,
            cleanup,
        }),
        canvasFactory: { create, destroy: vi.fn() },
    } as unknown as PDFDocumentProxy;
    return { pdf, create, cleanup };
}

const AT_THE_LIMIT = [
    ['wide', MAX_CANVAS_SIDE, 1],
    ['tall', 1, MAX_CANVAS_SIDE],
] as const;
const ONE_OVER_THE_LIMIT = [
    ['wide', MAX_CANVAS_SIDE + 1, 1],
    ['tall', 1, MAX_CANVAS_SIDE + 1],
] as const;

test('the per-side limit is the 1,000,000 px that libpng accepts', () => {
    expect(MAX_CANVAS_SIDE).toBe(1_000_000);
});

test.each(AT_THE_LIMIT)('a %s page exactly at the side limit passes both guards', async (_shape, width, height) => {
    const metadata = await getPageMetadata(mockedDocument(width, height).pdf, 1, 1);
    const { pdf, create } = mockedDocument(width, height);
    const rendered = await renderPdfPage(pdf, 1, 1, true);

    expect([metadata.width, metadata.height]).toEqual([width, height]);
    expect([rendered.width, rendered.height]).toEqual([width, height]);
    expect(create).toHaveBeenCalledWith(width, height);
});

test.each(ONE_OVER_THE_LIMIT)('getPageMetadata rejects a %s page one pixel over the side limit', async (_shape, width, height) => {
    const { pdf, cleanup } = mockedDocument(width, height);

    await expect(getPageMetadata(pdf, 1, 1)).rejects.toThrow(sideLimitMessage(width, height));
    expect(cleanup).toHaveBeenCalledOnce();
});

test.each(ONE_OVER_THE_LIMIT)(
    'renderPdfPage rejects a %s page one pixel over the side limit before allocating a canvas',
    async (_shape, width, height) => {
        const { pdf, create, cleanup } = mockedDocument(width, height);

        await expect(renderPdfPage(pdf, 1, 1, true)).rejects.toThrow(sideLimitMessage(width, height));
        expect(create).not.toHaveBeenCalled();
        expect(cleanup).toHaveBeenCalledOnce();
    },
);

test('renderPdfPage applies the side limit whether or not PNG content is requested', async () => {
    const { pdf, create } = mockedDocument(MAX_CANVAS_SIDE + 1, 1);

    await expect(renderPdfPage(pdf, 1, 1, false)).rejects.toThrow(sideLimitMessage(MAX_CANVAS_SIDE + 1, 1));
    expect(create).not.toHaveBeenCalled();
});

test('a page over both the area and the side limit still reports the area limit', async () => {
    const [width, height] = [MAX_CANVAS_SIDE + 1, 1000];
    expect(width * height).toBeGreaterThan(MAX_CANVAS_PIXELS);

    await expect(getPageMetadata(mockedDocument(width, height).pdf, 1, 1)).rejects.toThrow(
        `Canvas ${width}×${height} px exceeds the 100,000,000 pixel limit. Reduce viewportScale.`,
    );
    await expect(renderPdfPage(mockedDocument(width, height).pdf, 1, 1, true)).rejects.toThrow(
        `Canvas ${width}×${height} px exceeds the 100,000,000 pixel limit. Reduce viewportScale.`,
    );
});

// The remaining tests use real pdf.js and @napi-rs/canvas, so they also prove 1,000,000 is the encoder's real limit.

test.each(AT_THE_LIMIT)('a real %s page exactly at the side limit still renders to a PNG of that size', async (_shape, width, height) => {
    const [page] = await pdfToPng(blankPdf(width, height));

    const png = page.content as Buffer;
    expect([page.width, page.height]).toEqual([width, height]);
    expect([png.readUInt32BE(16), png.readUInt32BE(20)]).toEqual([width, height]);
});

test.each(ONE_OVER_THE_LIMIT)('a real %s page over the side limit is rejected in every mode', async (_shape, width, height) => {
    const pdf = blankPdf(width, height);
    const message = sideLimitMessage(width, height);

    await expect(pdfToPng(pdf, { returnMetadataOnly: true })).rejects.toThrow(message);
    await expect(pdfToPng(pdf)).rejects.toThrow(message);
    await expect(pdfToPng(pdf, { returnPageContent: false })).rejects.toThrow(message);
});

test('a thin page that crosses the side limit only through viewportScale is rejected on both paths', async () => {
    // 10,001 × 0.5 pt at scale 100 is 1,000,100 × 50 px: far below MAX_CANVAS_PIXELS, but a side over the limit.
    const pdf = blankPdf(10_001, 0.5);
    const message = sideLimitMessage(1_000_100, 50);
    expect(1_000_100 * 50).toBeLessThan(MAX_CANVAS_PIXELS);

    await expect(pdfToPng(pdf, { viewportScale: 100, returnMetadataOnly: true })).rejects.toThrow(message);
    await expect(pdfToPng(pdf, { viewportScale: 100 })).rejects.toThrow(message);
});
