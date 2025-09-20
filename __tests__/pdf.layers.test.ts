import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, test } from 'vitest';
import { PngPageOutput, pdfToPng } from '../src';
import { comparePNG } from './comparePNG';

test(`should convert PDF with layers`, async () => {
    const pdfFilePath: string = resolve('./test-data/layers.pdf');
    const pngPages: PngPageOutput[] = await pdfToPng(pdfFilePath, {
        outputFolder: resolve('./test-results/layers/actual'),
    });

    expect(pngPages.length).to.toBeGreaterThan(0);
    for (const pngPage of pngPages) {
        const expectedFilePath: string = resolve('./test-data/layers/expected', pngPage.name);
        const actualFileContent: Buffer = readFileSync(pngPage.path);
        const compareResult: number = comparePNG({
            actualFile: actualFileContent,
            expectedFile: expectedFilePath,
            createExpectedFileIfMissing: true,
        });

        expect(compareResult).to.equal(0);
    }
});
