import { createCanvas, loadImage } from '@napi-rs/canvas';
import { join, resolve } from 'node:path';
import { expect } from 'vitest';
import { describeFixturePairs, type PageInfo, type PairInfo } from '../scripts/generate-wasm-fixtures';
import { pdfToPng } from '../src/pdfToPng.js';

/**
 * Shared helpers for the wasm-decoder regression suite (issue #278).
 *
 * pdfjs-dist 6.x decodes CCITT, JBIG2 and JPEG 2000 images only through wasm files that must be located with
 * the `wasmUrl` document parameter. Without it pdf.js paints those images blank and reports nothing below
 * verbosity 1. `scripts/generate-wasm-fixtures.ts` writes one picture twice: `<name>.pdf` through the wasm codec
 * and `<name>.control.pdf` through FlateDecode. With a working decoder both render to byte-identical PNGs.
 * Two blank renders would also be byte-identical, so every comparison here also decodes the PNG and checks the
 * exact ink pixel count from the generator.
 *
 * Paths are anchored to this file, not to the working directory, because some tests change the working directory.
 */
export const WASM_FIXTURE_DIR = resolve(__dirname, '..', 'test-data', 'wasm');

export function codecPdf(name: string): string {
    return join(WASM_FIXTURE_DIR, `${name}.pdf`);
}

export function controlPdf(name: string): string {
    return join(WASM_FIXTURE_DIR, `${name}.control.pdf`);
}

/** Stand-alone fixtures that are not codec/control pairs. */
export const FLATE_ONE_BIT_PDF = join(WASM_FIXTURE_DIR, 'flate1bit.pdf');
export const JPX_FLAT_GRAY_PDF = join(WASM_FIXTURE_DIR, 'jpx-flat-gray.pdf');

/**
 * A text PDF whose non-embedded fonts come from the pdf.js standard_fonts folder (rendered differently without it).
 * Used to show that the cmaps and standard_fonts lookups also no longer depend on the working directory.
 */
export const STANDARD_FONT_TEXT_PDF = resolve(__dirname, '..', 'test-data', 'sample.pdf');

/** Facts (page sizes, ink pixel counts) computed by the generator from the source pictures, not from any render. */
export const PAIRS: readonly PairInfo[] = describeFixturePairs();

/** The multi-page pair that mixes every codec; each page has its own image object. */
export const MIXED_PAIR_NAME = 'mixed-pages';

/** RGB of the fill colour used by the image-mask fixture (`0.1 0.3 0.9 rg`). */
export const MASK_PAINT_RGB = [26, 76, 230] as const;

export interface DecodedPng {
    width: number;
    height: number;
    /** RGBA bytes, row by row. */
    data: Uint8ClampedArray;
}

export async function decodePng(png: Uint8Array): Promise<DecodedPng> {
    const image = await loadImage(Buffer.from(png));
    const canvas = createCanvas(image.width, image.height);
    const context = canvas.getContext('2d');
    context.drawImage(image, 0, 0);
    return { width: image.width, height: image.height, data: context.getImageData(0, 0, image.width, image.height).data };
}

export function countPixels(image: DecodedPng, predicate: (r: number, g: number, b: number, a: number) => boolean): number {
    let count = 0;
    for (let offset = 0; offset < image.data.length; offset += 4) {
        if (predicate(image.data[offset], image.data[offset + 1], image.data[offset + 2], image.data[offset + 3])) {
            count++;
        }
    }
    return count;
}

const isWhite = (r: number, g: number, b: number, a: number): boolean => r === 255 && g === 255 && b === 255 && a === 255;
const isDark = (r: number, g: number, b: number, a: number): boolean => a === 255 && r < 128 && g < 128 && b < 128;

export const countNonWhite = (image: DecodedPng): number => countPixels(image, (r, g, b, a) => !isWhite(r, g, b, a));
export const countDark = (image: DecodedPng): number => countPixels(image, isDark);
export const countMaskPaint = (image: DecodedPng): number =>
    countPixels(image, (r, g, b, a) => a === 255 && r === MASK_PAINT_RGB[0] && g === MASK_PAINT_RGB[1] && b === MASK_PAINT_RGB[2]);

/**
 * A one-page PDF with nothing drawn on it, built with a correct cross-reference table.
 * Rendered through the same pipeline it gives the exact PNG a page whose images silently failed to decode would give.
 */
export function blankPdf(width: number, height: number): Uint8Array {
    const objects = [
        '<< /Type /Catalog /Pages 2 0 R >>',
        '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
        `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${width} ${height}] >>`,
    ];
    let text = '%PDF-1.4\n';
    const offsets: number[] = [];
    for (const [index, body] of objects.entries()) {
        offsets.push(text.length);
        text += `${index + 1} 0 obj\n${body}\nendobj\n`;
    }
    const xrefOffset = text.length;
    text += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
    for (const offset of offsets) {
        text += `${String(offset).padStart(10, '0')} 00000 n \n`;
    }
    text += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
    return Buffer.from(text, 'latin1');
}

const blankPngBySize = new Map<string, Buffer>();

/** The PNG an empty page of this pixel size renders to (the output of a decode that was silently skipped). */
export async function blankPagePng(width: number, height: number): Promise<Buffer> {
    const key = `${width}x${height}`;
    let png = blankPngBySize.get(key);
    if (png === undefined) {
        const [page] = await pdfToPng(blankPdf(width, height));
        png = page.content as Buffer;
        blankPngBySize.set(key, png);
    }
    return png;
}

/**
 * Asserts that `png` shows the picture the generator drew: right size, not blank, and (at 1:1) exactly the ink
 * pixel count of the source picture. The image-mask fixture paints blue; every other fixture is black on white.
 */
export async function expectPageShowsPicture(png: Uint8Array, page: PageInfo, pairName: string): Promise<void> {
    const image = await decodePng(png);
    expect([image.width, image.height]).toEqual([page.pixelWidth, page.pixelHeight]);
    const nonWhite = countNonWhite(image);
    expect(nonWhite, `${pairName}: the page is blank, so its image was not decoded`).toBeGreaterThan(0);
    if (pairName === 'ccitt-imagemask') {
        expect(countMaskPaint(image)).toBe(page.inkPixels);
        expect(countDark(image)).toBe(0);
    } else if (page.oneToOne) {
        expect(countDark(image)).toBe(page.inkPixels);
    }
    if (page.oneToOne) {
        expect(nonWhite).toBe(page.inkPixels);
    }
}

/**
 * The full proof for one rendered codec page: it shows the picture, it is byte-identical to the Flate control
 * render, and it is not the blank page of the same size.
 */
export async function expectCodecPageMatchesControl(
    codecPng: Uint8Array,
    controlPng: Uint8Array,
    page: PageInfo,
    pairName: string,
): Promise<void> {
    await expectPageShowsPicture(controlPng, page, pairName);
    await expectPageShowsPicture(codecPng, page, pairName);
    expect(Buffer.compare(Buffer.from(codecPng), Buffer.from(controlPng))).toBe(0);
    expect(Buffer.compare(Buffer.from(codecPng), await blankPagePng(page.pixelWidth, page.pixelHeight))).not.toBe(0);
}

/** Every pixel of the JPEG 2000 fixture decodes to mid-gray (a flat DC level shift). */
export async function expectFlatMidGray(png: Uint8Array): Promise<void> {
    const image = await decodePng(png);
    expect([image.width, image.height]).toEqual([32, 32]);
    expect(countNonWhite(image), 'jpx-flat-gray: the page is blank, so its image was not decoded').toBeGreaterThan(0);
    expect(countPixels(image, (r, g, b, a) => r === 128 && g === 128 && b === 128 && a === 255)).toBe(image.width * image.height);
}
