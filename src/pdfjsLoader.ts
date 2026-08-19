import { resolve, sep } from 'node:path';
import type { PDFDocumentLoadingTask, PDFDocumentProxy } from 'pdfjs-dist';
import type * as PdfjsModule from 'pdfjs-dist/legacy/build/pdf.mjs';
import type { DocumentInitParameters } from 'pdfjs-dist/types/src/display/api';
import { CMAP_RELATIVE_URL, STANDARD_FONTS_RELATIVE_URL } from './const.js';
import type { VerbosityLevel } from './types.js';

/** The validated document-loading options consumed by pdf.js. */
export interface PdfDocumentOptions {
    disableFontFace: boolean;
    useSystemFonts: boolean;
    enableXfa: boolean;
    pdfFilePassword: string | undefined;
    verbosityLevel: VerbosityLevel;
}

let pdfjsLib: typeof PdfjsModule | undefined;

/** Builds a pdf.js factory URL using call-time CWD and a portable trailing forward slash. */
function factoryUrl(path: string): string {
    const absolute = resolve(path).split(sep).join('/');
    return absolute.endsWith('/') ? absolute : `${absolute}/`;
}

export async function getPdfDocument(pdfFileBuffer: Uint8Array, opts: PdfDocumentOptions): Promise<PDFDocumentProxy> {
    pdfjsLib ??= await import('pdfjs-dist/legacy/build/pdf.mjs');
    const { getDocument } = pdfjsLib;
    const parameters: DocumentInitParameters = {
        data: pdfFileBuffer,
        cMapUrl: factoryUrl(CMAP_RELATIVE_URL),
        cMapPacked: true,
        standardFontDataUrl: factoryUrl(STANDARD_FONTS_RELATIVE_URL),
        verbosity: opts.verbosityLevel,
        disableFontFace: opts.disableFontFace,
        useSystemFonts: opts.useSystemFonts,
        enableXfa: opts.enableXfa,
        password: opts.pdfFilePassword,
    };
    const task: PDFDocumentLoadingTask = getDocument(parameters);

    try {
        return await task.promise;
    } catch (error) {
        await task.destroy();
        throw error;
    }
}
