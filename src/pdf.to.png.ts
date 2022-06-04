import { Canvas, CanvasRenderingContext2D } from 'canvas';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { parse, resolve } from 'path';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf';
import * as pdfApiTypes from 'pdfjs-dist/types/src/display/api';
import * as pdfDisplayUtilsTypes from 'pdfjs-dist/types/src/display/display_utils';
import { PdfToPngOptions, PngPageOutput } from '.';
import { PDF_TO_PNG_OPTIONS_DEFAULTS } from './const';

import { CanvasContext, NodeCanvasFactory } from './node.canvas.factory';
import { propsToPdfDocInitParams } from './props.to.pdf.doc.init.params';

export async function pdfToPng(pdfFilePathOrBuffer: string | ArrayBufferLike, props?: PdfToPngOptions): Promise<PngPageOutput[]> {
    const isBuffer: boolean = Buffer.isBuffer(pdfFilePathOrBuffer);

    if (!isBuffer && !existsSync(pdfFilePathOrBuffer as string)) {
        throw Error(`PDF file not found on: ${pdfFilePathOrBuffer}.`);
    }

    if (props?.outputFolder && !existsSync(props.outputFolder)) {
        mkdirSync(props.outputFolder, { recursive: true });
    }

    const pdfFileBuffer: ArrayBuffer = isBuffer
        ? (pdfFilePathOrBuffer as ArrayBuffer)
        : readFileSync(pdfFilePathOrBuffer as string);

    const pdfDocInitParams: pdfApiTypes.DocumentInitParameters = propsToPdfDocInitParams(props);
    pdfDocInitParams.data = new Uint8Array(pdfFileBuffer);

    const pdfDocument: pdfApiTypes.PDFDocumentProxy = await pdfjs.getDocument(pdfDocInitParams).promise;
    const pngPagesOutput: PngPageOutput[] = [];

    const targetedPages: number[] = props?.pagesToProcess !== undefined
        ? props.pagesToProcess
        : Array.from({ length: pdfDocument.numPages }, (_, index) => index + 1);

    if (props?.strictPagesToProcess && targetedPages.some((pageNum) => pageNum < 1)) {
        throw new Error('Invalid pages requested, page numbers must be >= 1');
    }

    if (props?.strictPagesToProcess && targetedPages.some((pageNum) => pageNum > pdfDocument.numPages)) {
        throw new Error('Invalid pages requested, page numbers must be <= total pages');
    }

    for (const pageNumber of targetedPages) {
        if (pageNumber > pdfDocument.numPages || pageNumber < 1) {
            // If a requested page is beyond the PDF bounds we skip it.
            // This allows the use case "generate up to the first n pages from a set of input PDFs"
            continue;
        }
        const page: pdfApiTypes.PDFPageProxy = await pdfDocument.getPage(pageNumber);
        const viewport: pdfDisplayUtilsTypes.PageViewport = page.getViewport({
            scale: props?.viewportScale  !== undefined 
                ? props.viewportScale 
                : (PDF_TO_PNG_OPTIONS_DEFAULTS.viewportScale as number),
        });
        const canvasFactory = new NodeCanvasFactory();
        const canvasAndContext: CanvasContext = canvasFactory.create(viewport.width, viewport.height);

        const renderContext: pdfApiTypes.RenderParameters = {
            canvasContext: canvasAndContext.context as CanvasRenderingContext2D,
            viewport,
            canvasFactory,
        };

        await page.render(renderContext).promise;

        let pageName;
        if (props?.outputFileMask) {
            pageName = props.outputFileMask;
        }
        if (!pageName && !isBuffer) {
            pageName = parse(pdfFilePathOrBuffer as string).name;
        }
        if (!pageName) {
            pageName = PDF_TO_PNG_OPTIONS_DEFAULTS.outputFileMask;
        }
        const pngPageOutput: PngPageOutput = {
            name: `${pageName}_page_${pageNumber}.png`,
            content: (canvasAndContext.canvas as Canvas).toBuffer(),
            path: '',
        };

        if (props?.outputFolder) {
            pngPageOutput.path = resolve(props.outputFolder, pngPageOutput.name);
            writeFileSync(pngPageOutput.path, pngPageOutput.content);
        }

        pngPagesOutput.push(pngPageOutput);
    }

    return pngPagesOutput;
}
