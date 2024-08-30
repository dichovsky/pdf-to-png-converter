import { expect, test } from 'vitest'
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { PngPageOutput, pdfToPng } from '../src';
import { comparePNG } from '../src/compare.png';

test(`should convert PDF To PNG files`, async () => {
    const pdfFilePath: string = resolve('./test-data/large_pdf.pdf');
    const pngPages: PngPageOutput[] = await pdfToPng(pdfFilePath, {
        outputFolder: 'test-results/pdf.to.file/actual',
    });

    pngPages.forEach((pngPage: PngPageOutput) => {
        const expectedFilePath: string = resolve('./test-data/pdf.to.file/expected', pngPage.name);
        const actualFileContent: Buffer = readFileSync(pngPage.path);
        const compareResult: number = comparePNG(actualFileContent, expectedFilePath);

        expect(compareResult).to.equal(0);
    });
});

test(`should convert simple sample`, async () => {
    const pdfFilePath: string = resolve('./test-data/sample.pdf');
    const pngPages: PngPageOutput[] = await pdfToPng(pdfFilePath, {
        outputFolder: 'test-results/sample/actual',
        viewportScale: 2.0,
    });

    expect(pngPages.length).to.equal(2);
    pngPages.forEach((pngPage: PngPageOutput) => {
        const expectedFilePath: string = resolve('./test-data/sample/expected', pngPage.name);
        const actualFileContent: Buffer = readFileSync(pngPage.path);
        const compareResult: number = comparePNG(actualFileContent, expectedFilePath);

        expect(compareResult).to.equal(0);
    });
});
