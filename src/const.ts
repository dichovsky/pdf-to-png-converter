/**
 * Maximum allowed value for `viewportScale`. Larger scales are rejected up front: an A4 page at
 * scale 100 already yields ~5×10⁹ pixels, far above `MAX_CANVAS_PIXELS`, so no such page could be rendered.
 */
export const MAX_VIEWPORT_SCALE = 100;

/**
 * Maximum canvas area in pixels. At 4 bytes per pixel, 100 MP ≈ 400 MB of raw bitmap memory.
 * Any page whose rendered (floored) canvas area exceeds this limit is rejected before canvas
 * allocation. The guard floors the viewport dimensions first so it bounds the bitmap actually
 * allocated rather than the slightly larger fractional viewport area.
 */
export const MAX_CANVAS_PIXELS = 100_000_000;

/**
 * Maximum canvas width or height in pixels: libpng's default per-side limit (PNG_USER_WIDTH_MAX and
 * PNG_USER_HEIGHT_MAX). The PNG encoder behind `@napi-rs/canvas` refuses a wider or taller bitmap with an opaque
 * "Get png data from surface failed" and raw libpng output on stderr, only after the page has been rendered.
 * `MAX_CANVAS_PIXELS` bounds the area alone, so a very thin page passes it: 10,001 × 0.5 pt at scale 100 is a
 * 1,000,100 × 50 px bitmap. A page whose floored width or height exceeds this limit is rejected before any canvas
 * is allocated.
 */
export const MAX_CANVAS_SIDE = 1_000_000;

/**
 * Default upper bound on input PDF size in bytes. 256 MiB is a generous ceiling for legitimate
 * PDFs while keeping a single conversion well below typical service container memory limits.
 * The path branch of `getPdfFileBuffer()` opens once, verifies that same handle is a regular file,
 * and reads it with a bounded allocation, so devices, FIFOs, sockets, and unbounded growth cannot
 * bypass the cap through a pathname race.
 * Callers can override with `PdfToPngOptions.maxInputBytes`.
 */
export const MAX_INPUT_BYTES = 256 * 1024 * 1024;

/**
 * Longest string accepted as a file path input: POSIX PATH_MAX on Linux. A longer string cannot be a usable path, it
 * is document content passed by mistake, and the filesystem error for it would copy the whole value into its message.
 * Windows extended-length paths (up to 32,767 characters) are therefore not accepted as string input; raise this if that
 * is ever needed.
 */
export const MAX_INPUT_PATH_LENGTH = 4096;

/**
 * Largest single `FileHandle.read()` request when an input PDF is read from a path. `read()` takes an int32 `length`, so
 * a request of 2 GiB or more is unsafe: depending on the Node version it aborts the process (a failed C++ CHECK) or
 * throws ERR_OUT_OF_RANGE, and a multiple of 4 GiB wraps to a zero-length read that the read loop would take for EOF and
 * return a silently short buffer. No single request may exceed this; the loop already assembles a file from short reads.
 */
export const FILE_READ_MAX_CHUNK_BYTES = 2 ** 30;

/**
 * NAME_MAX: one path segment holds at most 255 units on every common filesystem. APFS, HFS+ and NTFS count UTF-16 code
 * units; ext4, xfs, btrfs and most other hosts count UTF-8 bytes, which are never fewer than the code units. Node
 * exposes no pathconf, so `assertValidOutputFilename()` lets the host family stand in for the filesystem.
 */
export const MAX_FILENAME_LENGTH = 255;

/**
 * Upper bound on `concurrencyLimit` for local parallel and worker rendering. At this cap,
 * worst-case in-flight canvas memory alone is roughly 6.4 GB, so the limit bounds rather than
 * prevents memory exhaustion. Callers should choose a substantially lower value in containers.
 */
export const MAX_CONCURRENCY_LIMIT = 16;

/**
 * Sliding-window size used for sequential (non-parallel) conversions. The window lets the
 * off-thread PNG encode and disk write of finished pages overlap the main-thread render of the
 * next page. Result order is preserved by `mapLimitOrdered()`; rendered pixels are unaffected.
 *
 * Sized 3 by paired A/B measurement: on text-heavy documents PNG encode costs ~2× render, and a
 * second in-flight encode recovers a small but consistent margin (TAMReview.pdf: −2…−5% median
 * end-to-end vs window 2 in interleaved trials, faster in 3 of 4 pairs; larger single-run
 * differences did not replicate under controlled re-measurement). Window 4 measured within
 * noise of 3. Peak cost: up to three live canvases.
 */
export const SEQUENTIAL_PIPELINE_WINDOW = 3;

/**
 * Shared default values for `PdfToPngOptions` fields that the caller does not set. The verbosity and
 * mode flags (`verbosityLevel`, `returnPageContent`, `returnMetadataOnly`, `processPagesInParallel`,
 * `renderInWorkerThreads`) default inside `normalizeOptions()` in `src/pdfToPng.ts`. The JSDoc on the
 * type states every default, so keep it in sync with both places.
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
    maxInputBytes: MAX_INPUT_BYTES,
};

/**
 * Names of the asset directories shipped inside the installed pdfjs-dist package. `pdfjsLoader`
 * resolves them against the package location (not the process working directory) at first use.
 */
export const PDFJS_ASSET_DIRECTORIES = {
    cmaps: 'cmaps',
    standardFonts: 'standard_fonts',
    wasm: 'wasm',
} as const;

/** One of the asset directory names above; the only values `pdfjsAssetDirectory()` accepts. */
export type PdfjsAssetDirectory = (typeof PDFJS_ASSET_DIRECTORIES)[keyof typeof PDFJS_ASSET_DIRECTORIES];

/** Decoder binaries inside the pdfjs-dist wasm directory that image rendering depends on (CCITT/JBIG2 and JPEG 2000). */
export const PDFJS_WASM_DECODER_FILES = ['jbig2.wasm', 'openjpeg.wasm'] as const;

/**
 * Upper bound on the one-time wasm warm-up in `warmUpWasmDecoders()` (issue #288), which normally takes well under a
 * second. Past it, conversions go ahead without the protection rather than wait on a warm-up stalled by other pdf.js
 * use in the same thread.
 */
export const WASM_WARM_UP_TIMEOUT_MS = 10_000;

// Test-only asset lists (STANDARD_FONTS, STANDARD_CMAPS, STANDARD_WASM) live in __tests__/test-data-constants.ts
