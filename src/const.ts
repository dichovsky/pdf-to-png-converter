import { join } from 'node:path';
import { DocumentInitParameters } from 'pdfjs-dist/types/src/display/api';
import { PdfToPngOptions } from './types/pdf.to.png.options';

export const PDF_TO_PNG_OPTIONS_DEFAULTS: PdfToPngOptions = {
    viewportScale: 1,
    disableFontFace: true,
    useSystemFonts: false,
    enableXfa: false,
    outputFileMask: 'buffer',
    strictPagesToProcess: false,
    pdfFilePassword: undefined,
};

export const DOCUMENT_INIT_PARAMS_DEFAULTS: DocumentInitParameters = {
    cMapUrl: join(__dirname, '../../../node_modules/pdfjs-dist/cmaps/'),
    cMapPacked: true,
    standardFontDataUrl: join(__dirname, '../../../node_modules/pdfjs-dist/standard_fonts/'),
}
