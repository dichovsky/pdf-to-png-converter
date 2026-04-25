import { promises as fsPromises } from 'node:fs';
import { resolve } from 'node:path';
import { expect, test } from 'vitest';
import type { PngPageOutput } from '../src';
import { pdfToPng } from '../src';
import { comparePNG } from './comparePNG';

test(`should convert protected PDF To PNG`, async () => {
    const pdfFilePath: string = resolve('./test-data/large_pdf-protected.pdf');
    const outputFolder = resolve('./test-results/protected.pdf/actual');
    await fsPromises.rm(outputFolder, { recursive: true, force: true });
    const pngPages: PngPageOutput[] = await pdfToPng(pdfFilePath, {
        outputFolder,
        pdfFilePassword: 'uES69xm545C/HP!',
    });

    expect(pngPages.length).toBeGreaterThan(0);
    for (const pngPage of pngPages) {
        const expectedFilePath: string = resolve('./test-data/protected.pdf/expected', pngPage.name);
        const compareResult: number = await comparePNG({
            actualFile: pngPage.content!,
            expectedFile: expectedFilePath,
            createExpectedFileIfMissing: true,
        });

        expect(compareResult).toBe(0);
    }
});
