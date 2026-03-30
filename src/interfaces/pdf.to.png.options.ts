/**
 * Options for the `pdfToPng` conversion function.
 *
 * All properties are optional. Any unset property falls back to the corresponding
 * value in `PDF_TO_PNG_OPTIONS_DEFAULTS` defined in `src/const.ts`.
 */
export interface PdfToPngOptions {
    /**
     * Scale factor applied to each page viewport before rendering.
     * Values above `1` produce larger, higher-resolution images; values below `1` produce smaller images.
     * Must be a finite positive number. Maximum allowed value is `100`; values above this limit throw
     * immediately to prevent runaway memory allocation (OOM) during canvas creation.
     * Default: `1`.
     */
    viewportScale?: number;

    /**
     * When `true`, pdfjs will not load embedded fonts and substitutes them with built-in fonts.
     * Speeds up rendering but may affect visual fidelity for PDFs with custom fonts.
     * Default: `true`.
     */
    disableFontFace?: boolean;

    /**
     * When `true`, pdfjs attempts to use fonts installed on the host system.
     * Typically combined with `disableFontFace: false` to improve font rendering accuracy.
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
     * Leave `undefined` for unprotected files.
     * Default: `undefined`.
     */
    pdfFilePassword?: string;

    /**
     * Folder path (relative or absolute) where PNG files will be written.
     * Relative paths are resolved against `process.cwd()`.
     * The folder is created recursively if it does not exist.
     * When omitted, no files are written to disk.
     *
     * @remarks
     * **Security (TOCTOU):** The write-containment guard resolves symlinks and checks that the
     * output path stays within this folder, but a residual race window exists between the final
     * check and the actual write. A local attacker could exploit this via
     * (a) atomically replacing the folder with a symlink during that window, or (b) creating or
     * pre-populating a symlink at the destination filename inside this folder that redirects
     * `writeFile()` elsewhere. To reduce exposure on multi-user or shared systems, ensure this
     * directory is private, not writable by untrusted users, and does not contain untrusted,
     * pre-existing symlinks at the filenames that will be written.
     */
    outputFolder?: string;

    /**
     * Custom naming function for output PNG files.
     * Receives the 1-based page number and must return a full filename string including the `.png` extension
     * (e.g. `(pageNumber) => \`page_${pageNumber}.png\``).
     * When omitted, names default to `<pdfBasename>_page_<pageNumber>.png`,
     * or `buffer_page_<pageNumber>.png` when the PDF is supplied as an `ArrayBufferLike`.
     */
    outputFileMaskFunc?: (pageNumber: number) => string;

    /**
     * 1-based page numbers to convert. Pages outside the valid range (1 to `numPages`) are silently ignored.
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
     * When `true`, each `PngPageOutput` will include a `content` property containing the PNG image as a `Buffer`.
     * Set to `false` to skip buffering when only writing files to disk, which reduces memory usage.
     * Default: `true`.
     */
    returnPageContent?: boolean;

    /**
     * When `true`, only page metadata is returned for each page without rendering any PNG image.
     * The returned `PngPageOutput` objects will have `pageNumber`, `name`, `width`, `height`, and
     * `rotation` populated, but `content` will always be `undefined` and `path` will always be `""`.
     * No canvas is created, no rendering is performed, and no files are written to disk even if
     * `outputFolder` is set.
     * This is significantly faster than full rendering and useful for inspecting page dimensions
     * and rotation without generating images.
     * Default: `false`.
     */
    returnMetadataOnly?: boolean;

    /**
     * When `true`, all selected pages are rendered concurrently using `Promise.all` in batches
     * controlled by `concurrencyLimit`. When `false`, pages are processed one at a time in order.
     * Default: `false`.
     */
    processPagesInParallel?: boolean;

    /**
     * Maximum number of pages rendered simultaneously when `processPagesInParallel` is `true`.
     * Must be a positive integer (`>= 1`). Non-integer or sub-1 values throw immediately (before any I/O).
     * Higher values increase throughput at the cost of memory.
     * Only applies when `processPagesInParallel` is `true`.
     * Default: `4`.
     */
    concurrencyLimit?: number;
}
