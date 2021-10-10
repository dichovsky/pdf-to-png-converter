import { readFileSync } from 'fs';
import { resolve } from 'path';
import comparePng from 'png-visual-compare';
import { pdfToPng } from '../src';
import { PngPageOutput } from '../src/convert.to.png';

test(`Convert protected PDF To PNG`, async () => {
    const pdfFilePath: string = resolve('test-data/large_pdf-protected.pdf');
    const pngPages: PngPageOutput[] = await pdfToPng(pdfFilePath, {
        outputFilesFolder: 'test-results/protected.pdf/actual',
        disableFontFace: false,
        useSystemFonts: true,
        pdfFilePassword: 'uES69xm545C/HP!'
    });

    pngPages.forEach((pngPage) => {
        const expectedFilePath: string = resolve('test-data/protected.pdf/expected', pngPage.name);
        const expectedFileContent: Buffer = readFileSync(expectedFilePath);
        const compareResult: number = comparePng(pngPage.content, expectedFileContent);

        expect(compareResult).toBe(0);
    });
});
