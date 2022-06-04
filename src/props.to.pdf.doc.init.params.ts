import { VerbosityLevel } from 'pdfjs-dist';
import * as pdfApiTypes from 'pdfjs-dist/types/src/display/api';
import { PDF_TO_PNG_OPTIONS_DEFAULTS } from './const';
import { PdfToPngOptions } from './types/pdf.to.png.options';

export function propsToPdfDocInitParams(props?: PdfToPngOptions): pdfApiTypes.DocumentInitParameters {
    const cMapUrl = '../node_modules/pdfjs-dist/cmaps/';
    const cMapPacked = true;
    const pdfDocInitParams: pdfApiTypes.DocumentInitParameters = {
        cMapUrl,
        cMapPacked,
    };

    pdfDocInitParams.verbosity = props?.verbosityLevel !== undefined ? props?.verbosityLevel : VerbosityLevel.ERRORS;

    pdfDocInitParams.disableFontFace =
        props?.disableFontFace !== undefined ? props.disableFontFace : PDF_TO_PNG_OPTIONS_DEFAULTS.disableFontFace;

    pdfDocInitParams.useSystemFonts =
        props?.useSystemFonts !== undefined ? props.useSystemFonts : PDF_TO_PNG_OPTIONS_DEFAULTS.useSystemFonts;

    pdfDocInitParams.password =
        props?.pdfFilePassword !== undefined ? props?.pdfFilePassword : PDF_TO_PNG_OPTIONS_DEFAULTS.pdfFilePassword;

    return pdfDocInitParams;
}
