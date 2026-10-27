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
     * Must be a finite positive number. Maximum allowed value is `100`; values above this limit throw
     * immediately to prevent runaway memory allocation (OOM) during canvas creation.
     * Default: `1`.
     */
    viewportScale?: number;

    /**
     * pdf.js has no Font Loading API in Node.js, so it is always given `true`, which draws glyphs as paths with its
     * built-in font renderer (embedded fonts are still used). An explicit `false` is accepted but ignored, on the main
     * thread and in worker threads, and a process warning with code `PDF_TO_PNG_DISABLE_FONT_FACE_IGNORED` is emitted once
     * per process; silence only that warning with `node --disable-warning=PDF_TO_PNG_DISABLE_FONT_FACE_IGNORED`.
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
     * A relative path is resolved against `process.cwd()` when `pdfToPng()` is called, before any asynchronous work, so a
     * later `process.chdir()` cannot redirect the output.
     * The folder is created recursively if it does not exist.
     * When omitted (or `null`), no files are written to disk. Any other non-string value throws before the input is read.
     *
     * @remarks
     * **Security (TOCTOU):** The write-containment guard rejects filenames that contain path
     * separators (so the target is always a direct child of this folder), resolves symlinks,
     * checks the folder's canonical pathname immediately before each write, and uses exclusive-
     * create file opens to avoid overwriting pre-existing files or following a pre-planted target
     * symlink at the final filename. Path checks cannot atomically bind the write to a directory
     * inode, so this directory must be private and not writable by untrusted users.
     */
    outputFolder?: string;

    /**
     * Custom naming function for output PNG files.
     * Receives the 1-based page number and must return a filename string. The library neither adds nor checks a file
     * extension: by convention, add `.png` yourself (e.g. `(pageNumber) => \`page_${pageNumber}.png\``).
     * In every mode the value must be non-empty and contain no host path separator. For disk
     * output it must also be a host-valid filename of at most 255 units (UTF-16 code units on macOS and Windows, UTF-8
     * bytes on other hosts): NUL and directory aliases are rejected, and
     * Windows additionally rejects invalid characters, alternate-data-stream syntax, reserved
     * device basenames, and trailing dots/spaces before output I/O.
     * For disk output, names that a filesystem may treat as one file are also rejected as duplicates before the output
     * folder is created. Names are compared after Unicode normalization (NFC and NFD forms) and case folding, so
     * `Page.png` and `page.png`, `straße.png` and `STRASSE.png`, or two spellings of one accented name collide on every
     * platform.
     * When omitted, names default to `<pdfBasename>_page_<pageNumber>.png`,
     * or `buffer_page_<pageNumber>.png` when the PDF is supplied as bytes instead of a file path.
     * `null` counts as omitted; any other non-function value throws before the input is read.
     * @since 3.14.0
     */
    outputFileMaskFunc?: (pageNumber: number) => string;

    /**
     * 1-based integer page numbers to convert. Must be an `Array` of positive integers: any other container (a typed
     * array, `Set`, string or other array-like), an array with holes, non-integer values and values less than or equal
     * to zero throw immediately, before any I/O.
     * Pages above the document page count are silently ignored.
     * When omitted (or `null`), all pages in the document are processed.
     * @since 3.3.0
     */
    pagesToProcess?: number[];

    /**
     * pdfjs verbosity level. Use the `VerbosityLevel` const for readable values:
     * `VerbosityLevel.ERRORS` (0), `VerbosityLevel.WARNINGS` (1), `VerbosityLevel.INFOS` (5).
     * It changes pdf.js log lines only, never the output or errors. On the main thread the level is process-wide: pdf.js
     * keeps one verbosity setting that every opened document overwrites, so conversions that overlap with different
     * levels all log at the level of the document opened last. Worker threads (`renderInWorkerThreads`) have their own.
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
     * No canvas is created, no rendering is performed, and no files are written to disk even if
     * `outputFolder` is set.
     * This is significantly faster than full rendering and useful for inspecting page dimensions
     * and rotation without generating images.
     * To stay consistent with a real render, this path still rejects pages that could not be
     * rendered at the requested `viewportScale` — those that floor to `0` px, those whose rendered
     * (floored) canvas area exceeds the internal canvas pixel limit, and those whose floored width or
     * height exceeds 1,000,000 px (the PNG encoder's per-side limit) — rather than reporting
     * dimensions for a page that would throw on render.
     * Default: `false`.
     * @since 3.14.0
     */
    returnMetadataOnly?: boolean;

    /**
     * When `true`, selected pages are rendered concurrently through a sliding-window scheduler
     * that keeps up to `concurrencyLimit` pages active. When `false`, pages are processed in
     * a lightly pipelined sequence: results are always returned in page order, but the PNG
     * encoding and disk writes of finished pages may overlap the rendering of the next page
     * (at most three pages in flight), so files may finish writing out of page order and, when
     * a page fails, pages already in flight still complete before the returned promise rejects.
     * Consume output via the resolved `PngPageOutput[]` (ordered) rather than directory-watch order.
     * Peak canvas memory in this mode is up to three live canvases; for strict one-page-at-a-time
     * processing with a single live canvas, set `processPagesInParallel: true` with
     * `concurrencyLimit: 1` (a sliding window of exactly one page).
     * Default: `false`.
     * @since 3.7.0
     */
    processPagesInParallel?: boolean;

    /**
     * Maximum number of pages rendered simultaneously when `processPagesInParallel` is `true`.
     * When `processPagesInParallel` or `renderInWorkerThreads` is enabled it must be a positive integer
     * between `1` and `16` (inclusive); values outside that range throw immediately (before any I/O).
     * Otherwise it is ignored. The upper bound caps peak in-flight canvas memory at roughly
     * `16 × MAX_CANVAS_PIXELS × 4 bytes ≈ 6.4 GB`; this is a bound, not a guarantee against
     * container exhaustion. Higher values increase throughput at the cost of memory. In worker-thread
     * mode it sets the worker-pool size.
     * Default: `4`.
     * @since 3.14.0
     */
    concurrencyLimit?: number;

    /**
     * When `true`, pages are rasterized in a pool of Node.js worker threads (pool size =
     * `concurrencyLimit`), giving true multi-core parallelism — unlike `processPagesInParallel`,
     * which interleaves pages on one thread. Each worker loads its own copy of the document, so
     * expect roughly one PDF copy plus one pdf.js instance of memory per worker and a pool
     * startup cost of a few hundred milliseconds per conversion; it pays off on multi-page,
     * render-heavy (e.g. image-heavy) documents and can be slower for small ones.
     * Rendered pixels are identical to single-threaded mode; results are returned in page
     * order; disk writes still happen on the main thread through the same path-security guards.
     * Takes precedence over `processPagesInParallel`. Ignored when `returnMetadataOnly` is `true`
     * (metadata extraction does not render). `outputFileMaskFunc` is fully supported — names are
     * resolved on the main thread before dispatch.
     * The workers run the compiled `pageRenderWorker.js` found beside the library's own modules, so this mode needs the
     * installed, unbundled package: from an ESM bundle, where `__dirname` is undefined, a conversion that selects at least
     * one page rejects with an error that says so.
     * Default: `false`.
     * @since 4.2.0
     */
    renderInWorkerThreads?: boolean;

    /**
     * Maximum allowed input PDF size in bytes. Inputs larger than this throw immediately,
     * before any rendering work is started. Applies to both the file path branch (opened once,
     * verified and read through one handle with bounded allocation) and buffer / `Uint8Array`
     * inputs (validated via `byteLength`; a byte `Array` counts by its `length`). Non-regular files such as FIFOs,
     * sockets and devices are rejected. Must be a positive integer.
     * The cap bounds the input bytes only, not the memory pdf.js needs to parse them: a non-PDF payload that is one long
     * run of a single byte value costs about 32 to 64 heap bytes per input byte in pdf.js's recovery scan and can abort
     * the process on heap exhaustion even below this cap. Convert untrusted files in an isolated process (with
     * `--max-old-space-size` set) or in a `Worker` started with `resourceLimits`.
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
