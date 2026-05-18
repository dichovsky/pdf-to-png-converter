import type * as pdfApiTypes from 'pdfjs-dist/types/src/display/api';
import { CMAP_RELATIVE_URL, DOCUMENT_INIT_PARAMS_DEFAULTS, STANDARD_FONTS_RELATIVE_URL } from './const';
import { normalizePath } from './normalizePath';
import type { NormalizedPdfToPngOptions } from './normalizePdfToPngOptions';

/**
 * Maps a fully-validated `NormalizedPdfToPngOptions` to a pdfjs `DocumentInitParameters`.
 *
 * Starts from `DOCUMENT_INIT_PARAMS_DEFAULTS` (cMap paths and standard font data URL) and
 * overlays the following fields. Because the caller has already run all defaulting through
 * `normalizePdfToPngOptions`, this mapper performs **no** fallback resolution — it is a pure
 * field rename:
 *
 * - `verbosityLevel`  → `verbosity`
 * - `disableFontFace` → `disableFontFace`
 * - `useSystemFonts`  → `useSystemFonts`
 * - `enableXfa`       → `enableXfa`
 * - `pdfFilePassword` → `password`
 *
 * The cMap and standard-font asset paths are resolved at call time so that any
 * `process.chdir()` between import and invocation is correctly reflected.
 *
 * @param opts - Already-normalized options.
 * @returns A `DocumentInitParameters` object ready to be passed to pdfjs `getDocument()`.
 */
export function propsToPdfDocInitParams(opts: NormalizedPdfToPngOptions): pdfApiTypes.DocumentInitParameters {
    return {
        ...DOCUMENT_INIT_PARAMS_DEFAULTS,
        cMapUrl: normalizePath(CMAP_RELATIVE_URL),
        standardFontDataUrl: normalizePath(STANDARD_FONTS_RELATIVE_URL),
        verbosity: opts.verbosityLevel,
        disableFontFace: opts.disableFontFace,
        useSystemFonts: opts.useSystemFonts,
        enableXfa: opts.enableXfa,
        password: opts.pdfFilePassword,
    };
}
