import { Canvas, CanvasRenderingContext2D } from 'canvas';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { parse, resolve } from 'path';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf';
import {
    DocumentInitParameters,
    PDFDocumentProxy,
    PDFPageProxy,
    RenderParameters
} from 'pdfjs-dist/types/src/display/api';
import { PageViewport } from 'pdfjs-dist/types/src/display/display_utils';
import { NodeCanvasFactory } from './node.canvas.factory';

const cMapUrl = '../node_modules/pdfjs-dist/cmaps/';
const cMapPacked = true;

export type PdfToPngOptions = {
    viewportScale?: number;
    outputFilesFolder?: string;
    disableFontFace?: boolean;
    useSystemFonts?: boolean;
    pdfFilePassword?: string;
    outputFileMask?: string;
};

export type PngPageOutput = {
    name: string;
    content: Buffer;
    path: string;
};

export async function pdfToPng(
    pdfFilePathOrBuffer: string | ArrayBufferLike,
    props?: PdfToPngOptions,
): Promise<PngPageOutput[]> {
    const isBuffer: boolean = Buffer.isBuffer(pdfFilePathOrBuffer);

    if (!isBuffer && !existsSync(pdfFilePathOrBuffer as string)) {
        throw Error(`PDF file not found on: ${pdfFilePathOrBuffer}.`);
    }

    if (props?.outputFilesFolder && !existsSync(props.outputFilesFolder)) {
        mkdirSync(props.outputFilesFolder, { recursive: true });
    }

    if (!props?.outputFileMask && isBuffer) {
        throw Error('outputFileMask is required when input is a Buffer.');
    }
    const pdfFileBuffer: ArrayBuffer = isBuffer ? pdfFilePathOrBuffer as ArrayBuffer : readFileSync(pdfFilePathOrBuffer as string);
    const pdfDocInitParams: DocumentInitParameters = {
        data: new Uint8Array(pdfFileBuffer),
        cMapUrl,
        cMapPacked,
    };

    pdfDocInitParams.disableFontFace = props?.disableFontFace ?? true;
    pdfDocInitParams.useSystemFonts = props?.useSystemFonts ?? false;

    if (props?.pdfFilePassword) {
        pdfDocInitParams.password = props?.pdfFilePassword;
    }

    const pdfDocument: PDFDocumentProxy = await pdfjs.getDocument(pdfDocInitParams).promise;
    const pngPagesOutput: PngPageOutput[] = [];

    for (let pageNumber = 1; pageNumber <= pdfDocument.numPages; pageNumber++) {
        const page: PDFPageProxy = await pdfDocument.getPage(pageNumber);
        const viewport: PageViewport = page.getViewport({ scale: props?.viewportScale ?? 1.0 });
        const canvasFactory = new NodeCanvasFactory();
        const canvasAndContext = canvasFactory.create(viewport.width, viewport.height);

        const renderContext: RenderParameters = {
            canvasContext: canvasAndContext.context as CanvasRenderingContext2D,
            viewport,
            canvasFactory,
        };

        await page.render(renderContext).promise;
        const pageName: string = props?.outputFileMask ?? parse(pdfFilePathOrBuffer as string).name;
        const pngPageOutput: PngPageOutput = {
            name: `${pageName}_page_${pageNumber}.png`,
            content: (canvasAndContext.canvas as Canvas).toBuffer(),
            path: '',
        };

        if (props?.outputFilesFolder) {
            pngPageOutput.path = resolve(props.outputFilesFolder, pngPageOutput.name);
            writeFileSync(pngPageOutput.path, pngPageOutput.content);
        }

        pngPagesOutput.push(pngPageOutput);
    }

    return pngPagesOutput;
}
