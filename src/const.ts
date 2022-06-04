import { PdfToPngOptions } from "./types/pdf.to.png.options";

export const PDF_TO_PNG_OPTIONS_DEFAULTS: PdfToPngOptions = {
    viewportScale: 1,
    disableFontFace: true,
    useSystemFonts: false,
    outputFileMask: 'buffer',
    strictPagesToProcess: false,
    pdfFilePassword: undefined,
};
