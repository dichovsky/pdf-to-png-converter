import { promises as fsPromises, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, test } from 'vitest';
import type { PngPageOutput } from '../src';
import { pdfToPng } from '../src';
import { comparePNG } from './comparePNG';

const PDF_PATH = resolve('./test-data/rotated-pages.pdf');
// 4-page A4 PDF: page 1=0°, page 2=90°, page 3=180°, page 4=270°
const EXPECTED_ROTATIONS = [0, 90, 180, 270];
// A4 points: 595 × 842. After rotation the viewport swaps for 90°/270°.
const A4_SHORT = 595;
const A4_LONG = 842;

test('should report exact rotation values per page (metadata only)', async () => {
    const pages: PngPageOutput[] = await pdfToPng(PDF_PATH, { returnMetadataOnly: true });

    expect(pages.length).toBe(4);
    for (let i = 0; i < pages.length; i++) {
        expect(pages[i].rotation).toBe(EXPECTED_ROTATIONS[i]);
    }
});

test('should swap width and height for 90° and 270° rotated pages', async () => {
    const pages: PngPageOutput[] = await pdfToPng(PDF_PATH, { returnMetadataOnly: true });

    expect(pages.length).toBe(4);

    // Pages at 0° and 180°: portrait (width < height)
    expect(pages[0].width).toBe(A4_SHORT);
    expect(pages[0].height).toBe(A4_LONG);

    expect(pages[2].width).toBe(A4_SHORT);
    expect(pages[2].height).toBe(A4_LONG);

    // Pages at 90° and 270°: landscape (width > height — dimensions swap)
    expect(pages[1].width).toBe(A4_LONG);
    expect(pages[1].height).toBe(A4_SHORT);

    expect(pages[3].width).toBe(A4_LONG);
    expect(pages[3].height).toBe(A4_SHORT);
});

test('should render all rotated pages and return non-empty PNG buffers', async () => {
    const pages: PngPageOutput[] = await pdfToPng(PDF_PATH);

    expect(pages.length).toBe(4);
    for (const page of pages) {
        expect(page.content).toBeInstanceOf(Buffer);
        expect((page.content as Buffer).byteLength).toBeGreaterThan(0);
    }
});

test('should match rendered PNG pixel dimensions to reported metadata dimensions', async () => {
    const [metaPages, renderPages] = await Promise.all([pdfToPng(PDF_PATH, { returnMetadataOnly: true }), pdfToPng(PDF_PATH)]);

    expect(renderPages.length).toBe(4);
    for (let i = 0; i < renderPages.length; i++) {
        const content = renderPages[i].content as Buffer;
        // PNG header: bytes 16-23 contain width (big-endian u32) and height (big-endian u32)
        const pngWidth = content.readUInt32BE(16);
        const pngHeight = content.readUInt32BE(20);

        expect(pngWidth).toBe(metaPages[i].width);
        expect(pngHeight).toBe(metaPages[i].height);
    }
});

test('should write rotated pages to files with correct visual output', async () => {
    const outputFolder = resolve('./test-results/rotated-pages/actual');
    await fsPromises.rm(outputFolder, { recursive: true, force: true });
    const pages: PngPageOutput[] = await pdfToPng(PDF_PATH, {
        outputFolder,
    });

    expect(pages.length).toBe(4);
    for (const page of pages) {
        const expectedFilePath = resolve('./test-data/rotated-pages/expected', page.name);
        const actualFileContent: Buffer = readFileSync(page.path);
        const compareResult: number = await comparePNG({
            actualFile: actualFileContent,
            expectedFile: expectedFilePath,
            createExpectedFileIfMissing: true,
        });

        expect(compareResult).toBe(0);
    }
});
