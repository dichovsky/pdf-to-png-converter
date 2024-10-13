import { existsSync, readFileSync } from 'node:fs';
import { parse, resolve } from 'node:path';
import { expect, test } from 'vitest';
import { PngPageOutput, pdfToPng } from '../src';
import { comparePNG } from '../src/compare.png';
import { PDF_TO_PNG_OPTIONS_DEFAULTS } from '../src/const';

const pdfFilePath: string = resolve('./test-data/large_pdf.pdf');
const pdfBuffer: Buffer = readFileSync(pdfFilePath);

test(`should convert PDF To PNG without saving to file, output file mask is not defined`, async () => {
    const pngPages: PngPageOutput[] = await pdfToPng(pdfBuffer, {
        viewportScale: 2.0,
    });

    pngPages.forEach((pngPage: PngPageOutput, index: number) => {
        const expectedFilePath: string = resolve(
            'test-data/pdf.to.buffer/expected',
            pngPage.name.replace(PDF_TO_PNG_OPTIONS_DEFAULTS.outputFileMask as string, parse(pdfFilePath).name),
        );
        const compareResult: number = comparePNG({
            actualFile: pngPage.content,
            expectedFile: expectedFilePath,
            createExpectedFileIfMissing: false,
        });

        expect(pngPage.name).to.equal(`${PDF_TO_PNG_OPTIONS_DEFAULTS.outputFileMask as string}_page_${index + 1}.png`);
        expect(existsSync(pngPage.path)).to.equal(false);
        expect(compareResult).to.equal(0);
    });
});
