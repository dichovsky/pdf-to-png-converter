import { resolve } from 'node:path';
import { expect, test } from 'vitest';
import { pdfToPng, PngPageOutput } from '../src';
import { comparePNG } from './comparePNG';

test(`should convert protected PDF To PNG`, async () => {
    const pdfFilePath: string = resolve('./test-data/large_pdf-protected.pdf');
    const pngPages: PngPageOutput[] = await pdfToPng(pdfFilePath, {
        outputFolder: resolve('./test-results/protected.pdf/actual'),
        pdfFilePassword: 'uES69xm545C/HP!',
    });

    expect(pngPages.length).to.toBeGreaterThan(0);
    for (const pngPage of pngPages) {
        const expectedFilePath: string = resolve('./test-data/protected.pdf/expected', pngPage.name);
        const compareResult: number = comparePNG({
            actualFile: pngPage.content,
            expectedFile: expectedFilePath,
            createExpectedFileIfMissing: true,
        });

        expect(compareResult).to.equal(0);
    }
});
