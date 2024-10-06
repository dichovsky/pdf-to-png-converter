import { expect, test } from 'vitest'
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { PngPageOutput, pdfToPng } from '../src';
import { comparePNG } from '../src/compare.png';

test(`should convert PDF with layers`, async () => {
    const pdfFilePath: string = resolve('./test-data/layers/layers.pdf');
    const pngPages: PngPageOutput[] = await pdfToPng(pdfFilePath, {
        outputFolder: 'test-results/layers/actual',
    });

    pngPages.forEach((pngPage: PngPageOutput) => {
        const expectedFilePath: string = resolve('./test-data/layers/expected', pngPage.name);
        const actualFileContent: Buffer = readFileSync(pngPage.path);
        const compareResult: number = comparePNG(actualFileContent, expectedFilePath);

        expect(compareResult).to.equal(0);
    });
});

