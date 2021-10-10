import { readFileSync } from 'fs';
import { resolve } from 'path';
import comparePng from 'png-visual-compare';
import { pdfToPng } from '../src';
import { PngPageOutput } from '../src/convert.to.png';

test(`Convert To PNG and save results to files`, async () => {
    const pdfFilePath: string = resolve('test-data/large_pdf.pdf');
    const pngPages: PngPageOutput[] = await pdfToPng(pdfFilePath, {
        outputFilesFolder: 'test-results/pdf.to.file/actual',
    });

    pngPages.forEach((pngPage) => {
        const expectedFilePath: string = resolve('test-data/pdf.to.file/expected', pngPage.name);
        const expectedFileContent: Buffer = readFileSync(expectedFilePath);
        const actualFileContent: Buffer = readFileSync(pngPage.path);
        const compareResult: number = comparePng(actualFileContent, expectedFileContent);

        expect(compareResult).toBe(0);
    });
});
