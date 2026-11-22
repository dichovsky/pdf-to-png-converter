/**
 * Options for the `pdfToPng` conversion function.
 *
 * All properties are optional. Unset properties take the shared defaults in `PDF_TO_PNG_OPTIONS_DEFAULTS`
 * (`src/const.ts`) or, for the verbosity and mode flags, the defaults applied in `normalizeOptions()`
 * (`src/pdfToPng.ts`); each property below states its default.
 */
export interface PdfToPngOptions {
    /**
     * Scale factor applied to each page viewport before rendering.
     * Values above `1` produce larger, higher-resolution images; values below `1` produce smaller images.
     * Must be a finite positive number. The maximum value is `100`. Values above this limit throw immediately.
     * If the rendered size of a page is more than the canvas limits, the page is rejected before a canvas is
     * allocated.
     * Default: `1`.
     */
    viewportScale?: number;

    /**
     * Always `true` at runtime. pdf.js has no Font Loading API in Node.js. With `false`, pdf.js would draw text in
     * embedded fonts as missing-glyph boxes. Thus, the library passes `true`, and pdf.js draws glyph outlines as
     * paths (pdf.js continues to use embedded fonts).
     * An explicit `false` is accepted but ignored, on the main thread and in worker threads. The library then emits a
     * process warning with code `PDF_TO_PNG_DISABLE_FONT_FACE_IGNORED` a maximum of one time for each thread (normally
     * one time for each process). To stop only that warning, use
     * `node --disable-warning=PDF_TO_PNG_DISABLE_FONT_FACE_IGNORED`.
     * Default: `true`.
     */
    disableFontFace?: boolean;

    /**
     * When `true`, pdfjs attempts to use fonts installed on the host system for fonts that are not embedded.
     * Output then depends on the fonts installed on the machine that runs the conversion.
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
     * A relative path is resolved against `process.cwd()` when `pdfToPng()` is called, before asynchronous work starts.
     * Thus, a later `process.chdir()` cannot redirect the output.
     * The folder is created recursively if it is not present.
     * When omitted (or `null`), no files are written to disk. All other non-string values throw before the input is read.
     *
     * @remarks
     * **Security (TOCTOU):** This directory must be private and not writable by untrusted users.
     * Path checks cannot atomically bind the write to a directory inode. The write-containment guard does these steps:
     * - It rejects filenames that contain path separators. Thus, the target is always a direct child of this folder.
     * - It resolves symlinks.
     * - It checks the canonical pathname of the folder immediately before each write.
     * - It uses exclusive-create file opens. Thus, it does not overwrite pre-existing files or follow a pre-planted
     *   target symlink at the final filename.
     */
    outputFolder?: string;

    /**
     * Custom naming function for output PNG files.
     * Receives the 1-based page number and must return a filename string. The library does not add or check a file
     * extension. By convention, add `.png` yourself (e.g. `(pageNumber) => \`page_${pageNumber}.png\``).
     * In all modes, the value must be non-empty and contain no host path separator.
     * For disk output, the value must also be a host-valid filename of 255 units or less. A unit is a UTF-16 code unit on
     * macOS and Windows, and a UTF-8 byte on other hosts. Before output I/O, these values are rejected:
     * - NUL and directory aliases.
     * - On Windows: invalid characters, alternate-data-stream syntax, reserved device basenames, and trailing
     *   dots/spaces.
     *
     * For disk output, names that a filesystem may treat as one file are also rejected as duplicates before the output
     * folder is created. Names are compared after Unicode normalization (NFC and NFD forms) and case folding. Thus,
     * these pairs collide on all platforms: `Page.png` and `page.png`, `straße.png` and `STRASSE.png`, and two
     * spellings of one accented name.
     * When omitted, names default to `<pdfBasename>_page_<pageNumber>.png`. When the PDF is supplied as bytes, not as a
     * file path, names default to `buffer_page_<pageNumber>.png`.
     * `null` counts as omitted. All other non-function values throw before the input is read.
     * @since 3.14.0
     */
    outputFileMaskFunc?: (pageNumber: number) => string;

    /**
     * 1-based integer page numbers to convert. Must be an `Array` of positive integers. These values throw immediately,
     * before I/O starts:
     * - All other containers (a typed array, `Set`, string, or other array-like).
     * - An array with holes.
     * - Non-integer values, and values less than or equal to zero.
     *
     * Pages above the document page count are silently ignored.
     * When omitted (or `null`), all pages in the document are processed.
     * @since 3.3.0
     */
    pagesToProcess?: number[];

    /**
     * pdfjs verbosity level. Use the `VerbosityLevel` const for readable values:
     * `VerbosityLevel.ERRORS` (0), `VerbosityLevel.WARNINGS` (1), `VerbosityLevel.INFOS` (5).
     * It changes pdf.js log lines only, never the output or errors.
     * On the main thread, the level is process-wide. pdf.js keeps one verbosity setting, and each opened document
     * overwrites it. Thus, overlapping conversions with different levels all log at the level of the last opened document.
     * Page rendering in worker threads (`renderInWorkerThreads`) uses the level of each worker. But the main thread
     * also opens all documents. Thus, its load-time log lines follow the process-wide level.
     * Default: `VerbosityLevel.ERRORS` (0).
     */
    verbosityLevel?: VerbosityLevel;

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
     * No canvas is created, no rendering is performed, and no files are written to disk. This is
     * also true when `outputFolder` is set.
     * This mode is significantly faster than full rendering. Use it to inspect page dimensions
     * and rotation without generating images.
     * To stay consistent with a real render, this mode also rejects pages that cannot be rendered at the requested
     * `viewportScale`. It does not report dimensions for a page that would throw on render. It rejects these pages:
     * - Pages that floor to `0` px.
     * - Pages whose rendered (floored) canvas area is more than the internal canvas pixel limit.
     * - Pages whose floored width or height is more than 1,000,000 px (the per-side limit of the PNG encoder).
     *
     * Default: `false`.
     * @since 3.14.0
     */
    returnMetadataOnly?: boolean;

    /**
     * When `true`, selected pages are rendered concurrently through a sliding-window scheduler.
     * This scheduler keeps a maximum of `concurrencyLimit` pages active.
     * When `false`, pages are processed in a lightly pipelined sequence (a maximum of three pages in flight):
     * - Results are always returned in page order.
     * - The PNG encoding and disk writes of finished pages may overlap the rendering of the next page.
     *   Thus, files may finish writing out of page order.
     * - When a page fails, the pages that are in flight complete before the returned promise rejects.
     *
     * Read output from the resolved `PngPageOutput[]` (ordered), not from directory-watch order.
     * Peak canvas memory in this mode is a maximum of three live canvases. For strict one-page-at-a-time
     * processing with a single live canvas, set `processPagesInParallel: true` with
     * `concurrencyLimit: 1` (a sliding window of one page).
     * Default: `false`.
     * @since 3.7.0
     */
    processPagesInParallel?: boolean;

    /**
     * Maximum number of pages rendered simultaneously when `processPagesInParallel` is `true`.
     * When `processPagesInParallel` or `renderInWorkerThreads` is enabled, it must be a positive integer
     * from `1` to `16` (inclusive). Values outside that range throw immediately (before I/O starts).
     * In other modes, it is ignored.
     * The upper bound caps peak in-flight canvas memory at approximately `16 × MAX_CANVAS_PIXELS × 4 bytes ≈ 6.4 GB`.
     * This cap is a bound, not a guarantee against container exhaustion.
     * Higher values increase throughput but use more memory. In worker-thread mode, it sets the worker-pool size.
     * Default: `4`.
     * @since 3.14.0
     */
    concurrencyLimit?: number;

    /**
     * When `true`, pages are rasterized in a pool of Node.js worker threads (pool size = `concurrencyLimit`).
     * This mode gives true multi-core parallelism. `processPagesInParallel` only interleaves pages on one thread.
     * Each worker loads its own copy of the document. For each worker, expect approximately the memory of one PDF copy
     * plus one pdf.js instance. Expect also a pool startup cost of a few hundred milliseconds for each conversion.
     * This mode is better for multi-page, render-heavy (e.g. image-heavy) documents. It can be slower for small documents.
     * Rendered pixels are identical to single-threaded mode, and results are returned in page order.
     * Disk writes continue to occur on the main thread through the same path-security guards.
     * Takes precedence over `processPagesInParallel`. Ignored when `returnMetadataOnly` is `true`
     * (metadata extraction does not render). `outputFileMaskFunc` is fully supported: names are
     * resolved on the main thread before dispatch.
     * The workers run the compiled `pageRenderWorker.js` that is next to the library's own modules. Thus, this mode
     * requires the installed, unbundled package. In an ESM bundle, `__dirname` is undefined. There, a conversion that
     * selects one or more pages rejects with an error that gives this cause.
     * Default: `false`.
     * @since 4.2.0
     */
    renderInWorkerThreads?: boolean;

    /**
     * Maximum allowed input PDF size in bytes. Larger inputs throw immediately, before rendering work starts.
     * This limit applies to these inputs:
     * - File paths. The file is opened one time, then verified and read through one handle with bounded allocation.
     * - Byte containers, including `Buffer`, `Uint8Array`, `ArrayBuffer`, and `SharedArrayBuffer`. The limit applies to their byte length.
     * - Arrays of bytes. The limit applies to the array length.
     *
     * Non-regular files such as FIFOs, sockets, and devices are rejected. The limit must be a positive integer.
     * The cap bounds the input bytes only, not the memory that pdf.js needs to parse them.
     * A non-PDF payload can be one long sequence of a single byte value (zeros, for example). In the pdf.js recovery
     * scan, this payload uses approximately 32 to 64 heap bytes for each input byte. It can abort the process on heap
     * exhaustion. This can also occur when the input is below this cap.
     * Convert untrusted files in an isolated process (with `--max-old-space-size` set), or in a Node.js `Worker` that you
     * start yourself with `resourceLimits`. `renderInWorkerThreads` does not help, because the main thread also opens
     * all documents.
     * Default: `256 * 1024 * 1024` (256 MiB).
     * @since 4.1.0
     */
    maxInputBytes?: number;
}

/** Page rotation reported by pdf.js, normalized to a clockwise quarter turn. */
export type PageRotation = 0 | 90 | 180 | 270;

interface BasePngPageOutput {
    pageNumber: number;
    name: string;
    /**
     * Image width in pixels, floored to match the rendered bitmap. A length up to 1e-6 px below an integer counts as that
     * integer, so a 612 × 792 pt Letter page at `viewportScale: 350 / 72` (350 dpi) is 2975 × 3850 px, not 2974 × 3849.
     */
    width: number;
    /** Image height in pixels, floored to match the rendered bitmap, with the same 1e-6 px tolerance as `width`. */
    height: number;
    rotation: PageRotation;
}

interface MetadataPngPageOutput extends BasePngPageOutput {
    kind: 'metadata';
    content: undefined;
    path: '';
}

interface InMemoryPngPageOutput extends BasePngPageOutput {
    kind: 'content';
    content: Buffer | undefined;
    path: '';
}

interface FilePngPageOutput extends BasePngPageOutput {
    kind: 'file';
    content: Buffer | undefined;
    path: string;
}

/** Observable result variants returned by {@link pdfToPng}. */
export type PngPageOutput = MetadataPngPageOutput | InMemoryPngPageOutput | FilePngPageOutput;

/**
 * Verbosity levels for the pdfjs-dist logger.
 *
 * The numeric enum shape and values are public compatibility guarantees.
 */
export enum VerbosityLevel {
    ERRORS = 0,
    WARNINGS = 1,
    INFOS = 5,
}
