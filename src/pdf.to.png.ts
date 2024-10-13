import { promises } from 'node:fs';
import { parse, resolve } from 'node:path';
import { PdfToPngOptions, PngPageOutput } from '.';
import { PDF_TO_PNG_OPTIONS_DEFAULTS } from './const';
import { NodeCanvasFactory } from './node.canvas.factory';
import { propsToPdfDocInitParams } from './props.to.pdf.doc.init.params';

/**
 * Converts a PDF file to PNG images.
 * @param pdfFilePathOrBuffer - The path to the PDF file or a buffer containing the PDF file.
 * @param props - Optional configuration options for the conversion process.
 * @returns An array of objects containing information about each generated PNG image.
 */
export async function pdfToPng(
    pdfFilePathOrBuffer: string | ArrayBufferLike,
    props?: PdfToPngOptions,
): Promise<PngPageOutput[]> {
    const isBuffer: boolean = Buffer.isBuffer(pdfFilePathOrBuffer);

    const pdfFileBuffer: ArrayBuffer = isBuffer
        ? (pdfFilePathOrBuffer as ArrayBuffer)
        : await promises.readFile(pdfFilePathOrBuffer as string);

    const pdfDocInitParams = {
        ...propsToPdfDocInitParams(props),
        data: new Uint8Array(pdfFileBuffer),
    };

    const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs');
    const pdfDocument = await getDocument(pdfDocInitParams).promise;
    const canvasFactory = pdfDocument.canvasFactory as NodeCanvasFactory;

    const targetedPageNumbers: number[] =
        props?.pagesToProcess !== undefined
            ? props.pagesToProcess
            : Array.from({ length: pdfDocument.numPages }, (_, index) => index + 1);

    if (props?.strictPagesToProcess && targetedPageNumbers.some((pageNum) => pageNum < 1)) {
        throw new Error('Invalid pages requested, page number must be >= 1');
    }
    if (props?.strictPagesToProcess && targetedPageNumbers.some((pageNum) => pageNum > pdfDocument.numPages)) {
        throw new Error('Invalid pages requested, page number must be <= total pages');
    }
    if (props?.outputFolder) {
        await promises.mkdir(props.outputFolder, { recursive: true });
    }

    const outputFileMask: string =
        props?.outputFileMask !== undefined
            ? props.outputFileMask
            : isBuffer
                ? PDF_TO_PNG_OPTIONS_DEFAULTS.outputFileMask
                : parse(pdfFilePathOrBuffer as string).name;

    const pngPagesOutput: PngPageOutput[] = [];

    for (const pageNumber of targetedPageNumbers) {
        if (pageNumber > pdfDocument.numPages || pageNumber < 1) {
            // If a requested page is beyond the PDF bounds we skip it.
            // This allows the use case "generate up to the first n pages from a set of input PDFs"
            continue;
        }
        const page = await pdfDocument.getPage(pageNumber);
        const viewport = page.getViewport({
            scale: props?.viewportScale !== undefined ? props.viewportScale : PDF_TO_PNG_OPTIONS_DEFAULTS.viewportScale,
        });
        const { canvas, context } = canvasFactory.create(viewport.width, viewport.height);

        await page.render({ canvasContext: context, viewport }).promise;
        const pngPageOutput: PngPageOutput = {
            pageNumber,
            name: `${outputFileMask}_page_${pageNumber}.png`,
            content: canvas.toBuffer(),
            path: '',
            width: viewport.width,
            height: viewport.height,
        };

        if (props?.outputFolder) {
            pngPageOutput.path = resolve(props.outputFolder, pngPageOutput.name);
            await promises.writeFile(pngPageOutput.path, pngPageOutput.content);
        }

        pngPagesOutput.push(pngPageOutput);

        page.cleanup();
    }
    await pdfDocument.cleanup();
    return pngPagesOutput;
}
