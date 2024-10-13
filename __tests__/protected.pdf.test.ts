import { resolve } from 'node:path';
import { expect, test } from 'vitest';
import { pdfToPng, PngPageOutput } from '../src';
import { comparePNG } from '../src/compare.png';

test(`should convert protected PDF To PNG`, async () => {
    const pdfFilePath: string = resolve('./test-data/large_pdf-protected.pdf');
    const pngPages: PngPageOutput[] = await pdfToPng(pdfFilePath, {
        outputFolder: 'test-results/protected.pdf/actual',
        pdfFilePassword: 'uES69xm545C/HP!',
    });

    pngPages.forEach((pngPage: PngPageOutput) => {
        const expectedFilePath: string = resolve('./test-data/protected.pdf/expected', pngPage.name);
        const compareResult: number = comparePNG({
            actualFile: pngPage.content,
            expectedFile: expectedFilePath,
            createExpectedFileIfMissing: true,
        });

        expect(compareResult).to.equal(0);
    });
});
