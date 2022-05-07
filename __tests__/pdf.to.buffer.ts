import { existsSync, readFileSync } from 'fs';
import { resolve } from 'path';
import comparePng from 'png-visual-compare';
import { pdfToPng, PngPageOutput } from '../src';

test(`Convert To PNG without saving to file`, async () => {
    const pdfFilePath: string = resolve('test-data/large_pdf.pdf');
    const pngPages: PngPageOutput[] = await pdfToPng(pdfFilePath, {
        viewportScale: 2.0,
    });

    pngPages.forEach((pngPage: PngPageOutput) => {
        const expectedFilePath: string = resolve('test-data/pdf.to.buffer/expected', pngPage.name);
        const expectedFileContent: Buffer = readFileSync(expectedFilePath);
        const compareResult: number = comparePng(pngPage.content, expectedFileContent);

        expect(existsSync(pngPage.path)).toBe(false);
        expect(compareResult).toBe(0);
    });
});
