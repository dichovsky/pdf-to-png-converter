import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pdfToPng, PngPageOutput } from '../src';
import { comparePNG } from '../src/compare.png';

test(`should convert PDF To PNG files`, async () => {
    const pdfFilePath: string = resolve('test-data/large_pdf.pdf');
    const pngPages: PngPageOutput[] = await pdfToPng(pdfFilePath, {
        outputFolder: 'test-results/pdf.to.file/actual',
    });

    pngPages.forEach((pngPage: PngPageOutput) => {
        const expectedFilePath: string = resolve('test-data/pdf.to.file/expected', pngPage.name);
        const actualFileContent: Buffer = readFileSync(pngPage.path);
        const compareResult: number = comparePNG(actualFileContent, expectedFilePath);

        expect(compareResult).toBe(0);
    });
});
