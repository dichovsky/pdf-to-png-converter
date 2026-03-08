import { promises as fsPromises } from 'node:fs';
import { dirname, isAbsolute, join, parse, relative, resolve, sep } from 'node:path';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import { PDF_TO_PNG_OPTIONS_DEFAULTS } from './const';
import { NodeCanvasFactory } from './node.canvas.factory';
import { propsToPdfDocInitParams } from './propsToPdfDocInitParams';
import type { PdfToPngOptions, PngPageOutput } from './interfaces';

/**
 * Convert one or more pages from a PDF into PNG images.
 *
 * This function:
 * - Loads the provided PDF (either a file path string or an ArrayBuffer-like object).
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
 * @param pdfFile - Path to a PDF file or an ArrayBuffer-like containing PDF data.
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
export async function pdfToPng(pdfFile: string | ArrayBufferLike, props?: PdfToPngOptions): Promise<PngPageOutput[]> {
    if (props?.viewportScale !== undefined) {
        const viewportScale = props.viewportScale;
        if (typeof viewportScale !== 'number' || !Number.isFinite(viewportScale) || viewportScale <= 0) {
            throw new Error(`viewportScale must be a finite number greater than 0, received: ${viewportScale}`);
        }
    }

    // Read the PDF file and initialize the PDF document
    const pdfFileBuffer: ArrayBufferLike = await getPdfFileBuffer(pdfFile);
    const pdfDocument: PDFDocumentProxy = await getPdfDocument(pdfFileBuffer, props);

    // Get the pages to process based on the provided options, invalid pages will be filtered out
    const pagesToProcess: number[] = props?.pagesToProcess ?? Array.from({ length: pdfDocument.numPages }, (_, index) => index + 1);
    const validPagesToProcess: number[] = pagesToProcess.filter((pageNumber) => pageNumber <= pdfDocument.numPages && pageNumber >= 1);
    const returnMetadataOnly: boolean = props?.returnMetadataOnly ?? false;

    // Create output folder if specified (skip when returnMetadataOnly is true — no files will be written)
    if (props?.outputFolder !== undefined && !returnMetadataOnly) {
        await fsPromises.mkdir(join(process.cwd(), props.outputFolder), { recursive: true });
    }

    // Process each page
    const pngPagesOutput: PngPageOutput[] = [];
    try {
        const pageViewportScale: number = props?.viewportScale ?? PDF_TO_PNG_OPTIONS_DEFAULTS.viewportScale;
        const defaultMask: string = typeof pdfFile === 'string' 
            ? parse(pdfFile).name 
            : PDF_TO_PNG_OPTIONS_DEFAULTS.outputFileMask;
        const pngPageOutputs: PngPageOutput[] = [];
        // When an output folder is specified, content must always be retrieved
        // (even if the user doesn't want it returned) so it can be saved to disk.
        // When returnMetadataOnly is true, rendering is skipped entirely regardless.
        const shouldReturnContent: boolean = returnMetadataOnly
            ? false
            : props?.outputFolder
              ? true
              : (props?.returnPageContent ?? true);
        if (props?.processPagesInParallel === true) {
            // Limit concurrency to avoid memory issues with large PDFs
            const concurrencyLimit: number = props?.concurrencyLimit ?? PDF_TO_PNG_OPTIONS_DEFAULTS.concurrencyLimit;
            for (let i = 0; i < validPagesToProcess.length; i += concurrencyLimit) {
                const batch: number[] = validPagesToProcess.slice(i, i + concurrencyLimit);
                const batchResults: PngPageOutput[] = await Promise.all(
                    batch.map(async (pageNumber) => {
                        const pageOutput = await processPdfPage(
                            pdfDocument,
                            props?.outputFileMaskFunc?.(pageNumber) ?? `${defaultMask}_page_${pageNumber}.png`,
                            pageNumber,
                            pageViewportScale,
                            shouldReturnContent,
                            returnMetadataOnly,
                        );

                        if (props?.outputFolder && !returnMetadataOnly) {
                            await savePNGfile(pageOutput, join(process.cwd(), props.outputFolder));
                            // If the user didn't want the content returned, clear it to save memory
                            if (props?.returnPageContent === false) {
                                pageOutput.content = undefined;
                            }
                        }
                        return pageOutput;
                    }),
                );
                pngPageOutputs.push(...batchResults);
            }
        } else {
            for (const pageNumber of validPagesToProcess) {
                const pageOutput = await processPdfPage(
                    pdfDocument,
                    props?.outputFileMaskFunc?.(pageNumber) ?? `${defaultMask}_page_${pageNumber}.png`,
                    pageNumber,
                    pageViewportScale,
                    shouldReturnContent,
                    returnMetadataOnly,
                );

                if (props?.outputFolder && !returnMetadataOnly) {
                    await savePNGfile(pageOutput, join(process.cwd(), props.outputFolder));
                    if (props?.returnPageContent === false) {
                        pageOutput.content = undefined;
                    }
                }
                pngPageOutputs.push(pageOutput);
            }
        }
        pngPagesOutput.push(...pngPageOutputs);
    } finally {
        await pdfDocument.cleanup();
    }

    return pngPagesOutput;
}

/**
 * Reads or normalizes a PDF input into an ArrayBuffer-like object.
 *
 * This asynchronous utility accepts either a filesystem path to a PDF file (string)
 * or an already-loaded ArrayBuffer-like instance. If given a path, it reads the file
 * using fsPromises.readFile and normalizes the result to always return an ArrayBuffer-like
 * instance. If the input is already an ArrayBuffer-like value, it is returned unchanged.
 *
 * Remarks:
 * - When reading from the filesystem, Node.js Buffer instances are converted to a
 *   platform-independent ArrayBuffer slice that represents the same bytes.
 * - File read errors (for example, ENOENT or permission errors) are propagated from
 *   fsPromises.readFile and should be handled by the caller.
 * - If fsPromises.readFile returns a type that is neither an ArrayBuffer nor a Node Buffer,
 *   this function throws an Error indicating an unsupported buffer type.
 *
 * @param pdfFile - Either a path to a PDF file (string) or an ArrayBuffer-like object
 *                  containing the PDF data.
 * @returns A Promise that resolves to an ArrayBuffer-like view containing the PDF bytes.
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
async function getPdfFileBuffer(pdfFile: string | ArrayBufferLike): Promise<ArrayBufferLike> {
    const isString: boolean = typeof pdfFile === 'string';
    const pdfFileBuffer: ArrayBufferLike = isString
        ? await (async () => {
              const buffer = await fsPromises.readFile(pdfFile as string);
              // Ensure we always return an ArrayBuffer
              if (buffer instanceof ArrayBuffer) {
                  return buffer;
              } else if (Buffer.isBuffer(buffer)) {
                  return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
              } else {
                  throw new Error(`Unsupported buffer type: ${Object.prototype.toString.call(buffer)}`);
              }
          })()
        : (pdfFile as ArrayBufferLike);
    return pdfFileBuffer;
}

/**
 * Loads a PDF document from a given ArrayBuffer and returns a PDF.js document proxy.
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
async function getPdfDocument(pdfFileBuffer: ArrayBufferLike, props?: PdfToPngOptions): Promise<PDFDocumentProxy> {
    const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs');
    const documentInitParameters = propsToPdfDocInitParams(props);
    return await getDocument({
        ...documentInitParameters,
        data: new Uint8Array(pdfFileBuffer),
    }).promise;
}

/**
 * Renders a single page of a PDF document to an in-memory PNG (optionally) and returns page metadata.
 *
 * This function:
 * - Obtains the specified page from the provided PDF.js document (`PDFDocumentProxy`).
 * - When `returnMetadataOnly` is true: reads the viewport dimensions and page rotation, then returns
 *   immediately without creating a canvas or rendering; `page.cleanup()` is still called.
 * - When `returnMetadataOnly` is false: creates a canvas and drawing context, renders the page into the
 *   canvas at the requested scale, optionally encodes to PNG buffer, then cleans up via `finally`.
 * - Returns a `PngPageOutput` describing the page (including width, height, rotation, page number, name,
 *   and optional content).
 * - Ensures resources are cleaned up (calls `page.cleanup()` and `canvasFactory.destroy(...)`) even if rendering fails.
 *
 * Remarks:
 * - `pageNumber` is expected to be a 1-based page index as required by PDF.js `getPage`.
 * - The returned `PngPageOutput.path` is intentionally set to an empty string and should be populated by the caller if a filesystem path is needed.
 * - If `returnPageContent` is false (or `returnMetadataOnly` is true), the `content` field will be `undefined`.
 * - Errors originating from `pdf.getPage(...)`, the render task, or canvas operations will propagate to the caller; resources are still cleaned up in such cases.
 * - The function uses `page.getViewport({ scale: pageViewportScale })` so `width` and `height` reflect the viewport dimensions at the given scale.
 * - `rotation` is taken from `page.rotate` — the intrinsic page rotation stored in the PDF (0, 90, 180, or 270).
 *
 * @param pdf - The PDF.js document proxy (`PDFDocumentProxy`) from which to obtain and render the page.
 * @param pageName - A human-readable name/identifier for the page (used in the returned `PngPageOutput.name`).
 * @param pageNumber - The 1-based page index to render.
 * @param pageViewportScale - The scale factor passed to `page.getViewport({ scale })` to control output resolution.
 * @param returnPageContent - If true, the function will include a PNG buffer (`content`) in the returned `PngPageOutput`; otherwise `content` will be `undefined`. Ignored when `returnMetadataOnly` is true.
 * @param returnMetadataOnly - If true, skip canvas creation and rendering entirely; return only dimensions and rotation.
 *
 * @returns A promise that resolves to a `PngPageOutput` containing page metadata and optionally the PNG image buffer.
 *
 * @throws If retrieving the page, creating the canvas/context, rendering the page, or converting the canvas to a PNG buffer fails.
 */
async function processPdfPage(
    pdf: PDFDocumentProxy,
    pageName: string,
    pageNumber: number,
    pageViewportScale: number,
    returnPageContent: boolean,
    returnMetadataOnly: boolean,
): Promise<PngPageOutput> {
    const page = await pdf.getPage(pageNumber);
    const viewport = page.getViewport({ scale: pageViewportScale });

    if (returnMetadataOnly) {
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

    const canvasFactory = pdf.canvasFactory ? (pdf.canvasFactory as NodeCanvasFactory) : new NodeCanvasFactory();

    const { canvas, context } = canvasFactory.create(viewport.width, viewport.height);

    try {
        await page.render({ canvasContext: context, viewport, canvas }).promise;

        const pngPageOutput: PngPageOutput = {
            pageNumber,
            name: pageName,
            content: returnPageContent ? canvas!.toBuffer('image/png') : undefined,
            path: '',
            width: viewport.width,
            height: viewport.height,
            rotation: page.rotate,
        };
        return pngPageOutput;
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
 * @param outputFolder - Destination folder on disk where the PNG file will be saved.
 *
 * @returns A Promise that resolves when the file has been successfully written.
 *
 * @throws {Error} If `pngPageOutput.content` is `undefined`.
 * @throws {NodeJS.ErrnoException} If the underlying file system write operation fails,
 *   the original error from `fsPromises.writeFile` will be propagated.
 */
async function savePNGfile(pngPageOutput: PngPageOutput, outputFolder: string): Promise<void> {
    const resolvedOutputFolder = resolve(outputFolder);
    const resolvedFilePath = resolve(outputFolder, pngPageOutput.name);

    // Guard against path-traversal via .. segments or cross-drive absolute paths.
    // Use a segment-aware check (rel === '..' or starts with '../') to avoid false positives
    // on legitimate filenames that begin with '..', e.g. '..evil.png'.
    if (isEscapingRelativePath(relative(resolvedOutputFolder, resolvedFilePath))) {
        throw new Error(`Output file name escapes the output folder: ${pngPageOutput.name}`);
    }

    // Guard against symlink-based escapes: resolve symlinks in the output folder and in the
    // file's parent directory, then re-check containment.
    const realOutputFolder = await fsPromises.realpath(resolvedOutputFolder);
    const realFileDir = await fsPromises.realpath(dirname(resolvedFilePath));
    if (isEscapingRelativePath(relative(realOutputFolder, realFileDir))) {
        throw new Error(`Output file name escapes the output folder: ${pngPageOutput.name}`);
    }

    pngPageOutput.path = resolvedFilePath;
    if (pngPageOutput.content === undefined) {
        throw new Error(`Cannot write PNG file "${pngPageOutput.path}" because content is undefined.`);
    }
    await fsPromises.writeFile(pngPageOutput.path, pngPageOutput.content as Buffer);
}
