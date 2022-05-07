import { readFileSync } from 'fs';
import { resolve } from 'path';
import comparePng from 'png-visual-compare';
import { pdfToPng, PngPageOutput } from '../src';

test(`Convert To PNG and save results to files`, async () => {
    const pdfFilePath: string = resolve('test-data/large_pdf.pdf');
    const pngPages: PngPageOutput[] = await pdfToPng(pdfFilePath, {
        outputFolder: 'test-results/pdf.to.file/actual',
    });

    pngPages.forEach((pngPage: PngPageOutput) => {
        const expectedFilePath: string = resolve('test-data/pdf.to.file/expected', pngPage.name);
        const expectedFileContent: Buffer = readFileSync(expectedFilePath);
        const actualFileContent: Buffer = readFileSync(pngPage.path);
        const compareResult: number = comparePng(actualFileContent, expectedFileContent);

        expect(compareResult).toBe(0);
    });
});
