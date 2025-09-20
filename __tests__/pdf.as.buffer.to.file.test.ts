import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, test } from 'vitest';
import { PngPageOutput, pdfToPng } from '../src';
import { comparePNG } from './comparePNG';

test(`should generate png from pdf buffer`, async () => {
    const pdfFilePath: string = resolve('./test-data/sample.pdf');
    const pdfBuffer = readFileSync(pdfFilePath);
    const pngPages: PngPageOutput[] = await pdfToPng(pdfBuffer, {
        outputFolder: resolve('./test-results/sample/actual'),
        viewportScale: 2.0,
    });

    expect(pngPages.length).to.equal(2);
    for (const pngPage of pngPages) {
        const expectedFilePath: string = resolve('./test-data/sample/expected', pngPage.name);
        const actualFileContent: Buffer = readFileSync(pngPage.path);
        const compareResult: number = comparePNG({
            actualFile: actualFileContent,
            expectedFile: expectedFilePath,
            createExpectedFileIfMissing: true,
        });

        expect(compareResult).to.equal(0);
    }
});