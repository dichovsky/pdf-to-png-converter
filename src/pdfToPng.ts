import { promises as fsPromises } from 'node:fs';
import { parse, resolve } from 'node:path';
import { PDFDocumentProxy } from 'pdfjs-dist';
import { PDF_TO_PNG_OPTIONS_DEFAULTS } from './const';
import { propsToPdfDocInitParams } from './propsToPdfDocInitParams';
import { PdfToPngOptions, PngPageOutput } from './types';
import { NodeCanvasFactory } from './node.canvas.factory';

/**
 * Converts a PDF file to PNG images.
 *
 * @param {string | Buffer} pdfFile - The path to the PDF file or a buffer containing the PDF data.
 * @param {PdfToPngOptions} [props] - Optional properties to customize the conversion process.
 * @param {number[]} [props.pagesToProcess] - An array of page numbers to process.
 * @param {string} [props.outputFolder] - The folder where the output PNG files will be saved.
 * @param {number} [props.viewportScale] - The scale to apply to the page viewport.
 * @param {(pageNumber: number) => string} [props.outputFileMaskFunc] - A function to generate custom file names for the output PNG files.
 * @param {boolean} [props.strictPagesToProcess] - Whether to throw an error if invalid pages are requested.
 * @returns {Promise<PngPageOutput[]>} A promise that resolves to an array of PNG page outputs.
 *
 * @throws Will throw an error if invalid pages are requested when `strictPagesToProcess` is true.
 *
 * @example
 * ```typescript
 * const pngPages = await pdfToPng('/path/to/pdf/file.pdf', {
 *   pagesToProcess: [1, 2, 3],
 *   outputFolder: '/path/to/output/folder',
 *   viewportScale: 2.0,
 *   outputFileMaskFunc: (pageNumber) => `custom_name_page_${pageNumber}.png`,
 * });
 * ```
 */
export async function pdfToPng(pdfFile: string | Buffer, props?: PdfToPngOptions): Promise<PngPageOutput[]> {
    const isBuffer: boolean = Buffer.isBuffer(pdfFile);
    const pdfFileBuffer: Buffer = isBuffer 
        ? (pdfFile as Buffer) 
        : await fsPromises.readFile(pdfFile as string);
    const pdfDocument = await getPdfDocument(pdfFileBuffer, props);

    // Get the pages to process based on the provided options, invalid pages will be filtered out
    const pagesToProcess: number[] = props?.pagesToProcess ?? Array.from({ length: pdfDocument.numPages }, (_, index) => index + 1);
    const validPagesToProcess: number[] = pagesToProcess.filter((pageNumber) => pageNumber <= pdfDocument.numPages && pageNumber >= 1);

    // Process each page in parallel
    const pngPagesOutput: PngPageOutput[] = [];
    try {
        const pngPageOutputs: PngPageOutput[] = await Promise.all(
            validPagesToProcess.map((pageNumber) => {
                const pageViewportScale: number = props?.viewportScale !== undefined 
                    ? props.viewportScale 
                    : PDF_TO_PNG_OPTIONS_DEFAULTS.viewportScale;
                const defaultOutputFileMask: string = isBuffer 
                    ? PDF_TO_PNG_OPTIONS_DEFAULTS.outputFileMask 
                    : parse(pdfFile as string).name;
                const pageName: string = props?.outputFileMaskFunc?.(pageNumber) ?? `${defaultOutputFileMask}_page_${pageNumber}.png`;
                return processPdfPage(pdfDocument, pageName, pageNumber, pageViewportScale);
            }),
        );
        pngPagesOutput.push(...pngPageOutputs);
    } finally {
        await pdfDocument.cleanup();
    }

    // Save the PNG files to the output folder
    if (props?.outputFolder) {
        await fsPromises.mkdir(props.outputFolder, { recursive: true });

        await Promise.all(
            pngPagesOutput.map(async (pngPageOutput) => {
                pngPageOutput.path = resolve(props.outputFolder as string, pngPageOutput.name);
                await fsPromises.writeFile(pngPageOutput.path, pngPageOutput.content);
            })
        );
    }

    return pngPagesOutput;
}

/**
 * Asynchronously retrieves a PDF document from a given ArrayBuffer.
 *
 * @param pdfFileBuffer - The buffer containing the PDF file data.
 * @param props - Optional properties to customize the PDF document initialization.
 * @returns A promise that resolves to a PDFDocumentProxy object representing the PDF document.
 */
async function getPdfDocument(pdfFileBuffer: Buffer, props?: PdfToPngOptions) {
    const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs');
    const documentInitParameters = propsToPdfDocInitParams(props);
    return await getDocument({
        ...documentInitParameters,
        data: new Uint8Array(pdfFileBuffer),
    }).promise;
}

/**
 * Processes a single page of a PDF document and converts it to a PNG image.
 *
 * @param pdf - The PDF document proxy object.
 * @param pageName - The name to assign to the processed page.
 * @param pageNumber - The number of the page to process.
 * @param pageViewportScale - The scale to apply to the page viewport.
 * @returns A promise that resolves to an object containing the PNG image data and metadata.
 */
async function processPdfPage(pdf: PDFDocumentProxy, pageName: string, pageNumber: number, pageViewportScale: number) {
    const page = await pdf.getPage(pageNumber);
    const viewport = page.getViewport({ scale: pageViewportScale });
    const canvasFactory = new NodeCanvasFactory();
    const { canvas, context } = canvasFactory.create(viewport.width, viewport.height);

    await page.render({ canvasContext: context, viewport }).promise;
    const pngPageOutput: PngPageOutput = {
        pageNumber,
        name: pageName,
        content: canvas!.toBuffer('image/png'),
        path: '',
        width: viewport.width,
        height: viewport.height,
    };

    page.cleanup();
    canvasFactory.destroy({ canvas, context });
    return pngPageOutput;
}
