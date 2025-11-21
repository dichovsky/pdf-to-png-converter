import { promises as fsPromises } from 'node:fs';
import { join, parse } from 'node:path';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import { PDF_TO_PNG_OPTIONS_DEFAULTS } from './const';
import { NodeCanvasFactory } from './node.canvas.factory';
import { propsToPdfDocInitParams } from './propsToPdfDocInitParams';
import type { PdfToPngOptions, PngPageOutput } from './types';

/**
 * Convert one or more pages from a PDF into PNG images.
 *
 * This function:
 * - Loads the provided PDF (either a file path string or an ArrayBuffer-like object).
 * - Opens a PDFDocumentProxy and determines which pages to process.
 * - Filters out invalid page numbers (pages < 1 or > number of pages in the document).
 * - Renders each selected page to a PNG by calling an internal page-processing helper.
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
 *
 * Side effects:
 * - If `props.outputFolder` is specified the function will create the folder (recursive) under the current
 *   working directory and write each PNG file there. The `path` property of each returned `PngPageOutput`
 *   will be set to the written file path.
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
 *   - returnPageContent?: boolean       => Whether to include the PNG Buffer/Uint8Array in the returned output.
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
    // Read the PDF file and initialize the PDF document
    const pdfFileBuffer: ArrayBufferLike = await getPdfFileBuffer(pdfFile);
    const pdfDocument: PDFDocumentProxy = await getPdfDocument(pdfFileBuffer, props);

    // Get the pages to process based on the provided options, invalid pages will be filtered out
    const pagesToProcess: number[] = props?.pagesToProcess ?? Array.from({ length: pdfDocument.numPages }, (_, index) => index + 1);
    const validPagesToProcess: number[] = pagesToProcess.filter((pageNumber) => pageNumber <= pdfDocument.numPages && pageNumber >= 1);

    // Create output folder if specified
    if (props?.outputFolder !== undefined) {
        await fsPromises.mkdir(join(process.cwd(), props.outputFolder), { recursive: true });
    }

    // Process each page
    const pngPagesOutput: PngPageOutput[] = [];
    try {
        const pageViewportScale: number = props?.viewportScale !== undefined 
            ? props.viewportScale 
            : PDF_TO_PNG_OPTIONS_DEFAULTS.viewportScale;
        const defaultMask: string = typeof pdfFile === 'string' 
            ? parse(pdfFile).name 
            : PDF_TO_PNG_OPTIONS_DEFAULTS.outputFileMask;
        const pngPageOutputs: PngPageOutput[] = [];
        if (props?.processPagesInParallel === true) {
            // Limit concurrency to avoid memory issues with large PDFs
            const concurrencyLimit = props?.concurrencyLimit ?? PDF_TO_PNG_OPTIONS_DEFAULTS.concurrencyLimit;
            for (let i = 0; i < validPagesToProcess.length; i += concurrencyLimit) {
                const batch = validPagesToProcess.slice(i, i + concurrencyLimit);
                const batchResults = await Promise.all(
                    batch.map(async (pageNumber) => {
                        const pageOutput = await processPdfPage(
                            pdfDocument,
                            props?.outputFileMaskFunc?.(pageNumber) ?? `${defaultMask}_page_${pageNumber}.png`,
                            pageNumber,
                            pageViewportScale,
                            // If we need to save to disk, we must get the content, even if the user didn't ask for it in the return
                            props?.outputFolder ? true : (props?.returnPageContent ?? true),
                        );

                        if (props?.outputFolder) {
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
                    props?.outputFolder ? true : (props?.returnPageContent ?? true),
                );

                if (props?.outputFolder) {
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

    // Note: File saving is now handled within the loop above to allow for memory optimization

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
async function getPdfFileBuffer(pdfFile: string | ArrayBufferLike) {
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
                  throw new Error('Unsupported buffer type');
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
 * - Creates a canvas and drawing context (using a `NodeCanvasFactory` provided on the `pdf` object or by instantiating a new one).
 * - Renders the page into the canvas at the requested scale.
 * - Optionally extracts a PNG buffer from the rendered canvas if `returnPageContent` is true.
 * - Returns a `PngPageOutput` describing the page (including width, height, page number, name, and optional content).
 * - Ensures resources are cleaned up (calls `page.cleanup()` and `canvasFactory.destroy(...)`) even if rendering fails.
 *
 * Remarks:
 * - `pageNumber` is expected to be a 1-based page index as required by PDF.js `getPage`.
 * - The returned `PngPageOutput.path` is intentionally set to an empty string and should be populated by the caller if a filesystem path is needed.
 * - If `returnPageContent` is false, the `content` field of the returned object will be `undefined`.
 * - Errors originating from `pdf.getPage(...)`, the render task, or canvas operations will propagate to the caller; resources are still cleaned up in such cases.
 * - The function uses `page.getViewport({ scale: pageViewportScale })` so `width` and `height` reflect the viewport dimensions at the given scale.
 *
 * @param pdf - The PDF.js document proxy (`PDFDocumentProxy`) from which to obtain and render the page. May optionally expose a `canvasFactory` to control canvas creation/destruction.
 * @param pageName - A human-readable name/identifier for the page (used in the returned `PngPageOutput.name`).
 * @param pageNumber - The 1-based page index to render.
 * @param pageViewportScale - The scale factor passed to `page.getViewport({ scale })` to control output resolution.
 * @param returnPageContent - If true, the function will include a PNG buffer (`content`) in the returned `PngPageOutput`; otherwise `content` will be `undefined`.
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
) {
    const page = await pdf.getPage(pageNumber);
    const viewport = page.getViewport({ scale: pageViewportScale });
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
        };
        return pngPageOutput;
    } finally {
        page.cleanup();
        canvasFactory.destroy({ canvas, context });
    }
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
async function savePNGfile(pngPageOutput: PngPageOutput, outputFolder: string) {
    pngPageOutput.path = join(outputFolder, pngPageOutput.name);
    if (pngPageOutput.content === undefined) {
        throw new Error(`Cannot write PNG file "${pngPageOutput.path}" because content is undefined.`);
    }
    await fsPromises.writeFile(pngPageOutput.path, pngPageOutput.content as Buffer);
}
