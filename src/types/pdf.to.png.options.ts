export type PdfToPngOptions = {
    viewportScale?: number;
    disableFontFace?: boolean;
    useSystemFonts?: boolean;
    pdfFilePassword?: string;
    outputFolder?: string;
    outputFileMask?: string;
    pagesToProcess?: number[];
    strictPagesToProcess?: boolean;
    verbosityLevel?: number;
};
