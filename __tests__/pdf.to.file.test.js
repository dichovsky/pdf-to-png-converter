import { resolve } from 'node:path';
import { expect, test } from 'vitest';
import { pdfToPng } from '../out';

test(`should convert PDF To PNG files`, async () => {
    const pdfFilePath = resolve('./test-data/TAMReview.pdf');
    const pngPages = await pdfToPng(pdfFilePath);

    expect(pngPages.length).to.eq(23);
});
