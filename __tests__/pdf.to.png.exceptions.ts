import { test } from 'mocha';
import { resolve } from 'node:path';
import { pdfToPng } from '../src';

const chai = require('chai');
const expect = chai.expect;
chai.use(require('chai-as-promised'));

test(`should throw error when page index = 0 is requested`, async () => {
    const pdfFilePath: string = resolve('./test-data/large_pdf.pdf');

    await expect(pdfToPng(pdfFilePath, { pagesToProcess: [0, 1, 2], strictPagesToProcess: true })).to.be.rejectedWith(
        Error,
    );
});

test(`should throw error when page index < 1 is requested`, async () => {
    const pdfFilePath: string = resolve('./test-data/large_pdf.pdf');

    await expect(pdfToPng(pdfFilePath, { pagesToProcess: [1, 2, -1], strictPagesToProcess: true })).to.be.rejectedWith(
        Error,
    );
});

test(`should throw error when page index > then file contains and strictPagesToProcess is enabled`, async () => {
    const pdfFilePath: string = resolve('./test-data/large_pdf.pdf');

    await expect(
        pdfToPng(pdfFilePath, { pagesToProcess: [1, 2, 1000], strictPagesToProcess: true }),
    ).to.be.rejectedWith(Error);
});
