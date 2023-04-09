import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { PngPageOutput, pdfToPng } from '../src';
import { comparePNG } from '../src/compare.png';

test(`should convert PDF To PNG buffer (without saving to file)`, async () => {
    const pdfFilePath: string = resolve('test-data/large_pdf.pdf');
    const pngPages: PngPageOutput[] = await pdfToPng(pdfFilePath, {
        viewportScale: 2.0,
    });

    pngPages.forEach((pngPage: PngPageOutput) => {
        const expectedFilePath: string = resolve('test-data/pdf.to.buffer/expected', pngPage.name);
        const compareResult: number = comparePNG(pngPage.content, expectedFilePath);

        expect(existsSync(pngPage.path)).toBe(false);
        expect(compareResult).toBe(0);
    });
});
