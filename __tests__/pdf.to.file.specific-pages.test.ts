import { promises as fsPromises, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, test } from 'vitest';
import type { PngPageOutput } from '../src';
import { pdfToPng } from '../src';
import { comparePNG } from './comparePNG';

test(`should convert specific PDF pages To PNG files`, async () => {
    const pdfFilePath: string = resolve('./test-data/large_pdf.pdf');
    const outputFolder = resolve('./test-results/pdf.pages.to.file/actual');
    await fsPromises.rm(outputFolder, { recursive: true, force: true });
    const pngPages: PngPageOutput[] = await pdfToPng(pdfFilePath, {
        outputFolder,
        pagesToProcess: [2, 5, 7, 99, 999999],
    });

    // Out-of-range high page numbers are silently ignored.
    expect(pngPages.length).toBe(3);

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

test('should throw for non-positive pagesToProcess values before rendering', async () => {
    const pdfFilePath: string = resolve('./test-data/large_pdf.pdf');

    await expect(
        pdfToPng(pdfFilePath, {
            outputFolder: resolve('./test-results/pdf.pages.to.file/actual'),
            pagesToProcess: [-1, 0, 2],
        }),
    ).rejects.toThrow('pagesToProcess contains invalid page number: -1');
});
