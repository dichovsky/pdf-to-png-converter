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
 * @param pdfFile - The path to the PDF file or a buffer containing the PDF data.
 * @param props - Optional properties to customize the conversion process.
 * @returns A promise that resolves to an array of PNG page outputs.
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

export async function pdfToPng(pdfFile: string | ArrayBufferLike, props?: PdfToPngOptions): Promise<PngPageOutput[]> {
    const isString: boolean = typeof pdfFile == "string";
    const pdfFileBuffer: ArrayBufferLike = isString ? (await fsPromises.readFile(pdfFile as string)).buffer : pdfFile as ArrayBufferLike;
    const pdfDocument = await getPdfDocument(pdfFileBuffer, props);
    // Get the pages to process based on the provided options, invalid pages will be filtered out
    const pagesToProcess: number[] = props?.pagesToProcess ?? Array.from({ length: pdfDocument.numPages }, (_, index) => index + 1);
    const pngPagesOutput: PngPageOutput[] = [];

    try {
        // Process each page in parallel
        const pngPageOutputs = await Promise.all(
            pagesToProcess
                // Filter out invalid page numbers
                .filter((pageNumber) => pageNumber <= pdfDocument.numPages && pageNumber >= 1)
                // Process the page
                .map((pageNumber) => {
                    const pageViewportScale: number =
                        props?.viewportScale !== undefined ? props.viewportScale : PDF_TO_PNG_OPTIONS_DEFAULTS.viewportScale;
                    const defaultMask: string = isString ? parse(pdfFile as string).name : PDF_TO_PNG_OPTIONS_DEFAULTS.outputFileMask;
                    const pageName: string = props?.outputFileMaskFunc?.(pageNumber) ?? `${defaultMask}_page_${pageNumber}.png`;
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

        for (const pngPageOutput of pngPagesOutput) {
            pngPageOutput.path = resolve(props.outputFolder, pngPageOutput.name);
            await fsPromises.writeFile(pngPageOutput.path, pngPageOutput.content);

            pngPageOutput.path = resolve(props.outputFolder, pngPageOutput.name);
        }
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
async function getPdfDocument(pdfFileBuffer: ArrayBufferLike, props?: PdfToPngOptions): Promise<PDFDocumentProxy> {
    const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs');
    const documentInitParameters = propsToPdfDocInitParams(props);
    return await getDocument({
        ...documentInitParameters,
        data: new Uint8Array(pdfFileBuffer),
    }).promise;
}

async function processPdfPage(
    pdfDocument: PDFDocumentProxy,
    pageName: string,
    pageNumber: number,
    pageViewportScale: number,
): Promise<PngPageOutput> {
    const page = await pdfDocument.getPage(pageNumber);
    const viewport = page.getViewport({ scale: pageViewportScale });
    const canvasFactory = new NodeCanvasFactory();
    const { canvas, context } = canvasFactory.create(viewport.width, viewport.height);

    await page.render({ canvasContext: context, viewport }).promise;
    const pngPageOutput: PngPageOutput = {
        pageNumber,
        name: pageName,
        content: canvas.toBuffer('image/png'),
        path: '',
        width: viewport.width,
        height: viewport.height,
    };

    page.cleanup();
    canvasFactory.destroy({ canvas, context });
    return pngPageOutput;
}
