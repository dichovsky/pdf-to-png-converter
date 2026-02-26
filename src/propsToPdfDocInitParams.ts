import type * as pdfApiTypes from 'pdfjs-dist/types/src/display/api';
import { DOCUMENT_INIT_PARAMS_DEFAULTS, PDF_TO_PNG_OPTIONS_DEFAULTS } from './const';
import type { PdfToPngOptions } from './interfaces/pdf.to.png.options';
import { VerbosityLevel } from './types/verbosity.level';

/**
 * Maps a `PdfToPngOptions` object to a pdfjs `DocumentInitParameters` object.
 *
 * Starts from `DOCUMENT_INIT_PARAMS_DEFAULTS` (cMap paths and standard font data URL) and
 * overlays the following fields from `props`, falling back to `PDF_TO_PNG_OPTIONS_DEFAULTS`
 * for any property that is not set:
 *
 * - `verbosityLevel`  → `verbosity`  (default: `VerbosityLevel.ERRORS`)
 * - `disableFontFace` → `disableFontFace` (default: `true`)
 * - `useSystemFonts`  → `useSystemFonts`  (default: `false`)
 * - `enableXfa`       → `enableXfa`       (default: `true`)
 * - `pdfFilePassword` → `password`        (default: `undefined`)
 *
 * @param props - Optional `PdfToPngOptions` to convert. When `undefined`, all fields are set to their defaults.
 * @returns A `DocumentInitParameters` object ready to be passed to pdfjs `getDocument()`.
 */
export function propsToPdfDocInitParams(props?: PdfToPngOptions): pdfApiTypes.DocumentInitParameters {
    const pdfDocInitParams: pdfApiTypes.DocumentInitParameters = {
        ...DOCUMENT_INIT_PARAMS_DEFAULTS,
    };

    // Map 'verbosityLevel' from PdfToPngOptions to 'verbosity' in DocumentInitParameters
    pdfDocInitParams.verbosity = props?.verbosityLevel ?? VerbosityLevel.ERRORS;

    pdfDocInitParams.disableFontFace = props?.disableFontFace ?? PDF_TO_PNG_OPTIONS_DEFAULTS.disableFontFace;

    pdfDocInitParams.useSystemFonts = props?.useSystemFonts ?? PDF_TO_PNG_OPTIONS_DEFAULTS.useSystemFonts;

    pdfDocInitParams.enableXfa = props?.enableXfa ?? PDF_TO_PNG_OPTIONS_DEFAULTS.enableXfa;

    pdfDocInitParams.password = props?.pdfFilePassword ?? PDF_TO_PNG_OPTIONS_DEFAULTS.pdfFilePassword;

    return pdfDocInitParams;
}
