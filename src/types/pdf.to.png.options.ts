/**
 * Options for the `pdfToPng` conversion function.
 * All properties are optional; unset properties fall back to `PDF_TO_PNG_OPTIONS_DEFAULTS`.
 */
export type PdfToPngOptions = {
    /**
     * Scale factor applied to each page viewport before rendering.
     * Values > 1 produce larger, higher-resolution images; values < 1 produce smaller images.
     * Default: `1`.
     */
    viewportScale?: number;

    /**
     * When `true`, pdfjs will not load embedded fonts and will substitute them with
     * built-in fonts. Speeds up rendering; may affect visual fidelity.
     * Default: `true`.
     */
    disableFontFace?: boolean;

    /**
     * When `true`, pdfjs attempts to use fonts installed on the host system.
     * Typically used together with `disableFontFace: false`.
     * Default: `false`.
     */
    useSystemFonts?: boolean;

    /**
     * When `true`, pdfjs processes XFA (XML Forms Architecture) form data embedded in the PDF.
     * Default: `true`.
     */
    enableXfa?: boolean;

    /**
     * Password for opening password-protected (encrypted) PDFs.
     * Leave undefined for unprotected files.
     * Default: `undefined`.
     */
    pdfFilePassword?: string;

    /**
     * Folder path (relative to `process.cwd()`) where PNG files will be written.
     * The folder is created recursively if it does not exist.
     * When omitted, no files are written to disk.
     */
    outputFolder?: string;

    /**
     * Custom naming function for output PNG files.
     * Receives the 1-based page number and should return the full filename string including the `.png` extension
     * (e.g. `(pageNumber) => \`page_${pageNumber}.png\``).
     * When omitted, names default to `<pdfBasename>_page_<pageNumber>.png`.
     */
    outputFileMaskFunc?: (pageNumber: number) => string;

    /**
     * 1-based page numbers to convert. Pages outside the valid range (1 to numPages)
     * are silently ignored.
     * When omitted, all pages in the document are processed.
     */
    pagesToProcess?: number[];

    /**
     * pdfjs verbosity level. Use the `VerbosityLevel` const for readable values:
     * `VerbosityLevel.ERRORS` (0), `VerbosityLevel.WARNINGS` (1), `VerbosityLevel.INFOS` (5).
     * Default: `VerbosityLevel.ERRORS` (0).
     */
    verbosityLevel?: number;

    /**
     * When `true`, each `PngPageOutput` will include a `content` property containing
     * the PNG image as a `Buffer`. Set to `false` to skip buffering when only writing
     * files to disk, which reduces memory usage.
     * Default: `true`.
     */
    returnPageContent?: boolean;

    /**
     * When `true`, all selected pages are rendered concurrently (via `Promise.all` in batches).
     * When `false`, pages are processed one at a time in order.
     * Default: `false`.
     */
    processPagesInParallel?: boolean;

    /**
     * Maximum number of pages rendered simultaneously when `processPagesInParallel` is `true`.
     * Higher values increase throughput at the cost of memory. Minimum effective value is `1`.
     * Default: `4`.
     */
    concurrencyLimit?: number;
};
