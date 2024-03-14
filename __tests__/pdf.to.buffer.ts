import { expect } from 'chai';
import { test } from 'mocha';
import { existsSync, readFileSync } from 'node:fs';
import { parse, resolve } from 'node:path';
import { PngPageOutput, pdfToPng } from '../src';
import { comparePNG } from '../src/compare.png';
import { PDF_TO_PNG_OPTIONS_DEFAULTS } from '../src/const';

const pdfFilePath: string = resolve('./test-data/large_pdf.pdf');
const pdfBuffer: Buffer = readFileSync(pdfFilePath);

test(`should convert PDF To PNG buffer (without saving to file)`, async () => {
    const pngPages: PngPageOutput[] = await pdfToPng(pdfFilePath, {
        viewportScale: 2.0,
    });

    pngPages.forEach((pngPage: PngPageOutput) => {
        const expectedFilePath: string = resolve('./test-data/pdf.to.buffer/expected', pngPage.name);
        const compareResult: number = comparePNG(pngPage.content, expectedFilePath);

        expect(existsSync(pngPage.path)).to.equal(false);
        expect(compareResult).to.equal(0);
    });
});

test(`should convert PDF To PNG without saving to file, output file mask is defined`, async () => {
    const pngPages: PngPageOutput[] = await pdfToPng(pdfBuffer, {
        viewportScale: 2.0,
        outputFileMask: 'large_pdf',
    });

    pngPages.forEach((pngPage: PngPageOutput) => {
        const expectedFilePath: string = resolve('./test-data/pdf.to.buffer/expected', pngPage.name);
        const compareResult: number = comparePNG(pngPage.content, expectedFilePath);

        expect(existsSync(pngPage.path)).to.equal(false);
        expect(compareResult).to.equal(0);
    });
});

test(`should convert PDF To PNG without saving to file, output file mask is not defined`, async () => {
    const pngPages: PngPageOutput[] = await pdfToPng(pdfBuffer, {
        viewportScale: 2.0,
    });

    pngPages.forEach((pngPage: PngPageOutput, index: number) => {
        const expectedFilePath: string = resolve(
            'test-data/pdf.to.buffer/expected',
            pngPage.name.replace(PDF_TO_PNG_OPTIONS_DEFAULTS.outputFileMask as string, parse(pdfFilePath).name),
        );
        const compareResult: number = comparePNG(pngPage.content, expectedFilePath);

        expect(pngPage.name).to.equal(`${PDF_TO_PNG_OPTIONS_DEFAULTS.outputFileMask as string}_page_${index + 1}.png`);
        expect(existsSync(pngPage.path)).to.equal(false);
        expect(compareResult).to.equal(0);
    });
});
