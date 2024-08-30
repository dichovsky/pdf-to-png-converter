import { expect } from 'chai';
import { test } from 'mocha';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { PngPageOutput, pdfToPng } from '../src';
import { comparePNG } from '../src/compare.png';

const pdfFilePath: string = resolve('./test-data/large_pdf.pdf');
const pdfBuffer: Buffer = readFileSync(pdfFilePath);

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
