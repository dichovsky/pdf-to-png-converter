import type { PDFDocumentProxy } from 'pdfjs-dist';
import type { FilePngPageOutput, PngPageOutput } from './interfaces/index.js';
import type { OutputSink } from './interfaces/output.sink.js';
import { getPageMetadata, renderPdfPage } from './pageRenderer.js';

export function resolvePageName(
    pageNumber: number,
    defaultMask: string,
    outputFileMaskFunc: ((page: number) => string) | undefined,
): string {
    if (outputFileMaskFunc === undefined) {
        return `${defaultMask}_page_${pageNumber}.png`;
    }

    const name: string = outputFileMaskFunc(pageNumber);
    if (!name) {
        throw new Error(
            `outputFileMaskFunc returned an empty filename for page ${pageNumber}. Provide a non-empty string including the .png extension.`,
        );
    }

    return name;
}

export async function processAndSavePage(
    pdfDocument: PDFDocumentProxy,
    pageName: string,
    pageNumber: number,
    pageViewportScale: number,
    shouldReturnContent: boolean,
    returnMetadataOnly: boolean,
    outputSink: OutputSink | undefined,
    returnPageContent: boolean | undefined,
): Promise<PngPageOutput> {
    if (returnMetadataOnly) {
        return await getPageMetadata(pdfDocument, pageName, pageNumber, pageViewportScale);
    }

    const pageOutput = await renderPdfPage(pdfDocument, pageName, pageNumber, pageViewportScale, shouldReturnContent);

    if (outputSink !== undefined) {
        if (pageOutput.content === undefined) {
            throw new Error(`Cannot write PNG file "${pageOutput.name}" because content is undefined.`);
        }
        const resolvedPath = await outputSink.write(pageOutput.name, pageOutput.content);
        if (resolvedPath === '') {
            return pageOutput;
        }
        const filePageOutput: FilePngPageOutput = {
            ...pageOutput,
            kind: 'file',
            path: resolvedPath,
            content: returnPageContent === false ? undefined : pageOutput.content,
        };
        return filePageOutput;
    }

    return pageOutput;
}
