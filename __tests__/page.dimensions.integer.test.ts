import { resolve } from 'node:path';
import { expect, test } from 'vitest';
import type { PngPageOutput } from '../src';
import { pdfToPng } from '../src';
import { toPixelDimension } from '../src/pageRenderer.js';
import { MAX_CANVAS_PIXELS, MAX_CANVAS_SIDE } from '../src/const.js';
import { blankPdf } from './wasmFixtures';

test('toPixelDimension floors fractional viewport lengths to match canvas truncation', () => {
    expect(toPixelDimension(892.5)).toBe(892);
    expect(toPixelDimension(1263)).toBe(1263);
    expect(toPixelDimension(612)).toBe(612);
    // A sub-pixel viewport floors to 0; both the render and metadata paths reject this with a
    // clear "Increase viewportScale" error (see the non-renderable-dimensions tests below).
    expect(toPixelDimension(0.9)).toBe(0);
});

// `dpi / 72` is not exactly representable, so the product of a page length and such a scale can land a hair
// below the integer the caller meant: 612 pt at 350 dpi is 2974.9999999999995, which a bare Math.floor turned into
// 2974 px instead of 2975. toPixelDimension absorbs that noise (a 1e-6 px tolerance) and still floors real fractions.
test('toPixelDimension snaps float noise just below an integer up to that integer', () => {
    expect(612 * (350 / 72)).toBeLessThan(2975);
    expect(Math.floor(612 * (350 / 72))).toBe(2974);
    expect(toPixelDimension(612 * (350 / 72))).toBe(2975);
    expect(toPixelDimension(792 * (350 / 72))).toBe(3850);
    expect(toPixelDimension(612 * (220 / 72))).toBe(1870);
    expect(toPixelDimension(612 * (110 / 72))).toBe(935);
    expect(toPixelDimension(100 * 0.29)).toBe(29);
});

// The common "fit to N pixels" scale (N / page length) hits the same noise: about 6 % of the targets from 1 to
// 1,000,000 px came out one pixel short for each of these page lengths.
test('toPixelDimension reproduces the target of every fit-to-size scale up to the side limit', () => {
    for (const pageLength of [595, 612, 792, 842]) {
        const misses: number[] = [];
        for (let target = 1; target <= MAX_CANVAS_SIDE; target += 1) {
            if (toPixelDimension(pageLength * (target / pageLength)) !== target) misses.push(target);
        }
        expect(misses, `page length ${pageLength}`).toEqual([]);
    }
});

test('toPixelDimension keeps flooring lengths that are genuinely below an integer', () => {
    // 5e-7 px short is inside the tolerance and counts as the integer; 2e-6 px short is a real fraction.
    expect(toPixelDimension(2975 - 5e-7)).toBe(2975);
    expect(toPixelDimension(2975 - 2e-6)).toBe(2974);
    // Truncated decimal scales really are below 350 / 72: 612 * 4.8611 = 2974.9932 and 612 * 4.8611111 = 2974.9999932.
    expect(toPixelDimension(612 * 4.8611)).toBe(2974);
    expect(toPixelDimension(612 * 4.8611111)).toBe(2974);
    expect(toPixelDimension(0.999)).toBe(0);
    expect(toPixelDimension(0)).toBe(0);
});

// A 612 pt US-Letter page at scale 0.001 floors to 0×0 px. Both code paths must surface the same
// actionable error instead of a phantom 0×0 metadata result or an opaque canvas AssertionError.
const SUB_PIXEL_SCALE = 0.001;

test('render path rejects a viewportScale that floors page dimensions to zero', async () => {
    const pdfFilePath: string = resolve('./test-data/sample.pdf');
    await expect(pdfToPng(pdfFilePath, { viewportScale: SUB_PIXEL_SCALE, pagesToProcess: [1] })).rejects.toThrow(
        /cannot produce a valid image\. Increase viewportScale\./,
    );
});

test('returnMetadataOnly rejects a viewportScale that floors page dimensions to zero', async () => {
    const pdfFilePath: string = resolve('./test-data/sample.pdf');
    await expect(pdfToPng(pdfFilePath, { viewportScale: SUB_PIXEL_SCALE, pagesToProcess: [1], returnMetadataOnly: true })).rejects.toThrow(
        /cannot produce a valid image\. Increase viewportScale\./,
    );
});

// A 612×792 pt US-Letter page at scale 20 yields a 12240×15840 = ~1.94e8 px viewport, above the
// 1e8 MAX_CANVAS_PIXELS cap. Both paths must reject it identically: an oversized page is as
// unrenderable as a floor-to-zero one, so returnMetadataOnly must not hand back phantom dimensions
// for a page a render would refuse. Mirrors the floor-to-zero symmetry tests above.
const OVERSIZED_SCALE = 20;
// Anchors the "Canvas W×H px exceeds the N pixel limit" shape. The count uses a separator-tolerant
// class as defense-in-depth (the source pins toLocaleString('en-US'), so the separator is a comma).
const PIXEL_LIMIT_MESSAGE = /Canvas \d+×\d+ px exceeds the [\d,\s\u00a0\u202f]+ pixel limit\. Reduce viewportScale\./;

test('render path rejects a viewportScale whose viewport exceeds the pixel limit', async () => {
    const pdfFilePath: string = resolve('./test-data/sample.pdf');
    await expect(pdfToPng(pdfFilePath, { viewportScale: OVERSIZED_SCALE, pagesToProcess: [1] })).rejects.toThrow(PIXEL_LIMIT_MESSAGE);
});

test('returnMetadataOnly rejects a viewportScale whose viewport exceeds the pixel limit', async () => {
    const pdfFilePath: string = resolve('./test-data/sample.pdf');
    await expect(pdfToPng(pdfFilePath, { viewportScale: OVERSIZED_SCALE, pagesToProcess: [1], returnMetadataOnly: true })).rejects.toThrow(
        PIXEL_LIMIT_MESSAGE,
    );
});

test('render and returnMetadataOnly reject an oversized page with the identical message', async () => {
    const pdfFilePath: string = resolve('./test-data/sample.pdf');
    const renderErr = await pdfToPng(pdfFilePath, { viewportScale: OVERSIZED_SCALE, pagesToProcess: [1] }).catch((e: unknown) => e);
    const metadataErr = await pdfToPng(pdfFilePath, {
        viewportScale: OVERSIZED_SCALE,
        pagesToProcess: [1],
        returnMetadataOnly: true,
    }).catch((e: unknown) => e);

    expect(renderErr).toBeInstanceOf(Error);
    expect(metadataErr).toBeInstanceOf(Error);
    expect((metadataErr as Error).message).toBe((renderErr as Error).message);
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

// Regression: the pixel-limit guard must bound the ACTUALLY-ALLOCATED canvas (floored
// dimensions), not the fractional viewport area. There is a narrow scale band where the
// un-floored viewport area `w*s × h*s` exceeds MAX_CANVAS_PIXELS while the floored bitmap that
// @napi-rs/canvas actually allocates — `floor(w*s) × floor(h*s)` — stays within it. Such a page
// is renderable and must NOT be rejected. (Before the fix the guard compared the un-floored area
// and threw "exceeds the pixel limit" for it.) Mirrors PR #154's "floored dims are the bitmap".
const PIXEL_LIMIT_PDF = './test-data/sample.pdf';

/** Smallest scale whose un-floored viewport area exceeds the cap while the floored canvas fits within it. */
function findFlooredStraddleScale(widthPt: number, heightPt: number): number {
    let scale = Math.sqrt(MAX_CANVAS_PIXELS / (widthPt * heightPt));
    for (let i = 0; i < 200_000; i += 1) {
        const unfloored = widthPt * scale * (heightPt * scale);
        const floored = Math.floor(widthPt * scale) * Math.floor(heightPt * scale);
        if (unfloored > MAX_CANVAS_PIXELS && floored <= MAX_CANVAS_PIXELS) {
            return scale;
        }
        scale += 0.0001;
    }
    throw new Error('No straddle scale found for the pixel-limit regression test.');
}

test('renders a page whose floored canvas fits the limit even though its viewport area exceeds it', async () => {
    const pdfFilePath: string = resolve(PIXEL_LIMIT_PDF);
    // Page-1 dimensions at scale 1 are integer points (US-Letter 612×792), so they are the page's
    // true point dimensions — derive the straddle scale from them instead of hard-coding.
    const [meta1] = await pdfToPng(pdfFilePath, { pagesToProcess: [1], returnMetadataOnly: true });
    const scale = findFlooredStraddleScale(meta1.width, meta1.height);

    const expectedWidth = Math.floor(meta1.width * scale);
    const expectedHeight = Math.floor(meta1.height * scale);
    // The chosen scale really does straddle the cap: un-floored area over, floored canvas within.
    expect(meta1.width * scale * (meta1.height * scale)).toBeGreaterThan(MAX_CANVAS_PIXELS);
    expect(expectedWidth * expectedHeight).toBeLessThanOrEqual(MAX_CANVAS_PIXELS);

    const pages: PngPageOutput[] = await pdfToPng(pdfFilePath, {
        viewportScale: scale,
        pagesToProcess: [1],
        returnPageContent: true,
    });

    const page = pages[0];
    expect(page.width).toBe(expectedWidth);
    expect(page.height).toBe(expectedHeight);
    expect(page.width * page.height).toBeLessThanOrEqual(MAX_CANVAS_PIXELS);
    const png = readPngDimensions(page.content as Buffer);
    expect(png.width).toBe(expectedWidth);
    expect(png.height).toBe(expectedHeight);
});

test('returnMetadataOnly reports the same in-limit dimensions a render produces at the floored straddle scale', async () => {
    const pdfFilePath: string = resolve(PIXEL_LIMIT_PDF);
    const [meta1] = await pdfToPng(pdfFilePath, { pagesToProcess: [1], returnMetadataOnly: true });
    const scale = findFlooredStraddleScale(meta1.width, meta1.height);

    const [rendered, metadata] = await Promise.all([
        pdfToPng(pdfFilePath, { viewportScale: scale, pagesToProcess: [1], returnPageContent: true }),
        pdfToPng(pdfFilePath, { viewportScale: scale, pagesToProcess: [1], returnMetadataOnly: true }),
    ]);

    expect(metadata[0].width).toBe(rendered[0].width);
    expect(metadata[0].height).toBe(rendered[0].height);
    expect(metadata[0].width * metadata[0].height).toBeLessThanOrEqual(MAX_CANVAS_PIXELS);
});

test('pixel-limit error reports the floored canvas dimensions, not the rounded viewport', async () => {
    const pdfFilePath: string = resolve(PIXEL_LIMIT_PDF);
    const [meta1] = await pdfToPng(pdfFilePath, { pagesToProcess: [1], returnMetadataOnly: true });
    // A fractional, oversized scale: the floored bitmap exceeds the cap, and at least one viewport
    // length has a fractional part ≥ 0.5 so `Math.round` would report a different (larger) size than
    // `Math.floor`. The thrown message must use the floored dimensions actually allocated.
    const scale = 14.501;
    const flooredWidth = Math.floor(meta1.width * scale);
    const flooredHeight = Math.floor(meta1.height * scale);
    // Guard the asset assumptions: genuinely oversized, and round ≠ floor on at least one axis.
    expect(flooredWidth * flooredHeight).toBeGreaterThan(MAX_CANVAS_PIXELS);
    expect(Math.round(meta1.width * scale) !== flooredWidth || Math.round(meta1.height * scale) !== flooredHeight).toBe(true);

    const error = await pdfToPng(pdfFilePath, { viewportScale: scale, pagesToProcess: [1] }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toContain(`Canvas ${flooredWidth}×${flooredHeight} px`);
});

// Integer-exact scaled sizes must come out exact. A US-Letter page (612×792 pt) at N dpi is 8.5N × 11N px with
// viewportScale = N / 72, and the ratios for 110, 220 and 350 dpi multiply to a hair below the integer, which a bare
// Math.floor turned into a bitmap one pixel short (350 dpi gave 2974×3849 instead of 2975×3850).
test.each([72, 96, 110, 144, 150, 200, 220, 300, 350, 400, 600])('a US-Letter page at %i dpi reports its exact pixel size', async (dpi) => {
    const [page] = await pdfToPng(resolve(PIXEL_LIMIT_PDF), { viewportScale: dpi / 72, pagesToProcess: [1], returnMetadataOnly: true });

    expect([page.width, page.height]).toEqual([8.5 * dpi, 11 * dpi]);
});

// The same noise appears with plain decimal scales: 100 × 0.29 is 28.999999999999996.
test.each([
    [0.29, 29],
    [0.57, 57],
    [0.58, 58],
])('a 100 pt square page at viewportScale %f reports %i px, not one pixel short', async (viewportScale, expected) => {
    const [page] = await pdfToPng(blankPdf(100, 100), { viewportScale, returnMetadataOnly: true });

    expect([page.width, page.height]).toEqual([expected, expected]);
});

// A fit-to-size scale (target / page length) hits the same noise: 612 × (630 / 612) and 792 × (1000 / 792) both fall just short.
test('a fit-to-size viewportScale reports exactly the requested width or height', async () => {
    const pdfFilePath = resolve(PIXEL_LIMIT_PDF);
    const [byWidth] = await pdfToPng(pdfFilePath, { viewportScale: 630 / 612, pagesToProcess: [1], returnMetadataOnly: true });
    const [byHeight] = await pdfToPng(pdfFilePath, { viewportScale: 1000 / 792, pagesToProcess: [1], returnMetadataOnly: true });

    expect(byWidth.width).toBe(630);
    expect(byHeight.height).toBe(1000);
});

test('a render at 350 dpi produces the 2975×3850 bitmap that returnMetadataOnly reports', async () => {
    const options = { viewportScale: 350 / 72, pagesToProcess: [1] };
    const [rendered] = await pdfToPng(resolve(PIXEL_LIMIT_PDF), { ...options, returnPageContent: true });
    const [metadata] = await pdfToPng(resolve(PIXEL_LIMIT_PDF), { ...options, returnMetadataOnly: true });

    expect([rendered.width, rendered.height]).toEqual([2975, 3850]);
    expect(readPngDimensions(rendered.content as Buffer)).toEqual({ width: 2975, height: 3850 });
    expect([metadata.width, metadata.height]).toEqual([2975, 3850]);
});
