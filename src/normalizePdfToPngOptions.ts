import { MAX_VIEWPORT_SCALE, PDF_TO_PNG_OPTIONS_DEFAULTS } from './const.js';
import type { PdfToPngOptions } from './interfaces/pdf.to.png.options.js';
import { VerbosityLevel } from './types/verbosity.level.js';

export interface NormalizedPdfToPngOptions {
    viewportScale: number;
    disableFontFace: boolean;
    useSystemFonts: boolean;
    enableXfa: boolean;
    pdfFilePassword: string | undefined;
    outputFolder: string | undefined;
    outputFileMaskFunc: ((pageNumber: number) => string) | undefined;
    pagesToProcess: number[] | undefined;
    verbosityLevel: VerbosityLevel;
    returnPageContent: boolean;
    returnMetadataOnly: boolean;
    processPagesInParallel: boolean;
    concurrencyLimit: number;
}

export function normalizePdfToPngOptions(props: PdfToPngOptions | undefined): NormalizedPdfToPngOptions {
    const viewportScale: number = props?.viewportScale ?? PDF_TO_PNG_OPTIONS_DEFAULTS.viewportScale;
    if (typeof viewportScale !== 'number' || !Number.isFinite(viewportScale) || viewportScale <= 0 || viewportScale > MAX_VIEWPORT_SCALE) {
        throw new Error(
            `viewportScale must be a finite number greater than 0 and at most ${MAX_VIEWPORT_SCALE}, received: ${viewportScale}`,
        );
    }

    const outputFolder = props?.outputFolder;
    if (outputFolder?.trim() === '') {
        throw new Error('outputFolder must not be empty');
    }

    const verbosityLevel: VerbosityLevel = props?.verbosityLevel ?? VerbosityLevel.ERRORS;
    if (verbosityLevel !== VerbosityLevel.ERRORS && verbosityLevel !== VerbosityLevel.WARNINGS && verbosityLevel !== VerbosityLevel.INFOS) {
        throw new Error('verbosityLevel must be 0, 1, or 5');
    }

    const pagesToProcess = props?.pagesToProcess?.map((pageNumber) => {
        if (!Number.isInteger(pageNumber) || pageNumber <= 0) {
            throw new Error(`pagesToProcess contains invalid page number: ${pageNumber}`);
        }
        return pageNumber;
    });

    const processPagesInParallel = props?.processPagesInParallel ?? false;
    const concurrencyLimit: number = props?.concurrencyLimit ?? PDF_TO_PNG_OPTIONS_DEFAULTS.concurrencyLimit;
    if (processPagesInParallel && (!Number.isInteger(concurrencyLimit) || concurrencyLimit < 1)) {
        throw new Error(`concurrencyLimit must be a positive integer >= 1, received: ${concurrencyLimit}`);
    }

    return {
        viewportScale,
        disableFontFace: props?.disableFontFace ?? PDF_TO_PNG_OPTIONS_DEFAULTS.disableFontFace,
        useSystemFonts: props?.useSystemFonts ?? PDF_TO_PNG_OPTIONS_DEFAULTS.useSystemFonts,
        enableXfa: props?.enableXfa ?? PDF_TO_PNG_OPTIONS_DEFAULTS.enableXfa,
        pdfFilePassword: props?.pdfFilePassword ?? PDF_TO_PNG_OPTIONS_DEFAULTS.pdfFilePassword,
        outputFolder,
        outputFileMaskFunc: props?.outputFileMaskFunc,
        pagesToProcess,
        verbosityLevel,
        returnPageContent: props?.returnPageContent ?? true,
        returnMetadataOnly: props?.returnMetadataOnly ?? false,
        processPagesInParallel,
        concurrencyLimit,
    };
}
