import { test } from 'mocha';
import { resolve } from 'node:path';
import { pdfToPng } from '../src';
import { expect } from 'chai';


test(`should throw error when page index = 0 is requested`, async () => {
    const pdfFilePath: string = resolve('./test-data/large_pdf.pdf');

    await pdfToPng(pdfFilePath, { pagesToProcess: [0, 1, 2], strictPagesToProcess: true }).catch((error: Error) => {
        expect(error.message).to.equal('Invalid pages requested, page number must be >= 1');
    });
});

test(`should throw error when page index < 1 is requested`, async () => {
    const pdfFilePath: string = resolve('./test-data/large_pdf.pdf');

    await pdfToPng(pdfFilePath, { pagesToProcess: [1, 2, -1], strictPagesToProcess: true }).catch((error: Error) => {
        expect(error.message).to.equal('Invalid pages requested, page number must be >= 1');
    });
});

test(`should throw error when page index > then file contains and strictPagesToProcess is enabled`, async () => {
    const pdfFilePath: string = resolve('./test-data/large_pdf.pdf');

    await pdfToPng(pdfFilePath, { pagesToProcess: [1, 2, 1000], strictPagesToProcess: true }).catch((error: Error) => { 
        expect(error.message).to.equal('Invalid pages requested, page number must be <= total pages');
    });
});
