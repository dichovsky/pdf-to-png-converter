import type { DocumentInitParameters } from 'pdfjs-dist/types/src/display/api';

/**
 * Maximum allowed value for `viewportScale`. Values above this limit would produce canvases
 * so large (an A4 page at scale 100 already yields ~5×10⁹ pixels) that they risk OOM crashes
 * before the pixel-count guard in `processPdfPage` can fire.
 */
export const MAX_VIEWPORT_SCALE = 100;

/**
 * Maximum canvas area in pixels. At 4 bytes per pixel, 100 MP ≈ 400 MB of raw bitmap memory.
 * Any page whose viewport exceeds this limit will be rejected before canvas allocation.
 */
export const MAX_CANVAS_PIXELS = 100_000_000;

/**
 * Default values applied to `PdfToPngOptions` fields that are not explicitly set by the caller.
 * These are also used as the source of truth for documented defaults in JSDoc comments on the type.
 */
export const PDF_TO_PNG_OPTIONS_DEFAULTS = {
    viewportScale: 1,
    disableFontFace: true,
    useSystemFonts: false,
    enableXfa: true,
    /** Used as the output filename stem when the PDF is supplied as a buffer rather than a file path. */
    outputFileMask: 'buffer',
    pdfFilePassword: undefined,
    concurrencyLimit: 4,
};

/**
 * Relative paths to the pdfjs-dist asset directories.
 * Stored as raw strings so they can be resolved against `process.cwd()` at call time
 * (inside `propsToPdfDocInitParams`) rather than at module-load time. This ensures
 * applications that call `process.chdir()` after importing the library still get
 * correct paths.
 */
export const CMAP_RELATIVE_URL = './node_modules/pdfjs-dist/cmaps/';
export const STANDARD_FONTS_RELATIVE_URL = './node_modules/pdfjs-dist/standard_fonts/';

/**
 * Default pdfjs `DocumentInitParameters` used when initialising a PDF document.
 * - `cMapUrl` / `cMapPacked`: point to the pre-packed character maps bundled with `pdfjs-dist`,
 *    required for rendering CJK and other non-Latin PDFs correctly.
 * - `standardFontDataUrl`: path to the standard Type 1 / TrueType fonts bundled with `pdfjs-dist`,
 *    used as fallbacks when a PDF does not embed its fonts.
 *
 * Note: these values are raw relative paths. They are resolved to absolute paths at call time
 * by `propsToPdfDocInitParams` via `normalizePath`.
 */
export const DOCUMENT_INIT_PARAMS_DEFAULTS: DocumentInitParameters = {
    cMapUrl: CMAP_RELATIVE_URL,
    cMapPacked: true,
    standardFontDataUrl: STANDARD_FONTS_RELATIVE_URL,
};

// Test-only asset lists (STANDARD_FONTS, STANDARD_CMAPS) live in __tests__/test-data-constants.ts
