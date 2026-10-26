/**
 * Maximum allowed value for `viewportScale`. Values above this limit would produce canvases
 * so large (an A4 page at scale 100 already yields ~5×10⁹ pixels) that they risk OOM crashes
 * before the pixel-count guard in `processPdfPage` can fire.
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
 * Default upper bound on input PDF size in bytes. 256 MiB is a generous ceiling for legitimate
 * PDFs while keeping a single conversion well below typical service container memory limits.
 * The path branch of `getPdfFileBuffer()` opens once, verifies that same handle is a regular file,
 * and reads it with a bounded allocation, so devices, FIFOs, sockets, and unbounded growth cannot
 * bypass the cap through a pathname race.
 * Callers can override with `PdfToPngOptions.maxInputBytes`.
 */
export const MAX_INPUT_BYTES = 256 * 1024 * 1024;

/**
 * Upper bound on `concurrencyLimit` for local parallel and worker rendering. At this cap,
 * worst-case in-flight canvas memory alone is roughly 6.4 GiB, so the limit bounds rather than
 * prevents memory exhaustion. Callers should choose a substantially lower value in containers.
 */
export const MAX_CONCURRENCY_LIMIT = 16;

/**
 * Sliding-window size used for sequential (non-parallel) conversions. The window lets the
 * off-thread PNG encode and disk write of finished pages overlap the main-thread render of the
 * next page. Result order is preserved by the window helper; rendered pixels are unaffected.
 *
 * Sized 3 by paired A/B measurement: on text-heavy documents PNG encode costs ~2× render, and a
 * second in-flight encode recovers a small but consistent margin (TAMReview.pdf: −2…−5% median
 * end-to-end vs window 2 in interleaved trials, faster in 3 of 4 pairs; larger single-run
 * differences did not replicate under controlled re-measurement). Window 4 measured within
 * noise of 3. Peak cost: up to three live canvases.
 */
export const SEQUENTIAL_PIPELINE_WINDOW = 3;

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

// Test-only asset lists (STANDARD_FONTS, STANDARD_CMAPS, STANDARD_WASM) live in __tests__/test-data-constants.ts
