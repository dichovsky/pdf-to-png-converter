import { promises as fsPromises, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, test } from 'vitest';
import type { PngPageOutput } from '../src';
import { pdfToPng } from '../src';
import { comparePNG } from './comparePNG';

test(`should convert PDF To PNG files`, async () => {
    const pdfFilePath: string = resolve('./test-data/large_pdf.pdf');
    const outputFolder = resolve('./test-results/pdf.to.file/actual');
    await fsPromises.rm(outputFolder, { recursive: true, force: true });
    const pngPages: PngPageOutput[] = await pdfToPng(pdfFilePath, {
        outputFolder,
        processPagesInParallel: false,
    });

    expect(pngPages.length).toBeGreaterThan(0);
    for (const pngPage of pngPages) {
        const expectedFilePath: string = resolve('./test-data/pdf.to.file/expected', pngPage.name);
        const actualFileContent: Buffer = readFileSync(pngPage.path);
        const compareResult: number = await comparePNG({
            actualFile: actualFileContent,
            expectedFile: expectedFilePath,
            createExpectedFileIfMissing: true,
        });

        expect(compareResult).toBe(0);
    }
});

test(`should convert TAMReview PDF to the expected number of PNG pages`, async () => {
    const pdfFilePath: string = resolve('./test-data/TAMReview.pdf');
    const pngPages: PngPageOutput[] = await pdfToPng(pdfFilePath);

    expect(pngPages.length).toBe(23);
});

test(`should convert PDF To PNG files in parallel mode`, async () => {
    const pdfFilePath: string = resolve('./test-data/large_pdf.pdf');
    const outputFolder = resolve('./test-results/pdf.to.file/actual');
    await fsPromises.rm(outputFolder, { recursive: true, force: true });
    const pngPages: PngPageOutput[] = await pdfToPng(pdfFilePath, {
        outputFolder,
        processPagesInParallel: true,
    });

    expect(pngPages.length).toBeGreaterThan(0);
    for (const pngPage of pngPages) {
        const expectedFilePath: string = resolve('./test-data/pdf.to.file/expected', pngPage.name);
        const actualFileContent: Buffer = readFileSync(pngPage.path);
        const compareResult: number = await comparePNG({
            actualFile: actualFileContent,
            expectedFile: expectedFilePath,
            createExpectedFileIfMissing: true,
        });

        expect(compareResult).toBe(0);
    }
});
