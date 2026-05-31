import { resolve } from 'node:path';
import { expect, test } from 'vitest';
import type { PngPageOutput } from '../src';
import { pdfToPng } from '../src';
import { toPixelDimension } from '../src/pageRenderer.js';

test('toPixelDimension floors fractional viewport lengths to match canvas truncation', () => {
    expect(toPixelDimension(892.5)).toBe(892);
    expect(toPixelDimension(1263)).toBe(1263);
    expect(toPixelDimension(612)).toBe(612);
    // A sub-pixel viewport floors to 0; the render path then throws an AssertionError in
    // NodeCanvasFactory.create (width/height must be > 0) before any canvas is allocated.
    expect(toPixelDimension(0.9)).toBe(0);
});

/**
 * Reads the width/height (pixels) from a PNG buffer's IHDR chunk.
 * Width is a 4-byte big-endian integer at byte offset 16, height at offset 20.
 */
function readPngDimensions(content: Buffer): { width: number; height: number } {
    return { width: content.readUInt32BE(16), height: content.readUInt32BE(20) };
}

// TAMReview.pdf has a 595×842 pt (A4) media box. At viewportScale 1.5 the viewport is
// 892.5×1263, which @napi-rs/canvas truncates to a 892×1263 bitmap. This is the case
// that exposed the fractional-dimension bug; US-Letter assets (612×792) stay integer.
const FRACTIONAL_VIEWPORT_PDF = './test-data/TAMReview.pdf';
const FRACTIONAL_VIEWPORT_SCALE = 1.5;

test('reports integer pixel dimensions that match the rendered PNG', async () => {
    const pdfFilePath: string = resolve(FRACTIONAL_VIEWPORT_PDF);
    const pngPages: PngPageOutput[] = await pdfToPng(pdfFilePath, {
        viewportScale: FRACTIONAL_VIEWPORT_SCALE,
        pagesToProcess: [1],
        returnPageContent: true,
    });

    const page = pngPages[0];
    expect(page.content).toBeDefined();
    expect(Number.isInteger(page.width)).toBe(true);
    expect(Number.isInteger(page.height)).toBe(true);

    const png = readPngDimensions(page.content as Buffer);
    expect(page.width).toBe(png.width);
    expect(page.height).toBe(png.height);
});

test('returnMetadataOnly reports the same integer dimensions a render would produce', async () => {
    const pdfFilePath: string = resolve(FRACTIONAL_VIEWPORT_PDF);
    const [rendered, metadata] = await Promise.all([
        pdfToPng(pdfFilePath, {
            viewportScale: FRACTIONAL_VIEWPORT_SCALE,
            pagesToProcess: [1],
            returnPageContent: true,
        }),
        pdfToPng(pdfFilePath, {
            viewportScale: FRACTIONAL_VIEWPORT_SCALE,
            pagesToProcess: [1],
            returnMetadataOnly: true,
        }),
    ]);

    expect(Number.isInteger(metadata[0].width)).toBe(true);
    expect(Number.isInteger(metadata[0].height)).toBe(true);
    expect(metadata[0].width).toBe(rendered[0].width);
    expect(metadata[0].height).toBe(rendered[0].height);
});
