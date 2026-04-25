import type { PDFDocumentLoadingTask, PDFDocumentProxy } from 'pdfjs-dist';
import type * as PdfjsModule from 'pdfjs-dist/legacy/build/pdf.mjs';
import type { PdfToPngOptions } from './interfaces/index.js';
import { propsToPdfDocInitParams } from './propsToPdfDocInitParams.js';

let pdfjsLib: typeof PdfjsModule | undefined;

export async function getPdfDocument(pdfFileBuffer: Uint8Array | ArrayBufferLike, props?: PdfToPngOptions): Promise<PDFDocumentProxy> {
    pdfjsLib ??= await import('pdfjs-dist/legacy/build/pdf.mjs');
    const { getDocument } = pdfjsLib;
    const documentInitParameters = propsToPdfDocInitParams(props);
    const data: Uint8Array = pdfFileBuffer instanceof Uint8Array ? pdfFileBuffer : new Uint8Array(pdfFileBuffer);
    const task: PDFDocumentLoadingTask = getDocument({
        ...documentInitParameters,
        data,
    });

    try {
        return await task.promise;
    } catch (error) {
        await task.destroy();
        throw error;
    }
}
