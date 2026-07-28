import type { PDFDocumentLoadingTask, PDFDocumentProxy } from 'pdfjs-dist';
import type * as PdfjsModule from 'pdfjs-dist/legacy/build/pdf.mjs';
import type { NormalizedPdfToPngOptions } from './normalizePdfToPngOptions.js';
import { propsToPdfDocInitParams } from './propsToPdfDocInitParams.js';

let pdfjsLib: typeof PdfjsModule | undefined;

export async function getPdfDocument(pdfFileBuffer: Uint8Array, opts: NormalizedPdfToPngOptions): Promise<PDFDocumentProxy> {
    pdfjsLib ??= await import('pdfjs-dist/legacy/build/pdf.mjs');
    const { getDocument } = pdfjsLib;
    const documentInitParameters = propsToPdfDocInitParams(opts);
    const task: PDFDocumentLoadingTask = getDocument({
        ...documentInitParameters,
        data: pdfFileBuffer,
    });

    try {
        return await task.promise;
    } catch (error) {
        await task.destroy();
        throw error;
    }
}
