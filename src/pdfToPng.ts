import { promises as fsPromises } from 'node:fs';
import { dirname, isAbsolute, join, parse, relative, sep } from 'node:path';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import type * as PdfjsModule from 'pdfjs-dist/legacy/build/pdf.mjs';
import { MAX_CANVAS_PIXELS, MAX_VIEWPORT_SCALE, PDF_TO_PNG_OPTIONS_DEFAULTS } from './const';
import { NodeCanvasFactory } from './node.canvas.factory';
import { propsToPdfDocInitParams } from './propsToPdfDocInitParams';
import type { PdfToPngOptions, PngPageOutput } from './interfaces';

/** Module-level cache for the pdfjs-dist dynamic import. V8 already caches dynamic imports
 * internally, but making it explicit here avoids the module-resolution overhead on every call
 * and makes the caching behaviour visible and testable. */
let pdfjsLib: typeof PdfjsModule | undefined;

/**
 * Convert one or more pages from a PDF into PNG images.
 *
 * This function:
 * - Loads the provided PDF (a file path string, an `ArrayBufferLike`, a `Uint8Array`, or a Node.js `Buffer`).
 * - Opens a PDFDocumentProxy and determines which pages to process.
 * - Filters out invalid page numbers (pages < 1 or > number of pages in the document).
 * - When `props.returnMetadataOnly` is true: returns page dimensions, rotation, name, and page number
 *   for each selected page without creating a canvas or rendering; no files are written to disk.
 * - When `props.returnMetadataOnly` is false (the default): renders each selected page to a PNG
 *   by calling an internal page-processing helper.
 * - Ensures the PDF document is cleaned up (pdfDocument.cleanup()) even if an error occurs.
 * - Optionally writes resulting PNG files to disk if `props.outputFolder` is provided.
 *
 * Behavior details:
 * - pagesToProcess: if not provided, defaults to all pages in the document (1..numPages).
 * - Invalid page numbers in `props.pagesToProcess` are silently ignored.
 * - Page processing can be done in parallel when `props.processPagesInParallel === true` (uses Promise.all),
 *   otherwise pages are processed sequentially.
 * - The viewport scale used for rendering defaults to `PDF_TO_PNG_OPTIONS_DEFAULTS.viewportScale`
 *   unless `props.viewportScale` is specified.
 * - The default output file name mask is taken from the input path's basename when `pdfFile` is a string,
 *   otherwise from `PDF_TO_PNG_OPTIONS_DEFAULTS.outputFileMask`. Each page name defaults to
 *   `${defaultMask}_page_${pageNumber}.png`, unless `props.outputFileMaskFunc` is provided and returns a name.
 * - By default the page renderer returns page content (`props.returnPageContent` defaults to true).
 * - When `props.returnMetadataOnly` is true, no canvas is created and no image is rendered;
 *   only `pageNumber`, `name`, `width`, `height`, and `rotation` are populated. `content` is
 *   always `undefined` and no files are written to disk even if `outputFolder` is set.
 *
 * Side effects:
 * - If `props.outputFolder` is specified (and `returnMetadataOnly` is false) the function will create
 *   the folder (recursive) under the current working directory and write each PNG file there.
 *   The `path` property of each returned `PngPageOutput` will be set to the written file path.
 * - If `props.returnPageContent` is false and `props.outputFolder` is provided, the file will be written to disk
 *   using the content buffer, which will then be cleared from memory to save resources.
 *
 * Parameters:
 * @param pdfFile - Path to a PDF file, an `ArrayBufferLike` (e.g. `ArrayBuffer`, `SharedArrayBuffer`),
 *                  a `Uint8Array`, or a Node.js `Buffer` containing PDF data.
 * @param props - Optional conversion options (see PdfToPngOptions). Common options used:
 *   - pagesToProcess?: number[]         => Specific page numbers to convert (1-based).
 *   - processPagesInParallel?: boolean  => Whether to process pages concurrently.
 *   - concurrencyLimit?: number         => Maximum number of pages to process concurrently (default: 4, min: 1).
 *                                          Higher values may increase memory usage. Only applies when processPagesInParallel is true.
 *   - viewportScale?: number            => Scale factor for page rendering.
 *   - outputFileMaskFunc?: (page: number) => string => Custom naming function for each page output.
 *   - returnPageContent?: boolean       => Whether to include the PNG Buffer in the returned output.
 *   - returnMetadataOnly?: boolean      => When true, skip rendering entirely and return only page metadata.
 *   - outputFolder?: string             => Relative folder (from process.cwd()) to write PNG files to.
 *
 * Returns:
 * @returns Promise<PngPageOutput[]> - A Promise that resolves to an array of PngPageOutput objects,
 *   one per successfully processed page (in the same order as the validated pagesToProcess).
 *   Each output typically includes at least `name` and, if requested, `content`. If `outputFolder` was provided,
 *   `path` will be set to the written file location.
 *
 * Errors:
 * @throws - Propagates errors from reading the PDF, opening the PDF document, rendering pages,
 *   or writing files to disk. In particular, an error is thrown when attempting to write a PNG file
 *   whose `content` is undefined.
 *
 * Example:
 * @example
 * // Convert all pages and get buffers:
 * const outputs = await pdfToPng("/path/to/doc.pdf", { returnPageContent: true });
 */
/**
 * Resolves the output filename for a single PDF page.
 *
 * If `outputFileMaskFunc` is provided it is called with the 1-based page number.
 * The returned value must be a non-empty string containing the full filename
 * (including `.png` extension); an empty string throws immediately so callers
 * receive a clear error rather than a confusing filesystem failure.
 *
 * When `outputFileMaskFunc` is absent, the name defaults to
 * `<defaultMask>_page_<pageNumber>.png`.
 *
 * @param pageNumber - 1-based page index.
 * @param defaultMask - Fallback filename stem (PDF basename or `"buffer"`).
 * @param outputFileMaskFunc - Optional caller-supplied naming function.
 * @returns Non-empty filename string for the page.
 *
 * @throws {Error} If `outputFileMaskFunc` returns an empty string.
 */
function resolvePageName(pageNumber: number, defaultMask: string, outputFileMaskFunc: ((page: number) => string) | undefined): string {
    if (outputFileMaskFunc === undefined) {
        return `${defaultMask}_page_${pageNumber}.png`;
    }
    const name = outputFileMaskFunc(pageNumber);
    if (!name) {
        throw new Error(
            `outputFileMaskFunc returned an empty filename for page ${pageNumber}. Provide a non-empty string including the .png extension.`,
        );
    }
    return name;
}

/**
 * Renders (or retrieves metadata for) a single PDF page, optionally saves it to disk,
 * and optionally clears the content buffer from memory when the caller only needs the
 * file on disk but not the in-memory bytes.
 *
 * Extracts the per-page render → save → maybe-clear logic that was previously duplicated
 * verbatim in the parallel `Promise.all` branch and the sequential `for` loop.
 *
 * @param pdfDocument - The open PDF.js document proxy.
 * @param pageName - Filename to assign to this page's output.
 * @param pageNumber - 1-based page index.
 * @param pageViewportScale - Render scale factor.
 * @param shouldReturnContent - Whether to include the PNG buffer in the output.
 * @param returnMetadataOnly - When true, skip rendering entirely.
 * @param resolvedOutputFolder - Absolute path to write PNG files; `undefined` means no file output.
 * @param realOutputFolder - Pre-computed `realpath` of `resolvedOutputFolder`, resolved once by
 *   the caller before the page loop to avoid N redundant syscalls. `undefined` when no file output.
 * @param returnPageContent - The caller's original preference; used to decide whether to
 *   clear `content` after writing to disk.
 * @returns A `PngPageOutput` with `path` and optionally `content` populated.
 */
async function processAndSavePage(
    pdfDocument: PDFDocumentProxy,
    pageName: string,
    pageNumber: number,
    pageViewportScale: number,
    shouldReturnContent: boolean,
    returnMetadataOnly: boolean,
    resolvedOutputFolder: string | undefined,
    realOutputFolder: string | undefined,
    returnPageContent: boolean | undefined,
): Promise<PngPageOutput> {
    const pageOutput = returnMetadataOnly
        ? await getPageMetadata(pdfDocument, pageName, pageNumber, pageViewportScale)
        : await renderPdfPage(pdfDocument, pageName, pageNumber, pageViewportScale, shouldReturnContent);
    if (resolvedOutputFolder !== undefined && realOutputFolder !== undefined && !returnMetadataOnly) {
        await savePNGfile(pageOutput, resolvedOutputFolder, realOutputFolder);
        if (returnPageContent === false) {
            pageOutput.content = undefined;
        }
    }
    return pageOutput;
}

export async function pdfToPng(pdfFile: string | ArrayBufferLike | Uint8Array, props?: PdfToPngOptions): Promise<PngPageOutput[]> {
    // Capture and validate viewportScale before the first await so the validated value is
    // immutable and cannot be bypassed by mutating `props` between validation and rendering.
    const pageViewportScale: number = props?.viewportScale ?? PDF_TO_PNG_OPTIONS_DEFAULTS.viewportScale;
    if (
        typeof pageViewportScale !== 'number' ||
        !Number.isFinite(pageViewportScale) ||
        pageViewportScale <= 0 ||
        pageViewportScale > MAX_VIEWPORT_SCALE
    ) {
        throw new Error(
            `viewportScale must be a finite number greater than 0 and at most ${MAX_VIEWPORT_SCALE}, received: ${pageViewportScale}`,
        );
    }

    // Fail fast: validate concurrencyLimit before any I/O so callers discover bad options immediately.
    // Only relevant when processPagesInParallel is true; ignored otherwise.
    if (props?.processPagesInParallel === true) {
        const concurrencyLimitEarly: number = props.concurrencyLimit ?? PDF_TO_PNG_OPTIONS_DEFAULTS.concurrencyLimit;
        if (!Number.isInteger(concurrencyLimitEarly) || concurrencyLimitEarly < 1) {
            throw new Error(`concurrencyLimit must be a positive integer >= 1, received: ${concurrencyLimitEarly}`);
        }
    }

    // Read the PDF file and initialize the PDF document
    const pdfFileBuffer: Uint8Array | ArrayBufferLike = await getPdfFileBuffer(pdfFile);
    const pdfDocument: PDFDocumentProxy = await getPdfDocument(pdfFileBuffer, props);

    // Get the pages to process based on the provided options, invalid pages will be filtered out
    const pagesToProcess: number[] = props?.pagesToProcess ?? Array.from({ length: pdfDocument.numPages }, (_, index) => index + 1);
    const validPagesToProcess: number[] = pagesToProcess.filter((pageNumber) => pageNumber <= pdfDocument.numPages && pageNumber >= 1);
    const returnMetadataOnly: boolean = props?.returnMetadataOnly ?? false;

    // Resolve output folder to an absolute path up-front so it can be shared between mkdir and the
    // page loop. The realpath is computed once after mkdir to avoid N redundant syscalls in savePNGfile.
    // When returnMetadataOnly is true no files are written, so the folder is never created or resolved.
    const resolvedOutputFolder: string | undefined =
        props?.outputFolder !== undefined && !returnMetadataOnly ? join(process.cwd(), props.outputFolder) : undefined;

    // Create output folder if specified
    if (resolvedOutputFolder !== undefined) {
        await fsPromises.mkdir(resolvedOutputFolder, { recursive: true });
    }

    // Resolve symlinks in the output folder once. Passing this cached value into savePNGfile avoids
    // one realpath() call per page (saves N calls for an N-page PDF). The per-page TOCTOU check
    // inside savePNGfile still calls realpath() independently so the security guarantee is unchanged.
    const realOutputFolder: string | undefined =
        resolvedOutputFolder !== undefined ? await fsPromises.realpath(resolvedOutputFolder) : undefined;

    // Process each page
    const pngPageOutputs: PngPageOutput[] = [];
    try {
        const defaultMask: string = typeof pdfFile === 'string' ? parse(pdfFile).name : PDF_TO_PNG_OPTIONS_DEFAULTS.outputFileMask;
        // When an output folder is specified, content must always be retrieved
        // (even if the user doesn't want it returned) so it can be saved to disk.
        // When returnMetadataOnly is true, rendering is skipped entirely regardless.
        const shouldReturnContent: boolean = returnMetadataOnly ? false : props?.outputFolder ? true : (props?.returnPageContent ?? true);
        if (props?.processPagesInParallel === true) {
            // concurrencyLimit was already validated above (fail-fast); safe to use directly.
            const concurrencyLimit: number = props.concurrencyLimit ?? PDF_TO_PNG_OPTIONS_DEFAULTS.concurrencyLimit;
            for (let i = 0; i < validPagesToProcess.length; i += concurrencyLimit) {
                const batch: number[] = validPagesToProcess.slice(i, i + concurrencyLimit);
                const batchResults: PngPageOutput[] = await Promise.all(
                    batch.map((pageNumber) =>
                        processAndSavePage(
                            pdfDocument,
                            resolvePageName(pageNumber, defaultMask, props?.outputFileMaskFunc),
                            pageNumber,
                            pageViewportScale,
                            shouldReturnContent,
                            returnMetadataOnly,
                            resolvedOutputFolder,
                            realOutputFolder,
                            props?.returnPageContent,
                        ),
                    ),
                );
                pngPageOutputs.push(...batchResults);
            }
        } else {
            for (const pageNumber of validPagesToProcess) {
                pngPageOutputs.push(
                    await processAndSavePage(
                        pdfDocument,
                        resolvePageName(pageNumber, defaultMask, props?.outputFileMaskFunc),
                        pageNumber,
                        pageViewportScale,
                        shouldReturnContent,
                        returnMetadataOnly,
                        resolvedOutputFolder,
                        realOutputFolder,
                        props?.returnPageContent,
                    ),
                );
            }
        }
    } finally {
        await pdfDocument.cleanup();
    }

    return pngPageOutputs;
}

/**
 * Reads or normalizes a PDF input so it is ready to be passed to pdfjs.
 *
 * Accepts a filesystem path, an `ArrayBufferLike` (e.g. `ArrayBuffer`, `SharedArrayBuffer`),
 * or a `Uint8Array` / Node.js `Buffer`. Returns a `Uint8Array` or `ArrayBufferLike` that pdfjs
 * can consume without an additional copy.
 *
 * Remarks:
 * - **String path:** calls `fsPromises.readFile` and normalizes the result.
 *   - `ArrayBuffer` result: returned as-is (no copy).
 *   - `Buffer` result: copied once into a standalone `Uint8Array` (avoids the pool-backed
 *     `buffer.buffer.slice()` allocation; pdfjs rejects `Buffer` instances directly).
 *   - Any other type: throws `Error('Unsupported buffer type: ...')`.
 * - **`Buffer` / `Uint8Array` input:** `Buffer` is copied into a plain `Uint8Array` (same reason
 *   as above). A `Uint8Array` that is not a `Buffer` is returned as-is.
 * - **`ArrayBufferLike` input:** returned as-is; `getPdfDocument` wraps it in a zero-copy
 *   `Uint8Array` view before handing it to pdfjs.
 * - File read errors (e.g. ENOENT, permission denied) are propagated from `fsPromises.readFile`.
 *
 * @param pdfFile - A file path, `ArrayBufferLike`, or `Uint8Array` / `Buffer` containing PDF bytes.
 * @returns A Promise resolving to a `Uint8Array` (for path and Buffer inputs) or the original
 *          `ArrayBufferLike` (for ArrayBuffer/SharedArrayBuffer inputs).
 *
 * @throws {Error} If the filesystem read yields an unsupported buffer type.
 * @throws {Error} Propagates errors thrown by fsPromises.readFile (e.g., file not found,
 *                 permission denied).
 *
 * @example
 * // From a file path
 * const buffer = await getPdfFileBuffer('/path/to/file.pdf');
 *
 * @example
 * // From an existing ArrayBuffer
 * const buffer = await getPdfFileBuffer(existingArrayBuffer);
 *
 * @async
 */
async function getPdfFileBuffer(pdfFile: string | ArrayBufferLike | Uint8Array): Promise<Uint8Array | ArrayBufferLike> {
    if (typeof pdfFile === 'string') {
        const buffer = await fsPromises.readFile(pdfFile);
        // Normalise to a standalone Uint8Array so pdfjs can accept it directly (no copy at that point).
        // Node.js Buffers are pool-backed (buffer.byteLength !== buffer.buffer.byteLength), so we copy
        // here once into a standalone Uint8Array, avoiding a separate ArrayBuffer.slice() allocation.
        if (buffer instanceof ArrayBuffer) {
            return buffer;
        } else if (Buffer.isBuffer(buffer)) {
            return new Uint8Array(buffer);
        } else {
            throw new Error(`Unsupported buffer type: ${Object.prototype.toString.call(buffer)}`);
        }
    }
    // Direct ArrayBufferLike: if the caller passes a Buffer, convert to plain Uint8Array because
    // pdfjs rejects Buffer instances and Buffer.byteLength !== Buffer.buffer.byteLength (pool-backed).
    if (Buffer.isBuffer(pdfFile)) {
        return new Uint8Array(pdfFile as Buffer);
    }
    return pdfFile;
}

/**
 * Loads a PDF document from a given `Uint8Array` or `ArrayBufferLike` and returns a PDF.js document proxy.
 *
 * @param pdfFileBuffer - The buffer containing the PDF file data.
 * @param props - Optional configuration options for PDF loading.
 * @returns A promise that resolves to a PDFDocumentProxy representing the loaded PDF.
 *
 * @remarks
 * This function dynamically imports the PDF.js library and initializes the document
 * using the provided buffer and options. The options are converted to PDF.js-compatible
 * initialization parameters via `propsToPdfDocInitParams`.
 *
 * @throws Will throw if the PDF cannot be loaded or parsed.
 */
async function getPdfDocument(pdfFileBuffer: Uint8Array | ArrayBufferLike, props?: PdfToPngOptions): Promise<PDFDocumentProxy> {
    pdfjsLib ??= await import('pdfjs-dist/legacy/build/pdf.mjs');
    const { getDocument } = pdfjsLib;
    const documentInitParameters = propsToPdfDocInitParams(props);
    // getPdfFileBuffer already normalises Buffer inputs to plain Uint8Array.
    // - Uint8Array: use directly (standalone, byteLength === buffer.byteLength — pdfjs accepts as-is)
    // - ArrayBufferLike: wrap as a view (new Uint8Array(arrayBuffer) is a view, not a copy)
    const data: Uint8Array = pdfFileBuffer instanceof Uint8Array ? pdfFileBuffer : new Uint8Array(pdfFileBuffer);
    return await getDocument({
        ...documentInitParameters,
        data,
    }).promise;
}

/**
 * Returns dimension and rotation metadata for a single PDF page without rendering it.
 *
 * Obtains the page from the document proxy, reads the viewport at the requested scale,
 * and returns a `PngPageOutput` with `content` always `undefined`. `page.cleanup()` is
 * called in `finally` to release PDF.js resources.
 *
 * @param pdf - The PDF.js document proxy.
 * @param pageName - Filename/identifier assigned to this page in the output.
 * @param pageNumber - 1-based page index.
 * @param pageViewportScale - Scale factor for `page.getViewport({ scale })`.
 * @returns Metadata-only `PngPageOutput` (no canvas created, no PNG encoded).
 */
async function getPageMetadata(
    pdf: PDFDocumentProxy,
    pageName: string,
    pageNumber: number,
    pageViewportScale: number,
): Promise<PngPageOutput> {
    const page = await pdf.getPage(pageNumber);
    const viewport = page.getViewport({ scale: pageViewportScale });
    try {
        return {
            pageNumber,
            name: pageName,
            content: undefined,
            path: '',
            width: viewport.width,
            height: viewport.height,
            rotation: page.rotate,
        };
    } finally {
        page.cleanup();
    }
}

/**
 * Renders a single PDF page to a PNG and returns the result.
 *
 * - Rejects the page before canvas allocation if `viewport.width × viewport.height`
 *   exceeds `MAX_CANVAS_PIXELS` to prevent OOM crashes.
 * - Creates a canvas via the document's `canvasFactory` (or a new `NodeCanvasFactory`).
 * - Renders via `page.render()` and optionally encodes the result to a PNG `Buffer`.
 * - Calls `page.cleanup()` and `canvasFactory.destroy()` in `finally` even on error.
 *
 * @param pdf - The PDF.js document proxy.
 * @param pageName - Filename/identifier assigned to this page in the output.
 * @param pageNumber - 1-based page index.
 * @param pageViewportScale - Scale factor for `page.getViewport({ scale })`.
 * @param returnPageContent - When `true`, encodes the canvas to PNG and returns the buffer
 *   in `content`; otherwise `content` is `undefined`.
 * @returns `PngPageOutput` with `path` set to `''` (populated by the caller if needed).
 *
 * @throws {Error} If the canvas pixel area exceeds `MAX_CANVAS_PIXELS`.
 * @throws If page retrieval, canvas creation, rendering, or PNG encoding fails.
 */
async function renderPdfPage(
    pdf: PDFDocumentProxy,
    pageName: string,
    pageNumber: number,
    pageViewportScale: number,
    returnPageContent: boolean,
): Promise<PngPageOutput> {
    const page = await pdf.getPage(pageNumber);
    const viewport = page.getViewport({ scale: pageViewportScale });

    // Guard against canvas allocations that would cause OOM. Even a modest PDF page combined
    // with a high viewportScale can produce an enormous pixel count: an A4 page at scale 100
    // yields ~5×10¹¹ pixels. This check fires before any allocation so the error is cheap.
    if (viewport.width * viewport.height > MAX_CANVAS_PIXELS) {
        page.cleanup();
        throw new Error(
            `Canvas ${Math.round(viewport.width)}×${Math.round(viewport.height)} px exceeds the ${MAX_CANVAS_PIXELS.toLocaleString()} pixel limit. Reduce viewportScale.`,
        );
    }

    const canvasFactory = pdf.canvasFactory ? (pdf.canvasFactory as NodeCanvasFactory) : new NodeCanvasFactory();
    const { canvas, context } = canvasFactory.create(viewport.width, viewport.height);

    try {
        await page.render({ canvasContext: context, viewport, canvas }).promise;
        return {
            pageNumber,
            name: pageName,
            content: returnPageContent ? canvas!.toBuffer('image/png') : undefined,
            path: '',
            width: viewport.width,
            height: viewport.height,
            rotation: page.rotate,
        };
    } finally {
        page.cleanup();
        canvasFactory.destroy({ canvas, context });
    }
}

/**
 * Returns `true` when `rel` (a result of `path.relative()`) indicates that the path
 * escapes its base directory — i.e. it is `'..'`, starts with `'..` + `sep` (traversal),
 * or is absolute (cross-drive escape on Windows).
 */
function isEscapingRelativePath(rel: string): boolean {
    return rel === '..' || rel.startsWith('..' + sep) || isAbsolute(rel);
}

/**
 * Write a PNG page to disk.
 *
 * This function sets `pngPageOutput.path` to the file path produced by joining
 * `outputFolder` and `pngPageOutput.name`, validates that `pngPageOutput.content`
 * is present, and asynchronously writes the content to disk using `fsPromises.writeFile`.
 *
 * The function mutates the provided `pngPageOutput` object by assigning the
 * computed `path` property before writing.
 *
 * @param pngPageOutput - Object describing the PNG to write. Must have a `name`
 *   property and a `content` property containing the file data. `content` is
 *   expected to be a Buffer (the implementation casts it to `Buffer`).
 * @param resolvedOutputFolder - Absolute, resolved destination folder path. The caller
 *   (`pdfToPng`) already computed this via `join(cwd, props.outputFolder)`; no second
 *   `resolve()` call is needed here.
 * @param realOutputFolder - Pre-computed `realpath` of `resolvedOutputFolder`, resolved
 *   once before the page loop by `pdfToPng`. Used for the initial symlink-escape check.
 *   The final TOCTOU re-check inside this function still calls `realpath()` independently.
 *
 * @returns A Promise that resolves when the file has been successfully written.
 *
 * @throws {Error} If `pngPageOutput.content` is `undefined`.
 * @throws {NodeJS.ErrnoException} If the underlying file system write operation fails,
 *   the original error from `fsPromises.writeFile` will be propagated.
 *
 * @remarks
 * **TOCTOU limitation:** This function performs `realpath()` checks to guard against
 * symlink-based path-traversal attacks, but a residual TOCTOU (Time-of-Check /
 * Time-of-Use) race window exists between the final check and `writeFile`. A local
 * attacker who can atomically swap the output directory for a symlink within that
 * window could redirect the write. This is a fundamental POSIX filesystem limitation
 * that cannot be fully eliminated in userspace JavaScript without OS-level primitives
 * (e.g. `O_NOFOLLOW` via native bindings). On multi-user or shared systems, ensure
 * the `outputFolder` is a private directory not writable by untrusted users.
 */
async function savePNGfile(pngPageOutput: PngPageOutput, resolvedOutputFolder: string, realOutputFolder: string): Promise<void> {
    // resolvedOutputFolder is already absolute (computed by pdfToPng) — no resolve() needed.
    const resolvedFilePath = join(resolvedOutputFolder, pngPageOutput.name);

    // Guard against path-traversal via .. segments or cross-drive absolute paths.
    // Use a segment-aware check (rel === '..' or starts with '../') to avoid false positives
    // on legitimate filenames that begin with '..', e.g. '..evil.png'.
    if (isEscapingRelativePath(relative(resolvedOutputFolder, resolvedFilePath))) {
        throw new Error(`Output file name escapes the output folder: ${pngPageOutput.name}`);
    }

    // Guard against symlink-based escapes: use the pre-computed realOutputFolder for the
    // initial containment check, and resolve symlinks in the file's parent directory.
    const realFileDir = await fsPromises.realpath(dirname(resolvedFilePath));
    if (isEscapingRelativePath(relative(realOutputFolder, realFileDir))) {
        throw new Error(`Output file name escapes the output folder: ${pngPageOutput.name}`);
    }

    pngPageOutput.path = resolvedFilePath;
    if (pngPageOutput.content === undefined) {
        throw new Error(`Cannot write PNG file "${pngPageOutput.path}" because content is undefined.`);
    }

    // Re-verify the output folder immediately before writeFile to narrow the TOCTOU race window.
    // Placing this check after all other validation means the gap between the check and the write
    // is as small as possible. It does NOT fully eliminate the window — a sufficiently fast
    // directory swap between this line and writeFile could still succeed — but it raises the bar
    // for exploitation significantly. Completely eliminating this class of race would require
    // enforcing no-follow semantics (for example via O_NOFOLLOW) on the underlying open(2) call,
    // which cannot be done portably through `fsPromises.writeFile` and would not protect
    // directory-component races even where available.
    const realOutputFolderFinal = await fsPromises.realpath(resolvedOutputFolder);
    if (realOutputFolderFinal !== realOutputFolder) {
        throw new Error(`Output folder was modified during write: ${resolvedOutputFolder}`);
    }

    await fsPromises.writeFile(pngPageOutput.path, pngPageOutput.content as Buffer);
}
