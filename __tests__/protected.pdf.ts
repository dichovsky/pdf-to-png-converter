import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import comparePng from 'png-visual-compare';
import { pdfToPng, PngPageOutput } from '../src';

test(`should convert protected PDF To PNG`, async () => {
    const pdfFilePath: string = resolve('test-data/large_pdf-protected.pdf');
    const pngPages: PngPageOutput[] = await pdfToPng(pdfFilePath, {
        outputFolder: 'test-results/protected.pdf/actual',
        pdfFilePassword: 'uES69xm545C/HP!',
    });

    pngPages.forEach((pngPage: PngPageOutput) => {
        const expectedFilePath: string = resolve('test-data/protected.pdf/expected', pngPage.name);
        const expectedFileContent: Buffer = readFileSync(expectedFilePath);
        const compareResult: number = comparePng(pngPage.content, expectedFileContent);

        expect(compareResult).toBe(0);
    });
});
