export type PdfToPngOptions = {
    viewportScale?: number;
    disableFontFace?: boolean;
    useSystemFonts?: boolean;
    enableXfa?: boolean;
    pdfFilePassword?: string;
    outputFolder?: string;
    outputFileMaskFunc?: (pageNumber: number) => string;
    pagesToProcess?: number[];
    verbosityLevel?: number;
    returnPageContent?: boolean;
    processPagesInParallel?: boolean;
};
