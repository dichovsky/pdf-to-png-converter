import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, test } from 'vitest';
import { PngPageOutput, pdfToPng } from '../src';
import { comparePNG } from './comparePNG';

test(`should convert specific PDF pages To PNG files`, async () => {
    const pdfFilePath: string = resolve('./test-data/large_pdf.pdf');
    const pngPages: PngPageOutput[] = await pdfToPng(pdfFilePath, {
        outputFolder: resolve('./test-results/pdf.pages.to.file/actual'),
        pagesToProcess: [-1, 0, 2, 5, 7, 99, 999999],
    });

    // Should skip page 99 since it's beyond PDF bounds
    expect(pngPages.length).to.equal(3);

    for (const pngPage of pngPages) {
        const expectedFilePath: string = resolve('./test-data/pdf.to.file/expected', pngPage.name);
        const actualFileContent: Buffer = readFileSync(pngPage.path);
        const compareResult: number = comparePNG({
            actualFile: actualFileContent,
            expectedFile: expectedFilePath,
            createExpectedFileIfMissing: true,
        });

        expect(compareResult).to.equal(0);
    }
});
