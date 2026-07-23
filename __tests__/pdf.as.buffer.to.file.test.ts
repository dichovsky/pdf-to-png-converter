import { promises as fsPromises, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, test } from 'vitest';
import type { PngPageOutput } from '../src';
import { pdfToPng } from '../src';
import { comparePNG } from './comparePNG';
import { RELAXED_COMPARE_DIFFERENCE_THRESHOLD } from './test-data-constants';

test(`should generate png from pdf buffer`, async () => {
    const pdfFilePath: string = resolve('./test-data/sample.pdf');
    const pdfBuffer = readFileSync(pdfFilePath);
    const outputFolder = resolve('./test-results/sample-buffer/actual');
    await fsPromises.rm(outputFolder, { recursive: true, force: true });
    const pngPages: PngPageOutput[] = await pdfToPng(pdfBuffer, {
        outputFolder,
        viewportScale: 2.0,
    });

    expect(pngPages.length).toBe(2);
    for (const pngPage of pngPages) {
        const expectedFilePath: string = resolve('./test-data/sample/expected', pngPage.name);
        const actualFileContent: Buffer = readFileSync(pngPage.path);
        const compareResult: number = await comparePNG({
            actualFile: actualFileContent,
            expectedFile: expectedFilePath,
            createExpectedFileIfMissing: true,
        });

        expect(compareResult).toBeLessThan(RELAXED_COMPARE_DIFFERENCE_THRESHOLD);
    }
});
