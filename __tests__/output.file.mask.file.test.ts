import { parse, resolve } from 'node:path';
import { expect, test } from 'vitest';
import { PngPageOutput, pdfToPng } from '../src';

const pdfFilePath: string = resolve('./test-data/large_pdf.pdf');

test(`should apply file mask if defined for pdf file path`, async () => {
    const pngPages: PngPageOutput[] = await pdfToPng(pdfFilePath, {
        outputFileMaskFunc: (pageNumber: number) => `pdf_file_${pageNumber}.png`,
    });

    expect(pngPages.length).toBeGreaterThan(0);
    for (const [index, pngPage] of pngPages.entries()) {
        expect(pngPage.name).toBe(`pdf_file_${index + 1}.png`);
    }
});

test(`should throw if outputFileMaskFunc returns an empty string`, async () => {
    await expect(
        pdfToPng(pdfFilePath, {
            outputFileMaskFunc: () => '',
        }),
    ).rejects.toThrow('outputFileMaskFunc returned an empty filename for page 1');
});

test(`should apply default buffer name if outputFileMaskFunc is not defined for pdf buffer`, async () => {
    const pngPages: PngPageOutput[] = await pdfToPng(pdfFilePath);

    expect(pngPages.length).toBeGreaterThan(0);
    for (const [index, pngPage] of pngPages.entries()) {
        expect(pngPage.name).toBe(`${parse(pdfFilePath).name}_page_${index + 1}.png`);
    }
});
