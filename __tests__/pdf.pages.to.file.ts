import { readFileSync } from 'fs';
import { resolve } from 'path';
import comparePng from 'png-visual-compare';
import { pdfToPng, PngPageOutput } from '../src';

test(`should convert specific PDF pages To PNG files`, async () => {
    const pdfFilePath: string = resolve('test-data/large_pdf.pdf');
    const pngPages: PngPageOutput[] = await pdfToPng(pdfFilePath, {
        outputFolder: 'test-results/pdf.pages.to.file/actual',
        pagesToProcess: [-1, 0, 2, 5, 7, 99, 999999],
    });

    // Should skip page 99 since it's beyond PDF bounds
    expect(pngPages).toHaveLength(3);

    pngPages.forEach((pngPage: PngPageOutput) => {
        const expectedFilePath: string = resolve('test-data/pdf.to.file/expected', pngPage.name);
        const expectedFileContent: Buffer = readFileSync(expectedFilePath);
        const actualFileContent: Buffer = readFileSync(pngPage.path);
        const compareResult: number = comparePng(actualFileContent, expectedFileContent);

        expect(compareResult).toBe(0);
    });
});
