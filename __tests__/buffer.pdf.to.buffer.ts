import { existsSync, readFileSync } from 'fs';
import { parse, resolve } from 'path';
import comparePng from 'png-visual-compare';
import { pdfToPng, PngPageOutput } from '../src';
import { PDF_TO_PNG_OPTIONS_DEFAULTS } from '../src/convert.to.png';

const pdfFilePath: string = resolve('test-data/large_pdf.pdf');
const pdfBuffer: Buffer = readFileSync(pdfFilePath);

test(`Convert To PNG without saving to file, output file mask is defined`, async () => {
    const pngPages: PngPageOutput[] = await pdfToPng(pdfBuffer, {
        viewportScale: 2.0,
        outputFileMask: 'large_pdf',
    });

    pngPages.forEach((pngPage: PngPageOutput) => {
        const expectedFilePath: string = resolve('test-data/pdf.to.buffer/expected', pngPage.name);
        const expectedFileContent: Buffer = readFileSync(expectedFilePath);
        const compareResult: number = comparePng(pngPage.content, expectedFileContent);

        expect(existsSync(pngPage.path)).toBe(false);
        expect(compareResult).toBe(0);
    });
});

test(`Convert To PNG without saving to file, output file mask is not defined`, async () => {
    const pngPages: PngPageOutput[] = await pdfToPng(pdfBuffer, {
        viewportScale: 2.0,
    });

    pngPages.forEach((pngPage: PngPageOutput, index: number) => {
        const expectedFilePath: string = resolve(
            'test-data/pdf.to.buffer/expected',
            pngPage.name.replace(PDF_TO_PNG_OPTIONS_DEFAULTS.outputFileMask as string, parse(pdfFilePath).name),
        );
        const expectedFileContent: Buffer = readFileSync(expectedFilePath);
        const compareResult: number = comparePng(pngPage.content, expectedFileContent);

        expect(pngPage.name).toBe(`${PDF_TO_PNG_OPTIONS_DEFAULTS.outputFileMask as string}_page_${index + 1}.png`);
        expect(existsSync(pngPage.path)).toBe(false);
        expect(compareResult).toBe(0);
    });
});
