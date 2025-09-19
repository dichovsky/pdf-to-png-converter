import { promises as fsPromises } from 'node:fs';
import { join, parse } from 'node:path';
import { PDFDocumentProxy } from 'pdfjs-dist';
import { PDF_TO_PNG_OPTIONS_DEFAULTS } from './const';
import { NodeCanvasFactory } from './node.canvas.factory';
import { propsToPdfDocInitParams } from './propsToPdfDocInitParams';
import { PdfToPngOptions, PngPageOutput } from './types';

/**
 * Converts a PDF file to PNG images, one per page.
 *
 * @param pdfFile - The PDF file to convert. Can be a file path (string) or an ArrayBufferLike.
 * @param props - Optional configuration options for the conversion process.
 * @returns A promise that resolves to an array of `PngPageOutput` objects, each representing a PNG image of a PDF page.
 *
 * @remarks
 * - If `pdfFile` is a string, it is treated as a file path and read from disk.
 * - The `props.pagesToProcess` option allows specifying which pages to convert (1-based indices).
 * - The `props.viewportScale` option controls the rendering scale of the PDF pages.
 * - The `props.outputFileMaskFunc` option allows customizing the output file name for each page.
 * - If `props.outputFolder` is provided, the PNG files are saved to the specified folder.
 * - The function processes pages in parallel for efficiency.
 * - All resources are cleaned up after processing.
 *
 * @throws Will throw if the PDF file cannot be read or processed.
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
                await fsPromises.writeFile(pngPageOutput.path, pngPageOutput.content);
            }),
        );
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
