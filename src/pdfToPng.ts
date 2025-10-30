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
export async function pdfToPng(pdfFile: string | ArrayBufferLike | Buffer, props?: PdfToPngOptions): Promise<PngPageOutput[]> {
    // Read the PDF file and initialize the PDF document
    const isString: boolean = typeof pdfFile == 'string';
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
    const pdfDocument = await getPdfDocument(pdfFileBuffer, props);

    // Get the pages to process based on the provided options, invalid pages will be filtered out
    const pagesToProcess: number[] = props?.pagesToProcess ?? Array.from({ length: pdfDocument.numPages }, (_, index) => index + 1);
    const validPagesToProcess: number[] = pagesToProcess.filter((pageNumber) => pageNumber <= pdfDocument.numPages && pageNumber >= 1);

    // Process each page in parallel
    const pngPagesOutput: PngPageOutput[] = [];
    try {
        const pageViewportScale: number =
            props?.viewportScale !== undefined ? props.viewportScale : PDF_TO_PNG_OPTIONS_DEFAULTS.viewportScale;
        const defaultMask: string = isString ? parse(pdfFile as string).name : PDF_TO_PNG_OPTIONS_DEFAULTS.outputFileMask;

        const pngPageOutputs: PngPageOutput[] = await Promise.all(
            validPagesToProcess.map((pageNumber) => {
                const pageName: string = props?.outputFileMaskFunc?.(pageNumber) ?? `${defaultMask}_page_${pageNumber}.png`;
                return processPdfPage(pdfDocument, pageName, pageNumber, pageViewportScale);
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
                await fsPromises.writeFile(pngPageOutput.path, pngPageOutput.content as Buffer);
            }),
        );
    }

    if (props?.returnPageContent === false) {
        for (const pngPageOutput of pngPagesOutput) {
            delete pngPageOutput.content;
        }
    }

    return pngPagesOutput;
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
 * Renders a specific page of a PDF document to a PNG image buffer.
 *
 * @param pdf - The PDF.js document proxy representing the loaded PDF.
 * @param pageName - The name to associate with the rendered page.
 * @param pageNumber - The 1-based index of the page to render.
 * @param pageViewportScale - The scale factor to apply to the page viewport for rendering.
 * @returns A promise that resolves to a `PngPageOutput` object containing the rendered PNG buffer and page metadata.
 */
async function processPdfPage(pdf: PDFDocumentProxy, pageName: string, pageNumber: number, pageViewportScale: number) {
    const page = await pdf.getPage(pageNumber);
    const viewport = page.getViewport({ scale: pageViewportScale });
    const canvasFactory = pdf.canvasFactory ? (pdf.canvasFactory as NodeCanvasFactory) : new NodeCanvasFactory();

    const { canvas, context } = canvasFactory.create(viewport.width, viewport.height);

    try {
        await page.render({ canvasContext: context, viewport, canvas }).promise;
        const pngPageOutput: PngPageOutput = {
            pageNumber,
            name: pageName,
            content: canvas!.toBuffer('image/png'),
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
