import { promises as fsPromises } from 'node:fs';
import { parse, resolve } from 'node:path';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import { PDF_TO_PNG_OPTIONS_DEFAULTS } from './const.js';
import type { PdfToPngOptions, PngPageOutput } from './interfaces/index.js';
import type { OutputSink } from './interfaces/output.sink.js';
import { FilesystemSink } from './filesystemSink.js';
import { normalizePdfToPngOptions } from './normalizePdfToPngOptions.js';
import { NullSink } from './nullSink.js';
import { processAndSavePage, resolvePageName } from './pageOrchestrator.js';
import { getPdfFileBuffer } from './pdfInput.js';
import { getPdfDocument } from './pdfjsLoader.js';

async function processPagesWithSlidingWindow<T>(
    pageNumbers: number[],
    concurrencyLimit: number,
    processPage: (pageNumber: number) => Promise<T>,
): Promise<T[]> {
    const results = new Array<T>(pageNumbers.length);
    let nextIndex = 0;
    let firstError: unknown;

    async function runWorker(): Promise<void> {
        while (firstError === undefined && nextIndex < pageNumbers.length) {
            const currentIndex = nextIndex;
            nextIndex += 1;
            try {
                results[currentIndex] = await processPage(pageNumbers[currentIndex]);
            } catch (error: unknown) {
                firstError ??= error;
            }
        }
    }

    const workerCount = Math.min(concurrencyLimit, pageNumbers.length);
    await Promise.allSettled(Array.from({ length: workerCount }, () => runWorker()));

    if (firstError !== undefined) {
        throw firstError;
    }

    return results;
}

export async function pdfToPng(pdfFile: string | ArrayBufferLike | Uint8Array, props?: PdfToPngOptions): Promise<PngPageOutput[]> {
    const normalizedProps = normalizePdfToPngOptions(props);
    const pageViewportScale = normalizedProps.viewportScale;
    const pdfFileBuffer: Uint8Array | ArrayBufferLike = await getPdfFileBuffer(pdfFile);
    const pdfDocument: PDFDocumentProxy = await getPdfDocument(pdfFileBuffer, normalizedProps);
    const pagesToProcess: number[] =
        normalizedProps.pagesToProcess ?? Array.from({ length: pdfDocument.numPages }, (_, index) => index + 1);
    const validPagesToProcess: number[] = pagesToProcess.filter((pageNumber) => pageNumber <= pdfDocument.numPages && pageNumber >= 1);
    const returnMetadataOnly = normalizedProps.returnMetadataOnly;
    const resolvedOutputFolder: string | undefined =
        normalizedProps.outputFolder !== undefined && !returnMetadataOnly ? resolve(normalizedProps.outputFolder) : undefined;
    if (resolvedOutputFolder !== undefined) {
        await fsPromises.mkdir(resolvedOutputFolder, { recursive: true });
    }
    const realOutputFolder: string | undefined =
        resolvedOutputFolder !== undefined ? await fsPromises.realpath(resolvedOutputFolder) : undefined;
    const pngPageOutputs: PngPageOutput[] = [];

    try {
        const defaultMask: string = typeof pdfFile === 'string' ? parse(pdfFile).name : PDF_TO_PNG_OPTIONS_DEFAULTS.outputFileMask;
        const shouldReturnContent: boolean = returnMetadataOnly
            ? false
            : normalizedProps.outputFolder
              ? true
              : normalizedProps.returnPageContent;
        const outputSink: OutputSink | undefined =
            resolvedOutputFolder !== undefined && realOutputFolder !== undefined
                ? new FilesystemSink(resolvedOutputFolder, realOutputFolder)
                : shouldReturnContent
                  ? new NullSink()
                  : undefined;
        const processPage = async (pageNumber: number): Promise<PngPageOutput> =>
            await processAndSavePage(
                pdfDocument,
                resolvePageName(pageNumber, defaultMask, normalizedProps.outputFileMaskFunc),
                pageNumber,
                pageViewportScale,
                shouldReturnContent,
                returnMetadataOnly,
                outputSink,
                normalizedProps.returnPageContent,
            );

        if (normalizedProps.processPagesInParallel === true) {
            pngPageOutputs.push(
                ...(await processPagesWithSlidingWindow(validPagesToProcess, normalizedProps.concurrencyLimit, processPage)),
            );
        } else {
            for (const pageNumber of validPagesToProcess) {
                pngPageOutputs.push(await processPage(pageNumber));
            }
        }
    } finally {
        await pdfDocument.destroy();
    }

    return pngPageOutputs;
}
