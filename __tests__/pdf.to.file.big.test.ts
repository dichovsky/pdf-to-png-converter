import { resolve } from 'node:path';
import { expect, test } from 'vitest';
import { PngPageOutput, pdfToPng } from '../src';

test(`should convert BIG sample`, async () => {
    const pdfFilePath: string = resolve('./test-data/10-page-sample.pdf');
    const pngPages: PngPageOutput[] = await pdfToPng(pdfFilePath);

    expect(pngPages.length).to.eq(10);
});
