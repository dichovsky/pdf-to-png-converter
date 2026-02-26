import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, test } from 'vitest';
import type { PngPageOutput } from '../src';
import { pdfToPng } from '../src';

test('should return metadata without rendering when returnMetadataOnly is true', async () => {
    const pdfFilePath: string = resolve('./test-data/sample.pdf');
    const pngPages: PngPageOutput[] = await pdfToPng(pdfFilePath, { returnMetadataOnly: true });

    expect(pngPages.length).toBe(2);
    for (const page of pngPages) {
        expect(page.content).toBeUndefined();
        expect(page.path).toBe('');
        expect(page.pageNumber).toBeGreaterThanOrEqual(1);
        expect(page.name).toBeDefined();
        expect(page.width).toBeGreaterThan(0);
        expect(page.height).toBeGreaterThan(0);
        expect(typeof page.rotation).toBe('number');
    }
});

test('should return correct page numbers and names when returnMetadataOnly is true', async () => {
    const pdfFilePath: string = resolve('./test-data/sample.pdf');
    const pngPages: PngPageOutput[] = await pdfToPng(pdfFilePath, { returnMetadataOnly: true });

    expect(pngPages[0].pageNumber).toBe(1);
    expect(pngPages[0].name).toBe('sample_page_1.png');
    expect(pngPages[1].pageNumber).toBe(2);
    expect(pngPages[1].name).toBe('sample_page_2.png');
});

test('should return metadata only for specific pages when returnMetadataOnly is true', async () => {
    const pdfFilePath: string = resolve('./test-data/large_pdf.pdf');
    const pngPages: PngPageOutput[] = await pdfToPng(pdfFilePath, {
        returnMetadataOnly: true,
        pagesToProcess: [1, 3, 5],
    });

    expect(pngPages.length).toBe(3);
    expect(pngPages[0].pageNumber).toBe(1);
    expect(pngPages[1].pageNumber).toBe(3);
    expect(pngPages[2].pageNumber).toBe(5);
    for (const page of pngPages) {
        expect(page.content).toBeUndefined();
        expect(page.width).toBeGreaterThan(0);
        expect(page.height).toBeGreaterThan(0);
    }
});

test('should not create output folder or write files when returnMetadataOnly is true with outputFolder set', async () => {
    const pdfFilePath: string = resolve('./test-data/sample.pdf');
    const outputFolder: string = resolve('./test-results/metadata-only-folder-guard');
    const pngPages: PngPageOutput[] = await pdfToPng(pdfFilePath, {
        returnMetadataOnly: true,
        outputFolder,
        pagesToProcess: [1],
    });

    expect(pngPages.length).toBe(1);
    expect(pngPages[0].content).toBeUndefined();
    expect(pngPages[0].path).toBe('');
    expect(existsSync(outputFolder)).toBe(false);
});

test('should return metadata in parallel mode when returnMetadataOnly is true', async () => {
    const pdfFilePath: string = resolve('./test-data/large_pdf.pdf');
    const pngPages: PngPageOutput[] = await pdfToPng(pdfFilePath, {
        returnMetadataOnly: true,
        processPagesInParallel: true,
        concurrencyLimit: 3,
    });

    expect(pngPages.length).toBeGreaterThan(0);
    for (const page of pngPages) {
        expect(page.content).toBeUndefined();
        expect(page.path).toBe('');
        expect(page.width).toBeGreaterThan(0);
        expect(page.height).toBeGreaterThan(0);
        expect(typeof page.rotation).toBe('number');
    }
});

test('should respect viewportScale for width and height in metadata', async () => {
    const pdfFilePath: string = resolve('./test-data/sample.pdf');
    const [basePages, scaledPages] = await Promise.all([
        pdfToPng(pdfFilePath, { returnMetadataOnly: true, pagesToProcess: [1] }),
        pdfToPng(pdfFilePath, { returnMetadataOnly: true, viewportScale: 2, pagesToProcess: [1] }),
    ]);

    expect(scaledPages[0].width).toBe(basePages[0].width * 2);
    expect(scaledPages[0].height).toBe(basePages[0].height * 2);
});
