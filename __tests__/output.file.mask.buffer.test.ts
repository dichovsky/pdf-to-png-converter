import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, test } from 'vitest';
import { PngPageOutput, pdfToPng } from '../src';

const pdfFilePath: string = resolve('./test-data/large_pdf.pdf');
const pdfBuffer: Buffer = readFileSync(pdfFilePath);

test(`should apply file mask is defined for pdf buffer`, async () => {
    const pngPages: PngPageOutput[] = await pdfToPng(pdfBuffer, {
        outputFileMaskFunc: (pageNumber: number) => `custom_buffer_${pageNumber}.png`,
    });

    pngPages.forEach((pngPage: PngPageOutput, index: number) => {
        expect(pngPage.name).to.equal(`custom_buffer_${index + 1}.png`);
    });
});

test(`should apply default buffer name if outputFileMaskFunc is not defined for pdf buffer`, async () => {
    const pngPages: PngPageOutput[] = await pdfToPng(pdfBuffer);

    pngPages.forEach((pngPage: PngPageOutput, index: number) => {
        expect(pngPage.name).to.equal(`buffer_page_${index + 1}.png`);
    });
});
