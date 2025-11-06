import { promises as fsPromises } from 'node:fs';
import { join, parse } from 'node:path';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import { PDF_TO_PNG_OPTIONS_DEFAULTS } from './const';
import { NodeCanvasFactory } from './node.canvas.factory';
import { propsToPdfDocInitParams } from './propsToPdfDocInitParams';
import type { PdfToPngOptions, PngPageOutput } from './types';

/**
 * Convert a PDF (file path, ArrayBuffer-like, or Node Buffer) into one or more PNG images.
 *
 * The function:
 * - Accepts a PDF specified as a filesystem path (string), an ArrayBuffer-like object, or a Node Buffer.
 * - Normalizes input to an ArrayBuffer-like representation and opens the PDF via an internal document loader.
 * - Determines which pages to render using props.pagesToProcess (or all pages by default) and filters out invalid page numbers.
 * - Renders each valid page in parallel using a viewport scale (props.viewportScale or default) and an output file naming strategy
 *   (props.outputFileMaskFunc, or a default mask derived from the input filename or default mask constant).
 * - Cleans up the PDF document handle in a finally block to ensure resources are released.
 * - Optionally writes PNG files to disk when props.outputFolder is provided (creating the folder recursively). When saving,
 *   each returned PngPageOutput will have its path property set to the written file path and its content written as a Buffer.
 * - Optionally omits in-memory image content from the returned objects when props.returnPageContent === false.
 *
 * @param pdfFile - A filesystem path to a PDF (string), an ArrayBuffer-like object, or a Node Buffer containing PDF bytes.
 * @param props - Optional conversion options (PdfToPngOptions):
 *   - pagesToProcess?: number[]         — specific page numbers to render (1-based). Defaults to all pages.
 *   - viewportScale?: number           — scale factor for rendering the page viewport. Defaults to library default.
 *   - outputFileMask?: string          — base filename mask to use when input is not a path.
 *   - outputFileMaskFunc?: (n) => string — function to produce the output filename for a given page number.
 *   - outputFolder?: string            — folder (relative to process.cwd()) to write PNG files into. If omitted, files are not written.
 *   - returnPageContent?: boolean      — when false, the returned PngPageOutput objects will not include the binary content.
 *
 * @returns A promise that resolves to an array of PngPageOutput objects (one per processed page). Each object contains
 *   metadata such as the output filename, binary content (unless omitted via options), and, when files are written, the file path.
 *
 * @remarks
 * - Page numbers are 1-based; invalid page numbers (<= 0 or > document page count) are ignored.
 * - Rendering of pages is performed in parallel; callers should be mindful of memory and CPU usage for large documents or high parallelism.
 * - If pdfFile is a string path, the implementation will attempt to derive a default filename mask from that path.
 * - The function will always attempt to clean up PDF-related resources even if rendering or writing fails.
 *
 * @throws Will throw if:
 *   - The pdfFile cannot be read when given as a string path.
 *   - The supplied buffer type cannot be normalized to an ArrayBuffer-like object.
 *   - PDF document loading or page rendering fails.
 *   - Writing output files to disk fails (when outputFolder is specified).
 *
 * @example
 * // Convert all pages and save to "./out"
 * await pdfToPng("/path/to/file.pdf", { outputFolder: "./out" });
 *
 * @see PdfToPngOptions, PngPageOutput, getPdfDocument
 */
export async function pdfToPng(pdfFile: string | ArrayBufferLike, props?: PdfToPngOptions): Promise<PngPageOutput[]> {
    // Read the PDF file and initialize the PDF document
    const pdfFileBuffer: ArrayBufferLike = await getPdfFileBuffer(pdfFile);
    const pdfDocument: PDFDocumentProxy = await getPdfDocument(pdfFileBuffer, props);

    // Get the pages to process based on the provided options, invalid pages will be filtered out
    const pagesToProcess: number[] = props?.pagesToProcess ?? Array.from({ length: pdfDocument.numPages }, (_, index) => index + 1);
    const validPagesToProcess: number[] = pagesToProcess.filter((pageNumber) => pageNumber <= pdfDocument.numPages && pageNumber >= 1);

    // Process each page in parallel
    const pngPagesOutput: PngPageOutput[] = [];
    try {
        const pageViewportScale: number = props?.viewportScale !== undefined 
            ? props.viewportScale 
            : PDF_TO_PNG_OPTIONS_DEFAULTS.viewportScale;
        const defaultMask: string = typeof pdfFile === 'string' 
            ? parse(pdfFile as string).name 
            : PDF_TO_PNG_OPTIONS_DEFAULTS.outputFileMask;
        const pngPageOutputs: PngPageOutput[] = await Promise.all(
            validPagesToProcess.map((pageNumber) => {
                const pageName: string = props?.outputFileMaskFunc?.(pageNumber) ?? `${defaultMask}_page_${pageNumber}.png`;
                return processPdfPage(pdfDocument, pageName, pageNumber, pageViewportScale, props?.returnPageContent ?? true);
            }),
        );
        pngPagesOutput.push(...pngPageOutputs);
    } finally {
        await pdfDocument.cleanup();
    }

    // Save the PNG files to the output folder
    if (props?.outputFolder !== undefined) {
        const outputFolder: string = join(process.cwd(), props.outputFolder);
        await fsPromises.mkdir(outputFolder, { recursive: true });

        await Promise.all(
            pngPagesOutput.map(async (pngPageOutput) => {
                pngPageOutput.path = join(outputFolder, pngPageOutput.name);
                if (pngPageOutput.content === undefined) {
                    throw new Error(`Cannot write PNG file "${pngPageOutput.path}" because content is undefined.`);
                }
                await fsPromises.writeFile(pngPageOutput.path, pngPageOutput.content as Buffer);
            }),
        );
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
