export type PdfToPngOptions = {
    viewportScale?: number;
    disableFontFace?: boolean;
    useSystemFonts?: boolean;
    enableXfa?: boolean;
    pdfFilePassword?: string;
    outputFolder?: string;
    outputFileMask?: string;
    pagesToProcess?: number[];
    strictPagesToProcess?: boolean;
    verbosityLevel?: number;
};
