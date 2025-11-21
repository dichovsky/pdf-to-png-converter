import { resolve } from 'node:path';
import { expect, test } from 'vitest';
import { getPdfDocumentInfo, PdfDocumentInfo } from '../src';

test('should get PDF document info without conversion', async () => {
    const pdfFilePath: string = resolve('./test-data/sample.pdf');
    const docInfo: PdfDocumentInfo = await getPdfDocumentInfo(pdfFilePath, {
        viewportScale: 1.0,
    });

    expect(docInfo.numPages).to.equal(2);
    expect(docInfo.pages).to.have.length(2);
    
    // Check first page
    expect(docInfo.pages[0].pageNumber).to.equal(1);
    expect(docInfo.pages[0].width).to.be.greaterThan(0);
    expect(docInfo.pages[0].height).to.be.greaterThan(0);
    expect(docInfo.pages[0].rotation).to.be.a('number');
    
    // Check second page
    expect(docInfo.pages[1].pageNumber).to.equal(2);
    expect(docInfo.pages[1].width).to.be.greaterThan(0);
    expect(docInfo.pages[1].height).to.be.greaterThan(0);
    expect(docInfo.pages[1].rotation).to.be.a('number');
});

test('should get PDF document info with custom viewport scale', async () => {
    const pdfFilePath: string = resolve('./test-data/sample.pdf');
    const docInfo1x: PdfDocumentInfo = await getPdfDocumentInfo(pdfFilePath, {
        viewportScale: 1.0,
    });
    const docInfo2x: PdfDocumentInfo = await getPdfDocumentInfo(pdfFilePath, {
        viewportScale: 2.0,
    });

    expect(docInfo1x.numPages).to.equal(docInfo2x.numPages);
    
    // 2x scale should have dimensions approximately 2x larger
    expect(docInfo2x.pages[0].width).to.be.approximately(docInfo1x.pages[0].width * 2, 1);
    expect(docInfo2x.pages[0].height).to.be.approximately(docInfo1x.pages[0].height * 2, 1);
});

test('should get PDF document info from buffer', async () => {
    const { readFileSync } = await import('node:fs');
    const pdfFilePath: string = resolve('./test-data/sample.pdf');
    const pdfBuffer: ArrayBufferLike = readFileSync(pdfFilePath);
    
    const docInfo: PdfDocumentInfo = await getPdfDocumentInfo(pdfBuffer);

    expect(docInfo.numPages).to.equal(2);
    expect(docInfo.pages).to.have.length(2);
    expect(docInfo.pages[0].width).to.be.greaterThan(0);
    expect(docInfo.pages[0].height).to.be.greaterThan(0);
});
